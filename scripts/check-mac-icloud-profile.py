#!/usr/bin/env python3
"""Fail before signing if the Mac iCloud profile cannot authorize this app."""
import datetime
import plistlib
import subprocess
import sys
from pathlib import Path

profile = plistlib.loads(subprocess.check_output(['security', 'cms', '-D', '-i', sys.argv[1]]))
entitlements = profile['Entitlements']
expected = plistlib.loads(Path('src-tauri/Moldavite.entitlements').read_bytes())
for key in ('com.apple.application-identifier', 'com.apple.developer.team-identifier'):
    if entitlements.get(key) != expected[key]:
        raise SystemExit(f'Profile does not authorize {key}')
for key in ('com.apple.developer.icloud-container-identifiers',
            'com.apple.developer.ubiquity-container-identifiers',
            'com.apple.developer.icloud-services'):
    allowed = entitlements.get(key, [])
    if allowed != '*' and not set(expected[key]).issubset(allowed):
        raise SystemExit(f'Profile does not authorize {key}')
if 'OSX' not in profile.get('Platform', []) or not profile.get('ProvisionsAllDevices'):
    raise SystemExit('A Developer ID Mac distribution profile is required')
if profile['ExpirationDate'] <= datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None):
    raise SystemExit('Mac iCloud profile has expired')
print(f"Mac iCloud profile valid until {profile['ExpirationDate'].date()}")
