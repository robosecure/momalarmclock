#!/usr/bin/env python3
"""Render two editorial review artifacts only; timing admission is required."""
from pathlib import Path
import argparse, hashlib, json, math, os, subprocess, sys

BASE = Path(__file__).resolve().parent
VOICE_SHA = '0fd983148934d6c06b5c150741815e6f75e8682d9d02249f9f4e05094dbb401c'
SCRIPT_SHA = '63bbba1fa2cec34d6c06d56f5a93b56070d3ae5d09a54ddc0a65e52ed07e21ec'
FRAMES = [0, 42, 99, 175, 262, 296, 336, 444, 492, 528]
COMMON = ['alarm-card.png', 'reminders-card.png', 'morning-summary-card.png',
          'everyday-summary-card.png', 'status-card.png', 'cta-card.png', 'end-hold.png']
REQUIRED = {'assets/parent-scene.mp4', 'assets/cartoon-scene.mp4', 'assets/narration.mp3'}
REQUIRED |= {'assets/' + name for name in COMMON}
REQUIRED |= {'assets/' + v + '-opening-' + str(n) + '.png'
             for v in ['parent', 'cartoon'] for n in [1, 2]}


def demand(ok, message):
    if not ok:
        raise ValueError(message)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def validate():
    d = json.loads((BASE / 'manifest.json').read_text())
    demand(d['schema'] == 'momalarm-remote-review-v1', 'Wrong manifest')
    demand(d['render_script_sha256'] == digest(Path(__file__)), 'Changed renderer')
    demand(d['narration_script_sha256'] == SCRIPT_SHA, 'Wrong narration script')
    demand(d['inputs'].keys() == REQUIRED, 'Input set must contain exactly 14 approved files')
    demand(d['inputs']['assets/narration.mp3'] == VOICE_SHA, 'Wrong narration pin')
    for name, pin in d['inputs'].items():
        p = BASE / name
        demand(p.is_file() and not p.is_symlink() and p.resolve().is_relative_to(BASE), 'Unsafe input')
        demand(digest(p) == pin, 'Changed input: ' + name)
    demand(d['fps'] == 24 and d['voice_speed'] == 1.0, 'Wrong frame/voice rate')
    t = d['timeline']
    demand(t['state'] == 'ROOT_SELECTED_INFERRED', 'Final timing is pending root selection')
    frames = t['frame_boundaries']
    demand(isinstance(frames, list) and len(frames) == 10 and
           all(type(x) is int for x in frames), 'Ten integer boundaries required')
    demand(frames[0] == 0 and all(a < b for a, b in zip(frames, frames[1:])), 'Non-increasing timeline')
    demand(frames == FRAMES, 'Timeline differs from selected 22-second candidate')
    demand(24 * 21 <= frames[-1] <= 24 * 36 and frames[2] <= 120, 'Unsafe total/opening duration')
    demand(frames[7] - frames[6] >= 108, 'Status needs the selected 4.5 readable seconds')
    seconds = d['audio_duration_seconds']
    demand(type(seconds) in [int, float] and math.isfinite(seconds) and
           0 < seconds <= frames[-2] / 24 + 1 / 24 and
           seconds < frames[-1] / 24 - 0.5, 'Voice overrun; never stretch or trim it')
    return d, frames


