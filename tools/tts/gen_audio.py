# Pre-records the phone's fixed lines (TODO P3.8) with MMS-TTS Odia (see mms.py for the voice and its licence).
# Reads content/audio/<lang>.texts.json (from content/scripts/audio_texts.ts),
# writes apps/web/public/audio/<lang>/<key>.ogg (Opus, mono) + index.json. Incremental: existing clips are kept.
# AI-written replies are recorded live by serve.py instead.
import json, sys, os
from mms import Voice, speakable

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
lang = sys.argv[1] if len(sys.argv) > 1 else 'or'
assert lang == 'or', 'only Odia has an MMS voice wired here'
texts = json.load(open(os.path.join(ROOT, 'content', 'audio', f'{lang}.texts.json'), encoding='utf-8'))
outdir = os.path.join(ROOT, 'apps', 'web', 'public', 'audio', lang)
os.makedirs(outdir, exist_ok=True)

voice = Voice()
index_path = os.path.join(outdir, 'index.json')
index = json.load(open(index_path, encoding='utf-8')).get('clips', {}) if os.path.exists(index_path) else {}
spoken_path = os.path.join(ROOT, 'content', 'audio', f'{lang}.spoken.json')
spoken = json.load(open(spoken_path, encoding='utf-8')) if os.path.exists(spoken_path) else {}
wanted = {x['key'] for x in texts}
made = 0
for x in texts:
    key, f = x['key'], os.path.join(outdir, x['key'] + '.ogg')
    spoken[key] = ' | '.join(s for s, _ in speakable(x['text']))
    if key in index and os.path.exists(f): continue
    if voice.record(x['text'], f, seed=7) is None: continue
    index[key] = os.path.getsize(f)
    made += 1
    print(f'{key} {x["from"]:<28} {index[key] // 1024:>3} KB  {spoken[key][:60]}')
for k in [k for k in index if k not in wanted]:  # lines that no longer exist
    index.pop(k); spoken.pop(k, None)
    try: os.remove(os.path.join(outdir, k + '.ogg'))
    except FileNotFoundError: pass
# essential = the engine's own lines (retake tips, placement intro, feedback…) and the app's spoken labels: fetched with
# the pack so they play offline; lesson clips are cached the first time they play (data is money, PLAN §8.1)
essential = sorted(x['key'] for x in texts if x['from'] in ('engine', 'app'))
json.dump({'clips': dict(sorted(index.items())), 'essential': essential}, open(index_path, 'w', encoding='utf-8'), separators=(',', ':'))
json.dump(dict(sorted(spoken.items())), open(spoken_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f'made {made}, total {len(index)} clips, {sum(index.values()) // 1024} KB')
