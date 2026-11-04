"""Build the bounded offline ECDICT subset; default/check never access the network."""
from pathlib import Path
import argparse
import csv
import hashlib
import json
import re
import sys
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
COMMIT = '39cfb9672c0906b63569e0453c2e6abfb9ab182a'
SOURCE_SHA256 = 'd1ecbdf9ee2b920afb6f430ca6b6bb9f559588cf0dff86e04bd255f9390843cc'
LICENSE_SHA256 = 'f8552dd246f61a4e064569eae6194a01c6b3d63b03bf27c6ca863593c549ed0f'
README_SHA256 = '0c3f95fc7e15f7eccf65feedb58ba3ebace1fe7b7cbdd1af60c9ace4cef9094b'
VERSION = COMMIT[:12] + '-common-v1'
VENDOR = ROOT / 'build/vendor/ecdict' / COMMIT
BASE_LIMIT = 40000
TOTAL_LIMIT = 50000
FREQUENCY_LIMIT = 30000
BAD = re.compile(r'[<>\x00-\x08\x0b\x0c\x0e-\x1f]')
POS = re.compile(r'(?:^|\n)\s*(n|v|vt|vi|a|adj|adv|prep|pron|conj|num|art|interj|aux|int|abbr)\.', re.I)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def verified_file(name, expected):
    path = VENDOR / name
    if not path.is_file():
        raise ValueError('Missing pinned source: ' + str(path) + '; use --download to prepare it')
    raw = path.read_bytes()
    if digest(raw) != expected:
        raise ValueError('Pinned source SHA256 mismatch: ' + name)
    return raw


def download():
    VENDOR.mkdir(parents=True, exist_ok=True)
    for name, expected in [('ecdict.csv', SOURCE_SHA256), ('LICENSE', LICENSE_SHA256), ('README.md', README_SHA256)]:
        path = VENDOR / name
        if path.is_file() and digest(path.read_bytes()) == expected:
            continue
        request = urllib.request.Request('https://raw.githubusercontent.com/skywind3000/ECDICT/' + COMMIT + '/' + name, headers={'User-Agent': 'Jiufen-offline-dictionary-build'})
        with urllib.request.urlopen(request, timeout=90) as stream:
            raw = stream.read(100 * 1024 * 1024 + 1)
        if len(raw) > 100 * 1024 * 1024 or digest(raw) != expected:
            raise ValueError('Download did not match pinned source: ' + name)
        path.write_bytes(raw)


def clean(value):
    return str(value or '').replace('\\n', '\n').replace('\r\n', '\n').strip()


def entry(row):
    word = clean(row.get('word'))
    meaning = clean(row.get('translation'))
    phonetic = clean(row.get('phonetic'))
    exchange = clean(row.get('exchange'))
    if not word or not re.search(r'[A-Za-z]', word) or len(word) > 120 or len(word.split()) > 16:
        return None
    if BAD.search(word + meaning + phonetic + exchange) or not re.search(r'[\u3400-\u9fff]', meaning) or len(meaning) > 4000 or len(phonetic) > 500 or len(exchange) > 2000:
        return None
    result = {'word': word, 'meaning': meaning, 'phonetic': phonetic}
    labels = list(dict.fromkeys(match.group(1).lower() + '.' for match in POS.finditer(meaning)))
    if labels:
        result['partOfSpeech'] = ' / '.join(labels)
    if exchange:
        result['exchange'] = exchange
    return result


def frequency(row):
    values = []
    for key in ['bnc', 'frq']:
        try:
            value = int(row.get(key) or 0)
            if value > 0:
                values.append(value)
        except ValueError:
            pass
    return min(values, default=10**9)


def rows():
    with (VENDOR / 'ecdict.csv').open(encoding='utf-8-sig', newline='') as stream:
        yield from csv.DictReader(stream)


