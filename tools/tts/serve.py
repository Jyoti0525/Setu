# Live voice for AI-written replies (TODO P3.9): the server keeps this process running and sends one JSON line per
# text: {"key": "...", "text": "...", "out": "<path>.ogg"} → replies {"key": "...", "ok": true, "spoken": "..."}.
# The model loads once (≈ 5 s); each reply then takes about a second on a laptop CPU.
# Run with the spikes/tts/.venv python and HF_HUB_OFFLINE=1 (the server does this; see apps/server/src/voice.ts).
import json, os, sys
sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)
sys.stdin.reconfigure(encoding='utf-8')
from mms import Voice

# one model per language, loaded on first use (Odia at start: it is the demo language)
MODELS = {'or': 'facebook/mms-tts-ory', 'hi': 'facebook/mms-tts-hin'}
voices = {'or': Voice(MODELS['or'])}
def voice_for(lang):
    if lang not in voices: voices[lang] = Voice(MODELS[lang])
    return voices[lang]
print(json.dumps({'ready': True}), flush=True)
for line in sys.stdin:
    try:
        job = json.loads(line)
    except ValueError:
        continue
    try:
        os.makedirs(os.path.dirname(job['out']), exist_ok=True)
        tmp = job['out'] + '.part.ogg'
        spoken = voice_for(job.get('lang', 'or')).record(job['text'], tmp, seed=7)
        if spoken is None:
            print(json.dumps({'key': job['key'], 'ok': False, 'error': 'nothing speakable'}), flush=True)
            continue
        os.replace(tmp, job['out'])  # the server serves only finished files
        print(json.dumps({'key': job['key'], 'ok': True, 'spoken': spoken}, ensure_ascii=False), flush=True)
    except Exception as e:  # one bad line must not stop the voice
        print(json.dumps({'key': job.get('key'), 'ok': False, 'error': str(e)[:200]}), flush=True)
