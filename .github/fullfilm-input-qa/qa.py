#!/usr/bin/env python3
"""Fixed product-input technical QA only; no full-film or publication action."""
from pathlib import Path
import argparse
import hashlib
import json
import math
import os
import re
import struct
import subprocess
import sys

BASE = Path(__file__).resolve().parent
PINS = {
    "assets/narration.mp3": "6b839d387b092fb6a06d836dc7f40524c20748733aee21ec89765e62d8f0f336",
    "assets/endcard.png": "2238d86d5726c5cb4f9a334951cfc85690d05274774af8763fec55f0f4883d7b",
}
VOICE = {"duration_seconds": 49.56, "sample_rate_hz": 48000,
         "channels": 1, "bit_rate_bps": 128000, "speed": 1.0}
CARD = {"width": 1080, "height": 1920, "fps": 24, "frames": 72,
        "duration_seconds": 3, "audio": False}


def demand(ok, message):
    if not ok:
        raise ValueError(message)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def validate():
    path = BASE / "manifest.json"
    demand(path.is_file() and not path.is_symlink(), "Unsafe manifest")
    manifest = json.loads(path.read_text())
    demand(type(manifest) is dict and set(manifest) ==
           {"schema", "inputs", "voice", "endcard", "limits"}, "Malformed manifest")
    demand(manifest["schema"] == "momalarm-fullfilm-input-qa-v1" and
           type(manifest["inputs"]) is dict and manifest["inputs"] == PINS,
           "Exactly two approved input pins required")
    for key, expected in [("voice", VOICE), ("endcard", CARD)]:
        actual = manifest[key]
        demand(type(actual) is dict and set(actual) == set(expected) and
               all(type(actual[k]) is type(v) and actual[k] == v
                   for k, v in expected.items()), "Wrong fixed " + key + " metadata")
    demand(type(manifest["limits"]) is str and 0 < len(manifest["limits"]) <= 600,
           "Missing technical-only limits")
    demand(not (BASE / "assets").is_symlink(), "Unsafe input folder")
    for name, pin in PINS.items():
        asset = BASE / name
        demand(asset.is_file() and not asset.is_symlink() and
               asset.resolve().is_relative_to(BASE), "Unsafe or missing input: " + name)
        demand(digest(asset) == pin, "Changed input: " + name)
    png = (BASE / "assets/endcard.png").read_bytes()
    demand(png[:8] == b"\x89PNG\r\n\x1a\n" and png[12:16] == b"IHDR" and
           struct.unpack(">II", png[16:24]) == (1080, 1920), "Wrong PNG dimensions")
    return manifest


def duration(probe):
    seconds = float(probe["format"]["duration"])
    demand(math.isfinite(seconds) and seconds > 0, "Invalid probed duration")
    return seconds


def voice_probe(probe):
    streams = probe["streams"]
    demand(type(streams) is list and len(streams) == 1, "One voice stream required")
    audio = streams[0]
    demand(audio.get("codec_type") == "audio" and audio.get("codec_name") == "mp3"
           and audio.get("sample_rate") == "48000" and
           type(audio.get("channels")) is int and audio["channels"] == 1 and
           audio.get("bit_rate") == "128000", "Unexpected voice format")
    seconds = duration(probe)
    demand(abs(seconds - 49.56) <= 0.25, "Voice duration differs from pinned input metadata")
    return seconds


def endcard_probe(probe):
    streams = probe["streams"]
    demand(type(streams) is list and len(streams) == 1, "Silent endcard needs one stream")
    video = streams[0]
    demand(video.get("codec_type") == "video" and video.get("codec_name") == "h264"
           and type(video.get("width")) is int and video["width"] == 1080 and
           type(video.get("height")) is int and video["height"] == 1920 and
           video.get("avg_frame_rate") == "24/1" and video.get("nb_frames") == "72"
           and video.get("pix_fmt") == "yuv420p", "Wrong endcard frames/format")
    demand(abs(duration(probe) - 3) <= 0.001, "Wrong endcard duration")


def command(args, log):
    with log.open("xb") as handle:
        result = subprocess.run(args, stdout=handle, stderr=subprocess.STDOUT, timeout=120)
    demand(result.returncode == 0, args[0] + " EXIT " + str(result.returncode))