def build():
    source = verified_file('ecdict.csv', SOURCE_SHA256)
    license_data = verified_file('LICENSE', LICENSE_SHA256)
    verified_file('README.md', README_SHA256)
    candidates = []
    seen = set()
    source_rows = 0
    for row in rows():
        source_rows += 1
        rank = frequency(row)
        tags = clean(row.get('tag'))
        oxford = row.get('oxford') == '1'
        collins = str(row.get('collins') or '') not in ('', '0')
        if not (oxford or tags or collins or rank <= FREQUENCY_LIMIT):
            continue
        item = entry(row)
        if item and item['word'] not in seen:
            seen.add(item['word'])
            score = (0 if oxford else 1 if tags else 2 if collins else 3, rank, item['word'].casefold(), item['word'])
            candidates.append((score, item))
    candidates.sort(key=lambda pair: pair[0])
    selected = {item['word']: item for _, item in candidates[:BASE_LIMIT]}
    base_count = len(selected)
    wanted = {}
    for priority, item in enumerate(selected.values()):
        for relation in item.get('exchange', '').split('/'):
            if ':' in relation:
                code, form = relation.split(':', 1)
                if code in {'d', 'p', 'i', '3', 's', 'r', 't', '0'} and form:
                    wanted[form] = min(wanted.get(form, priority), priority)
    variants = []
    for row in rows():
        if row['word'] in wanted and row['word'] not in selected:
            item = entry(row)
            if item:
                variants.append((wanted[row['word']], frequency(row), item))
    variants.sort(key=lambda pair: (pair[0], pair[1], pair[2]['word'].casefold(), pair[2]['word']))
    for _, _, item in variants[:TOTAL_LIMIT - base_count]:
        selected[item['word']] = item
    entries = sorted(selected.values(), key=lambda item: (item['word'].casefold(), item['word']))
    source_info = {
        'id': 'ecdict', 'name': 'ECDICT 社区英汉词典', 'version': VERSION, 'commit': COMMIT,
        'url': 'https://github.com/skywind3000/ECDICT/tree/' + COMMIT,
        'license': 'MIT', 'licenseFile': 'vendor/LICENSE-ECDICT.txt',
        'phoneticLabel': '词典音标（保留原库标记，未分英美）', 'sourceSha256': SOURCE_SHA256,
        'notice': '社区汇编词典，资料可能有误；词义与读音需结合词性和语境核对。'
    }
    data = {'schema': 1, 'source': source_info, 'entries': entries}
    js = ('/* ECDICT pinned common-word subset; MIT notice: vendor/LICENSE-ECDICT.txt */\nglobalThis.DictionaryData=' + json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c') + ';\n').encode('utf-8')
    if len(js) > 16 * 1024 * 1024:
        raise ValueError('Offline subset exceeded the 16MB resource limit')
    manifest = {'format': 'jiufen-dictionary', 'schema': 1, 'version': VERSION, 'source': source_info,
                'file': 'dictionary-data.js', 'sha256': digest(js), 'bytes': len(js), 'entryCount': len(entries),
                'withPhonetic': sum(bool(item['phonetic']) for item in entries),
                'selection': {'sourceRows': source_rows, 'baseEntries': base_count, 'additionalVariants': len(entries) - base_count,
                              'baseLimit': BASE_LIMIT, 'totalLimit': TOTAL_LIMIT, 'frequencyLimit': FREQUENCY_LIMIT,
                              'rule': 'Oxford/exam tags/Collins or BNC-FRQ top30000, bounded priority selection, then source-backed inflections by base-word priority'}}
    return {'web/dictionary-data.js': js, 'web/dictionary-manifest.json': (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode('utf-8'), 'web/vendor/LICENSE-ECDICT.txt': license_data}, manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--download', action='store_true', help='Developer-only: download exact SHA256-pinned source files')
    parser.add_argument('--check', action='store_true', help='Offline: reproduce and compare generated assets')
    args = parser.parse_args()
    if args.download:
        download()
    files, manifest = build()
    for relative, raw in files.items():
        path = ROOT / relative
        if args.check:
            if not path.is_file() or path.read_bytes() != raw:
                raise ValueError('Generated asset differs: ' + relative)
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(raw)
    print(json.dumps({key: manifest[key] for key in ['version', 'entryCount', 'withPhonetic', 'bytes', 'sha256', 'selection']}, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
