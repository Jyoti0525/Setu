import { playClip, stopClip } from './audio.ts';
// UI strings (PLAN §7: fully localised interface): Odia, Hindi, English. Every key exists in every language (test).

const S = {
  or: {
    app: 'ସେତୁ', chooseLang: 'ଭାଷା ବାଛ', chooseAvatar: 'ତୁମ ଛବି ବାଛ', name: 'ନାମ (ଇଚ୍ଛା ହେଲେ)', start: 'ଆରମ୍ଭ କର',
    ask: 'ପ୍ରଶ୍ନ ପଚାର', askPlaceholder: 'ତୁମ ପ୍ରଶ୍ନ ଲେଖ — ଓଡ଼ିଆ ବା English ଅକ୍ଷରରେ', send: 'ପଠାଅ',
    today: 'ଆଜିର ପାଠ', next: 'ଆଗକୁ', why: 'କାହିଁକି?', answer: 'ଉତ୍ତର', typeNumber: 'ସଂଖ୍ୟା ଲେଖ', whoIsIt: 'ଏବେ କିଏ ପଢ଼ୁଛ?', otherHome: 'ମୋ ଘର ଭାଷା ଅଲଗା (କୁଇ, ସାନ୍ତାଳି, ହୋ…)', bridgeNote: 'ସେତୁ ଏବେ {0} କହିପାରେ ନାହିଁ — ତୁମ ସ୍କୁଲ ଭାଷା {1} ରେ ପଢ଼ାଇବ, ଆଉ ତୁମ ଶିକ୍ଷକ {0} ଶବ୍ଦ ଯୋଡ଼ିପାରିବେ।', ack: 'ଶୁଣିଲି — ଟିକେ ଦେଖୁଛି…', switchLearner: 'ଅନ୍ୟ ଶିକ୍ଷାର୍ଥୀ', timeToday: 'ଆଜି କେତେ ସମୟ ପଢ଼ିବ?', startLesson: 'ଆରମ୍ଭ କର', remindOff: 'ପାଠ ପ୍ରସ୍ତୁତ ହେଲେ ମନେ ପକାଅ', remindOn: 'ମନେ ପକାଇବା ଚାଲୁ ଅଛି', newLearner: 'ନୂଆ ଶିକ୍ଷାର୍ଥୀ', sharePack: 'ପାଠ ସାଙ୍ଗକୁ ପଠାଅ (ଫାଇଲ)', openPackFile: 'ସାଙ୍ଗ ପଠାଇଥିବା ପାଠ ଫାଇଲ ଖୋଲ', packBad: 'ଏହି ଫାଇଲ ଠିକ୍ ନାହିଁ (ବଦଳିଯାଇଛି) — ବ୍ୟବହାର କରାଗଲା ନାହିଁ।', packFormat: 'ଏହା ସେତୁ ପାଠ ଫାଇଲ ନୁହେଁ।', typeWords: 'ନିଜ ଭାଷାରେ ଲେଖ', nextHint: 'ଆଉ ଗୋଟିଏ ସୂଚନା', showAnswer: 'ଉତ୍ତର ଦେଖ', hintRight: 'ଠିକ୍! ତୁମେ ନିଜେ କଲ 👏', hintWrong: 'ଏଥର ମିଳିଲା ନାହିଁ — ସୂଚନା ଦେଖି ଆଉ ଥରେ ଚେଷ୍ଟା କର।',
    cloud: 'ଅନଲାଇନ', weak: 'ଦୁର୍ବଳ ସିଗନାଲ', device: 'ଫୋନରେ (ଅଫଲାଇନ)', practice: 'ଅଭ୍ୟାସ',
    syncDone: 'ସିଙ୍କ ହେଲା', thinking: 'ଭାବୁଛି…', end: 'ଆଜି ପାଇଁ ଶେଷ', mastery: 'ଶିଖିବା', dataUsed: 'ଡାଟା',
    loading: 'ପାଠ ଆଣୁଛି…', noPack: 'ପ୍ରଥମ ଥର ପାଇଁ ଇଣ୍ଟରନେଟ ଦରକାର।', speak: 'ଶୁଣ',
    ready: 'ତୁମ ପାଇଁ ପ୍ରସ୍ତୁତ', minutes: 'ମିନିଟ', yourQuestion: 'ତୁମ ପ୍ରଶ୍ନ', answered: 'ଉତ୍ତର ଆସିଗଲା',
    placementTag: 'ଆରମ୍ଭ ପ୍ରଶ୍ନ', chooseClass: 'କେଉଁ ଶ୍ରେଣୀ?', classCode: 'ଶିକ୍ଷକଙ୍କ ୬ ଅଙ୍କର କୋଡ୍ (ଇଚ୍ଛା ହେଲେ)', className: 'ଶ୍ରେଣୀ',
    snap: 'ଫଟୋ', photo: 'ବହିର ଫଟୋ', readingPhoto: 'ଫଟୋ ପଢ଼ୁଛି…', fromBook: 'ତୁମ ବହିରୁ', keepPhoto: 'ଫଟୋ ରଖ — ଇଣ୍ଟରନେଟ ଆସିଲେ ଉତ୍ତର ଦେବି',
    photoKept: 'ଫଟୋ ରଖିଲି। ସିଗନାଲ୍ ଆସିଲେ ପଢ଼ି ବୁଝାଇବି।', ocrDownload: 'ଅଫଲାଇନ ଫଟୋ ପଢ଼ିବା (୩ MB, Wi-Fi ରେ)', ocrDownloading: 'ଫଟୋ ପଢ଼ିବା ଡାଉନଲୋଡ ହେଉଛି…',
    scanQr: 'ଶିକ୍ଷକଙ୍କ QR ସ୍କାନ କର', scanHint: 'QR କୁ ବାକ୍ସ ଭିତରେ ରଖ', notClassQr: 'ଏହା ଶ୍ରେଣୀ QR ନୁହେଁ', noCamera: 'କ୍ୟାମେରା ଖୋଲିଲା ନାହିଁ — କୋଡ୍ ଟାଇପ କର।', close: 'ବନ୍ଦ କର',
    soon: 'ଶୀଘ୍ର', noClass: 'ଏହି କୋଡ୍ ମିଳିଲା ନାହିଁ', checkLater: 'ଇଣ୍ଟରନେଟ ଆସିଲେ ଯାଞ୍ଚ ହେବ', showName: 'ମୋ ନାମ ମୋ ଶିକ୍ଷକଙ୍କୁ ଦେଖାଅ',
    mic: 'କହି ପଚାର', listening: 'ଶୁଣୁଛି… କହିସାରିଲେ ପୁଣି ଛୁଅଁ', hearing: 'ବୁଝୁଛି…', speakNow: 'ଏବେ କୁହ…',
    voiceKept: 'ତୁମ ପ୍ରଶ୍ନ ରଖିଲି। ସିଗନାଲ୍ ଆସିଲେ ଶୁଣି ଉତ୍ତର ଦେବି।',
    voiceFailed: 'ଠିକ୍ ଶୁଣିପାରିଲି ନାହିଁ। ଇଂରାଜୀ ଅକ୍ଷରରେ ଲେଖ, ଯେପରି speed kana, କିମ୍ବା ବହିର ଫଟୋ ନିଅ।',
    gboardHint: 'କିବୋର୍ଡର ମାଇକ୍ 🎤 ଦବାଇ କୁହ — ଲେଖା ଆପେ ଆସିବ।',
  },
  hi: {
    app: 'सेतु', chooseLang: 'भाषा चुनो', chooseAvatar: 'अपनी तस्वीर चुनो', name: 'नाम (चाहो तो)', start: 'शुरू करो',
    ask: 'सवाल पूछो', askPlaceholder: 'अपना सवाल लिखो — हिंदी या English अक्षरों में', send: 'भेजो',
    today: 'आज का पाठ', next: 'आगे', why: 'क्यों?', answer: 'जवाब', typeNumber: 'संख्या लिखो', whoIsIt: 'अभी कौन पढ़ रहा है?', otherHome: 'मेरी घर की भाषा अलग है (कुई, संताली, हो…)', bridgeNote: 'सेतु अभी {0} नहीं बोल पाता — तुम्हारी स्कूल की भाषा {1} में पढ़ाएगा, और तुम्हारे शिक्षक {0} के शब्द जोड़ सकते हैं।', ack: 'सुन लिया — ज़रा देख रहा हूँ…', switchLearner: 'दूसरा विद्यार्थी', timeToday: 'आज कितनी देर पढ़ोगे?', startLesson: 'शुरू करो', remindOff: 'पाठ तैयार हो तो याद दिलाओ', remindOn: 'याद दिलाना चालू है', newLearner: 'नया विद्यार्थी', sharePack: 'पाठ दोस्त को भेजो (फ़ाइल)', openPackFile: 'दोस्त की भेजी पाठ फ़ाइल खोलो', packBad: 'यह फ़ाइल ठीक नहीं है (बदली हुई) — इस्तेमाल नहीं की।', packFormat: 'यह सेतु की पाठ फ़ाइल नहीं है।', typeWords: 'अपने शब्दों में लिखो', nextHint: 'एक और संकेत', showAnswer: 'जवाब देखो', hintRight: 'सही! तुमने खुद किया 👏', hintWrong: 'अभी नहीं — संकेत देखकर एक बार और कोशिश करो।',
    cloud: 'ऑनलाइन', weak: 'कमज़ोर सिग्नल', device: 'फ़ोन पर (ऑफ़लाइन)', practice: 'अभ्यास',
    syncDone: 'सिंक हुआ', thinking: 'सोच रहा हूँ…', end: 'आज के लिए बस', mastery: 'सीखना', dataUsed: 'डेटा',
    loading: 'पाठ ला रहा हूँ…', noPack: 'पहली बार इंटरनेट चाहिए।', speak: 'सुनो',
    ready: 'तुम्हारे लिए तैयार', minutes: 'मिनट', yourQuestion: 'तुम्हारा सवाल', answered: 'जवाब आ गया',
    placementTag: 'शुरुआती सवाल', chooseClass: 'कौन सी कक्षा?', classCode: 'शिक्षक का 6 अंकों का कोड (चाहो तो)', className: 'कक्षा',
    snap: 'फ़ोटो', photo: 'किताब की फ़ोटो', readingPhoto: 'फ़ोटो पढ़ रहा हूँ…', fromBook: 'तुम्हारी किताब से', keepPhoto: 'फ़ोटो रखो — इंटरनेट आने पर जवाब दूँगा',
    photoKept: 'फ़ोटो रख ली। सिग्नल आने पर पढ़कर समझाऊँगा।', ocrDownload: 'ऑफ़लाइन फ़ोटो पढ़ना (3 MB, Wi-Fi पर)', ocrDownloading: 'फ़ोटो पढ़ना डाउनलोड हो रहा है…',
    scanQr: 'शिक्षक का QR स्कैन करो', scanHint: 'QR को डिब्बे के अंदर रखो', notClassQr: 'यह कक्षा का QR नहीं है', noCamera: 'कैमरा नहीं खुला — कोड टाइप करो।', close: 'बंद करो',
    soon: 'जल्द', noClass: 'इस कोड की कक्षा नहीं मिली', checkLater: 'इंटरनेट आने पर जाँच होगी', showName: 'मेरा नाम मेरे शिक्षक को दिखाओ',
    mic: 'बोलकर पूछो', listening: 'सुन रहा हूँ… बोल चुको तो फिर छुओ', hearing: 'समझ रहा हूँ…', speakNow: 'अब बोलो…',
    voiceKept: 'तुम्हारा सवाल रख लिया। सिग्नल आने पर सुनकर जवाब दूँगा।',
    voiceFailed: 'ठीक से सुन नहीं पाया। English अक्षरों में लिखो, जैसे "speed kya hai", या किताब की फ़ोटो लो।',
    gboardHint: 'कीबोर्ड का 🎤 दबाकर बोलो — शब्द अपने आप लिख जाएँगे।',
  },
  en: {
    app: 'Setu', chooseLang: 'Choose language', chooseAvatar: 'Pick your picture', name: 'Name (optional)', start: 'Start',
    ask: 'Ask a doubt', askPlaceholder: 'Type your question — in Odia or English letters', send: 'Send',
    today: "Today's lesson", next: 'Next', why: 'Why?', answer: 'Answer', typeNumber: 'Type a number', whoIsIt: 'Who is learning now?', otherHome: 'My home language is different (Kui, Santali, Ho…)', bridgeNote: 'Setu cannot speak {0} yet — it will teach in your school language, {1}, and your teacher can add {0} words.', ack: 'Got it — looking…', switchLearner: 'Switch learner', timeToday: 'How long can you study today?', startLesson: 'Start', remindOff: 'Remind me when a lesson is ready', remindOn: 'Reminders on', newLearner: 'New learner', sharePack: 'Send the lesson to a friend (file)', openPackFile: 'Open a lesson file from a friend', packBad: 'This file is damaged or changed — not used.', packFormat: 'This is not a Setu lesson file.', typeWords: 'Write in your own words', nextHint: 'One more hint', showAnswer: 'Show the answer', hintRight: 'Right! You did it yourself 👏', hintWrong: 'Not yet — look at the hints and try once more.',
    cloud: 'Online', weak: 'Weak signal', device: 'On phone (offline)', practice: 'practice',
    syncDone: 'Synced', thinking: 'Thinking…', end: 'Done for today', mastery: 'Learning', dataUsed: 'Data',
    loading: 'Getting your lessons…', noPack: 'Internet is needed the first time.', speak: 'Listen',
    ready: 'Ready for you', minutes: 'min', yourQuestion: 'Your question', answered: 'Answer is here',
    placementTag: 'starting question', chooseClass: 'Which class?', classCode: "Teacher's 6-digit code (optional)", className: 'Class',
    snap: 'Photo', photo: 'Photo of the book', readingPhoto: 'Reading the photo…', fromBook: 'From your book', keepPhoto: 'Keep the photo — I will answer when online',
    photoKept: 'Photo kept. I will read it and explain when the signal is back.', ocrDownload: 'Offline photo reading (3 MB, use Wi-Fi)', ocrDownloading: 'Downloading photo reading…',
    scanQr: "Scan the teacher's QR", scanHint: 'Hold the QR inside the box', notClassQr: 'This is not a class QR', noCamera: 'Camera did not open — type the code.', close: 'Close',
    soon: 'soon', noClass: 'No class with this code', checkLater: 'Will be checked when online', showName: 'Show my name to my teacher',
    mic: 'Ask by voice', listening: 'Listening… tap again when you finish', hearing: 'Understanding…', speakNow: 'Speak now…',
    voiceKept: 'I kept your question. I will listen and answer when the signal is back.',
    voiceFailed: 'I could not hear that clearly. Type it in English letters, like "speed kana", or snap a photo of the book.',
    gboardHint: 'Tap the 🎤 on your keyboard and speak — the words will type themselves.',
  },
} as const;

