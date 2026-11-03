"""Compile original bilingual usage cards without changing the vocabulary identity.

Authoring files are UTF-8 ``tools/usage/part-*.tsv``. Each non-comment row is
``word|sentence|translation|collocation1；collocation2`` or the same with an
explicit id before word. Despite the historical .tsv suffix, pipes are used so
ordinary commas and apostrophes remain easy to edit.
"""
from pathlib import Path
import argparse
import json
import re
import unicodedata

ROOT = Path(__file__).resolve().parents[1]
DIRECTORY = ROOT / "tools" / "usage"


def normal(value):
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", value)).strip().casefold()


def includes_word(sentence, word):
    return bool(re.search(r"(?<!\w)" + re.escape(normal(word)) + r"(?!\w)", normal(sentence)))


def compile_entries(vocabulary, allow_incomplete=False):
    originals = {normal(item["word"]): item for item in vocabulary}
    if len(originals) != len(vocabulary):
        raise ValueError("Vocabulary has duplicate normalized word forms")
    cards = {}
    for source in sorted(DIRECTORY.glob("part-*.tsv")):
        for number, line in enumerate(source.read_text(encoding="utf-8-sig").splitlines(), 1):
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            fields = [field.strip() for field in line.split("|")]
            if len(fields) == 4:
                word, sentence, translation, phrases = fields
                identity = None
            elif len(fields) == 5:
                identity, word, sentence, translation, phrases = fields
            else:
                raise ValueError(f"{source.name}:{number}: expected 4 or 5 pipe-separated fields")
            original = originals.get(normal(word))
            if not original or (identity is not None and identity != original["id"]):
                raise ValueError(f"{source.name}:{number}: unknown or mismatched identity {word!r}")
            if original["id"] in cards:
                raise ValueError(f"Duplicate usage entry: {word}")
            collocations = [text.strip() for text in re.split(r"[；;]", phrases) if text.strip()]
            if not 1 <= len(collocations) <= 2 or not sentence or not translation:
                raise ValueError(f"{word}: missing sentence, translation or 1–2 collocations")
            if not includes_word(sentence, word):
                raise ValueError(f"{word}: complete target form is absent from example")
            if not re.search(r"[\u3400-\u9fff]", translation):
                raise ValueError(f"{word}: Chinese translation is absent")
            joined = " ".join([sentence, translation, *collocations])
            if re.search(r"待补|占位|TODO|TBD|example goes here|this is a word", joined, re.I):
                raise ValueError(f"{word}: placeholder text")
            cards[original["id"]] = {"id": original["id"], "word": original["word"], "usage": {
                "sentence": sentence, "translation": translation, "collocations": collocations}}
    missing = [word["word"] for word in vocabulary if word["id"] not in cards]
    if missing and not allow_incomplete:
        raise ValueError(f"Missing {len(missing)} usage cards: {', '.join(missing[:25])}")
    result = [cards[word["id"]] for word in vocabulary if word["id"] in cards]
    return result, missing


def compile_alternatives(vocabulary):
    """Compile explicitly authored second cues; never infer a mnemonic from spelling."""
    source = DIRECTORY / "alternatives-source.tsv"
    originals = {normal(item["word"]): item for item in vocabulary}
    result = []
    seen = set()
    for number, line in enumerate(source.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        fields = [field.strip() for field in line.split("|")]
        if len(fields) != 3:
            raise ValueError(f"{source.name}:{number}: expected word|parts|scene")
        word, pieces, scene = fields
        original = originals.get(normal(word))
        if not original or normal(word) in seen:
            raise ValueError(f"Unknown or duplicate alternative word: {word}")
        parts = []
        for chunk in re.split(r"；(?=[^；|=]+=)", pieces):
            text, cue = chunk.split("=", 1)
            if not text.strip() or not cue.strip():
                raise ValueError(f"{word}: empty alternative part")
            parts.append({"text": text.strip(), "cue": cue.strip()})
        if normal("".join(part["text"] for part in parts)) != normal(original["word"]):
            raise ValueError(f"{word}: alternative parts do not reconstruct the word")
        if not scene.strip() or re.search(r"待补|TODO|TBD|占位", scene, re.I):
            raise ValueError(f"{word}: missing alternative scene")
        result.append({"word": original["word"], "id": "alt-1", "label": "另一条熟词线索", "parts": parts,
            "scene": scene, "focus": f"按上方借词步骤还原，核对完整拼写：{original['word']}",
            "reference": "原创的另一种助记方案。借词删改与场景仅作记忆线索，不作为历史词源或标准发音；提示词不熟悉时可切换或编辑。"})
        seen.add(normal(word))
    if len(result) != 120:
        raise ValueError(f"Expected 120 authored alternatives; got {len(result)}")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vocabulary", type=Path, help="Optional vocabulary JSON; defaults to the public web/index.html vocabulary-data")
    parser.add_argument("--allow-incomplete", action="store_true", help="Validate authoring batches while work is in progress")
    parser.add_argument("--check", action="store_true", help="Validate current outputs without overwriting them")
    args = parser.parse_args()
    if args.vocabulary:
        vocabulary = json.loads(args.vocabulary.read_text(encoding="utf-8"))
    else:
        html = (ROOT / "web" / "index.html").read_text(encoding="utf-8")
        match = re.search(r'<script\s+id="vocabulary-data"\s+type="application/json">([\s\S]*?)</script>', html)
        if not match:
            raise ValueError("web/index.html has no vocabulary-data JSON")
        vocabulary = json.loads(match.group(1))
    entries, missing = compile_entries(vocabulary, args.allow_incomplete)
    json_text = json.dumps(entries, ensure_ascii=False, indent=2) + "\n"
    rows = ["# id|word|sentence|translation|collocation1；collocation2"]
    for entry in entries:
        card = entry["usage"]
        rows.append("|".join([entry["id"], entry["word"], card["sentence"], card["translation"], "；".join(card["collocations"])]))
    tsv_text = "\n".join(rows) + "\n"
    alternatives = compile_alternatives(vocabulary)
    outputs = [(DIRECTORY / "entries.json", json_text), (DIRECTORY / "usage.tsv", tsv_text),
        (ROOT / "tools" / "mnemonics" / "alternatives.json", json.dumps(alternatives, ensure_ascii=False, indent=2) + "\n")]
    for path, content in outputs:
        if args.check:
            if not path.exists() or path.read_text(encoding="utf-8") != content:
                raise ValueError(f"Out-of-date compiled usage data: {path}")
        else:
            path.write_text(content, encoding="utf-8")
    print(json.dumps({"entries": len(entries), "vocabulary": len(vocabulary), "missing": len(missing), "alternatives": len(alternatives), "checked": args.check}, ensure_ascii=False))


if __name__ == "__main__":
    main()
