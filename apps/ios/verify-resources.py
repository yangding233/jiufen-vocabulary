"""Fail the build before compiling if personal state or remote scripts were bundled."""
from pathlib import Path
import json
import plistlib
import re
import sys
import xml.etree.ElementTree as ET
import hashlib

ROOT = Path(__file__).resolve().parents[2]
html = (ROOT / "web" / "index.html").read_text(encoding="utf-8")
for path in [*(ROOT / "web" / name for name in ["native-adapter.js", "pako.min.js", "style.css", "app.js", "learning-tools.js", "content-pack.js", "wordbooks.js", "word-import.js", "dictionary.js", "dictionary-data.js", "dictionary-manifest.json", "vendor/xlsx.full.min.js"]), ROOT / "shared" / "sync-core.js"]:
    assert path.is_file() and path.stat().st_size > 100, f"Missing runtime: {path}"
embedded = re.search(r'<script\s+id="portable-state"\s+type="application/json">([\s\S]*?)</script>', html)
dictionary_manifest=json.loads((ROOT/'web/dictionary-manifest.json').read_text(encoding='utf-8'))
dictionary_data=(ROOT/'web/dictionary-data.js').read_bytes()
assert dictionary_manifest['entryCount']==50000 and len(dictionary_data)==dictionary_manifest['bytes']
assert hashlib.sha256(dictionary_data).hexdigest()==dictionary_manifest['sha256'], 'Offline dictionary checksum mismatch'
assert (ROOT/'web/vendor/LICENSE-ECDICT.txt').is_file()
assert embedded and json.loads(embedded.group(1)) is None, "Do not upload an exported HTML containing personal learning state."
vocabulary = re.search(r'<script\s+id="vocabulary-data"\s+type="application/json">([\s\S]*?)</script>', html)
assert vocabulary, "Vocabulary data is missing."
words = json.loads(vocabulary.group(1))
assert len(words) == 1493 and len({w["id"] for w in words}) == 1493, "Wrong bundled vocabulary."
assert all(w["phonetic"].strip() for w in words), "Missing phonetic data."
assert all(w["memory"]["kind"] not in {"待补巧记", "形近对照候选"} for w in words), "Unfinished built-in mnemonics."
for source in re.findall(r'<(?:script|iframe)\b[^>]*\bsrc=["\']([^"\']+)', html, re.I):
    assert not re.match(r'^(?:https?:)?//', source), f"Offline app includes remote runtime: {source}"
    if not source.startswith("data:"):
        assert ".." not in source and source in ["native-adapter.js", "sync-core.js", "pako.min.js", "app.js", "host-hooks.js", "sync-panel.js", "learning-tools.js", "content-pack.js", "wordbooks.js", "word-import.js", "dictionary.js", "vendor/xlsx.full.min.js"], f"Unexpected runtime asset: {source}"
for path in (ROOT / "web").rglob("*"):
    assert not path.is_symlink(), f"Do not bundle symlinks: {path.name}"
    if path.is_file():
        assert path.suffix.lower() in {".html", ".js", ".css", ".json", ".wav", ".mp3", ".m4a"} or path.name in {"LICENSE-SheetJS.txt", "LICENSE-ECDICT.txt"}, f"Unexpected offline file: {path.name}"
content = json.loads((ROOT / "web/content-pack.json").read_text(encoding="utf-8"))
assert content["format"] == "jiufen-content" and content["schema"] == 1 and len(content["entries"]) == 1493
assert {entry["id"] for entry in content["entries"]} == {word["id"] for word in words}
manifest_path = ROOT / "web/audio-manifest.json"
if manifest_path.is_file():
    import hashlib
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest["schema"] == 1 and set(manifest["entries"]) == {word["id"] for word in words}
    for entry in manifest["entries"].values():
        for accent in ("en-GB", "en-US"):
            audio = entry[accent]
            relative = Path(audio["file"])
            assert not relative.is_absolute() and ".." not in relative.parts and relative.parts[0] == "audio"
            file = ROOT / "web" / relative
            assert file.is_file() and file.stat().st_size > 100 and audio["seconds"] > 0
            assert hashlib.sha256(file.read_bytes()).hexdigest() == audio["sha256"], f"Audio checksum mismatch: {relative}"
assert "__JIUFEN_IOS__" in (ROOT / "apps/ios/JiufenVocabulary/AppDelegate.swift").read_text(encoding="utf-8")
with (ROOT / "apps/ios/JiufenVocabulary/Info.plist").open("rb") as file:
    info = plistlib.load(file)
assert info["UIFileSharingEnabled"] is True
assert info["CFBundleIdentifier"] == "$(PRODUCT_BUNDLE_IDENTIFIER)"
assert info["CFBundleShortVersionString"] == "$(MARKETING_VERSION)"
icons = ROOT / "apps/ios/JiufenVocabulary/Assets.xcassets/AppIcon.appiconset"
catalogue = json.loads((icons / "Contents.json").read_text(encoding="utf-8"))
assert len(catalogue["images"]) == 18
assert all((icons / image["filename"]).is_file() for image in catalogue["images"])
ET.parse(ROOT / "apps/ios/JiufenVocabulary.xcodeproj/xcshareddata/xcschemes/JiufenVocabulary.xcscheme")
print("PASS offline resources, 1,493 words, all phonetics, no embedded progress, Info.plist and shared Xcode scheme")
