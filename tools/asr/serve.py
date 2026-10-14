# Self-hosted speech-to-text (TODO P3.4, PLAN §10.1 step 4): AI4Bharat IndicConformer-600M-multilingual (MIT),
# CTC decoding only (no RNNT/joint networks needed). One long-running process; the server talks JSON lines:
#   ← {"ready": true, "langs": [...]}
#   → {"id": "...", "path": "<audio file, any format ffmpeg reads>", "lang": "or"}
#   ← {"id": "...", "ok": true, "text": "...", "ms": 812}   or   {"id": "...", "ok": false, "error": "..."}
# The audio file belongs to the server, which deletes it after the reply (audio is never kept, P5.21).
import json, os, subprocess, sys, time, unicodedata
import numpy as np
import onnxruntime as ort
import torch
from huggingface_hub import snapshot_download

REPO = 'ai4bharat/indic-conformer-600m-multilingual'
BLANK = 256
SR = 16000
MAX_SECONDS = 60

def load():
    root = snapshot_download(REPO, ignore_patterns=['assets/joint_*', 'assets/rnnt_decoder.onnx', '*.py'])
    a = lambda f: os.path.join(root, 'assets', f)
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = max(1, (os.cpu_count() or 2) // 2)
    pre = torch.jit.load(a('preprocessor.ts'), map_location='cpu')
    enc = ort.InferenceSession(a('encoder.onnx'), opts, providers=['CPUExecutionProvider'])
    ctc = ort.InferenceSession(a('ctc_decoder.onnx'), opts, providers=['CPUExecutionProvider'])
    vocab = json.load(open(a('vocab.json'), encoding='utf-8'))
    masks = json.load(open(a('language_masks.json'), encoding='utf-8'))
    return pre, enc, ctc, vocab, masks

def tidy(text):
    """Greedy CTC can emit the same vowel sign twice across a token boundary (ବିିନ୍ଦୁ → ବିନ୍ଦୁ)."""
    out = []
    for ch in text:
        if out and ch == out[-1] and unicodedata.category(ch) in ('Mn', 'Mc'):
            continue
        out.append(ch)
    return unicodedata.normalize('NFC', ''.join(out))

def pcm(path):
    """Any container/codec (webm/ogg opus from the phone) → 16 kHz mono float32."""
    r = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-t', str(MAX_SECONDS), '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True)
    if r.returncode != 0:
        raise ValueError('could not read the audio')
    return np.frombuffer(r.stdout, dtype=np.float32)

def main():
    pre, enc, ctc, vocab, masks = load()
    print(json.dumps({'ready': True, 'langs': sorted(vocab.keys())}), flush=True)
    for line in sys.stdin:
        try:
            req = json.loads(line)
        except ValueError:
            continue
        t0 = time.time()
        try:
            lang = req['lang']
            if lang not in vocab:
                raise ValueError(f'language {lang} not supported')
            x = pcm(req['path'])
            if len(x) < SR * 0.3:
                raise ValueError('too short')
            wav = torch.from_numpy(x.copy()).unsqueeze(0)
            with torch.no_grad():
                sig, length = pre(input_signal=wav, length=torch.tensor([wav.shape[-1]]))
            out, _ = enc.run(['outputs', 'encoded_lengths'], {'audio_signal': sig.numpy(), 'length': length.numpy()})
            logits = ctc.run(['logprobs'], {'encoder_output': out})[0][0][:, masks[lang]]
            ids = logits.argmax(-1)
            prev, toks = -1, []
            for i in ids:  # greedy CTC: collapse repeats, drop blanks
                if i != prev and i != BLANK:
                    toks.append(vocab[lang][i])
                prev = i
            text = tidy(''.join(toks).replace('▁', ' ').strip())
            print(json.dumps({'id': req.get('id'), 'ok': True, 'text': text, 'ms': int((time.time() - t0) * 1000)}, ensure_ascii=False), flush=True)
        except Exception as e:  # noqa: BLE001 — every failure is a reply, never a dead worker
            print(json.dumps({'id': req.get('id'), 'ok': False, 'error': str(e)[:200]}), flush=True)

if __name__ == '__main__':
    main()
