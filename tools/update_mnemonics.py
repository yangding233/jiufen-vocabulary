"""Compile authored mnemonic plans into both offline applications' shared word bank.

Only built-in memory fields are replaced. Word IDs, order, phonetics, definitions,
personal cues and learning documents do not take part in this content build.
"""
from __future__ import annotations

import argparse
from collections import Counter
from copy import deepcopy
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
CONTENT = ROOT / "tools" / "mnemonics"
PATTERN = r'(<script id="vocabulary-data" type="application/json">)([\s\S]*?)(</script>)'
VERSION = "2026-11-03"
REFERENCE = (
    "参考三套课程的熟词搭桥、拼音编码与拆联方法，逐条原创的助记。"
    "本卡的字母借用与故事不作为历史词源；拼音、首字母和字形编码不作为英语读音。"
)


def rows(name: str):
    for number, line in enumerate((CONTENT / name).read_text(encoding="utf-8").splitlines(), 1):
        if line.strip() and not line.lstrip().startswith("#"):
            yield number, [part.strip() for part in line.split("|")]


def author_plans():
    plans = {}
    for file in sorted([*CONTENT.glob("batch-*.json"), *CONTENT.glob("extra-*.json")]):
        for entry in json.loads(file.read_text(encoding="utf-8")):
            key = entry["word"].casefold()
            assert key not in plans, f"Duplicate authored plan: {entry['word']} ({file.name})"
            plans[key] = deepcopy(entry)
    for number, fields in rows("refinements.tsv"):
        assert len(fields) == 3, f"refinements.tsv:{number}: expected three columns"
        word, encoded, scene = fields
        assert word.casefold() not in plans, f"Duplicate refinement: {word}"
        parts = []
        for part in encoded.split(";"):
            text, cue = part.split("=", 1)
            parts.append({"text": text.strip(), "cue": cue.strip()})
        plans[word.casefold()] = {"word": word, "parts": parts, "scene": scene}
    return plans


def operations_result(base, operations):
    output = []
    for operation in operations:
        assert base[operation["start"]:operation["end"]] == operation["before"]
        output.append(operation["after"])
    return "".join(output)


