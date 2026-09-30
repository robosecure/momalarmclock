#!/usr/bin/env python3
"""Adapted status-v2 renderer: two voice-only future-GA review cuts."""
from pathlib import Path
import argparse, hashlib, json, math, os, re, subprocess, sys

BASE = Path(__file__).resolve().parent
EXISTING = '.github/render-status-v2/assets/'
VOICE = 'campaign/media/ga-feature-narration-v1-review.mp3'
VOICE_SHA = 'ec51f67d95a77ea295bfbdde376d63331a6dc3a8c51d9ed4a136d28b903733a3'
FRAMES = [0, 48, 108, 204, 293, 394, 504, 600, 732, 840, 912]
CARDS = ['intro.png', 'alarm.png', 'wake.png', 'reminder.png',
         'reminder-status.png', 'sync.png', 'cta.png']
REQUIRED = {EXISTING + v + '-scene.mp4' for v in ('parent', 'cartoon')}
REQUIRED |= {EXISTING + v + '-opening-' + str(n) + '.png'
             for v in ('parent', 'cartoon') for n in (1, 2)}
REQUIRED |= {EXISTING + 'end-hold.png', VOICE}
REQUIRED |= {'.github/render-ga-v1/assets/' + name for name in CARDS}
PREVIEWS = [0.6, 5, 10, 15.5, 20, 27, 33, 36]


def demand(ok, message):
    if not ok:
        raise ValueError(message)


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def source(name, repo):
    if name.startswith('.github/render-ga-v1/assets/'):
        path, root = BASE / 'assets' / name.rsplit('/', 1)[-1], BASE
    else:
        path, root = repo / name, repo
    demand(path.is_file() and not path.is_symlink() and path.resolve().is_relative_to(root),
           'Missing or unsafe input: ' + name)
    return path


def validate(repo):
    d = json.loads((BASE / 'manifest.json').read_text())
    demand(d['schema'] == 'momalarm-ga-remote-review-v1', 'Wrong manifest')
    demand(d['render_script_sha256'] == digest(Path(__file__)), 'Changed renderer')
    registry = json.loads((repo / 'campaign/review/items.json').read_text())
    items = [x for x in registry['items'] if x.get('id') == 'ga-feature-narration-v1']
    demand(len(items) == 1 and items[0]['asset']['sha256'] == VOICE_SHA, 'Wrong GA registry item')
    transcript = ' '.join(items[0]['transcript'].split())
    demand(hashlib.sha256(transcript.encode()).hexdigest() == d['transcript_sha256'],
           'Changed GA transcript')
    demand(set(d['inputs']) == REQUIRED and len(REQUIRED) == 15, 'Wrong input set')
    demand(d['inputs'][VOICE] == VOICE_SHA, 'Wrong GA voice pin')
    for name, pin in d['inputs'].items():
        demand(re.fullmatch(r'[0-9a-f]{64}', pin) is not None, 'Invalid hash pin')
        demand(digest(source(name, repo)) == pin, 'Changed input: ' + name)
    demand(d['fps'] == 24 and d['voice_speed'] == 1.0 and d['mix'] == 'voice_only',
           'Wrong frame/voice/mix contract')
    demand(d['timeline']['state'] == 'EDITORIAL_ESTIMATE_HUMAN_ALIGNMENT_PENDING' and
           d['timeline']['frame_boundaries'] == FRAMES and d['publication'] == 'REVIEW_HOLD_NOT_GA_LIVE',
           'Wrong timing or authority')
    duration = d['audio_duration_seconds']
    demand(type(duration) in (int, float) and math.isfinite(duration) and
           34.50 <= duration <= 34.60 and duration < FRAMES[-2] / 24,
           'Voice overrun; never trim or stretch')
    graph(FRAMES)
    return d


