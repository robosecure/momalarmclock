#!/usr/bin/env python3
"""Fixed 1.05x pitch-preserving audio successors. Remote execution only."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys

BASE = Path(__file__).resolve().parent
PINS = {
    "beta": {"path": "assets/beta-original.mp3", "sha256": "6b839d387b092fb6a06d836dc7f40524c20748733aee21ec89765e62d8f0f336", "duration_seconds": 49.56},
    "ga": {"path": "assets/ga-original.mp3", "sha256": "0e938ac9e43fd5f8eae100f1c931b5260846bbced91c40154fbde2ed13943cc4", "duration_seconds": 36.264},
}
TEMPO = 1.05
FORMAT = "mp3/192kbps/48000Hz/mono"


def demand(ok, why):
    if not ok:
        raise ValueError(why)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def validate():
    mpath = BASE / "manifest.json"
    demand(mpath.is_file() and not mpath.is_symlink(), "Missing/unsafe manifest")
    m = json.loads(mpath.read_text())
    demand(set(m) == {"schema", "tempo", "inputs", "output_format", "limits"}, "Wrong manifest fields")
    demand(m["schema"] == "momalarm-narration-tempo-v1" and type(m["tempo"]) is float and m["tempo"] == TEMPO and m["inputs"] == PINS and m["output_format"] == FORMAT, "Changed processing contract")
    demand(type(m["limits"]) is str and 0 < len(m["limits"]) <= 600, "Missing review limitations")
    demand(not (BASE / "assets").is_symlink(), "Unsafe assets folder")
    for name, spec in PINS.items():
        pin, duration = spec["sha256"], spec["duration_seconds"]
        demand(isinstance(pin, str) and bool(re.fullmatch(r"[0-9a-f]{64}", pin)) and type(duration) in (int, float) and math.isfinite(duration) and 0 < duration < 180, "Source not yet bound: " + name)
        source = BASE / spec["path"]
        demand(source.is_file() and not source.is_symlink() and source.resolve().is_relative_to(BASE), "Missing/unsafe source: " + name)
        demand(digest(source) == pin, "Source hash mismatch: " + name)
    return m


def command(args, path):
    with path.open("xb") as log:
        result = subprocess.run(args, stdout=log, stderr=subprocess.STDOUT, timeout=120)
    demand(result.returncode == 0, args[0] + " EXIT " + str(result.returncode))


def probe(source, folder, label, output=False):
    with (folder / (label + "-probe.json")).open("xb") as out, (folder / (label + "-probe.stderr.log")).open("xb") as err:
        result = subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(source)], stdout=out, stderr=err, timeout=120)
    demand(result.returncode == 0, "ffprobe EXIT " + str(result.returncode))
    p = json.loads((folder / (label + "-probe.json")).read_text())
    demand(len(p["streams"]) == 1, "Exactly one voice stream required")
    a = p["streams"][0]
    demand(a.get("codec_type") == "audio" and a.get("sample_rate") == "48000" and a.get("channels") == 1, "Wrong voice format")
    if output:
        demand(a.get("codec_name") == "mp3" and a.get("bit_rate") == "192000", "Wrong successor codec")
    seconds = float(p["format"]["duration"])
    demand(math.isfinite(seconds) and seconds > 0, "Invalid duration")
    return seconds


def encode_args(source, target):
    return ["ffmpeg", "-hide_banner", "-nostdin", "-n", "-xerror", "-threads", "1", "-filter_threads", "1", "-err_detect", "explode", "-i", str(source), "-map", "0:a:0", "-vn", "-af", "atempo=1.05", "-ar", "48000", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "192k", str(target)]


def run():
    demand(os.environ.get("GITHUB_ACTIONS") == "true" and os.environ.get("RUNNER_TEMP"), "Remote GitHub runner required")
    parent = Path(os.environ["RUNNER_TEMP"]).resolve()
    folder = parent / "momalarm-narration-tempo"
    demand(not folder.exists() and not folder.is_symlink(), "Refuse overwrite")
    folder.mkdir()
    records = []
    for name, spec in PINS.items():
        source = BASE / spec["path"]
        original = probe(source, folder, name + "-original")
        demand(abs(original - spec["duration_seconds"]) <= 0.25, "Source duration drift: " + name)
        target = folder / (name + "-105-review.mp3")
        command(encode_args(source, target), folder / (name + "-tempo.log"))
        actual = probe(target, folder, name + "-105", output=True)
        demand(abs(actual - original / TEMPO) <= 0.15, "Tempo duration mismatch: " + name)
        log = folder / (name + "-decode-loudness.log")
        command(["ffmpeg", "-hide_banner", "-nostdin", "-xerror", "-threads", "1", "-filter_threads", "1", "-err_detect", "explode", "-i", str(target), "-vn", "-af", "ebur128=peak=true,volumedetect", "-f", "null", "-"], log)
        text = log.read_text()
        metrics = {}
        for key, pattern in {"integrated_lufs": r"I:\s*(-?\d+(?:\.\d+)?)\s*LUFS", "true_peak_dbfs": r"Peak:\s*(-?\d+(?:\.\d+)?)\s*dBFS", "max_volume_dbfs": r"max_volume:\s*(-?\d+(?:\.\d+)?)\s*dB"}.items():
            values = re.findall(pattern, text)
            demand(bool(values), "Missing numeric audio metric: " + key)
            metrics[key] = float(values[-1])
        demand(metrics["max_volume_dbfs"] > -90, "Effectively silent output")
        records.append({"variant": name, "source_sha256": spec["sha256"], "output": target.name, "sha256": digest(target), "original_seconds": original, "tempo": TEMPO, "expected_seconds": original / TEMPO, "actual_seconds": actual, "encode_exit": 0, "full_decode_exit": 0, "audio_metrics": metrics, "peak_review_needed": metrics["true_peak_dbfs"] > -1})
    with (folder / "EXPORTS.json").open("x") as out:
        out.write(json.dumps({"state": "NEW_AUDIO_FOR_EXACT_REVIEW", "outputs": records, "limits": "No hearing, spoken alignment, runtime parity, new-hash approval or posting clearance."}, indent=2) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--check", action="store_true")
    group.add_argument("--run", action="store_true")
    args = parser.parse_args()
    validate()
    if args.run:
        run()
    print("PASS: exact source pins and fixed processing contract")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("FAIL: " + str(error), file=sys.stderr)
        sys.exit(1)
