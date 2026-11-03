"""Refresh only offline Web resources in a verified unsigned IPA.

Refuses native source changes. A new Swift interface always needs Xcode first.
"""
import argparse
from copy import copy
import hashlib
import json
from pathlib import Path
import plistlib
import re
import struct
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--base-ipa', type=Path, required=True)
parser.add_argument('--base-commit', required=True)
parser.add_argument('--expected-sha256', required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
assert re.fullmatch(r'[a-f0-9]{40}', args.base_commit)
assert hashlib.sha256(args.base_ipa.read_bytes()).hexdigest() == args.expected_sha256
assert not args.output.exists(), 'Keep previous package; choose a fresh output path'

for relative in ('apps/ios/JiufenVocabulary/AppDelegate.swift', 'apps/ios/JiufenVocabulary/Info.plist', 'apps/ios/JiufenVocabulary.xcodeproj/project.pbxproj'):
    previous = subprocess.run(['git', 'show', args.base_commit+':'+relative], cwd=ROOT, capture_output=True, check=True).stdout.decode('utf-8').strip()
    assert previous == (ROOT/relative).read_text(encoding='utf-8').strip(), 'Native source changed; perform a new Xcode build: '+relative

app = 'Payload/JiufenVocabulary.app/'
files = sorted(path for path in (ROOT/'web').rglob('*') if path.is_file())
assert not any(path.is_symlink() for path in files)
with zipfile.ZipFile(args.base_ipa) as base:
    assert not any('_CodeSignature' in name or name.endswith('embedded.mobileprovision') for name in base.namelist()), 'Use the unsigned build artifact'
    native = base.read(app+'JiufenVocabulary')
    assert struct.unpack('<II', native[:8]) == (0xFEEDFACF, 0x0100000C)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(args.output, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as out:
        for item in base.infolist():
            if not item.filename.startswith(app+'Web/'):
                out.writestr(copy(item), base.read(item.filename))
        for file in files:
            item = zipfile.ZipInfo(app+'Web/'+file.relative_to(ROOT/'web').as_posix())
            item.external_attr = 0o100644 << 16
            item.compress_type = zipfile.ZIP_DEFLATED
            out.writestr(item, file.read_bytes())
with zipfile.ZipFile(args.output) as out, zipfile.ZipFile(args.base_ipa) as base:
    assert out.read(app+'JiufenVocabulary') == native
    for item in base.infolist():
        if not item.filename.startswith(app+'Web/'):
            assert out.read(item.filename) == base.read(item.filename)
    for file in files:
        assert out.read(app+'Web/'+file.relative_to(ROOT/'web').as_posix()) == file.read_bytes()
    html = out.read(app+'Web/index.html').decode('utf-8')
    assert json.loads(re.search(r'<script id="portable-state" type="application/json">([\s\S]*?)</script>', html)[1]) is None
    info = plistlib.loads(out.read(app+'Info.plist'))
print(json.dumps({'file': str(args.output), 'appVersion': info['CFBundleShortVersionString'], 'build': info['CFBundleVersion'], 'nativeUnchanged': True, 'webFiles': len(files), 'bytes': args.output.stat().st_size, 'sha256': hashlib.sha256(args.output.read_bytes()).hexdigest()}))
