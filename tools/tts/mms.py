# Odia voice with MMS-TTS (facebook/mms-tts-ory, CC-BY-NC-4.0: prototype only; production → Indic Parler-TTS, Apache-2.0).
# Shared by gen_audio.py (fixed lines, before release) and serve.py (AI-written replies, live on the server).
#
# MMS knows only Odia letters (no digits, Latin or danda), so each line is first made speakable:
# numbers → Odia words, units/abbreviations → words, bracketed English dropped, one synthesis per sentence + pauses.
# The words used here are a DRAFT for native review (TODO D6) — content/audio/<lang>.spoken.json shows what was read.
import io, re, subprocess
import numpy as np, torch, scipy.io.wavfile as wav

ONES = ['ଶୂନ', 'ଏକ', 'ଦୁଇ', 'ତିନି', 'ଚାରି', 'ପାଞ୍ଚ', 'ଛଅ', 'ସାତ', 'ଆଠ', 'ନଅ', 'ଦଶ', 'ଏଗାର', 'ବାର', 'ତେର', 'ଚଉଦ', 'ପନ୍ଦର', 'ଷୋହଳ', 'ସତର', 'ଅଠର', 'ଊଣେଇଶି',
        'କୋଡ଼ିଏ', 'ଏକୋଇଶି', 'ବାଇଶି', 'ତେଇଶି', 'ଚବିଶି', 'ପଚିଶି', 'ଛବିଶି', 'ସତେଇଶି', 'ଅଠେଇଶି', 'ଅଣତିରିଶି', 'ତିରିଶି']
SOME = {36: 'ଛତିଶି', 40: 'ଚାଳିଶି', 45: 'ପଞ୍ଚଚାଳିଶି', 50: 'ପଚାଶ', 60: 'ଷାଠିଏ', 70: 'ସତୁରି', 80: 'ଅଶୀ', 90: 'ନବେ'}

def words(n: int) -> str:
    if n <= 30: return ONES[n]
    if n in SOME: return SOME[n]
    if n < 100: return ' '.join(ONES[int(d)] for d in str(n))  # not in the table: digit by digit (flagged)
    if n < 1000:
        h, r = divmod(n, 100)
        return ('ଶହେ' if h == 1 else f'{ONES[h]} ଶହ') + (f' {words(r)}' if r else '')
    if n < 100000:
        k, r = divmod(n, 1000)
        if r and r % 100 == 0 and n < 2000: return f'{ONES[n // 100]} ଶହ'  # 1200 → ବାର ଶହ
        return f'{words(k)} ହଜାର' + (f' {words(r)}' if r else '')
    return ' '.join(ONES[int(d)] for d in str(n))

def number(m):
    t = m.group(0).translate(str.maketrans('୦୧୨୩୪୫୬୭୮୯', '0123456789')).replace(',', '')
    if '.' in t:
        a, b = t.split('.', 1)
        return f"{words(int(a))} ଦଶମିକ {' '.join(ONES[int(d)] for d in b)}"
    return words(int(t))

UNITS = [  # longest first
    (r'କି\.ମି\./ଘଣ୍ଟା', 'କିଲୋମିଟର ପ୍ରତି ଘଣ୍ଟା'), (r'km/h', 'କିଲୋମିଟର ପ୍ରତି ଘଣ୍ଟା'), (r'm/s²', 'ମିଟର ପ୍ରତି ସେକେଣ୍ଡ ବର୍ଗ'), (r'm/s', 'ମିଟର ପ୍ରତି ସେକେଣ୍ଡ'),
    (r'କି\.ମି\.', 'କିଲୋମିଟର'), (r'ମି\.', 'ମିଟର'), (r'ସେ\.', 'ସେକେଣ୍ଡ'), (r'\bSI\b', 'ଏସ ଆଇ'),
    (r'÷', ' ଭାଗ '), (r'×', ' ଗୁଣନ '), (r'=', ' ସମାନ '), (r'\+', ' ଯୋଗ '), (r'(?<=\s)-(?=\s)', ' ବିୟୋଗ '),
]

