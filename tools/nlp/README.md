# Language helpers: IndicTrans2 + embeddings (hybrid RAG)

`serve.py` is one long-running process the server starts (`apps/server/src/rag.ts`, `NlpWorker`). It does two jobs:

| Job | Model | Licence | Used for |
|---|---|---|---|
| `translate` | AI4Bharat **IndicTrans2** indic→en, distilled 200M | MIT | Her question in English, as a hint for the model and a second search query. The reply is **not** translated back: it is written from the Odia passages, so the textbook's own words are kept. |
| `embed` | multilingual-e5-small (default), or **BGE-M3** (BAAI, ONNX) | MIT | Meaning vectors for every passage, stored in **Postgres + pgvector** (PGlite, embedded in the server, no install). |

Search on the server is then **hybrid RAG**: the keyword search (BM25, same as the phone's offline search) and the
meaning search (pgvector cosine) are fused by reciprocal rank. A meaning-only page counts as grounded only when the
meaning search agrees on one chapter (3 of its top 5), so chit-chat ("hello") still gets no page. Measured by
`apps/server/scripts/rag_eval.ts` on `content/eval/book_search.json` and `content/eval/paraphrase.json`.

## Setup (once)

Weights live outside the repo in `~/setu-models` (or `SETU_MODELS`), at pinned revisions. IndicTrans2 is gated on
Hugging Face: accept its licence on the model page, then use your token.

```bash
M=~/setu-models; T=$(cat ~/.cache/huggingface/token)
mkdir -p $M/indictrans2-indic-en-dist-200M && cd $M/indictrans2-indic-en-dist-200M
for f in config.json dict.SRC.json dict.TGT.json generation_config.json model.SRC model.TGT model.safetensors; do
  curl -sSfL -C - -H "Authorization: Bearer $T" -o $f https://huggingface.co/ai4bharat/indictrans2-indic-en-dist-200M/resolve/d66a2122ad6d28184f3dc3797b652bd80ae3f65f/$f; done
mkdir -p $M/bge-m3 && cd $M/bge-m3
for f in model.onnx model.onnx_data Constant_7_attr__value config.json sentencepiece.bpe.model special_tokens_map.json tokenizer.json tokenizer_config.json; do
  curl -sSfL -C - -o $f https://huggingface.co/BAAI/bge-m3/resolve/5617a9f61b028005a4858fdac845db406aefb181/onnx/$f; done
spikes/tts/.venv/Scripts/python.exe -m pip install sentencepiece   # the same venv as speech (torch, transformers, onnxruntime)
```

The IndicTrans2 model code is vendored in `indictrans/` (MIT, AI4Bharat), patched for transformers 5 (no ONNX
config, weight tying, no `trust_remote_code`). Its tokenizer is reimplemented in `serve.py` (sentencepiece + the
model's dictionaries); Odia is read as Devanagari, as IndicTrans2 was trained (script unification).

The first server start embeds every passage (e5-small: about 7 minutes; BGE-M3 on a laptop CPU: over an hour) into
`apps/server/data/pg`; later starts only embed changed passages. Until then the keyword search answers alone.
`SETU_NLP=0` turns the helpers off; `SETU_EMBED=bge-m3` picks the bigger embedder.
