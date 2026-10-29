#!/usr/bin/python3
"""Root-owned, fixed-path Journey release receiver and activation coordinator.

Only receive/status are exposed through sudo. activate is invoked by systemd.
Release files are data to this process; application code always runs as journey.
"""
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import signal
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request

BASE = Path('/opt/journey')
STATE = Path('/var/lib/journey-deploy/state')
SELF = '/usr/local/libexec/journey/deploy-release.py'
ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9._-]{0,95}\Z')
SHA = re.compile(r'[a-f0-9]{64}\Z')
COMMIT = re.compile(r'[a-f0-9]{40}\Z')
PROTECTED = re.compile(r'l4d2|srcds|left4dead|controller', re.I)
MAX_ARCHIVE = 100 * 1024 * 1024
MAX_EXPANDED = 400 * 1024 * 1024
DISK_RESERVE = 1024 * 1024 * 1024


def require_space(path):
    available = shutil.disk_usage(path).free
    required = DISK_RESERVE + MAX_ARCHIVE + MAX_EXPANDED
    if available < required:
        raise RuntimeError(f'Insufficient deployment disk space: {available} bytes free; {required} required')
TERMINAL = {'success': 0, 'failed': 1, 'rolled_back': 1, 'rollback_failed': 1}


def run(*args, timeout=60):
    return subprocess.run(args, check=True, text=True, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, timeout=timeout).stdout


