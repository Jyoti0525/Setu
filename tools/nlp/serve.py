# Self-hosted language helpers for the tutor turn (hybrid RAG + question translation), one long-running process:
#   - translate: her question → English with AI4Bharat IndicTrans2 (indic-en, distilled 200M, MIT). Only the question
#     is translated; the reply is still written straight from her textbook in her language (keeps the book's words).
#   - embed: text → 384-d meaning vectors with multilingual-e5-small (MIT) for pgvector search.
# The IndicTrans2 model code is vendored in ./indictrans (no remote code at run time); weights are read from
# SETU_MODELS (default ~/setu-models), downloaded once at pinned revisions (see tools/nlp/README.md).
# JSON lines, like tools/asr/serve.py:
#   ← {"ready": true, "translate": bool, "embed": bool}
#   → {"id": "1", "op": "translate", "text": "...", "src": "or"}   ← {"id": "1", "ok": true, "text": "...", "ms": 410}
#   → {"id": "2", "op": "embed", "texts": [...], "kind": "query"}  ← {"id": "2", "ok": true, "vecs": [[...]], "ms": 30}
import json, os, re, sys, time, unicodedata
import torch

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS = os.environ.get('SETU_MODELS') or os.path.join(os.path.expanduser('~'), 'setu-models')
IT_DIR = os.path.join(MODELS, 'indictrans2-indic-en-dist-200M')
E5_DIR = os.path.join(MODELS, 'multilingual-e5-small')
BGE_DIR = os.path.join(MODELS, 'bge-m3')
# multilingual-e5-small by default (indexes the shelf in ~7 min on a laptop CPU). SETU_EMBED=bge-m3 picks BAAI
# BGE-M3 (MIT, ONNX: no pickle), stronger but over an hour to index on CPU: for a server with a GPU.
EMBED = os.environ.get('SETU_EMBED') or 'e5'
TAGS = {'or': 'ory_Orya', 'hi': 'hin_Deva', 'bn': 'ben_Beng', 'te': 'tel_Telu', 'ta': 'tam_Taml', 'mr': 'mar_Deva', 'gu': 'guj_Gujr', 'kn': 'kan_Knda', 'ml': 'mal_Mlym', 'pa': 'pan_Guru', 'as': 'asm_Beng'}
# the Brahmic blocks share one layout: IndicTrans2 reads every script as Devanagari (script unification)
BLOCKS = {'or': 0x0B00, 'bn': 0x0980, 'as': 0x0980, 'te': 0x0C00, 'ta': 0x0B80, 'gu': 0x0A80, 'kn': 0x0C80, 'ml': 0x0D00, 'pa': 0x0A00}
SPECIAL = {0x0B5F: 0x092F, 0x0B71: 0x0935, 0x0B5C: 0x095C, 0x0B5D: 0x095D}  # Odia ୟ ୱ ଡ଼ ଢ଼

