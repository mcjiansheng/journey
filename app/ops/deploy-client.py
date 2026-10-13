#!/usr/bin/env python3
"""Upload an immutable release and follow the server-owned deployment transaction."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time


def main():
    if len(sys.argv) != 4:
        raise ValueError('Usage: deploy-client.py ARCHIVE RELEASE_ID COMMIT')
    archive, release, commit = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}', release):
        raise ValueError('Invalid release ID')
    if not re.fullmatch(r'[0-9a-f]{40}', commit):
        raise ValueError('Invalid commit SHA')
    host = os.environ['DEPLOY_HOST']
    port = os.environ.get('DEPLOY_PORT', '22')
    user = os.environ.get('DEPLOY_USER', 'journey-deploy')
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9.:-]*', host):
        raise ValueError('Invalid deployment host')
    if not port.isdecimal() or not 1 <= int(port) <= 65535 or user != 'journey-deploy':
        raise ValueError('Invalid deployment port or user')
    with archive.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    with tempfile.TemporaryDirectory(prefix='journey-ssh-') as directory:
        key, known_hosts = Path(directory) / 'key', Path(directory) / 'known_hosts'
        key.write_text(os.environ['DEPLOY_SSH_KEY'].rstrip() + '\n')
        key.chmod(0o600)
        known_hosts.write_text(os.environ['DEPLOY_KNOWN_HOSTS'].rstrip() + '\n')
        known_hosts.chmod(0o600)
        child_env = {k: v for k, v in os.environ.items() if k not in {'DEPLOY_SSH_KEY', 'DEPLOY_KNOWN_HOSTS'}}
        ssh = ['ssh', '-F', '/dev/null', '-T', '-o', 'BatchMode=yes',
               '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes',
               '-o', f'UserKnownHostsFile={known_hosts}', '-o', 'ConnectTimeout=15',
               '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3',
               '-i', str(key), '-p', port, f'{user}@{host}']
        print(f'Uploading release {release} ({commit})', flush=True)
        try:
            with archive.open('rb') as stream:
                uploaded = subprocess.run(ssh + [f'deploy {release} {digest} {commit}'],
                                          stdin=stream, capture_output=True, text=True,
                                          timeout=240, env=child_env)
            if uploaded.returncode:
                print(f'Upload response exit {uploaded.returncode}: {uploaded.stderr.strip()}', flush=True)
        except subprocess.TimeoutExpired:
            print('Upload connection timed out; checking durable server status.', flush=True)
        deadline = time.monotonic() + 30 * 60
        last_status, failures = None, 0
        while time.monotonic() < deadline:
            try:
                result = subprocess.run(ssh + [f'status {release}'], capture_output=True,
                                        text=True, timeout=60, env=child_env)
                state = json.loads(result.stdout)
                if state.get('release') != release:
                    raise ValueError('Server returned a different release ID')
                status = state['status']
                if status not in {'receiving', 'queued', 'activating', 'success', 'failed', 'rolled_back', 'rollback_failed'}:
                    raise ValueError(f'Unknown deployment status: {status}')
                if state.get('gitCommit') != commit or state.get('archiveSha256') != digest:
                    raise ValueError('Server deployment provenance does not match the uploaded release')
                failures = 0
                if status != last_status:
                    print(f'Deployment: {status}', flush=True)
                    last_status = status
                if status in {'success', 'failed', 'rolled_back', 'rollback_failed'}:
                    print(json.dumps(state, ensure_ascii=False, sort_keys=True), flush=True)
                    return 0 if status == 'success' and result.returncode == 0 else 1
            except (subprocess.TimeoutExpired, json.JSONDecodeError, KeyError, ValueError) as error:
                failures += 1
                print(f'Status attempt failed: {error}', flush=True)
                if failures >= 5:
                    raise RuntimeError(f'Server status unavailable; inspect status {release}. Server transaction continues independently.') from error
            time.sleep(10)
        raise TimeoutError(f'Deployment status deadline exceeded; inspect status {release}.')


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print(f'Deployment failed: {error}', file=sys.stderr)
        sys.exit(1)
