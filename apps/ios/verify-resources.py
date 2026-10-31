"""Fail the build before compiling if personal state or remote scripts were bundled."""
from pathlib import Path
import json
import plistlib
import re
import sys
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
html = (ROOT / "web" / "index.html").read_text(encoding="utf-8")
for path in [*(ROOT / "web" / name for name in ["native-adapter.js", "pako.min.js", "style.css", "app.js"]), ROOT / "shared" / "sync-core.js"]:
    assert path.is_file() and path.stat().st_size > 100, f"Missing runtime: {path}"
embedded = re.search(r'<script\s+id="portable-state"\s+type="application/json">([\s\S]*?)</script>', html)
assert embedded and json.loads(embedded.group(1)) is None, "Do not upload an exported HTML containing personal learning state."
vocabulary = re.search(r'<script\s+id="vocabulary-data"\s+type="application/json">([\s\S]*?)</script>', html)
assert vocabulary, "Vocabulary data is missing."
words = json.loads(vocabulary.group(1))
assert len(words) == 1493 and len({w["id"] for w in words}) == 1493, "Wrong bundled vocabulary."
assert all(w["phonetic"].strip() for w in words), "Missing phonetic data."
for source in re.findall(r'<(?:script|iframe)\b[^>]*\bsrc=["\']([^"\']+)', html, re.I):
    assert not re.match(r'^(?:https?:)?//', source), f"Offline app includes remote runtime: {source}"
    if not source.startswith("data:"):
        assert ".." not in source and source in ["native-adapter.js", "sync-core.js", "pako.min.js", "app.js", "host-hooks.js", "sync-panel.js"], f"Unexpected runtime asset: {source}"
assert "__JIUFEN_IOS__" in (ROOT / "apps/ios/JiufenVocabulary/AppDelegate.swift").read_text(encoding="utf-8")
with (ROOT / "apps/ios/JiufenVocabulary/Info.plist").open("rb") as file:
    info = plistlib.load(file)
assert info["UIFileSharingEnabled"] is True
assert info["CFBundleIdentifier"] == "$(PRODUCT_BUNDLE_IDENTIFIER)"
ET.parse(ROOT / "apps/ios/JiufenVocabulary.xcodeproj/xcshareddata/xcschemes/JiufenVocabulary.xcscheme")
print("PASS offline resources, 1,493 words, all phonetics, no embedded progress, Info.plist and shared Xcode scheme")