def graph(frames):
    total = frames[-1] / 24
    switch = frames[1] / 24
    opening = frames[2]
    g = [f'[0:v]fps=24,trim=end_frame={opening},setpts=PTS-STARTPTS,scale=1080:1920,setsar=1[scene]',
         f"[scene][1:v]overlay=0:0:shortest=1:enable='lt(t,{switch:.6f})'[open1]",
         f"[open1][2:v]overlay=0:0:shortest=1:enable='gte(t,{switch:.6f})'[open2]",
         f'[open2]trim=end_frame={opening},setpts=PTS-STARTPTS,format=yuv420p[o]']
    lengths = [b - a for a, b in zip(frames[2:-1], frames[3:])]
    demand(len(lengths) == 7 and opening + sum(lengths) == frames[-1], 'Frame conservation failure')
    for n, length in enumerate(lengths):
        g.append(f'[{n+3}:v]fps=24,trim=end_frame={length},setpts=PTS-STARTPTS,setsar=1,format=yuv420p[s{n}]')
    g.append('[o]' + ''.join(f'[s{n}]' for n in range(7)) +
             f'concat=n=8:v=1:a=0,fps=24,trim=end_frame={frames[-1]},setpts=PTS-STARTPTS[v]')
    g.append(f'[10:a]aresample=48000,apad=whole_dur={total},atrim=duration={total},'
             f'afade=t=out:st={total-0.5}:d=0.5,loudnorm=I=-16:TP=-1.5:LRA=7,aresample=48000[a]')
    return ';'.join(g)


def render(d, frames, folder):
    demand('RUNNER_TEMP' in os.environ, 'Render requires GitHub runner output directory')
    expected = Path(os.environ['RUNNER_TEMP']).resolve() / 'momalarm-status-v2'
    demand(folder.resolve() == expected and not folder.exists(), 'Refusing output escape or overwrite')
    folder.mkdir()
    filter_text = graph(frames)
    (folder / 'filter.txt').write_text(filter_text)
    exports = []
    for variant in ['parent', 'cartoon']:
        total = str(frames[-1] / 24)
        cmd = ['ffmpeg', '-hide_banner', '-nostdin', '-n', '-threads', '1',
               '-filter_threads', '1', '-filter_complex_threads', '1',
               '-i', str(BASE / ('assets/' + variant + '-scene.mp4'))]
        cards = [variant + '-opening-1.png', variant + '-opening-2.png'] + COMMON
        for name in cards:
            cmd += ['-loop', '1', '-framerate', '24', '-t', total, '-i', str(BASE / ('assets/' + name))]
        output = folder / (variant + '-status-v2-review-HOLD.mp4')
        cmd += ['-i', str(BASE / 'assets/narration.mp3'), '-filter_complex', filter_text,
                '-map', '[v]', '-map', '[a]', '-t', total, '-frames:v', str(frames[-1]),
                '-r', '24', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19',
                '-pix_fmt', 'yuv420p', '-threads', '1', '-c:a', 'aac', '-b:a', '192k',
                '-ar', '48000', '-movflags', '+faststart', '-metadata',
                'comment=Editorial review only; voice-only mix; human/media/runtime QA pending.', str(output)]
        with (folder / (variant + '-render.log')).open('xb') as log:
            result = subprocess.run(cmd, stdout=log, stderr=subprocess.STDOUT)
        demand(result.returncode == 0, f'{variant} render EXIT {result.returncode}; partial preserved')
        exports.append({'file': output.name, 'sha256': digest(output), 'frames': frames[-1],
                        'render_exit': 0, 'media_human_runtime_owner_QA': 'PENDING'})
    (folder / 'EXPORTS.json').write_text(json.dumps({'state': 'REVIEW_HOLD_QA_PENDING',
        'manifest_sha256': digest(BASE / 'manifest.json'), 'exports': exports}, indent=2) + '\n')


def main():
    p = argparse.ArgumentParser(description=__doc__)
    mode = p.add_mutually_exclusive_group(required=True)
    mode.add_argument('--check', action='store_true')
    mode.add_argument('--render', action='store_true')
    p.add_argument('--output', type=Path)
    args = p.parse_args()
    d, frames = validate()
    graph(frames)
    if args.render:
        demand(args.output is not None, 'Output directory required')
        render(d, frames, args.output)
    else:
        print('CHECK PASS; exactly 14 inputs; timeline admitted; no encoding')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, TypeError, json.JSONDecodeError) as e:
        print('BLOCKED: ' + str(e), file=sys.stderr)
        raise SystemExit(2)
