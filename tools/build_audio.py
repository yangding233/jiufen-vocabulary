"""Generate reproducible-scope offline English WAVs with official eSpeak NG.

The synthesizer is a development dependency, not installed or run by the app.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import re
import subprocess
import wave
import os

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--engine', type=Path, default=ROOT / 'build/vendor/espeak/eSpeak NG/espeak-ng.exe')
parser.add_argument('--check', action='store_true')
args = parser.parse_args()
if os.name == 'nt':
    # Only this development process and its children: never show crash dialogs.
    import ctypes
    ctypes.windll.kernel32.SetErrorMode(0x0001 | 0x0002 | 0x8000)
words = json.loads(re.search(r'<script id="vocabulary-data" type="application/json">([\s\S]*?)</script>', (ROOT/'web/index.html').read_text(encoding='utf-8'))[1])
voices = {'en-GB': 'en-gb', 'en-US': 'en-us'}


def build(item):
    word, locale, voice = item
    destination = ROOT / 'web/audio' / locale / (word['id'] + '.wav')
    if not args.check and not destination.exists():
        destination.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run([str(args.engine), '--path='+str(args.engine.parent.resolve()), '-v', voice, '-s', '145', '-z', '-w', str(destination), word['word']], cwd=args.engine.parent, check=True, capture_output=True, timeout=30)
    with wave.open(str(destination), 'rb') as stream:
        seconds = stream.getnframes()/stream.getframerate()
        assert stream.getnchannels() == 1 and stream.getsampwidth() == 2 and .1 < seconds < 15, word['word']
    return (word['id'], locale, {'file': f'audio/{locale}/{word["id"]}.wav', 'seconds': round(seconds, 3), 'sha256': hashlib.sha256(destination.read_bytes()).hexdigest()})


manifest = {'schema': 1, 'engine': 'eSpeak NG 1.52.0', 'description': '离线合成英语参考音；英语词义及音标独立提供。', 'voices': list(voices), 'entries': {}}
with ThreadPoolExecutor(max_workers=4) as executor:
    for identifier, locale, result in executor.map(build, [(word, locale, voice) for word in words for locale, voice in voices.items()]):
        manifest['entries'].setdefault(identifier, {})[locale] = result
assert len(manifest['entries']) == 1493
target = ROOT / 'web/audio-manifest.json'
if args.check:
    assert manifest == json.loads(target.read_text(encoding='utf-8'))
else:
    target.write_text(json.dumps(manifest, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
print(json.dumps({'words': len(words), 'voices': list(voices), 'files': len(words)*2, 'bytes': sum(p.stat().st_size for p in (ROOT/'web/audio').rglob('*.wav'))}))