def atomic_json(path, value):
    fd, temporary = tempfile.mkstemp(prefix='.state-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as out:
            json.dump(value, out, sort_keys=True)
            out.write('\n')
            out.flush()
            os.fsync(out.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def archive_name(name):
    while name.startswith('./'):
        name = name[2:]
    if name in ('', '.'):
        return ''
    p = PurePosixPath(name)
    if p.is_absolute() or '..' in p.parts or '\\' in name or '\x00' in name:
        raise ValueError('Unsafe archive path: ' + repr(name))
    return str(p)


def unpack(archive, destination, release, commit):
    """Validate the entire namespace before writing; never traverse symlinks."""
    with tarfile.open(archive, 'r:gz') as tar:
        members = {}
        expanded = 0
        for member in tar:
            name = archive_name(member.name)
            if not name:
                if not member.isdir():
                    raise ValueError('Invalid archive root')
                continue
            if name in members:
                raise ValueError('Duplicate archive path: ' + name)
            if not (member.isfile() or member.isdir() or member.issym()):
                raise ValueError('Unsupported archive entry: ' + name)
            expanded += member.size
            if expanded > MAX_EXPANDED or len(members) >= 30000:
                raise ValueError('Expanded archive exceeds limit')
            members[name] = member
        for name, member in members.items():
            for parent in PurePosixPath(name).parents:
                if str(parent) in members and not members[str(parent)].isdir():
                    raise ValueError('Non-directory archive ancestor: ' + name)
            if member.issym():
                target = member.linkname
                if not target or target.startswith('/') or '\\' in target:
                    raise ValueError('Unsafe symbolic link: ' + name)
                resolved = os.path.normpath(str(PurePosixPath(name).parent / target))
                if resolved == '..' or resolved.startswith('../') or resolved not in members:
                    raise ValueError('Escaping or dangling symbolic link: ' + name)
        digests = {}
        # Regular files first; symlinks cannot affect writes.
        for name, member in members.items():
            path = destination / name
            path.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
            if member.isdir():
                path.mkdir(exist_ok=True, mode=0o755)
            elif member.isfile():
                checksum = hashlib.sha256()
                with tar.extractfile(member) as source, path.open('xb') as output:
                    for chunk in iter(lambda: source.read(1024 * 1024), b''):
                        output.write(chunk)
                        checksum.update(chunk)
                digests[name] = checksum.hexdigest()
                path.chmod(0o755 if member.mode & 0o111 else 0o644)
        for name, member in members.items():
            if member.issym():
                (destination / name).symlink_to(member.linkname)
        for name, member in members.items():
            if member.issym():
                try:
                    (destination / name).resolve(strict=True).relative_to(destination.resolve())
                except (OSError, ValueError, RuntimeError) as error:
                    raise ValueError('Escaping, dangling, or cyclic symbolic link: ' + name) from error
        manifest_path = destination / 'release-manifest.json'
        if 'release-manifest.json' not in members or not members['release-manifest.json'].isfile():
            raise ValueError('Missing regular release manifest')
        if manifest_path.stat().st_size > 8 * 1024 * 1024:
            raise ValueError('Manifest exceeds size limit')
        manifest = json.loads(manifest_path.read_text())
        if manifest.get('release') != release or manifest.get('gitCommit') != commit:
            raise ValueError('Manifest provenance mismatch')
        entries = manifest.get('files')
        if not isinstance(entries, list):
            raise ValueError('Invalid manifest files')
        inventory = {}
        for entry in entries:
            name = entry.get('path')
            digest = entry.get('sha256')
            if not isinstance(name, str) or archive_name(name) != name or name in inventory:
                raise ValueError('Invalid manifest path')
            if not isinstance(digest, str) or not SHA.fullmatch(digest):
                raise ValueError('Invalid manifest digest')
            inventory[name] = digest
        actual = {name for name, member in members.items() if member.isfile()} - {'release-manifest.json'}
        if set(inventory) != actual:
            raise ValueError('Manifest inventory mismatch')
        for name, expected in inventory.items():
            if digests.get(name) != expected:
                raise ValueError('Manifest digest mismatch: ' + name)
        for name in ('server/index.mjs', 'dist/index.html', 'dist/build.json', 'package.json',
                     'package-lock.json', 'src/domain.js'):
            if name not in actual:
                raise ValueError('Missing essential regular file: ' + name)
        if not any(name.startswith('node_modules/') for name in actual):
            raise ValueError('Missing production dependencies')
        build = json.loads((destination / 'dist/build.json').read_text())
        if not isinstance(build.get('buildId'), str) or not build['buildId']:
            raise ValueError('Missing build identity')
        return build['buildId']


class Deployment:
    def __init__(self, release, base=None, state=None):
        if not ID.fullmatch(release):
            raise ValueError('Invalid release id')
        base = BASE if base is None else base
        state = STATE if state is None else state
        self.release, self.base, self.state = release, base, state
        self.path = state / (release + '.json')
        self.data = {}

    def save(self, status, **fields):
        self.data.update(fields, release=self.release, status=status, updatedAt=int(time.time()))
        atomic_json(self.path, self.data)

    def receive(self, digest, commit, source):
        if not SHA.fullmatch(digest) or not COMMIT.fullmatch(commit):
            raise ValueError('Invalid digest or commit')
        self.state.mkdir(parents=True, exist_ok=True, mode=0o700)
        (self.base / 'releases').mkdir(parents=True, exist_ok=True, mode=0o755)
        # Reservation never disappears, including rejected uploads.
        with self.path.open('x'):
            pass
        self.path.chmod(0o600)
        temporary = Path(tempfile.mkdtemp(prefix='.receive-', dir=self.state))
        self.data = {'gitCommit': commit, 'archiveSha256': digest}
        dispatched = False
        try:
            self.save('receiving')
            require_space(self.state)
            archive = temporary / 'release.tar.gz'
            total, checksum = 0, hashlib.sha256()
            with archive.open('xb') as output:
                while True:
                    chunk = source.read(1024 * 1024)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > MAX_ARCHIVE:
                        raise ValueError('Archive exceeds 100 MiB limit')
                    checksum.update(chunk)
                    output.write(chunk)
            if checksum.hexdigest() != digest:
                raise ValueError('Archive SHA256 mismatch')
            os.rename(archive, self.state / (self.release + '.tar.gz'))
            self.save('queued')
            dispatched = True
            run('systemd-run', '--quiet', '--collect', '--unit=journey-deploy-' + self.release,
                '--property=Type=exec', '--property=Nice=19', '--property=CPUQuota=20%',
                '--property=IOWeight=1', '--property=MemoryMax=256M',
                '--property=RuntimeMaxSec=26min', '--property=TimeoutStopSec=300',
                '--property=OOMPolicy=stop',
                '--property=ExecStopPost=' + SELF + ' recover ' + self.release,
                '--property=KillMode=mixed', SELF, 'activate', self.release)
        except BaseException as error:
            if dispatched:
                # systemd-run may have accepted the unit before the client timed out.
                # Never overwrite the worker's durable state after dispatch begins.
                self.data = json.loads(self.path.read_text())
            else:
                self.save('failed', error=str(error), exitCode=1)
                raise
        finally:
            shutil.rmtree(temporary)

    def control(self, action, unit):
        if action not in ('start', 'stop') or unit not in ('journey.service', 'journey-backup.service'):
            raise ValueError('Forbidden service operation')
        return run('systemctl', action, unit, timeout=1230 if unit == 'journey-backup.service' else 45)

    def protected(self):
        names = run('systemctl', 'list-units', '--type=service', '--state=active',
                    '--no-legend', '--plain', '--no-pager').splitlines()
        snapshot = {}
        units = {'l4d2.service', 'l4d2-control.service', 'l4d2-crash-recorder.service', 'nginx.service'}
        units.update(line.split()[0] for line in names if PROTECTED.search(line.split()[0]))
        for unit in sorted(units):
                snapshot[unit] = run('systemctl', 'show', unit, '--property=MainPID',
                    '--property=ExecMainStartTimestampMonotonic', '--property=NRestarts',
                    '--property=ActiveState').strip()
        return snapshot

    def inspect_protected(self):
        try:
            return self.protected(), False
        except BaseException as inspection:
            return {'inspectionError': str(inspection)}, True

    def switch(self, target):
        temp = self.base / ('.current-' + self.release)
        with contextlib.suppress(FileNotFoundError):
            temp.unlink()
        temp.symlink_to(target)
        os.replace(temp, self.base / 'current')

    def health(self, build_id):
        deadline = time.monotonic() + 75
        last = None
        while time.monotonic() < deadline:
            try:
                for url in ('http://127.0.0.1:4177/api/health',
                            'https://journey.jscloud.wang/api/health'):
                    with urllib.request.urlopen(url, timeout=5) as response:
                        value = json.load(response)
                        if response.status != 200 or value.get('ok') is not True:
                            raise RuntimeError('Unhealthy response: ' + url)
                for origin in ('http://127.0.0.1:4177', 'https://journey.jscloud.wang'):
                    request = urllib.request.Request(origin + '/build.json', headers={'Cache-Control': 'no-cache'})
                    with urllib.request.urlopen(request, timeout=5) as response:
                        if json.load(response).get('buildId') != build_id:
                            raise RuntimeError('Served build identity mismatch: ' + origin)
                return
            except Exception as error:
                last = error
                time.sleep(2)
        raise RuntimeError('Health verification timed out: ' + str(last))

    def activate(self):
        self.data = json.loads(self.path.read_text())
        with (self.state / 'activation.lock').open('a') as lock:
            deadline = time.monotonic() + 300
            while True:
                try:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    if time.monotonic() >= deadline:
                        self.save('failed', error='Activation lock timed out', exitCode=1)
                        return 1
                    time.sleep(1)
            if self.data['status'] != 'queued':
                raise ValueError('Release is not queued')
            old, stopped, before = None, False, None
            previous_handlers = {}
            def interrupted(signum, frame):
                raise RuntimeError('Activation interrupted by signal ' + str(signum))
            for signum in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
                previous_handlers[signum] = signal.signal(signum, interrupted)
            try:
                active = self.state / '.active.json'
                if active.exists():
                    prior_id = json.loads(active.read_text())['release']
                    prior = Deployment(prior_id, self.base, self.state)
                    for signum in previous_handlers:
                        signal.signal(signum, signal.SIG_IGN)
                    try:
                        prior.recover_locked()
                    finally:
                        for signum in previous_handlers:
                            signal.signal(signum, interrupted)
                    if prior.data['status'] == 'rollback_failed':
                        raise RuntimeError('Prior activation recovery failed: ' + prior_id)
                atomic_json(active, {'release': self.release})
                self.save('activating')
                before, before_error = self.inspect_protected()
                require_space(self.base / 'releases')
                stage = Path(tempfile.mkdtemp(prefix='.stage-', dir=self.base / 'releases'))
                try:
                    build_id = unpack(self.state / (self.release + '.tar.gz'), stage,
                                      self.release, self.data['gitCommit'])
                    final = self.base / 'releases' / self.release
                    if final.exists():
                        raise ValueError('Release already exists')
                    stage.chmod(0o755)
                    os.rename(stage, final)
                    self.save('activating', buildId=build_id)
                finally:
                    if stage.exists():
                        shutil.rmtree(stage)
                    (self.state / (self.release + '.tar.gz')).unlink(missing_ok=True)
                current = self.base / 'current'
                if not current.is_symlink():
                    raise RuntimeError('Existing current release symlink required')
                old = os.readlink(current)
                old_path = (self.base / old).resolve()
                if old_path.parent != (self.base / 'releases').resolve() or not old_path.is_dir():
                    raise RuntimeError('Current release must resolve within releases')
                old_build = json.loads((old_path / 'dist/build.json').read_text())['buildId']
                self.save('activating', previousRelease=old_path.name, previousBuildId=old_build,
                          protectedServicesBefore=before)
                # Fixed root-owned backup service; package code is never run as root.
                self.control('start', 'journey-backup.service')
                self.save('activating', stopAttempted=True)
                stopped = True  # Even a timed-out/failed stop may have stopped the service.
                self.control('stop', 'journey.service')
                self.switch('releases/' + self.release)
                self.control('start', 'journey.service')
                self.health(self.data['buildId'])
                after, after_error = self.inspect_protected()
                protected_changed = before_error or after_error or after != before
                self.save('success', exitCode=0,
                          protectedServicesChanged=protected_changed,
                          protectedServicesBefore=before, protectedServicesAfter=after)
            except BaseException as error:
                # Further coordinator TERM signals must not interrupt rollback.
                for signum in previous_handlers:
                    signal.signal(signum, signal.SIG_IGN)
                rollback_error = None
                if stopped:
                    try:
                        self.control('stop', 'journey.service')
                    except BaseException:
                        pass
                    try:
                        self.switch(old)
                        self.control('start', 'journey.service')
                        self.health(old_build)
                    except BaseException as rollback:
                        rollback_error = str(rollback)
                if before is not None:
                    after, after_error = self.inspect_protected()
                    protected_changed = before_error or after_error or after != before
                else:
                    after, protected_changed = None, False
                self.save('rollback_failed' if rollback_error else ('rolled_back' if stopped else 'failed'),
                          error=str(error), rollbackError=rollback_error, exitCode=1,
                          protectedServicesChanged=protected_changed,
                          protectedServicesBefore=before, protectedServicesAfter=after)
            finally:
                self.clear_active()
                for signum, handler in previous_handlers.items():
                    signal.signal(signum, handler)
        return self.data.get('exitCode', 1)


    def clear_active(self):
        active = self.state / '.active.json'
        if self.data.get('status') in TERMINAL and self.data.get('status') != 'rollback_failed' and active.exists():
            if json.loads(active.read_text()).get('release') == self.release:
                active.unlink()

    def recover_locked(self):
        """Caller owns the process flock, including when a newer worker recovers us."""
        self.data = json.loads(self.path.read_text())
        if self.data['status'] in TERMINAL:
            self.clear_active()
            return 0 if self.data['status'] != 'rollback_failed' else 1
        error = 'Activation coordinator stopped before completion'
        if not self.data.get('stopAttempted'):
            self.save('failed', error=error, exitCode=1)
            self.clear_active()
            return 1
        try:
            old = self.data['previousRelease']
            if not ID.fullmatch(old):
                raise ValueError('Invalid previous release identity')
            current = os.readlink(self.base / 'current')
            if current not in ('releases/' + self.release, 'releases/' + old):
                raise RuntimeError('Current release changed externally; recovery stopped')
            with contextlib.suppress(Exception):
                self.control('stop', 'journey.service')
            self.switch('releases/' + old)
            self.control('start', 'journey.service')
            self.health(self.data['previousBuildId'])
            after, after_error = self.inspect_protected()
            self.save('rolled_back', error=error, rollbackError=None, exitCode=1,
                      protectedServicesAfter=after,
                      protectedServicesChanged=after_error or after != self.data.get('protectedServicesBefore'))
        except BaseException as rollback:
            self.save('rollback_failed', error=error, rollbackError=str(rollback), exitCode=1)
        # Keep failed recovery ownership durable so the next worker refuses it.
        if self.data['status'] != 'rollback_failed':
            self.clear_active()
        return 1

    def recover(self):
        """systemd ExecStopPost reconciles uncatchable worker termination."""
        with (self.state / 'activation.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            for signum in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
                signal.signal(signum, signal.SIG_IGN)
            return self.recover_locked()


def main():
    if os.geteuid() != 0:
        raise PermissionError('Root required')
    os.umask(0o022)
    args = sys.argv[1:]
    if len(args) == 4 and args[0] == 'receive':
        # Bound even a stalled SSH upload. Activation has a separate systemd lifetime.
        def upload_timeout(signum, frame):
            raise TimeoutError('Upload exceeded 900 seconds')
        signal.signal(signal.SIGALRM, upload_timeout)
        signal.alarm(900)
        deployment = Deployment(args[1])
        deployment.receive(args[2], args[3], sys.stdin.buffer)
        signal.alarm(0)
        print(json.dumps(deployment.data))
        return 0
    if len(args) == 2 and args[0] == 'status':
        deployment = Deployment(args[1])
        data = json.loads(deployment.path.read_text())
        if data['status'] in ('queued', 'activating') and time.time() - data['updatedAt'] > 30:
            unit = 'journey-deploy-' + deployment.release + '.service'
            try:
                unit_state = run('systemctl', 'show', unit, '--property=LoadState', '--value').strip()
            except subprocess.CalledProcessError:
                unit_state = 'not-found'
            if unit_state == 'not-found':
                deployment.recover()
                data = json.loads(deployment.path.read_text())
        print(json.dumps(data))
        return TERMINAL.get(data['status'], 2)
    deploy_user = os.environ.get('DEPLOY_USER', 'journey-deploy')
    if len(args) == 2 and args[0] in ('activate', 'recover') and os.environ.get('SUDO_USER') != deploy_user:
        return getattr(Deployment(args[1]), args[0])()
    raise ValueError('Expected receive ID SHA256 COMMIT, status ID, or admin activate/recover ID')


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print(json.dumps({'status': 'failed', 'error': str(error), 'exitCode': 1}), file=sys.stderr)
        sys.exit(1)
