import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('deploy', Path(__file__).parents[1] / 'deploy-release.py')
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)
COMMIT = 'a' * 40


def archive(path, release='new', extra=None, mutate=None):
    files = {'server/index.mjs': b'// server', 'dist/index.html': b'html',
             'dist/build.json': b'{"buildId":"new-build"}', 'package.json': b'{}',
             'package-lock.json': b'{}', 'src/domain.js': b'// domain',
             'node_modules/example/index.js': b'// dependency'}
    manifest = {'release': release, 'gitCommit': COMMIT,
                'files': [{'path': p, 'sha256': hashlib.sha256(v).hexdigest()} for p, v in files.items()]}
    if mutate:
        mutate(manifest)
    files['release-manifest.json'] = json.dumps(manifest).encode()
    with tarfile.open(path, 'w:gz') as tar:
        for name, value in files.items():
            member = tarfile.TarInfo('./' + name)
            member.size = len(value)
            tar.addfile(member, io.BytesIO(value))
        if extra:
            for member in extra:
                tar.addfile(member, io.BytesIO(b'x' * member.size) if member.isfile() else None)


class DeployTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.archive = self.root / 'archive.tar.gz'
        self.stage = self.root / 'stage'
        self.stage.mkdir()

    def tearDown(self):
        self.temp.cleanup()

    def test_valid_archive_and_relative_npm_bin_link(self):
        link = tarfile.TarInfo('./node_modules/.bin/example')
        link.type, link.linkname = tarfile.SYMTYPE, '../example/index.js'
        archive(self.archive, extra=[link])
        self.assertEqual(deploy.unpack(self.archive, self.stage, 'new', COMMIT), 'new-build')
        self.assertTrue((self.stage / 'node_modules/.bin/example').is_symlink())

    def test_reject_unsafe_entries(self):
        for name, kind, target in [('../escape', tarfile.REGTYPE, ''),
                                   ('/escape', tarfile.REGTYPE, ''),
                                   ('node_modules/escape', tarfile.SYMTYPE, '../../../escape'),
                                   ('hard', tarfile.LNKTYPE, 'package.json'),
                                   ('device', tarfile.CHRTYPE, '')]:
            with self.subTest(name=name):
                entry = tarfile.TarInfo(name)
                entry.type, entry.linkname = kind, target
                archive(self.archive, extra=[entry])
                with self.assertRaises(ValueError):
                    deploy.unpack(self.archive, self.stage, 'new', COMMIT)

    def test_reject_symlink_ancestor_and_duplicate(self):
        for name, target in [('node_modules', 'dist'), ('package.json', 'dist/index.html')]:
            entry = tarfile.TarInfo(name)
            entry.type, entry.linkname = tarfile.SYMTYPE, target
            archive(self.archive, extra=[entry])
            with self.assertRaises(ValueError):
                deploy.unpack(self.archive, self.stage, 'new', COMMIT)

    def test_manifest_commit_inventory_and_digest(self):
        mutations = [lambda m: m.update(gitCommit='b'*40),
                     lambda m: m['files'].pop(),
                     lambda m: m['files'][0].update(sha256='0'*64)]
        for i, mutation in enumerate(mutations):
            dest = self.root / ('stage' + str(i))
            dest.mkdir()
            archive(self.archive, mutate=mutation)
            with self.assertRaises(ValueError):
                deploy.unpack(self.archive, dest, 'new', COMMIT)

    def prepare_activation(self):
        base, state = self.root / 'base', self.root / 'state'
        (base / 'releases/old/dist').mkdir(parents=True)
        (base / 'releases/old/dist/build.json').write_text('{"buildId":"old-build"}')
        (base / 'current').symlink_to('releases/old')
        state.mkdir()
        archive(state / 'new.tar.gz')
        deployment = deploy.Deployment('new', base, state)
        deployment.data = {'gitCommit': COMMIT}
        deployment.save('queued')
        return deployment

    def test_activation_success(self):
        d = self.prepare_activation()
        with patch.object(d, 'control') as control, patch.object(d, 'protected', return_value={'l4d2': 'unchanged'}), patch.object(d, 'health') as health:
            self.assertEqual(d.activate(), 0)
        self.assertEqual((d.base / 'current').readlink(), Path('releases/new'))
        self.assertEqual(control.call_args_list[0].args, ('start', 'journey-backup.service'))
        health.assert_called_once_with('new-build')

    def test_unhealthy_release_rolls_back_code(self):
        d = self.prepare_activation()
        with patch.object(d, 'control'), patch.object(d, 'protected', return_value={}), patch.object(d, 'health', side_effect=[RuntimeError('bad health'), None]) as health:
            self.assertEqual(d.activate(), 1)
        self.assertEqual((d.base / 'current').readlink(), Path('releases/old'))
        self.assertEqual(d.data['status'], 'rolled_back')
        self.assertEqual(health.call_args_list[-1].args, ('old-build',))

    def test_failed_stop_still_recovers(self):
        d = self.prepare_activation()
        with patch.object(d, 'control', side_effect=[None, RuntimeError('stop timeout'), None, None]), patch.object(d, 'protected', return_value={}), patch.object(d, 'health'):
            self.assertEqual(d.activate(), 1)
        self.assertEqual(d.data['status'], 'rolled_back')
        self.assertEqual((d.base / 'current').readlink(), Path('releases/old'))

    def test_backup_failure_does_not_stop_app(self):
        d = self.prepare_activation()
        with patch.object(d, 'control', side_effect=RuntimeError('backup failed')) as control, patch.object(d, 'protected', return_value={}):
            self.assertEqual(d.activate(), 1)
        self.assertEqual(d.data['status'], 'failed')
        self.assertEqual(control.call_count, 1)
        self.assertEqual((d.base / 'current').readlink(), Path('releases/old'))

    def test_protected_service_change_rolls_back(self):
        d = self.prepare_activation()
        with patch.object(d, 'control'), patch.object(d, 'protected', side_effect=[{'l4d2': 'old'}, {'l4d2': 'new'}, {'l4d2': 'new'}]), patch.object(d, 'health'):
            self.assertEqual(d.activate(), 1)
        self.assertEqual(d.data['status'], 'rolled_back')
        self.assertTrue(d.data['protectedServicesChanged'])

    def test_rollback_failure_reported(self):
        d = self.prepare_activation()
        with patch.object(d, 'control'), patch.object(d, 'protected', return_value={}), patch.object(d, 'health', side_effect=RuntimeError('unhealthy')):
            self.assertEqual(d.activate(), 1)
        self.assertEqual(d.data['status'], 'rollback_failed')

    def test_receive_digest_and_immutable_id(self):
        d = deploy.Deployment('new', self.root / 'base', self.root / 'state')
        with self.assertRaisesRegex(ValueError, 'SHA256'):
            d.receive('0'*64, COMMIT, io.BytesIO(b'archive'))
        self.assertEqual(json.loads(d.path.read_text())['status'], 'failed')
        with self.assertRaises(FileExistsError):
            d.receive('0'*64, COMMIT, io.BytesIO(b'archive'))

    def test_receive_queues_resource_bounded_worker_without_extracting(self):
        archive(self.archive)
        raw = self.archive.read_bytes()
        d = deploy.Deployment('new', self.root / 'base', self.root / 'state')
        with patch.object(deploy, 'run') as launch, patch.object(deploy, 'unpack') as unpack:
            d.receive(hashlib.sha256(raw).hexdigest(), COMMIT, io.BytesIO(raw))
        unpack.assert_not_called()
        self.assertEqual(d.data['status'], 'queued')
        self.assertFalse((d.base / 'releases/new').exists())
        args = launch.call_args.args
        self.assertIn('--property=MemoryMax=256M', args)
        self.assertIn('--property=ExecStopPost=' + deploy.SELF + ' recover new', args)

    def test_signal_after_switch_rolls_back(self):
        d = self.prepare_activation()
        with patch.object(d, 'control'), patch.object(d, 'protected', return_value={}), patch.object(d, 'health', side_effect=[KeyboardInterrupt(), None]):
            self.assertEqual(d.activate(), 1)
        self.assertEqual(d.data['status'], 'rolled_back')
        self.assertTrue(d.data['stopAttempted'])

    def test_stop_post_recovers_killed_worker(self):
        d = self.prepare_activation()
        d.save('activating', stopAttempted=True, previousRelease='old', previousBuildId='old-build', protectedServicesBefore={})
        (d.base / 'releases/new').mkdir()
        d.switch('releases/new')
        with patch.object(deploy.signal, 'signal'), patch.object(d, 'control'), patch.object(d, 'health') as health, patch.object(d, 'protected', return_value={}):
            self.assertEqual(d.recover(), 1)
        self.assertEqual(d.data['status'], 'rolled_back')
        self.assertEqual((d.base / 'current').readlink(), Path('releases/old'))
        health.assert_called_once_with('old-build')

    def test_stop_post_does_not_modify_terminal_release(self):
        d = self.prepare_activation()
        d.save('success', exitCode=0)
        with patch.object(d, 'control') as control:
            self.assertEqual(d.recover(), 0)
        control.assert_not_called()

    def test_stop_post_before_stop_records_failure(self):
        d = self.prepare_activation()
        with patch.object(deploy.signal, 'signal'), patch.object(d, 'control') as control:
            self.assertEqual(d.recover(), 1)
        self.assertEqual(d.data['status'], 'failed')
        control.assert_not_called()

    def test_new_worker_recovers_prior_before_choosing_rollback_target(self):
        prior = self.prepare_activation()
        prior.save('activating', stopAttempted=True, previousRelease='old', previousBuildId='old-build', protectedServicesBefore={})
        (prior.base / 'releases/new').mkdir()
        prior.switch('releases/new')
        deploy.atomic_json(prior.state / '.active.json', {'release': 'new'})
        archive(prior.state / 'next.tar.gz', release='next')
        next_deploy = deploy.Deployment('next', prior.base, prior.state)
        next_deploy.data = {'gitCommit': COMMIT}
        next_deploy.save('queued')
        with patch.object(deploy.Deployment, 'control'), patch.object(deploy.Deployment, 'protected', return_value={}), patch.object(deploy.Deployment, 'health') as health:
            self.assertEqual(next_deploy.activate(), 0)
        self.assertEqual(next_deploy.data['previousRelease'], 'old')
        self.assertEqual(json.loads(prior.path.read_text())['status'], 'rolled_back')
        self.assertEqual(health.call_args_list[0].args, ('old-build',))
        self.assertFalse((prior.state / '.active.json').exists())

    def test_failed_prior_recovery_blocks_new_worker(self):
        prior = self.prepare_activation()
        prior.save('rollback_failed', exitCode=1)
        deploy.atomic_json(prior.state / '.active.json', {'release': 'new'})
        next_deploy = deploy.Deployment('next', prior.base, prior.state)
        next_deploy.data = {'gitCommit': COMMIT}
        next_deploy.save('queued')
        with patch.object(next_deploy, 'control') as control:
            self.assertEqual(next_deploy.activate(), 1)
        control.assert_not_called()
        self.assertIn('Prior activation recovery failed', next_deploy.data['error'])
        self.assertEqual(json.loads((prior.state / '.active.json').read_text())['release'], 'new')

    def test_uncertain_dispatch_never_overwrites_worker_state(self):
        archive(self.archive)
        raw = self.archive.read_bytes()
        d = deploy.Deployment('new', self.root / 'base', self.root / 'state')
        def dispatch(*args):
            d.save('activating', stopAttempted=True)
            raise TimeoutError('systemd-run response lost')
        with patch.object(deploy, 'run', side_effect=dispatch):
            d.receive(hashlib.sha256(raw).hexdigest(), COMMIT, io.BytesIO(raw))
        self.assertEqual(json.loads(d.path.read_text())['status'], 'activating')

    def test_reject_actual_symlink_escape_and_cycle(self):
        outside = self.root / 'package.json'
        outside.write_text('outside')
        directory = tarfile.TarInfo('dist')
        directory.type = tarfile.DIRTYPE
        a = tarfile.TarInfo('nested/a')
        a.type, a.linkname = tarfile.SYMTYPE, '../dist'
        b = tarfile.TarInfo('b')
        b.type, b.linkname = tarfile.SYMTYPE, 'nested/a/../../package.json'
        archive(self.archive, extra=[directory, a, b])
        with self.assertRaisesRegex(ValueError, 'symbolic link'):
            deploy.unpack(self.archive, self.stage, 'new', COMMIT)
        a = tarfile.TarInfo('a')
        a.type, a.linkname = tarfile.SYMTYPE, 'b'
        b.linkname = 'a'
        archive(self.archive, extra=[a, b])
        second = self.root / 'cycle'
        second.mkdir()
        with self.assertRaisesRegex(ValueError, 'symbolic link'):
            deploy.unpack(self.archive, second, 'new', COMMIT)

    def test_disk_reserve_failure_before_application_stop(self):
        d = self.prepare_activation()
        with patch.object(deploy, 'require_space', side_effect=RuntimeError('Insufficient deployment disk space')), patch.object(d, 'protected', return_value={}), patch.object(d, 'control') as control:
            self.assertEqual(d.activate(), 1)
        control.assert_not_called()
        self.assertEqual(d.data['status'], 'failed')
        self.assertEqual((d.base / 'current').readlink(), Path('releases/old'))

    def test_receiving_is_not_recovered_as_orphan(self):
        d = deploy.Deployment('active', deploy.BASE, deploy.STATE)
        self.assertNotEqual(d.path.name, '.active.json')
        with patch.object(deploy.os, 'geteuid', return_value=0), patch.object(deploy.sys, 'argv', ['deploy', 'status', 'active']), patch.object(deploy.Path, 'read_text', return_value=json.dumps({'status': 'receiving', 'updatedAt': 0})), patch.object(deploy.Deployment, 'recover') as recover, patch('builtins.print'):
            self.assertEqual(deploy.main(), 2)
        recover.assert_not_called()

    def test_inherited_recovery_ignores_signals_then_restores_handlers(self):
        prior = self.prepare_activation()
        prior.save('failed', exitCode=1)
        deploy.atomic_json(prior.state / '.active.json', {'release': 'new'})
        next_deploy = deploy.Deployment('next', prior.base, prior.state)
        next_deploy.data = {'gitCommit': COMMIT}
        next_deploy.save('queued')
        archive(prior.state / 'next.tar.gz', release='next')
        observed = []
        original = deploy.Deployment.recover_locked
        def recovery(instance):
            observed.extend(deploy.signal.getsignal(sig) for sig in (deploy.signal.SIGTERM, deploy.signal.SIGHUP, deploy.signal.SIGINT))
            return original(instance)
        with patch.object(deploy.Deployment, 'recover_locked', recovery), patch.object(deploy.Deployment, 'control'), patch.object(deploy.Deployment, 'health'), patch.object(deploy.Deployment, 'protected', return_value={}):
            self.assertEqual(next_deploy.activate(), 0)
        self.assertEqual(observed, [deploy.signal.SIG_IGN] * 3)

    def test_service_mutations_restricted(self):
        d = deploy.Deployment('new', self.root, self.root)
        with self.assertRaises(ValueError):
            d.control('stop', 'l4d2.service')


if __name__ == '__main__':
    unittest.main()
