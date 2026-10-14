# P0.e: MMS-TTS Odia (facebook/mms-tts-ory, CC-BY-NC-4.0) — pack audio pre-generation.
import sys, time, io, torch, scipy.io.wavfile as wav
from transformers import VitsModel, AutoTokenizer
name = "facebook/mms-tts-ory"
tok = AutoTokenizer.from_pretrained(name); model = VitsModel.from_pretrained(name)
texts = {
  "velocity": "ବେଗ ହେଉଛି କୌଣସି ବସ୍ତୁ କେଉଁ ଦିଗରେ କେତେ ଜୋରରେ ଗତି କରୁଛି, ତାହାର ମାପ।",
  "speed_vs_velocity": "ଦ୍ରୁତି କେବଳ କେତେ ଜୋରରେ ଯାଉଛି କହେ, କିନ୍ତୁ ବେଗ ଦିଗ ମଧ୍ୟ କହେ।",
}
print("params(M):", round(sum(p.numel() for p in model.parameters())/1e6,1))
for k, t in texts.items():
    inp = tok(t, return_tensors="pt")
    t0 = time.time()
    with torch.no_grad(): out = model(**inp).waveform[0].numpy()
    wav.write(f"out/mms_{k}.wav", model.config.sampling_rate, out)
    print(k, "chars", len(t), "audio_s", round(len(out)/model.config.sampling_rate,2), "gen_s", round(time.time()-t0,2), "tokens", inp["input_ids"].shape[1])
