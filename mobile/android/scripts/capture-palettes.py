#!/usr/bin/env python3
"""Run the Android palette screenshots against a local acceptance fixture."""
import argparse
import json
import os
import shlex
from pathlib import Path
import subprocess
from urllib.parse import urlparse

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--fixture', type=Path, required=True)
parser.add_argument('--app-apk', type=Path, required=True)
parser.add_argument('--test-apk', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--sdk', type=Path, default=Path(os.environ.get('ANDROID_HOME', '.local/android-sdk')))
parser.add_argument('--serial', default='emulator-5554')
parser.add_argument('--trip-name', default='南京周末')
parser.add_argument('--shutdown', action='store_true', help='Stop the emulator after capturing results')
args = parser.parse_args()
fixture = json.loads(args.fixture.read_text())
args.output.mkdir(parents=True, exist_ok=True)
adb = [str(args.sdk.resolve() / 'platform-tools/adb'), '-s', args.serial]


def call(*command, check=True):
    result = subprocess.run(adb + list(command), text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if check and result.returncode:
        raise RuntimeError('adb operation failed: ' + result.stdout)
    return result


try:
    for apk in [args.app_apk, args.test_apk]:
        call('install', '-r', str(apk.resolve()))
    call('shell', 'pm', 'clear', 'wang.jscloud.journey')
    port = str(urlparse(fixture['serverURL']).port or 80)
    call('reverse', 'tcp:' + port, 'tcp:' + port)
    result = call('shell', shlex.join(['am', 'instrument', '-w', '-r',
                  '-e', 'class', 'wang.jscloud.journey.NativeFlowTest#palettesAndFlatSettingsScreenshots',
                  '-e', 'identifier', fixture['identifier'], '-e', 'password', fixture['password'],
                  '-e', 'tripName', args.trip_name,
                  'wang.jscloud.journey.test/androidx.test.runner.AndroidJUnitRunner']), check=False)
    (args.output / 'instrumentation.log').write_text(result.stdout)
    pulled = call('pull', '/sdcard/Android/data/wang.jscloud.journey/files/acceptance/.',
                  str(args.output.resolve()), check=False)
    if result.returncode or 'OK (1 test)' not in result.stdout:
        screenshot = subprocess.run(adb + ['exec-out', 'screencap', '-p'], stdout=subprocess.PIPE).stdout
        (args.output / 'failure.png').write_bytes(screenshot)
        raise RuntimeError('Palette screenshot test failed; see instrumentation.log')
    if pulled.returncode:
        raise RuntimeError('Could not pull screenshots: ' + pulled.stdout)
    print('Palette screenshot test passed:', len(list(args.output.glob('android-*.png'))), 'screenshots')
finally:
    if args.shutdown:
        call('emu', 'kill', check=False)