torch.set_num_threads(max(1, (os.cpu_count() or 2) // 2))


def to_deva(text, lang):
    base = BLOCKS.get(lang)
    if base is None:
        return text
    out = []
    for ch in text:
        o = ord(ch)
        if base <= o < base + 0x80:
            out.append(chr(SPECIAL.get(o, 0x0900 + (o - base))))
        else:
            out.append(ch)
    return ''.join(out)


def prep(text, lang):
    t = unicodedata.normalize('NFC', text)
    t = re.sub(r'\s+', ' ', t).strip()
    t = re.sub(r'([?!.,;:|।॥"\'()])', r' \1 ', t)  # trivial tokenization, as in training
    t = to_deva(re.sub(r'\s+', ' ', t).strip(), lang)
    return t.replace(' ् ', '्')


def tidy_en(t):
    t = re.sub(r'\s+([?!.,;:)])', r'\1', t)
    return re.sub(r'\(\s+', '(', t).strip()


class Translator:
    def __init__(self):
        sys.path.insert(0, HERE)
        from indictrans.configuration_indictrans import IndicTransConfig
        from indictrans.modeling_indictrans import IndicTransForConditionalGeneration
        import sentencepiece as spm
        f = lambda n: os.path.join(IT_DIR, n)
        load = lambda n: json.load(open(f(n), encoding='utf-8'))
        # the model's own tokenizer, without transformers' tokenizer base class (its v5 API changed)
        self.src, self.tgt = load('dict.SRC.json'), load('dict.TGT.json')
        self.tgt_inv = {v: k for k, v in self.tgt.items()}
        self.spm = spm.SentencePieceProcessor(model_file=f('model.SRC'))
        cfg = IndicTransConfig.from_pretrained(IT_DIR)
        self.model = IndicTransForConditionalGeneration.from_pretrained(IT_DIR, config=cfg, dtype=torch.float32).eval()
        # transformers 5 loads the model on an empty device and zeroes non-saved buffers: the sinusoidal position
        # tables come back all zeros (no word order, so it loops and drops words). Rebuild them.
        for part in (self.model.model.encoder, self.model.model.decoder):
            pe = part.embed_positions
            pe.weights = pe.get_embedding(pe.weights.shape[0], pe.embedding_dim, pe.padding_idx)

    def __call__(self, text, src):
        tag = TAGS.get(src)
        if not tag:
            raise ValueError(f'no IndicTrans2 tag for {src}')
        unk = self.src['<unk>']
        ids = [self.src[tag], self.src['eng_Latn']] + [self.src.get(p, unk) for p in self.spm.EncodeAsPieces(prep(text, src))][:250] + [self.src['</s>']]
        y = self.beam(torch.tensor([ids]), max_len=min(128, 2 * len(ids) + 10))
        special = {'<s>', '<pad>', '</s>', '<unk>'}
        out = ''.join(t for t in (self.tgt_inv.get(int(i), '') for i in y) if t not in special).replace('▁', ' ')
        return tidy_en(out)

    @torch.inference_mode()
    def beam(self, x, max_len, k=3, no_repeat=3):
        # Our own beam search with the decoder's key/value cache: transformers 5's generate() cannot use this
        # model's tuple cache, and without a cache it is 2-3x slower. Repeated 3-grams are banned (it loops on
        # greetings: "Hello hel hel hel…"), and the length is capped by the question's length.
        m, eos = self.model.model, 2
        mask = torch.ones_like(x)
        enc = m.encoder(input_ids=x, attention_mask=mask).last_hidden_state.expand(k, -1, -1)
        mask = mask.expand(k, -1)
        seqs, scores, past, done = [[eos]] * k, torch.tensor([0.0] + [-1e9] * (k - 1)), None, []
        for _ in range(max_len):
            last = torch.tensor([[s[-1]] for s in seqs])
            d = m.decoder(input_ids=last, encoder_hidden_states=enc, encoder_attention_mask=mask, past_key_values=past, use_cache=True)
            logp = torch.log_softmax(self.model.lm_head(d.last_hidden_state[:, -1]).float(), -1)
            for b, s in enumerate(seqs):
                if len(s) >= no_repeat:
                    pre = tuple(s[-(no_repeat - 1):])
                    for i in range(len(s) - no_repeat + 1):
                        if tuple(s[i:i + no_repeat - 1]) == pre:
                            logp[b, s[i + no_repeat - 1]] = -1e9
            cand = (scores[:, None] + logp).view(-1)
            top = torch.topk(cand, 2 * k)
            nxt_seqs, nxt_scores, rows = [], [], []
            for sc, ix in zip(top.values.tolist(), top.indices.tolist()):
                b, tok = divmod(ix, logp.shape[1])
                if tok == eos:
                    done.append((sc / len(seqs[b]), seqs[b] + [eos]))
                else:
                    nxt_seqs.append(seqs[b] + [tok]); nxt_scores.append(sc); rows.append(b)
                if len(nxt_seqs) == k:
                    break
            if len(done) >= k and max(d_[0] for d_ in done) > max(nxt_scores) / len(nxt_seqs[0]):
                break
            idx = torch.tensor(rows)
            past = tuple(tuple(t.index_select(0, idx) for t in layer) for layer in d.past_key_values)
            seqs, scores = nxt_seqs, torch.tensor(nxt_scores)
        best = max(done, key=lambda d_: d_[0])[1] if done else seqs[0]
        return best


class Embedder:
    """multilingual-e5-small (mean pooling, query:/passage: prefixes, 384-d)"""
    name, dim = 'e5-small', 384

    def __init__(self):
        from transformers import AutoModel, AutoTokenizer
        self.tok = AutoTokenizer.from_pretrained(E5_DIR)
        self.model = AutoModel.from_pretrained(E5_DIR).eval()

    def __call__(self, texts, kind):
        prefix = 'query: ' if kind == 'query' else 'passage: '
        out = []
        for i in range(0, len(texts), 16):
            b = self.tok([prefix + t for t in texts[i:i + 16]], max_length=512, truncation=True, padding=True, return_tensors='pt')
            with torch.inference_mode():
                h = self.model(**b).last_hidden_state
            m = b['attention_mask'].unsqueeze(-1).float()
            v = torch.nn.functional.normalize((h * m).sum(1) / m.sum(1), dim=-1)
            out.extend([[round(float(z), 5) for z in row] for row in v])
        return out


class BgeM3:
    """BAAI BGE-M3 dense vectors (CLS pooling, normalized, 1024-d), ONNX Runtime"""
    name, dim = 'bge-m3', 1024

    def __init__(self):
        import numpy as np
        import onnxruntime as ort
        from transformers import AutoTokenizer
        self.np = np
        self.tok = AutoTokenizer.from_pretrained(BGE_DIR)
        o = ort.SessionOptions()
        o.intra_op_num_threads = os.cpu_count() or 4
        self.sess = ort.InferenceSession(os.path.join(BGE_DIR, 'model.onnx'), o, providers=['CPUExecutionProvider'])
        self.inputs = {i.name for i in self.sess.get_inputs()}

    def __call__(self, texts, kind):
        np = self.np
        out = []
        for i in range(0, len(texts), 8):
            b = self.tok(texts[i:i + 8], max_length=320 if kind == 'passage' else 128, truncation=True, padding=True, return_tensors='np')
            feed = {k: v.astype(np.int64) for k, v in b.items() if k in self.inputs}
            res = self.sess.run(None, feed)[0]
            v = res[:, 0] if res.ndim == 3 else res  # CLS of the last hidden state, or already pooled
            v = v / np.linalg.norm(v, axis=1, keepdims=True)
            out.extend([[round(float(z), 5) for z in row] for row in v])
        return out


def main():
    # -I ignores PYTHONIOENCODING: Windows would read her Odia as cp1252
    sys.stdin.reconfigure(encoding='utf-8')
    sys.stdout.reconfigure(encoding='utf-8')
    tr = em = None
    try:
        em = BgeM3() if EMBED == 'bge-m3' else Embedder()
    except Exception as e:  # noqa: BLE001
        print(json.dumps({'log': f'embedder unavailable: {e}'}), flush=True)
    try:
        tr = Translator()
    except Exception as e:  # noqa: BLE001
        print(json.dumps({'log': f'translator unavailable: {e}'}), flush=True)
    print(json.dumps({'ready': True, 'translate': tr is not None, 'embed': em is not None, 'model': em.name if em else None, 'dim': em.dim if em else None}), flush=True)
    for line in sys.stdin:
        try:
            req = json.loads(line)
        except ValueError:
            continue
        t0 = time.time()
        try:
            if req.get('op') == 'translate':
                if not tr:
                    raise ValueError('translator not loaded')
                res = {'text': tr(str(req['text'])[:1200], req.get('src', 'or'))}
            elif req.get('op') == 'embed':
                if not em:
                    raise ValueError('embedder not loaded')
                res = {'vecs': em([str(t)[:4000] for t in req['texts']][:256], req.get('kind', 'passage'))}
            else:
                raise ValueError('unknown op')
            print(json.dumps({'id': req.get('id'), 'ok': True, **res, 'ms': int((time.time() - t0) * 1000)}, ensure_ascii=False), flush=True)
        except Exception as e:  # noqa: BLE001
            print(json.dumps({'id': req.get('id'), 'ok': False, 'error': str(e)[:200]}), flush=True)


if __name__ == '__main__':
    main()
