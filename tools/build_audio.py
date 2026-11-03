"""Build compact offline English reference audio using eSpeak NG and FFmpeg.

Only AAC-LC M4A files ship with the app. Original PCM remains in ignored
build/audio-pcm. Both executables are development tools and are not bundled.
Run --check to verify the shipped manifest and files without either executable.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import wave

ROOT = Path(__file__).resolve().parents[1]
AUDIO = ROOT / 'web' / 'audio'
PCM = ROOT / 'build' / 'audio-pcm'
TARGET = ROOT / 'web' / 'audio-manifest.json'
VOICES = {'en-GB': 'en-gb', 'en-US': 'en-us'}
ENCODING = {'codec': 'AAC-LC', 'container': 'M4A', 'channels': 1,
            'sampleRate': 48000, 'bitrate': 48000}
FLAGS = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0


def inside_project(path):
    resolved = path.resolve()
    if not resolved.is_relative_to(ROOT):
        raise ValueError(f'Refusing to write or move outside project: {resolved}')
    return resolved


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def valid_m4a(path):
    with path.open('rb') as stream:
        header = stream.read(64)
    return path.stat().st_size > 256 and header[4:8] == b'ftyp'


def pcm_seconds(path):
    with wave.open(str(path), 'rb') as stream:
        seconds = stream.getnframes() / stream.getframerate()
        if stream.getnchannels() != 1 or stream.getsampwidth() != 2 or not .1 < seconds < 15:
            raise ValueError(f'Invalid mono PCM reference audio: {path}')
    return round(seconds, 3)


def load_words():
    html = (ROOT / 'web' / 'index.html').read_text(encoding='utf-8')
    match = re.search(r'<script id="vocabulary-data" type="application/json">([\s\S]*?)</script>', html)
    if not match:
        raise ValueError('No vocabulary-data found in web/index.html')
    words = json.loads(match[1])
    if len(words) != 1493 or len({item['id'] for item in words}) != 1493:
        raise ValueError('Expected 1493 unique vocabulary identifiers')
    if not all(re.fullmatch(r'jf-\d{4}', item['id']) for item in words):
        raise ValueError('Unsafe audio identifier in vocabulary')
    return words


def expected_files(words, slow=False):
    return {f'audio/{locale}/{word["id"]}{suffix}.m4a'
            for word in words for locale in VOICES
            for suffix in (('', '-slow') if slow else ('',))}


def check_manifest(manifest, words):
    if (manifest.get('schema') != 1 or manifest.get('voices') != list(VOICES)
            or manifest.get('encoding') != ENCODING
            or set(manifest.get('entries', {})) != {word['id'] for word in words}):
        raise ValueError('Audio manifest identity, coverage or encoding is incorrect')
    total = 0
    slow = any('slow' in card for variants in manifest['entries'].values()
               for card in variants.values())
    for word in words:
        variants = manifest['entries'][word['id']]
        if set(variants) != set(VOICES):
            raise ValueError(f'Missing accent variant: {word["id"]}')
        for locale, card in variants.items():
            if 'note' in card and (not isinstance(card['note'], str) or len(card['note']) > 200):
                raise ValueError(f'Invalid pronunciation note: {word["id"]}/{locale}')
            records = [(card, '')]
            if slow:
                if not isinstance(card.get('slow'), dict):
                    raise ValueError(f'Missing slow pronunciation: {word["id"]}/{locale}')
                records.append((card['slow'], '-slow'))
            for record, suffix in records:
                expected = f'audio/{locale}/{word["id"]}{suffix}.m4a'
                if (record.get('file') != expected or not isinstance(record.get('seconds'), (int, float))
                        or isinstance(record.get('seconds'), bool) or not .1 < record['seconds'] < 20):
                    raise ValueError(f'Invalid manifest record: {word["id"]}/{locale}{suffix}')
                path = inside_project(ROOT / 'web' / expected)
                if path.is_symlink() or not valid_m4a(path) or digest(path) != record.get('sha256'):
                    raise ValueError(f'Invalid M4A header or SHA256: {path}')
                total += path.stat().st_size
    actual = {path.relative_to(ROOT / 'web').as_posix() for path in AUDIO.rglob('*') if path.is_file()}
    if actual != expected_files(words, slow):
        raise ValueError('Unexpected or missing files in web/audio; PCM must stay in build/audio-pcm')
    return total


def preserve_pcm(words):
    """Reversible migration: validate every absolute path before any file moves."""
    inside_project(AUDIO)
    inside_project(PCM)
    allowed = {f'{locale}/{word["id"]}.wav' for word in words for locale in VOICES}
    moves = []
    for source in AUDIO.rglob('*.wav'):
        relative = source.relative_to(AUDIO).as_posix()
        destination = PCM / relative
        inside_project(source)
        inside_project(destination)
        if source.is_symlink() or relative not in allowed:
            raise ValueError(f'Unexpected legacy PCM file; not moved: {source}')
        pcm_seconds(source)
        if destination.exists() and digest(source) != digest(destination):
            raise FileExistsError(f'Keep different existing PCM backup: {destination}')
        moves.append((source, destination))
    if moves and TARGET.exists():
        backup = inside_project(PCM / 'audio-manifest-before-aac.json')
        backup.parent.mkdir(parents=True, exist_ok=True)
        if not backup.exists():
            shutil.copy2(TARGET, backup)
    for source, destination in moves:
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists():
            # The preserved copy was checked byte-for-byte above.
            source.unlink()
        else:
            source.rename(destination)
    return len(moves)


def executable(value, fallback=None):
    candidate = shutil.which(str(value)) if value else None
    if candidate:
        return Path(candidate).resolve()
    if value and Path(value).is_file():
        return Path(value).resolve()
    if fallback and fallback.is_file():
        return fallback.resolve()
    raise FileNotFoundError(f'Development executable not found: {value}')


def run(command, cwd=None):
    result = subprocess.run(command, cwd=cwd, capture_output=True, timeout=30,
                            creationflags=FLAGS)
    if result.returncode:
        raise RuntimeError(result.stderr.decode('utf-8', errors='replace')[-2000:])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--engine', type=Path, default=ROOT / 'build/vendor/espeak/eSpeak NG/espeak-ng.exe')
    parser.add_argument('--encoder', help='FFmpeg executable; defaults to PATH, then ../work/video-bin/ffmpeg.exe')
    parser.add_argument('--check', action='store_true', help='Verify bundled M4A files; no synthesizer or encoder needed')
    args = parser.parse_args()
    if os.name == 'nt':
        import ctypes
        ctypes.windll.kernel32.SetErrorMode(0x0001 | 0x0002 | 0x8000)
    words = load_words()
    previous = json.loads(TARGET.read_text(encoding='utf-8')) if TARGET.exists() else {}
    if args.check:
        total = check_manifest(previous, words)
        slow = any('slow' in card for variants in previous['entries'].values() for card in variants.values())
        print(json.dumps({'words': len(words), 'voices': list(VOICES), 'files': len(words)*(4 if slow else 2),
                          'bytes': total, 'encoding': ENCODING, 'checked': True}))
        return
    if previous and previous.get('engine') != 'eSpeak NG 1.52.0':
        raise ValueError('Refusing to replace non-eSpeak audio with the legacy eSpeak builder. Use the neural audio builder for this manifest.')
    migrated = preserve_pcm(words)
    encoder = None
    engine = None
    # Resolve tools lazily: verified assets can be rebuilt without installing
    # synthesizer or encoder development dependencies.
    jobs = []
    for word in words:
        for locale, voice in VOICES.items():
            destination = inside_project(AUDIO / locale / f'{word["id"]}.m4a')
            old = previous.get('entries', {}).get(word['id'], {}).get(locale, {})
            reuse = (old.get('file') == f'audio/{locale}/{word["id"]}.m4a'
                     and previous.get('encoding') == ENCODING and destination.is_file()
                     and valid_m4a(destination) and digest(destination) == old.get('sha256')
                     and isinstance(old.get('seconds'), (int, float)) and .1 < old['seconds'] < 15)
            if not reuse:
                encoder = encoder or executable(args.encoder or 'ffmpeg', ROOT.parent / 'work/video-bin/ffmpeg.exe')
                if not (PCM / locale / f'{word["id"]}.wav').exists():
                    engine = engine or executable(args.engine)
            jobs.append((word, locale, voice, reuse, old))

    def build(item):
        word, locale, voice, reuse, old = item
        if reuse:
            return word['id'], locale, old
        pcm = inside_project(PCM / locale / f'{word["id"]}.wav')
        if not pcm.exists():
            pcm.parent.mkdir(parents=True, exist_ok=True)
            run([str(engine), '--path='+str(engine.parent), '-v', voice, '-s', '145', '-z',
                 '-w', str(pcm), word['word']], cwd=engine.parent)
        seconds = pcm_seconds(pcm)
        destination = inside_project(AUDIO / locale / f'{word["id"]}.m4a')
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = inside_project(destination.with_name(destination.stem + '.encoding.m4a'))
        try:
            run([str(encoder), '-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(pcm),
                 '-map_metadata', '-1', '-ac', '1', '-ar', '48000', '-c:a', 'aac', '-profile:a', 'aac_low',
                 '-b:a', '48k', '-threads', '1', '-movflags', '+faststart', str(temporary)])
            if not valid_m4a(temporary):
                raise ValueError(f'FFmpeg did not create a valid M4A: {word["id"]}/{locale}')
            temporary.replace(destination)
        finally:
            if temporary.exists():
                temporary.unlink()
        return word['id'], locale, {'file': f'audio/{locale}/{word["id"]}.m4a', 'seconds': seconds,
                                    'sha256': digest(destination)}

    manifest = {'schema': 1, 'engine': 'eSpeak NG 1.52.0',
                'description': '离线合成英语参考音；英语词义及音标独立提供。',
                'encoding': ENCODING, 'voices': list(VOICES), 'entries': {}}
    with ThreadPoolExecutor(max_workers=4) as pool:
        for identifier, locale, result in pool.map(build, jobs):
            manifest['entries'].setdefault(identifier, {})[locale] = result
    total = check_manifest(manifest, words)
    TARGET.write_text(json.dumps(manifest, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    print(json.dumps({'words': len(words), 'voices': list(VOICES), 'files': len(jobs), 'bytes': total,
                      'encoding': ENCODING, 'migratedPCM': migrated,
                      'pcmBytes': sum(path.stat().st_size for path in PCM.rglob('*.wav'))}))


if __name__ == '__main__':
    main()
