// Child-safety layer (PLAN §6.7, §10.6; TODO P5.13–P5.17, P5.22). Runs on the phone and on the server, so it works
// offline. Word lists cover Odia script, Hindi, English and romanized Odia/Hindi. A list is a floor, not a ceiling:
// online the decide LLM's `understood.intent` can raise a question to wellbeing / off-topic too (cycle.ts).

export type SafetyKind = 'ok' | 'distress' | 'unsafe' | 'personal' | 'worried' | 'off_topic';

const any = (...res: RegExp[]) => (t: string) => res.some((r) => r.test(t));

/** She may be at risk or hurting: caring message, trusted adult + helpline, quiet teacher alert. */
const DISTRESS = any(
  /\b(suicide|suicidal|kill (my ?self|me)|want to die|wanna die|end (my|this) life|self[- ]?harm|cut(ting)? my ?self|hurt(ing)? my ?self|no ?one (cares|loves me)|can'?t live|better off dead)\b/i,
  /\b(he|she|they|uncle|sir|teacher|father|papa|brother) (hits|beats|touches|touched|hurts|abuses) me\b|\b(abused|molested|harass(ed|ing) me)\b/i,
  /\b(mari ?jibi|mori ?jibi|mari ?jaibi|mariba ?ku ?(chahe|chahun)|atma ?hatya|banchiba ?ku ?ichha ?nahi|mote ?(mada|maada) ?mar|mar ?jaun?ga|marna ?chaht|khud ?ko ?(maar|chot))/i,
  /ଆତ୍ମହତ୍ୟା|ମରିଯିବି|ମରିଯାଆନ୍ତି|ମରିବାକୁ ଚାହେଁ|ମରିଯିବାକୁ|ବଞ୍ଚିବାକୁ ଇଚ୍ଛା ନାହିଁ|ମୋତେ ମାଡ଼ ମାରେ|ମୋତେ ମାଡ଼ ମାରୁଛି|ମୋ ଦେହରେ ହାତ ଦିଏ|ନିଜକୁ କାଟି/,
  /आत्महत्या|मर जाना चाह|मरना चाहत|मैं मर जाऊँ|खुद को (चोट|मार)|मुझे मारत|मुझे छूता/,
);

/** Worried, stressed, scared or low (exams, studies): calm words and a small next step; not the at-risk reply, no alert. */
const WORRIED = any(
  /\b(i am|i'm|im|i feel|i felt|i get|i got|i'm getting|feeling|i keep)\b[^.?!]{0,30}\b(stress(ed)?|tensed?|tension|anxious|anxiety|nervous|scared|afraid|frightened|worried|panic(king)?|depressed|sad|lonely|hopeless|overwhelmed|upset)\b/i,
  /\b(exam|exams|test|board|result|results)\b[^.?!]{0,25}\b(stress|tension|fear|scared|afraid|worried|nervous|anxiety|panic)\b|\b(stress|tension|fear|scared|afraid|worried|nervous|anxiety|panic)\b[^.?!]{0,25}\b(exam|exams|test|board|result|results)\b/i,
  /\b(can'?t|cannot|couldn'?t) (sleep|stop crying|focus at all)\b|\bi (cry|am crying|cried)\b/i,
  /\b(dara (laguchi|lagu?che)|bhaya (laguchi|lagu?che)|chinta (laguchi|heuchi)|tension (heuchi|laguchi|ho rahi|ho raha)|mana kharap|dar lag raha|ghabrahat|ghabra (raha|rahi)|udaas)\b/i,
  /ଡର ଲାଗୁଛି|ଭୟ ଲାଗୁଛି|ଚିନ୍ତା ଲାଗୁଛି|ଚିନ୍ତା ହେଉଛି|ଟେନସନ୍|ଟେନ୍ସନ|ମନ ଖରାପ|ଦୁଃଖ ଲାଗୁଛି|ପରୀକ୍ଷା ଭୟ/,
  /डर लग रहा|डर लगता|तनाव|टेंशन|घबराहट|घबरा रहा|घबरा रही|चिंता हो रही|उदास|परीक्षा का डर/,
);

/** Not for a tutor at all: no engagement, calm message. (Physics words like bullet, gun, bomb-from-a-plane stay allowed.) */
const UNSAFE = any(
  /\b(sex|sexy|porn|nude|nudes|xxx|drugs?|ganja|charas|smack|alcohol|daaru|daru|weapon|make (a )?bomb|bomb (banaiba|kemiti|kaise)|kill (him|her|them|someone)|murder|rape)\b/i,
  /ଯୌନ|ନିଶା ଦ୍ରବ୍ୟ|ନିଶାଦ୍ରବ୍ୟ|ଗଞ୍ଜେଇ|ବୋମା ତିଆରି|ହତ୍ୟା କରିବା/,
  /सेक्स|नशा|गांजा|बम बनाना|हत्या कैसे/,
);

/** Not study (only counts when the question matched nothing in the chapter). */
const OFF_TOPIC = any(
  /\b(cricket|ipl|kohli|dhoni|movie|film|cinema|serial|song|gaana|gana|music|game|games|free ?fire|pubg|bgmi|instagram|insta|youtube|whatsapp|tiktok|reels?|girl ?friend|boy ?friend|crush|love you|joke|actor|actress|heroine|politics|election|recharge)\b/i,
  /ଚଳଚ୍ଚିତ୍ର|ସିନେମା|ଗୀତ|କ୍ରିକେଟ|ଫିଲ୍ମ|ପ୍ରେମ|ଅଭିନେତା|ରିଲ୍ସ/,
  /फिल्म|गाना|क्रिकेट|प्यार|हीरोइन/,
);

const PHONE = /(?:\+?91[\s-]?)?\b[6-9]\d{4}[\s-]?\d{5}\b/g;
const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;
const AADHAAR = /\b\d{4}[\s-]\d{4}[\s-]\d{4}\b/g;
/** She shares (or is asked for) where she lives / family details — not needed for learning (P5.16). */
const PERSONAL = any(
  /\b(my (home )?address|where i live|my village is|my phone number|my number is|pin ?code|aadhaar|aadhar|my father'?s? (name|number|phone)|my mother'?s? (name|number|phone))\b/i,
  /\b(mo ghara (thikana|address)|mo (phone|mobile) number)\b/i,
  /ମୋ ଘର ଠିକଣା|ମୋ ଠିକଣା|ମୋ ଫୋନ୍ ନମ୍ବର|ମୋ ମୋବାଇଲ୍ ନମ୍ବର|ଆଧାର ନମ୍ବର/,
  /मेरा पता|मेरा फोन नंबर|आधार नंबर/,
);
const hasPii = (t: string) => new RegExp(PHONE.source).test(t) || new RegExp(EMAIL.source).test(t) || new RegExp(AADHAAR.source).test(t);

/** What kind of message this is, safety-wise. `unmatched`: the chapter matcher found nothing it is about. */
export function screen(text: string, unmatched = true): SafetyKind {
  const t = text.normalize('NFC');
  if (DISTRESS(t)) return 'distress';
  if (UNSAFE(t)) return 'unsafe';
  if (PERSONAL(t) || hasPii(t)) return 'personal';
  if (WORRIED(t)) return 'worried';
  if (unmatched && OFF_TOPIC(t)) return 'off_topic';
  return 'ok';
}

/** Safety lexicon for any text (also outputs): distress or unsafe words. */
export const isUnsafe = (text: string) => { const k = screen(text, false); return k === 'distress' || k === 'unsafe'; };

/**
 * PII scrub (P5.22): phone numbers, e-mail addresses, Aadhaar-like numbers and the given names (her own name, which
 * only the phone knows) are replaced before text is stored on the server or put in any LLM prompt.
 */
export function scrubPii(text: string, names: string[] = []): string {
  let t = text.replace(EMAIL, '[email]').replace(AADHAAR, '[id]').replace(PHONE, '[phone]');
  for (const n of names.map((x) => x.trim()).filter((x) => x.length >= 2)) t = t.replace(new RegExp(`(?<![\\p{L}\\p{M}])${escapeRe(n)}(?![\\p{L}\\p{M}])`, 'giu'), '[name]');
  return t;
}
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
