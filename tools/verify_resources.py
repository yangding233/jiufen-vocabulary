"""Check distributable Windows resources without reading personal app data."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import unicodedata


def check(root: Path) -> dict:
    root = root.resolve()
    web = root / "web"
    html = (web / "index.html").read_text(encoding="utf-8-sig")

    def embedded(name):
        match = re.search(r'<script\s+id="' + re.escape(name) + r'"\s+type="application/json">([\s\S]*?)</script>', html)
        if not match:
            raise ValueError("Missing embedded resource: " + name)
        return json.loads(match.group(1))

    assert embedded("portable-state") is None, "Embedded personal progress found"
    words = embedded("vocabulary-data")
    assert len(words) == 1493 and len({w["id"] for w in words}) == 1493, "Incomplete built-in vocabulary"
    assert all(str(w.get("phonetic", "")).strip() for w in words), "Missing built-in phonetics"
    pack = json.loads((web / "content-pack.json").read_text(encoding="utf-8"))
    assert len(pack["entries"]) == 1493 and pack == embedded("learning-content"), "Content resource mismatch"
    unsigned = {key: value for key, value in pack.items() if key != "checksum"}
    canonical = json.dumps(unsigned, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    assert hashlib.sha256(canonical.encode("utf-8")).hexdigest() == pack["checksum"], "Content checksum mismatch"
    audio = json.loads((web / "audio-manifest.json").read_text(encoding="utf-8"))
    assert len(audio["entries"]) == 1493 and audio == embedded("audio-data"), "Audio manifest mismatch"
    files = set()
    for word in words:
        for voice in ("en-GB", "en-US"):
            card = audio["entries"][word["id"]][voice]
            for record, suffix in ((card, ""), (card["slow"], "-slow")):
                name = f"audio/{voice}/{word['id']}{suffix}.m4a"
                assert record["file"] == name, "Unexpected audio path: " + name
                data = (web / name).read_bytes()
                assert len(data) > 256 and data[4:8] == b"ftyp", "Invalid M4A: " + name
                assert hashlib.sha256(data).hexdigest() == record["sha256"], "Audio checksum mismatch: " + name
                assert .1 < record["seconds"] < 20, "Invalid audio duration: " + name
                files.add(name)
    actual = {p.relative_to(web).as_posix() for p in (web / "audio").rglob("*") if p.is_file()}
    assert files == actual and len(files) == 5972, "Audio file set mismatch"
    sentences = json.loads((web / "sentence-audio-manifest.json").read_text(encoding="utf-8"))
    assert sentences["schema"] == 1 and sentences["recipe"] == "kokoro-emma-heart-text-v1", "Sentence audio recipe mismatch"
    sentence_files = set()
    sentence_keys = set()
    for entry in pack["entries"]:
        text = unicodedata.normalize("NFC", entry["usage"]["sentence"]).strip()
        for locale, voice in (("en-GB", "bf_emma"), ("en-US", "af_heart")):
            raw_key = json.dumps([sentences["recipe"], locale, text], ensure_ascii=False, separators=(",", ":"))
            key = hashlib.sha256(raw_key.encode("utf-8")).hexdigest()
            record = sentences["entries"][key]
            name = f"sentence-audio/{locale}/{key}.m4a"
            assert record["key"] == key and record["text"] == text and record["locale"] == locale and record["voice"] == voice, "Sentence identity mismatch"
            assert record["file"] == name and sentences["words"][entry["id"]][locale] == key, "Sentence resource reference mismatch"
            data = (web / name).read_bytes()
            assert len(data) == record["bytes"] and data[4:8] == b"ftyp" and .1 < record["seconds"] < 180, "Invalid sentence audio"
            assert hashlib.sha256(data).hexdigest() == record["sha256"], "Sentence audio checksum mismatch"
            sentence_files.add(name)
            sentence_keys.add(key)
    actual_sentences = {p.relative_to(web).as_posix() for p in (web / "sentence-audio").rglob("*") if p.is_file()}
    assert len(sentence_files) == 2986 and sentence_files == actual_sentences and sentence_keys == set(sentences["entries"]), "Sentence audio file set mismatch"
    manifest = json.loads((web / "dictionary-manifest.json").read_text(encoding="utf-8"))
    assert manifest["file"] == "dictionary-data.js", "Unexpected dictionary path"
    data = (web / manifest["file"]).read_bytes()
    assert len(data) == manifest["bytes"] and hashlib.sha256(data).hexdigest() == manifest["sha256"], "Dictionary checksum mismatch"
    match = re.fullmatch(r"/\*[^\n]*\*/\s*globalThis\.DictionaryData=(.*);\s*", data.decode("utf-8"), re.S)
    assert match, "Unexpected dictionary module"
    dictionary = json.loads(match.group(1))
    assert len(dictionary["entries"]) == manifest["entryCount"] == 50000, "Dictionary entry count mismatch"
    assert sum(bool(row.get("phonetic")) for row in dictionary["entries"]) == manifest["withPhonetic"], "Dictionary phonetic count mismatch"
    for name in ("LICENSE-ECDICT.txt", "LICENSE-SheetJS.txt"):
        assert (web / "vendor" / name).is_file(), "Missing vendor license: " + name
    for source in (root / "shared").glob("*.js"):
        copy = web / source.name
        if copy.exists():
            assert source.read_bytes() == copy.read_bytes(), "Shared/browser copy mismatch: " + source.name
    for name in re.findall(r'<script[^>]+src="([^"]+)"', html):
        assert not re.match(r"[a-z]+:|[/\\]", name, re.I) and ".." not in Path(name).parts, "External/unsafe script: " + name
        assert (web / name).is_file(), "Missing script: " + name
    assert not (root / "apps" / "ios").exists(), "Obsolete iOS source still present"
    return {"root": str(root), "words": len(words), "audioFiles": len(files), "sentenceAudioFiles": len(sentence_files), "dictionaryEntries": len(dictionary["entries"])}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    print(json.dumps(check(parser.parse_args().root), ensure_ascii=False))
