import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('deploy_client', Path(__file__).parents[1] / 'deploy-client.py')
client = importlib.util.module_from_spec(spec)
spec.loader.exec_module(client)


class DeploymentClientTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.archive = Path(self.directory.name) / 'test.tar.gz'
        self.archive.write_bytes(b'archive')
        self.commit = 'a' * 40
        self.digest = hashlib.sha256(b'archive').hexdigest()
        self.environment = {'DEPLOY_HOST': 'example.com', 'DEPLOY_PORT': '22',
                            'DEPLOY_USER': 'journey-deploy', 'DEPLOY_SSH_KEY': 'test-key',
                            'DEPLOY_KNOWN_HOSTS': 'example.com test-host-key'}

    def response(self, status, code=0, **overrides):
        state = dict(release='test-release', gitCommit=self.commit,
                     archiveSha256=self.digest, status=status, **overrides)
        return subprocess.CompletedProcess([], code, json.dumps(state), '')

    def run_client(self, responses):
        with patch.object(client.sys, 'argv', ['deploy-client.py', str(self.archive), 'test-release', self.commit]), \
             patch.dict(client.os.environ, self.environment, clear=True), \
             patch.object(client.subprocess, 'run', side_effect=responses) as run, \
             patch.object(client.time, 'sleep'), contextlib.redirect_stdout(io.StringIO()):
            result = client.main()
            return result, run.call_args_list

    def test_success_waits_for_terminal_state_and_pins_host_key(self):
        result, calls = self.run_client([self.response('queued'), self.response('activating', 2), self.response('success')])
        self.assertEqual(result, 0)
        self.assertEqual(len(calls), 3)
        self.assertIn('StrictHostKeyChecking=yes', calls[0].args[0])
        self.assertNotIn('DEPLOY_SSH_KEY', calls[0].kwargs['env'])

    def test_automatic_rollback_reports_failed_deployment(self):
        result, _ = self.run_client([self.response('queued'), self.response('rolled_back', 1)])
        self.assertEqual(result, 1)

    def test_upload_disconnect_recovers_durable_outcome(self):
        result, _ = self.run_client([subprocess.TimeoutExpired('ssh', 960), self.response('success')])
        self.assertEqual(result, 0)

    def test_transient_status_disconnect_is_retried(self):
        result, _ = self.run_client([self.response('queued'), subprocess.TimeoutExpired('ssh', 60), self.response('success')])
        self.assertEqual(result, 0)

    def test_wrong_commit_never_counts_as_success(self):
        wrong = self.response('success')
        state = json.loads(wrong.stdout)
        state['gitCommit'] = 'b' * 40
        wrong.stdout = json.dumps(state)
        with self.assertRaisesRegex(RuntimeError, 'Server status unavailable'):
            self.run_client([self.response('queued')] + [wrong] * 5)

    def test_success_json_with_failed_ssh_exit_does_not_pass(self):
        result, _ = self.run_client([self.response('queued'), self.response('success', 1)])
        self.assertEqual(result, 1)


if __name__ == '__main__':
    unittest.main()
