"""Offline lexical screening of short neural-TTS samples, not pronunciation scoring.

Requires faster-whisper in the interpreter used to run this file. No dependency
installation, model download, cloud calls, or learning-database access occurs.
"""
from __future__ import annotations

import argparse
from collections import Counter
from difflib import SequenceMatcher
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MODEL = Path.home() / ".cache/huggingface/hub/models--Systran--faster-whisper-small/snapshots/536b0662742c02347bc0e980a01041f333bce120"


def tokens(text: str) -> list[str]:
    # Ignore punctuation/case only. Preserve the plural -s/-es: audience and
    # audiences must never silently compare equal. US/UK spelling is equivalent.
    return [x.replace("programme", "program") for x in re.findall(r"[a-z]+(?:'[a-z]+)?", text.lower())]


def lexical_review(expected: str, heard: str, readings: int = 1) -> dict:
    base = tokens(expected)
    target = base * readings
    actual = tokens(heard)
    if not actual:
        status = "empty-review"
    elif target == actual:
        status = "lexical-match"
    elif readings > 1 and actual == base:
        status = "repeat-collapsed-review"
    else:
        status = "mismatch-review"
    missing = Counter(target) - Counter(actual)
    extra = Counter(actual) - Counter(target)
    edits = [
        {"type": kind, "expected": target[a:b], "heard": actual[c:d]}
        for kind, a, b, c, d in SequenceMatcher(a=target, b=actual, autojunk=False).get_opcodes()
        if kind != "equal"
    ]
    return {"status": status, "expectedTokens": target, "heardTokens": actual,
            "missingTokens": dict(missing), "extraTokens": dict(extra), "edits": edits}