HI_ONES = ['शून्य', 'एक', 'दो', 'तीन', 'चार', 'पाँच', 'छह', 'सात', 'आठ', 'नौ']

def speakable_hi(text: str) -> list[tuple[str, float]]:
    # Hindi MMS reads Devanagari letters only: English in brackets dropped, digits read one by one
    t = re.sub(r'\(([^)]*[A-Za-z][^)]*)\)', '', text)
    t = re.sub(r'[0-9०-९]', lambda m: ' ' + HI_ONES[int(m.group(0).translate(str.maketrans('०१२३४५६७८९', '0123456789')))] + ' ', t)
    parts, out = re.split(r'([।?!.]|[,—;:])', t), []
    for i in range(0, len(parts), 2):
        seg = re.sub(r'\s+', ' ', re.sub(r'[^ऀ-ॿ\s]', ' ', parts[i])).strip()
        sep = parts[i + 1] if i + 1 < len(parts) else '।'
        if seg: out.append((seg, 0.35 if sep in '।?!.' else 0.15))
    return out

def speakable(text: str) -> list[tuple[str, float]]:
    if re.search(r'[ऀ-ॿ]', text) and not re.search(r'[଀-୿]', text): return speakable_hi(text)
    t = re.sub(r'\(([^)]*[A-Za-z][^)]*)\)', '', text)  # "(Speed)" — the English exam term is for reading, not hearing
    for a, b in UNITS: t = re.sub(a, b, t)
    t = re.sub(r'[0-9୦-୯]+(?:[.,][0-9୦-୯]+)*', number, t)
    t = re.sub(r'\b(\d+)\s*(?:m)\b', r'\1 ମିଟର', t)
    t = re.sub(r'[\U0001F300-\U0001FAFF]', '', t)
    # pause after sentences (। ? ! .) and a short one at commas/dashes
    parts, out = re.split(r'([।?!.]|[,—;:])', t), []
    for i in range(0, len(parts), 2):
        seg = re.sub(r'[^଀-୿\s\'-]', ' ', parts[i])
        seg = re.sub(r'\s+', ' ', seg).strip()
        sep = parts[i + 1] if i + 1 < len(parts) else '।'
        if seg: out.append((seg, 0.35 if sep in '।?!.' else 0.15))
    return out

class Voice:
    def __init__(self, name: str = 'facebook/mms-tts-ory'):
        from transformers import VitsModel, AutoTokenizer
        self.tok = AutoTokenizer.from_pretrained(name)
        self.model = VitsModel.from_pretrained(name).eval()
        self.sr = self.model.config.sampling_rate

    def record(self, text: str, out_path: str, seed: int | None = None) -> str | None:
        """Synthesises `text` to an Opus .ogg at out_path; returns what was read aloud, or None if nothing was speakable."""
        segs = speakable(text)
        if seed is not None: torch.manual_seed(seed)  # VITS samples durations/noise: fixed seed → the same clip every run
        pcm = []
        for seg, pause in segs:
            with torch.no_grad():
                w = self.model(**self.tok(seg, return_tensors='pt')).waveform[0].numpy()
            pcm += [w, np.zeros(int(self.sr * pause), dtype=np.float32)]
        if not pcm: return None
        buf = io.BytesIO(); wav.write(buf, self.sr, (np.concatenate(pcm) * 32767).clip(-32768, 32767).astype(np.int16))
        # speech at 16 kHz mono: Opus 16 kbps ≈ 2 KB per second, clear enough on a phone speaker
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'wav', '-i', 'pipe:0', '-ac', '1', '-c:a', 'libopus', '-b:a', '16k', '-application', 'voip', out_path],
                       input=buf.getvalue(), check=True)
        return ' | '.join(s for s, _ in segs)