def graph(frames):
    total, switch, opening = frames[-1] / 24, frames[1] / 24, frames[2]
    g = [f'[0:v]fps=24,trim=end_frame={opening},setpts=PTS-STARTPTS,scale=1080:1920,setsar=1[scene]',
         f"[scene][1:v]overlay=0:0:shortest=1:enable='lt(t,{switch:.6f})'[open1]",
         f"[open1][2:v]overlay=0:0:shortest=1:enable='gte(t,{switch:.6f})'[open2]",
         f'[open2]trim=end_frame={opening},setpts=PTS-STARTPTS,format=yuv420p[o]']
    lengths = [b - a for a, b in zip(frames[2:-1], frames[3:])]
    demand(len(lengths) == 8 and opening + sum(lengths) == frames[-1] and
           frames[-1] == 912 and opening <= 120 and frames[8] - frames[7] >= 120,
           'Frame conservation, opening or status-beat failure')
    for n, length in enumerate(lengths):
        g.append(f'[{n+3}:v]fps=24,trim=end_frame={length},setpts=PTS-STARTPTS,setsar=1,format=yuv420p[s{n}]')
    g.append('[o]' + ''.join(f'[s{n}]' for n in range(8)) +
             f'concat=n=9:v=1:a=0,fps=24,trim=end_frame={frames[-1]},setpts=PTS-STARTPTS[v]')
    g.append(f'[11:a]aresample=48000,apad=whole_dur={total},atrim=duration={total},'
             f'afade=t=out:st={total-0.5}:d=0.5,loudnorm=I=-16:TP=-1.5:LRA=7,aresample=48000[a]')
    return ';'.join(g)


def run_command(argv, log, timeout):
    with log.open('xb') as f:
        result = subprocess.run(argv, stdout=f, stderr=subprocess.STDOUT, timeout=timeout)
    demand(result.returncode == 0, argv[0] + ' EXIT ' + str(result.returncode) + '; ' + log.name)


def qa(output, folder, variant):
    probe = folder / (variant + '-probe.json')
    with probe.open('xb') as f:
        result = subprocess.run(['ffprobe', '-v', 'error', '-show_entries',
            'format=duration:stream=codec_type,codec_name,width,height,avg_frame_rate,nb_frames,sample_rate',
            '-of', 'json', str(output)], stdout=f, timeout=90)
    demand(result.returncode == 0, 'ffprobe EXIT ' + str(result.returncode))
    info = json.loads(probe.read_text())
    video = next((s for s in info['streams'] if s.get('codec_type') == 'video'), None)
    audio = next((s for s in info['streams'] if s.get('codec_type') == 'audio'), None)
    demand(len(info['streams']) == 2 and video and audio, 'Expected video and audio streams')
    demand(video.get('codec_name') == 'h264' and video.get('width') == 1080 and
           video.get('height') == 1920 and video.get('avg_frame_rate') == '24/1' and
           video.get('nb_frames') == '912', 'Wrong video format or frame count')
    demand(audio.get('codec_name') == 'aac' and audio.get('sample_rate') == '48000',
           'Wrong audio format')
    seconds = float(info['format']['duration'])
    demand(math.isfinite(seconds) and abs(seconds - 38) <= 0.08, 'Wrong movie duration')
    run_command(['ffmpeg', '-hide_banner', '-nostdin', '-xerror', '-threads', '1',
                 '-err_detect', 'explode', '-i', str(output), '-map', '0:v:0', '-map', '0:a:0',
                 '-f', 'null', '-'], folder / (variant + '-full-decode.log'), 120)
    loudness = folder / (variant + '-audio-metrics.log')
    run_command(['ffmpeg', '-hide_banner', '-nostdin', '-xerror', '-threads', '1',
                 '-i', str(output), '-vn', '-af', 'ebur128=peak=true,volumedetect',
                 '-f', 'null', '-'], loudness, 120)
    metrics = {}
    for key, pattern in {'integrated_lufs': r'I:\s*(-?\d+(?:\.\d+)?)\s*LUFS',
                         'true_peak_dbfs': r'Peak:\s*(-?\d+(?:\.\d+)?)\s*dBFS',
                         'max_volume_dbfs': r'max_volume:\s*(-?\d+(?:\.\d+)?)\s*dB'}.items():
        values = re.findall(pattern, loudness.read_text())
        demand(values, 'Missing audio measurement: ' + key)
        metrics[key] = float(values[-1])
    demand(metrics['max_volume_dbfs'] > -70, 'Effectively silent movie')
    previews = []
    (folder / 'preview').mkdir(exist_ok=True)
    for n, when in enumerate(PREVIEWS, 1):
        frame = folder / 'preview' / f'{variant}-{n:02}.png'
        run_command(['ffmpeg', '-hide_banner', '-nostdin', '-n', '-ss', str(when),
                     '-i', str(output), '-frames:v', '1', '-vf',
                     'scale=270:480:flags=lanczos', str(frame)],
                    folder / f'{variant}-preview-{n:02}.log', 45)
        previews.append({'file': 'preview/' + frame.name, 'at_seconds': when, 'sha256': digest(frame)})
    result = {'file': output.name, 'sha256': digest(output), 'frames': 912,
              'duration_seconds': seconds, 'full_decode_exit': 0,
              'audio_metrics': metrics, 'preview_frames': previews,
              'human_motion_listening_word_alignment_runtime_owner_review': 'PENDING'}
    with (folder / (variant + '-QA.json')).open('x') as f:
        json.dump(result, f, indent=2)
        f.write('\n')
    return result