export type Key = keyof typeof S.en;
export const t = (lang: string, k: Key) => (S as Record<string, Record<Key, string>>)[lang]?.[k] ?? S.en[k];

/** Language picker: each name is spoken in its own language when tapped. */
export const LANGS = [{ id: 'or', label: 'ଓଡ଼ିଆ' }, { id: 'hi', label: 'हिन्दी' }, { id: 'en', label: 'English' }];
/** Lines the app itself speaks (not the tutor engine): pre-recorded with the tutor's lines (content/scripts/audio_texts.ts). */
export const spokenUi = (lang: string) => [...LANGS.filter((l) => l.id === lang).map((l) => l.label), ...(['photoKept', 'voiceKept', 'voiceFailed', 'gboardHint', 'ack', 'timeToday', 'whoIsIt', 'hintWrong'] as const).map((k) => t(lang, k))];

/** Speak: the recorded clip for this exact line if we have one (step 2), else the device voice (PLAN §10.2 step 3). */
export function speak(text: string, lang: string) {
  void playClip(text, lang).then((ok) => { if (!ok) deviceVoice(text, lang); });
}

function deviceVoice(text: string, lang: string) {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return false;
    const tag = { or: 'or-IN', en: 'en-IN', hi: 'hi-IN' }[lang] ?? lang;
    const voice = synth.getVoices().find((v) => v.lang.toLowerCase().startsWith(tag.toLowerCase().slice(0, 2)));
    const u = new SpeechSynthesisUtterance(text);
    u.lang = tag;
    if (voice) u.voice = voice;
    synth.cancel();
    stopClip();
    synth.speak(u);
    return !!voice;
  } catch { return false; }
}