def probe(path, folder, name):
    output = folder / (name + ".json")
    error = folder / (name + ".stderr.log")
    with output.open("xb") as out, error.open("xb") as err:
        result = subprocess.run(["ffprobe", "-v", "error", "-show_streams",
                                 "-show_format", "-of", "json", str(path)],
                                stdout=out, stderr=err, timeout=120)
    demand(result.returncode == 0, "ffprobe EXIT " + str(result.returncode))
    return json.loads(output.read_text())


def run(folder):
    demand(os.environ.get("GITHUB_ACTIONS") == "true" and "RUNNER_TEMP" in os.environ,
           "Run requires a GitHub runner")
    expected = Path(os.environ["RUNNER_TEMP"]).resolve() / "momalarm-fullfilm-input-qa"
    demand(folder.resolve() == expected and not folder.exists(),
           "Refusing output escape or overwrite")
    folder.mkdir()
    voice = BASE / "assets/narration.mp3"
    seconds = voice_probe(probe(voice, folder, "voice-probe"))
    log = folder / "voice-audio.log"
    command(["ffmpeg", "-hide_banner", "-nostdin", "-xerror", "-threads", "1",
             "-filter_threads", "1", "-err_detect", "explode", "-i", str(voice),
             "-vn", "-af", "ebur128=peak=true,volumedetect,silencedetect=noise=-35dB:d=0.25",
             "-f", "null", "-"], log)
    text = log.read_text()
    metrics = {}
    for key, pattern in {
        "integrated_lufs": r"I:\s*(-?\d+(?:\.\d+)?)\s*LUFS",
        "true_peak_dbfs": r"Peak:\s*(-?\d+(?:\.\d+)?)\s*dBFS",
        "mean_volume_dbfs": r"mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB",
        "max_volume_dbfs": r"max_volume:\s*(-?\d+(?:\.\d+)?)\s*dB",
    }.items():
        values = re.findall(pattern, text)
        demand(bool(values), "Missing or non-finite audio metric: " + key)
        metrics[key] = float(values[-1])
    demand(metrics["max_volume_dbfs"] > -90, "Voice is effectively silent")
    metrics["silence_start_seconds"] = [float(x) for x in
                                         re.findall(r"silence_start:\s*(\d+(?:\.\d+)?)", text)]
    metrics["silence_end_seconds"] = [float(x) for x in
                                       re.findall(r"silence_end:\s*(\d+(?:\.\d+)?)", text)]
    metrics["mix_headroom_review_needed"] = metrics["true_peak_dbfs"] > -1
    endcard = folder / "endcard.mp4"
    command(["ffmpeg", "-hide_banner", "-nostdin", "-n", "-threads", "1",
             "-filter_threads", "1", "-loop", "1", "-framerate", "24", "-i",
             str(BASE / "assets/endcard.png"), "-frames:v", "72", "-t", "3",
             "-an", "-c:v", "libx264", "-threads", "1", "-pix_fmt", "yuv420p",
             "-movflags", "+faststart", str(endcard)], folder / "endcard-encode.log")
    endcard_probe(probe(endcard, folder, "endcard-probe"))
    report = {"state": "INPUT_TECHNICAL_QA_ONLY", "inputs": PINS,
              "probe_duration_seconds": seconds, "audio_decode_exit": 0,
              "audio_metrics": metrics, "endcard": {"file": "endcard.mp4",
              "sha256": digest(endcard), "frames": 72, "fps": 24, "seconds": 3,
              "encode_exit": 0}, "limitations": "No hearing, spoken-word alignment, "
              "runtime parity, owner approval, full-film or publication clearance."}
    with (folder / "EXPORTS.json").open("x") as out:
        out.write(json.dumps(report, indent=2) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--run", action="store_true")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    validate()
    if args.run:
        demand(args.output is not None, "Output directory required")
        run(args.output)
    else:
        demand(args.output is None, "Check mode does not accept output")
        print("CHECK PASS; exactly two approved inputs; no FFmpeg executed")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError, TypeError, IndexError, struct.error,
            subprocess.TimeoutExpired) as error:
        print("FAIL: " + str(error), file=sys.stderr)
        sys.exit(1)