def render(d, repo, folder):
    demand(os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('RUNNER_TEMP'),
           'Remote GitHub runner required')
    expected = Path(os.environ['RUNNER_TEMP']).resolve() / 'momalarm-ga-v1'
    demand(folder.resolve() == expected and not folder.exists() and not folder.is_symlink(),
           'Refusing output escape or overwrite')
    folder.mkdir()
    filter_text = graph(FRAMES)
    (folder / 'filter.txt').write_text(filter_text)
    exports = []
    for variant in ('parent', 'cartoon'):
        total = str(FRAMES[-1] / 24)
        cmd = ['ffmpeg', '-hide_banner', '-nostdin', '-n', '-xerror', '-threads', '1',
               '-filter_threads', '1', '-filter_complex_threads', '1',
               '-i', str(source(EXISTING + variant + '-scene.mp4', repo))]
        cards = [EXISTING + variant + '-opening-' + str(n) + '.png' for n in (1, 2)]
        cards += ['.github/render-ga-v1/assets/' + name for name in CARDS]
        cards += [EXISTING + 'end-hold.png']
        for name in cards:
            cmd += ['-loop', '1', '-framerate', '24', '-t', total, '-i', str(source(name, repo))]
        output = folder / (variant + '-ga-review-HOLD.mp4')
        cmd += ['-i', str(source(VOICE, repo)), '-filter_complex', filter_text,
                '-map', '[v]', '-map', '[a]', '-t', total, '-frames:v', str(FRAMES[-1]),
                '-r', '24', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19',
                '-pix_fmt', 'yuv420p', '-threads', '1', '-c:a', 'aac', '-b:a', '192k',
                '-ar', '48000', '-movflags', '+faststart', '-metadata',
                'comment=Future GA editorial review only; no app UI; QA and approval pending.', str(output)]
        run_command(cmd, folder / (variant + '-render.log'), 480)
        exports.append(qa(output, folder, variant))
    with (folder / 'EXPORTS.json').open('x') as f:
        json.dump({'state': 'REVIEW_HOLD_QA_PENDING',
                   'manifest_sha256': digest(BASE / 'manifest.json'),
                   'exports': exports, 'publication': 'NOT_AUTHORIZED'}, f, indent=2)
        f.write('\n')


def main():
    p = argparse.ArgumentParser(description=__doc__)
    mode = p.add_mutually_exclusive_group(required=True)
    mode.add_argument('--check', action='store_true')
    mode.add_argument('--render', action='store_true')
    p.add_argument('--source-root', type=Path, help='Local check only')
    p.add_argument('--output', type=Path)
    args = p.parse_args()
    demand(not args.source_root or args.check, 'Source override is check-only')
    repo = args.source_root.resolve() if args.source_root else BASE.parents[1]
    d = validate(repo)
    if args.render:
        demand(args.output is not None, 'Runner output directory required')
        render(d, repo, args.output)
    else:
        demand(args.output is None, 'Output is render-only')
        print('CHECK PASS; 15 pinned inputs; 38-second timeline; no encoding')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, TypeError, json.JSONDecodeError, subprocess.TimeoutExpired) as e:
        print('BLOCKED: ' + str(e), file=sys.stderr)
        raise SystemExit(2)
