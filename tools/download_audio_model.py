"""Download hash-pinned, development-only Kokoro assets; never ships the model."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'build/vendor/kokoro'
BASE = 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/'
FILES = {
    'kokoro-v1.0.onnx': ('beb0d1848dee9a49da392cc3df26958d46cfa35d321edf434f52949153f0df3a', 325505369),
    'voices-v1.0.bin': ('bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d', 28214398),
}

def download(name):
    digest, size = FILES[name]
    target = DEST / name
    if target.exists():
        assert target.stat().st_size == size and hashlib.file_digest(target.open('rb'), 'sha256').hexdigest() == digest, name
        return name + ': verified existing'
    temporary = target.with_suffix(target.suffix + '.download')
    if temporary.exists():
        raise FileExistsError('Preserve partial download for inspection: ' + str(temporary))
    with urllib.request.urlopen(urllib.request.Request(BASE + name, headers={'User-Agent': 'Jiufen-offline-audio'}), timeout=60) as response, temporary.open('xb') as stream:
        total = 0
        last = 0
        while data := response.read(1024 * 1024):
            stream.write(data); total += len(data)
            if total - last >= 32 * 1024 * 1024:
                print(f'{name}: {total}/{size} bytes', flush=True); last = total
    assert temporary.stat().st_size == size and hashlib.file_digest(temporary.open('rb'), 'sha256').hexdigest() == digest, name
    temporary.rename(target)
    return name + ': downloaded and SHA256 verified'

if __name__ == '__main__':
    DEST.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=2) as pool:
        for result in pool.map(download, FILES): print(result, flush=True)