def compile_words(words):
    before = [{key: value for key, value in word.items() if key != "memory"} for word in words]
    by_word = {word["word"].casefold(): word for word in words}
    plans = author_plans()
    assert all(key in by_word for key in plans), "An authored plan is outside the regular word bank"
    for key, plan in plans.items():
        word = by_word[key]
        assert "".join(part["text"] for part in plan["parts"]).casefold() == key, f"Parts mismatch: {plan['word']}"
        assert plan["scene"].strip() and all(part["cue"].strip() for part in plan["parts"])
        word["memory"] = {
            "kind": "拆分巧记", "family": f"从 {plan['parts'][0]['text']} 搭桥",
            "anchor": " + ".join(f"{part['text']}（{part['cue']}）" for part in plan["parts"]),
            "parts": plan["parts"], "scene": plan["scene"],
            "focus": f"依次连接：{' + '.join(part['text'] for part in plan['parts'])} = {word['word']}",
            "related": word["memory"].get("related", []), "reference": REFERENCE,
            "status": "逐词编写 · 拼写已校验", "version": 3, "contentVersion": VERSION,
        }

    phrase_count = 0
    for number, fields in rows("phrases.tsv"):
        assert len(fields) == 3, f"phrases.tsv:{number}: expected three columns"
        name, encoded, scene = fields
        word = by_word[name.casefold()]
        tokens = re.findall(r"[A-Za-z]+|[^A-Za-z]+", word["word"])
        meanings = encoded.split(";")
        assert len(meanings) == sum(bool(re.fullmatch(r"[A-Za-z]+", token)) for token in tokens), f"Phrase gloss count: {name}"
        meanings = iter(meanings)
        parts = [
            {"text": token, "cue": next(meanings).strip() if re.fullmatch(r"[A-Za-z]+", token) else "按原词形保留的空格／连字符"}
            for token in tokens
        ]
        word["memory"] = {
            "kind": "短语搭桥", "family": "完整短语", "parts": parts,
            "anchor": " + ".join(f"{part['text']}（{part['cue']}）" for part in parts if part["text"].strip() and part["text"] != "-"),
            "scene": scene, "focus": f"按原词表还原空格、连字符与大小写：{word['word']}",
            "related": word["memory"].get("related", []), "reference": REFERENCE,
            "status": "逐词编写 · 短语已校验", "version": 3, "contentVersion": VERSION,
        }
        phrase_count += 1
    assert phrase_count == 156, f"Incomplete phrase content: {phrase_count}/156"

    glosses = {fields[0].casefold(): fields[1] for _, fields in rows("base-glosses.tsv")}
    plain_memories = {key: deepcopy(word["memory"]) for key, word in by_word.items()}

    def resolve(name, seen):
        key = name.casefold()
        assert key not in seen, f"Circular base-word lesson: {' -> '.join(sorted(seen))} -> {name}; add an independent authored plan"
        entry, memory = by_word.get(key), plain_memories.get(key)
        if entry and memory and key not in seen:
            if memory.get("parts"):
                return {"word": entry["word"], "meaning": entry["meaning"], "parts": memory["parts"], "scene": memory["scene"]}, []
            if memory.get("base") and memory.get("operations"):
                root, steps = resolve(memory["base"], seen | {key})
                return root, steps + [{"from": memory["base"], "to": entry["word"], "change": memory["focus"], "meaning": entry["meaning"]}]
        meaning = entry["meaning"] if entry else glosses.get(key)
        assert meaning, f"Missing base-word meaning: {name}"
        return {"word": name, "meaning": meaning, "parts": [{"text": name, "cue": f"英语 {name}：{meaning}"}], "scene": ""}, []

    transformed = 0
    for key, word in by_word.items():
        memory = word["memory"]
        if memory["kind"] != "熟词变形":
            continue
        assert operations_result(memory["base"], memory["operations"]).casefold() == key
        root, steps = resolve(memory["base"], {key})
        # Older handcrafted baseParts are useful when the base isn't a main entry.
        old_parts = memory.get("baseParts", [])
        if not root["scene"] and old_parts and "".join(part["text"] for part in old_parts).casefold() == root["word"].casefold():
            root["parts"] = old_parts
        memory["cueWord"] = root["word"]
        memory["baseParts"] = root["parts"]
        memory["baseScene"] = root["scene"]
        memory["baseMeaning"] = root["meaning"]
        memory["spellingSteps"] = steps + [{"from": memory["base"], "to": word["word"], "change": memory["focus"], "meaning": word["meaning"]}]
        memory["related"] = list(dict.fromkeys([*memory.get("related", []), *[step["from"] for step in memory["spellingSteps"] if step["from"].casefold() in by_word]]))
        memory["anchor"] = f"先记 {root['word']}（{root['meaning']}），再按下方步骤变成 {word['word']}。"
        if "看清词尾的变化，再按本条释义回忆" in memory["scene"]:
            memory["scene"] = f"{root['word']}：{root['meaning']}。本词 {word['word']}：{word['meaning']}。先用基础词的提示，再核对本词变形。"
        memory["status"] = "基础词提示＋变形步骤"
        memory["contentVersion"] = VERSION
        memory["version"] = 3
        transformed += 1
    assert before == [{key: value for key, value in word.items() if key != "memory"} for word in words], "Lexical data changed"
    assert len(words) == 1493
    assert all(word["memory"]["kind"] not in {"待补巧记", "形近对照候选"} for word in words), "Unfinished plans remain"
    assert not any("此处没有单独词义资料" in json.dumps(word["memory"], ensure_ascii=False) for word in words)
    return {"version": VERSION, "words": len(words), "authoredPlans": len(plans), "authoredPhrases": phrase_count, "linkedTransformations": transformed, "kinds": dict(Counter(word["memory"]["kind"] for word in words))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Fail when the checked-in bank differs from authored content")
    args = parser.parse_args()
    path = ROOT / "web" / "index.html"
    html = path.read_text(encoding="utf-8")
    match = re.search(PATTERN, html)
    assert match, "Missing vocabulary-data"
    words = json.loads(match[2])
    report = compile_words(words)
    payload = json.dumps(words, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    rendered = html[:match.start(2)] + payload + html[match.end(2):]
    options = '<option value="all">全部方法</option>' + ''.join(f'<option>{kind}</option>' for kind in ("熟词直连", "拆分巧记", "熟词变形", "短语搭桥"))
    rendered = re.sub(r'(<select id="network-kind">)[\s\S]*?(</select>)',lambda match: match[1] + options + match[2],rendered,count=1)
    counts = report["kinds"]
    footer = (
        f'内置巧记 · {VERSION} · 九分常规 1,493 条均有线索<br>'
        f'熟词直连 {counts["熟词直连"]} · 拆分与拼写联想 {counts["拆分巧记"]} · 熟词变形 {counts["熟词变形"]} · 短语 {counts["短语搭桥"]}<br>'
        '用熟悉的线索搭桥，再连接意思与拼写。不认识提示词或联想不顺手时，可停用或写自己的巧记。'
    )
    rendered = re.sub(r'(<footer class="page-footer small muted">)[\s\S]*?(</footer>)',lambda match: match[1] + footer + match[2],rendered,count=1)
    if args.check:
        assert rendered == html, "Run python tools/update_mnemonics.py to compile current authored content"
    else:
        path.write_text(rendered, encoding="utf-8")
        (CONTENT / "coverage-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
