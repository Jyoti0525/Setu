#!/usr/bin/env bash
# Runs once when the Codespace is created: app build, Python speech/language venv, model weights.
set -euo pipefail
cd "$(dirname "$0")/.."

# the base image ships a yarn apt source with an expired key, which fails apt-get update
sudo rm -f /etc/apt/sources.list.d/yarn.list
sudo apt-get update -qq || true
sudo apt-get install -y -qq ffmpeg

export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
corepack enable
pnpm install --frozen-lockfile
pnpm --filter @setu/web build

# same venv path the server looks for (apps/server/src/index.ts)
python3 -m venv spikes/tts/.venv
PY=spikes/tts/.venv/bin/python
$PY -m pip install -q --upgrade pip
$PY -m pip install -q torch --index-url https://download.pytorch.org/whl/cpu
$PY -m pip install -q 'transformers>=5' sentencepiece onnxruntime scipy numpy huggingface_hub tokenizers

# weights live outside the repo (tools/nlp/README.md); IndicTrans2 and IndicConformer are gated: HF_TOKEN secret
M=~/setu-models
mkdir -p "$M"
$PY - <<'EOF'
import os
from huggingface_hub import snapshot_download
M = os.path.expanduser('~/setu-models')
tok = os.environ.get('HF_TOKEN') or None
snapshot_download('intfloat/multilingual-e5-small', local_dir=f'{M}/multilingual-e5-small',
                  allow_patterns=['config.json', 'model.safetensors', 'sentencepiece.bpe.model', 'special_tokens_map.json', 'tokenizer.json', 'tokenizer_config.json'])
for v in ['ory', 'hoc', 'kxv', 'unr']:  # Odia; Ho, Kuvi, Munda (tribal home languages, Odia script)
    snapshot_download(f'facebook/mms-tts-{v}')
try:
    snapshot_download('ai4bharat/indictrans2-indic-en-dist-200M', revision='d66a2122ad6d28184f3dc3797b652bd80ae3f65f', local_dir=f'{M}/indictrans2-indic-en-dist-200M', token=tok,
                      allow_patterns=['config.json', 'dict.SRC.json', 'dict.TGT.json', 'generation_config.json', 'model.SRC', 'model.TGT', 'model.safetensors'])
    snapshot_download('ai4bharat/indic-conformer-600m-multilingual', token=tok, ignore_patterns=['assets/joint_*', 'assets/rnnt_decoder.onnx', '*.py'])
except Exception as e:
    print(f'gated models skipped ({type(e).__name__}): add the HF_TOKEN secret and accept the licences, then run .devcontainer/setup.sh again')
EOF
echo "Setu setup done."