def load_plan(path: Path) -> list[dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, list):
        rows = data
    elif isinstance(data, dict):
        rows = data.get("samples") or data.get("items") or data.get("entries")
    else:
        rows = None
    if not isinstance(rows, list) or not rows:
        raise ValueError("Plan must be a nonempty array, or an object with samples/items/entries")
    output = []
    seen = {}
    for row in rows:
        if not isinstance(row, dict) or not re.fullmatch(r"jf-\d{4}", str(row.get("id", ""))):
            raise ValueError("Each sample requires a safe existing jf-0001-style id")
        if not isinstance(row.get("word"), str) or not row["word"].strip():
            raise ValueError("Each sample requires the actual word/phrase")
        # The generator's sample-plan has one row per accent. Screen each word
        # once per requested accent rather than scheduling those rows twice.
        previous = seen.get(row["id"])
        if previous:
            if previous["word"] != row["word"] or previous.get("readings") != row.get("readings"):
                raise ValueError("Conflicting repeated sample identifier")
            continue
        seen[row["id"]] = row
        output.append(row)
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, default=DEFAULT_MODEL)
    parser.add_argument("--plan", type=Path, default=ROOT / "tools/audio-pronunciation-overrides.json")
    parser.add_argument("--audio-root", type=Path, default=ROOT / "build/neural-audio/audio")
    parser.add_argument("--output", type=Path, default=ROOT / "build/neural-audio/asr-review.json")
    parser.add_argument("--locale", choices=["en-GB", "en-US", "both"], default="both")
    parser.add_argument("--slow", action="store_true", help="Also screen separately generated -slow.m4a files")
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--ffmpeg", type=Path, default=ROOT.parent / "work/video-bin/ffmpeg.exe")
    parser.add_argument("--limit", type=int, default=0, help="Limit sample words, zero means every plan sample")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        assert lexical_review("audiences", "Audience.")["status"] == "mismatch-review"
        assert lexical_review("a radio program", "A radio programme!")["status"] == "lexical-match"
        assert lexical_review("permit", "permit", 2)["status"] == "repeat-collapsed-review"
        assert lexical_review("use", "use use", 2)["status"] == "lexical-match"
        assert lexical_review("wind", "")["status"] == "empty-review"
        print("PASS lexical comparison distinguishes plural endings and collapsed repeated readings")
        return
    for name in ("config.json", "model.bin", "tokenizer.json", "vocabulary.txt"):
        if not (args.model / name).is_file():
            raise FileNotFoundError(f"Local model file is missing; no download attempted: {args.model / name}")
    args.output = args.output.resolve()
    if not args.output.is_relative_to(ROOT / "build"):
        raise ValueError("Development review reports must remain inside this project's build directory")
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    try:
        from faster_whisper import WhisperModel
        import numpy as np
    except ImportError as error:
        raise SystemExit("faster-whisper is absent in this Python interpreter; install it separately in .venv-audio. No installation was attempted.") from error
    rows = load_plan(args.plan)
    if not args.ffmpeg.is_file():
        raise FileNotFoundError(f"Local FFmpeg is missing; no download attempted: {args.ffmpeg}")
    if args.limit:
        rows = rows[:args.limit]
    override_data = json.loads((ROOT / "tools/audio-pronunciation-overrides.json").read_text(encoding="utf-8"))
    override_counts = {row["id"]: len(row["variants"]) for row in override_data["entries"]}
    locales = ["en-GB", "en-US"] if args.locale == "both" else [args.locale]
    jobs = []
    for row in rows:
        for locale in locales:
            for slow in ([False, True] if args.slow else [False]):
                filename = row["id"] + ("-slow" if slow else "") + ".m4a"
                file = args.audio_root / locale / filename
                if not file.is_file():
                    raise FileNotFoundError(f"Sample audio is missing: {file}")
                readings = int(row.get("readings", override_counts.get(row["id"], 1)))
                if not 1 <= readings <= 10:
                    raise ValueError("Expected readings must be between 1 and 10")
                jobs.append((row, locale, slow, file, readings))
    model = WhisperModel(str(args.model.resolve()), device="cpu", compute_type="int8",
                         local_files_only=True, cpu_threads=max(1, args.threads), num_workers=1)
    results = []
    started = time.monotonic()
    for row, locale, slow, file, readings in jobs:
        # No target-word initial_prompt: that would bias the ASR toward the
        # expected answer. VAD disabled to avoid discarding isolated short words.
        # Decode through the existing FFmpeg executable, passing a 16 kHz mono
        # float array to faster-whisper. This deliberately bypasses PyAV's open
        # metadata_errors argument, which changed in the installed PyAV 19 API.
        decoded = subprocess.run([str(args.ffmpeg), "-nostdin", "-hide_banner", "-loglevel", "error",
                                  "-i", str(file), "-f", "f32le", "-acodec", "pcm_f32le",
                                  "-ac", "1", "-ar", "16000", "pipe:1"],
                                 capture_output=True, timeout=30, check=True,
                                 creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        waveform = np.frombuffer(decoded.stdout, dtype="<f4").copy()
        if not 0.1 <= len(waveform) / 16000 <= 30 or not np.isfinite(waveform).all():
            raise ValueError(f"Invalid short audio waveform: {file}")
        segments, info = model.transcribe(waveform, language="en", task="transcribe",
                                          beam_size=1, best_of=1, temperature=0,
                                          condition_on_previous_text=False, vad_filter=False)
        segments = list(segments)
        heard = " ".join(segment.text.strip() for segment in segments).strip()
        result = {"id": row["id"], "word": row["word"], "locale": locale, "slow": slow,
                  "file": str(file.resolve()), "expectedReadings": readings, "transcript": heard,
                  "segments": [{"text": segment.text.strip(), "start": segment.start, "end": segment.end,
                                "avgLogprob": segment.avg_logprob, "noSpeechProbability": segment.no_speech_prob}
                               for segment in segments],
                  **lexical_review(row["word"], heard, readings)}
        results.append(result)
        print(json.dumps({"id": row["id"], "locale": locale, "slow": slow, "heard": heard,
                          "status": result["status"]}, ensure_ascii=False), flush=True)
    report = {"model": str(args.model.resolve()), "offline": True, "device": "cpu", "computeType": "int8",
              "beamSize": 1, "bestOf": 1, "decoder": "FFmpeg 16kHz mono float32 array",
              "seconds": round(time.monotonic() - started, 2),
              "warning": "Lexical matches only screen for likely omissions/additions. ASR cannot establish phoneme accuracy, stress, accent, naturalness, or equivalence of repeated heteronym readings. Every mismatch is for review, not proof of a TTS error.",
              "counts": dict(Counter(row["status"] for row in results)), "results": results}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"report": str(args.output), "counts": report["counts"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
