// The door to Setu: sign in (Firebase: Google, email + password, phone OTP) or go on with no account. The learning
// itself never needs an account — a phone with no signal, or a server with no sign-in set up, opens straight into
// her learning space (accountId LOCAL), as before.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Auth, AuthCredential, ConfirmationResult, RecaptchaVerifier, User } from 'firebase/auth';
import { getAuthOnce } from './firebase.ts';
import { App as LearnerApp, LOCAL } from './app.tsx';
import { Icon, Logo } from './icons.tsx';
import { LANGUAGES } from '@setu/core';

type Page = 'login' | 'register' | 'dashboard';
const NO_ACCOUNT = 'setu-no-account';
const keep = (k: string, v?: string | null) => { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } return null; };

function pageFromLocation(): Page {
  const path = location.pathname.replace(/\/$/, '');
  return path === '/login' || path === '/register' ? (path.slice(1) as Page) : 'dashboard';
}
/** a teacher's QR (#join=…) or a demo link (#restore=…) must survive the way through the sign-in page */
function go(path: string) {
  const carry = /^#(join|restore)=/.test(location.hash) ? location.hash : '';
  history.pushState({}, '', path + carry); dispatchEvent(new PopStateEvent('popstate')); window.scrollTo(0, 0);
}
function Link({ href, children, className = '' }: { href: string; children: preact.ComponentChildren; className?: string }) {
  return <a class={className} href={href} onClick={(e) => { if (!e.metaKey && !e.ctrlKey && e.button === 0) { e.preventDefault(); go(href); } }}>{children}</a>;
}

export function ProductApp() {
  const [page, setPage] = useState<Page>(pageFromLocation());
  const [auth, setAuth] = useState<Auth | null | undefined>(undefined);
  const [user, setUser] = useState<User | null>(null);
  const [checked, setChecked] = useState(false);
  const [local, setLocal] = useState(() => keep(NO_ACCOUNT) === '1' || /^#restore=/.test(location.hash));
  const [pending, setPending] = useState<AuthCredential | null>(null);
  useEffect(() => {
    const pop = () => setPage(pageFromLocation());
    addEventListener('popstate', pop);
    let off = () => {};
    void (async () => {
      // never wait long for the sign-in setup: a slow link still opens Setu with no account
      const a = await Promise.race([getAuthOnce(), new Promise<null>((r) => setTimeout(() => r(null), 6000))]);
      setAuth(a);
      if (!a) return setChecked(true);
      const { onAuthStateChanged } = await import('firebase/auth');
      off = onAuthStateChanged(a, (u) => { setUser(u); setChecked(true); });
    })();
    return () => { off(); removeEventListener('popstate', pop); };
  }, []);
  const useLocal = local || auth === null;
  useEffect(() => {
    if (!checked || useLocal) return;
    if (page === 'dashboard' && !user) go('/login');
    else if (page !== 'dashboard' && user) go('/dashboard');
  }, [page, user, checked, useLocal]);

  if (local && page === 'dashboard') return <LearnerApp accountId={LOCAL} onSignIn={auth ? () => { keep(NO_ACCOUNT, null); setLocal(false); go('/login'); } : undefined} />;
  if (!checked) return <main class="auth-loading" aria-label="Setu"><Logo size={56} /><span>ସେତୁ · Setu</span></main>;
  if (useLocal) return <LearnerApp accountId={LOCAL} />;
  if (page === 'dashboard') return user
    ? <LearnerApp accountId={user.uid} displayName={user.displayName} accountEmail={user.email}
        onLogout={async () => { const { signOut } = await import('firebase/auth'); await signOut(auth!); go('/login'); }}
        onProfileName={async (name) => { if (auth?.currentUser) { const { updateProfile } = await import('firebase/auth'); await updateProfile(auth.currentUser, { displayName: name }); } }} />
    : <main class="auth-loading"><Logo size={56} /></main>;
  return <AuthPage mode={page} auth={auth!} pending={pending} setPending={setPending} onSkip={() => { keep(NO_ACCOUNT, '1'); setLocal(true); go('/dashboard'); }} />;
}

/** the sign-in page's words in Odia, Hindi and English (she picks; the app itself has many more languages) */
const W: Record<string, Record<string, string>> = {
  or: { createEyebrow: 'ତୁମ ଖାତା ଖୋଲ', loginEyebrow: 'ତୁମ ପଢ଼ା ଜାଗା', getStarted: 'ଆରମ୍ଭ କର', welcome: 'ପୁଣି ସ୍ୱାଗତ', createSub: 'କିପରି ଖାତା ଖୋଲିବ ବାଛ।', loginSub: 'ପଢ଼ା ଜାରି ରଖିବାକୁ ଲଗ୍‌ଇନ୍ କର।', google: 'Google ସହିତ ଆଗକୁ', or: 'କିମ୍ବା', email: 'ଇମେଲ୍', phone: 'ଫୋନ୍', fullName: 'ପୂରା ନାମ', emailAddr: 'ଇମେଲ୍ ଠିକଣା', password: 'ପାସୱାର୍ଡ', show: 'ଦେଖାଅ', hide: 'ଲୁଚାଅ', forgot: 'ପାସୱାର୍ଡ ଭୁଲିଗଲ?', wait: 'ଟିକେ ଅପେକ୍ଷା କର…', create: 'ଖାତା ଖୋଲ', login: 'ଲଗ୍‌ଇନ୍', phoneNo: 'ଫୋନ୍ ନମ୍ବର', code: 'OTP କୋଡ୍', verify: 'ଯାଞ୍ଚ କରି ଆଗକୁ', verifying: 'ଯାଞ୍ଚ ହେଉଛି…', resendIn: '{0} ସେକେଣ୍ଡ ପରେ ପୁଣି ପଠାଅ', resend: 'କୋଡ୍ ପୁଣି ପଠାଅ', changePhone: 'ଫୋନ୍ ନମ୍ବର ବଦଳାଅ', sending: 'କୋଡ୍ ପଠାଉଛି…', send: 'OTP ପଠାଅ', sent: 'ତୁମ ଫୋନକୁ କୋଡ୍ ପଠାଗଲା।', have: 'ଖାତା ଅଛି?', new: 'ସେତୁରେ ନୂଆ?', makeOne: 'ଖାତା ଖୋଲ', skip: 'ଖାତା ବିନା ଆଗକୁ ଯାଅ', skipNote: 'ଖାତା ବିନା ବି ସବୁ ପଢ଼ା ଚାଲିବ — ଏହି ଫୋନରେ, ନେଟ୍ ନଥିଲେ ବି।', back: '← ସେତୁକୁ ଫେରିବା', resetFirst: 'ପ୍ରଥମେ ଇମେଲ୍ ଲେଖ, ତାପରେ "ପାସୱାର୍ଡ ଭୁଲିଗଲ?" ଦବାଅ।', resetSent: 'ସେହି ଇମେଲରେ ଖାତା ଥିଲେ ନୂଆ ପାସୱାର୍ଡ ଲିଙ୍କ୍ ଯାଉଛି।', linkPhone: 'ଏହି ଫୋନ୍ ନମ୍ବର ଆଉ ଏକ ଖାତାରେ ଅଛି। ସେହି ଖାତାରେ ଲଗ୍‌ଇନ୍ କର, ଫୋନ୍ ଯୋଡ଼ି ହୋଇଯିବ।', linkGoogle: 'ଏହି ଇମେଲ୍ ଅନ୍ୟ ଉପାୟରେ ଖୋଲା ହୋଇଛି। ସେହି ଉପାୟରେ ଲଗ୍‌ଇନ୍ କର, Google ଯୋଡ଼ି ହୋଇଯିବ।', failed: 'ଲଗ୍‌ଇନ୍ ହେଲା ନାହିଁ। ବିବରଣୀ ଦେଖି ପୁଣି ଚେଷ୍ଟା କର।', badLogin: 'ଇମେଲ୍ ବା ପାସୱାର୍ଡ ଠିକ୍ ନୁହେଁ।', inUse: 'ଏହି ଇମେଲରେ ଆଗରୁ ଖାତା ଅଛି। ଲଗ୍‌ଇନ୍ କର।', weak: 'ଅତି କମରେ 6 ଅକ୍ଷରର ପାସୱାର୍ଡ ଦିଅ।', badEmail: 'ଠିକ୍ ଇମେଲ୍ ଠିକଣା ଲେଖ।', badPhone: 'ଠିକ୍ ଫୋନ୍ ନମ୍ବର ଲେଖ।', badCode: 'କୋଡ୍ ମେଳ ଖାଉନି। ପୁଣି ଦେଖ।', tooMany: 'ବହୁତ ଥର ଚେଷ୍ଟା ହେଲା। ଟିକେ ପରେ ଚେଷ୍ଟା କର।', net: 'ଇଣ୍ଟରନେଟ୍ ଦେଖି ପୁଣି ଚେଷ୍ଟା କର।', domain: 'ଏହି ୱେବସାଇଟ୍ Firebase ରେ ଅନୁମତି ପାଇନାହିଁ (Authorized domains)।', disabled: 'ଏହି ଲଗ୍‌ଇନ୍ ଉପାୟ Firebase ରେ ଚାଲୁ ନାହିଁ।', popup: 'Google ଲଗ୍‌ଇନ୍ ୱିଣ୍ଡୋ ବନ୍ଦ ହୋଇଗଲା।' },
  hi: { createEyebrow: 'अपना खाता बनाओ', loginEyebrow: 'तुम्हारी पढ़ाई की जगह', getStarted: 'शुरू करें', welcome: 'फिर से स्वागत है', createSub: 'खाता बनाने का तरीका चुनो।', loginSub: 'पढ़ाई जारी रखने के लिए लॉग इन करो।', google: 'Google से आगे बढ़ें', or: 'या', email: 'ईमेल', phone: 'फ़ोन', fullName: 'पूरा नाम', emailAddr: 'ईमेल पता', password: 'पासवर्ड', show: 'दिखाओ', hide: 'छिपाओ', forgot: 'पासवर्ड भूल गए?', wait: 'थोड़ा रुको…', create: 'खाता बनाओ', login: 'लॉग इन', phoneNo: 'फ़ोन नंबर', code: 'OTP कोड', verify: 'जाँच कर आगे बढ़ें', verifying: 'जाँच हो रही है…', resendIn: '{0} सेकंड बाद फिर भेजें', resend: 'कोड फिर भेजें', changePhone: 'फ़ोन नंबर बदलें', sending: 'कोड भेज रहे हैं…', send: 'OTP भेजें', sent: 'तुम्हारे फ़ोन पर कोड भेजा गया।', have: 'खाता है?', new: 'सेतु पर नए हो?', makeOne: 'खाता बनाओ', skip: 'बिना खाते के आगे बढ़ें', skipNote: 'बिना खाते के भी सारी पढ़ाई चलेगी — इसी फ़ोन पर, बिना नेट के भी।', back: '← सेतु पर वापस', resetFirst: 'पहले ईमेल लिखो, फिर "पासवर्ड भूल गए?" दबाओ।', resetSent: 'उस ईमेल पर खाता हो तो नया पासवर्ड लिंक जा रहा है।', linkPhone: 'यह फ़ोन नंबर दूसरे खाते में है। उस खाते से लॉग इन करो, फ़ोन जुड़ जाएगा।', linkGoogle: 'यह ईमेल दूसरे तरीके से बना है। उसी तरीके से लॉग इन करो, Google जुड़ जाएगा।', failed: 'लॉग इन नहीं हुआ। जानकारी देखकर फिर कोशिश करो।', badLogin: 'ईमेल या पासवर्ड सही नहीं है।', inUse: 'इस ईमेल पर पहले से खाता है। लॉग इन करो।', weak: 'कम से कम 6 अक्षर का पासवर्ड रखो।', badEmail: 'सही ईमेल पता लिखो।', badPhone: 'सही फ़ोन नंबर लिखो।', badCode: 'कोड मेल नहीं खाता। फिर देखो।', tooMany: 'बहुत बार कोशिश हुई। थोड़ी देर बाद करो।', net: 'इंटरनेट देखकर फिर कोशिश करो।', domain: 'यह वेबसाइट Firebase में अनुमति नहीं पाई है (Authorized domains)।', disabled: 'यह लॉग इन तरीका Firebase में चालू नहीं है।', popup: 'Google लॉग इन विंडो बंद हो गई।' },
  en: { createEyebrow: 'Create your account', loginEyebrow: 'Your learning space', getStarted: 'Get started', welcome: 'Welcome back', createSub: 'Choose how you would like to sign up.', loginSub: 'Sign in to continue learning.', google: 'Continue with Google', or: 'or continue with', email: 'Email', phone: 'Phone', fullName: 'Full name', emailAddr: 'Email address', password: 'Password', show: 'Show', hide: 'Hide', forgot: 'Forgot password?', wait: 'Please wait…', create: 'Create account', login: 'Log in', phoneNo: 'Phone number', code: 'Verification code', verify: 'Verify and continue', verifying: 'Verifying…', resendIn: 'Resend code in {0}s', resend: 'Resend code', changePhone: 'Change phone number', sending: 'Sending code…', send: 'Send verification code', sent: 'A verification code has been sent to your phone.', have: 'Already have an account?', new: 'New to Setu?', makeOne: 'Create an account', skip: 'Continue without an account', skipNote: 'Everything works without an account too — on this phone, even with no internet.', back: '← Back to Setu', resetFirst: 'Enter your email address first, then choose Forgot password.', resetSent: 'If an account uses that address, a reset link is on its way.', linkPhone: 'This phone is already linked to an account. Sign in with that account’s other method to connect this phone number.', linkGoogle: 'This email already has another sign-in method. Sign in with it here and Setu will connect Google to that account.', failed: 'We could not complete sign-in. Check your details and try again.', badLogin: 'That email and password combination was not recognized.', inUse: 'An account already uses that email. Try logging in instead.', weak: 'Choose a password with at least 6 characters.', badEmail: 'Enter a valid email address.', badPhone: 'Enter a valid phone number.', badCode: 'That verification code did not match. Check it and try again.', tooMany: 'Too many attempts. Wait a little before trying again.', net: 'Check your internet connection and try again.', domain: 'This website is not in Firebase Authentication’s authorized domains.', disabled: 'This sign-in method is not enabled in Firebase Authentication.', popup: 'Google sign-in was closed before it finished.' },
};
// the page's main words in the other Indian languages (AI drafts like the rest of those languages' screens; the
// rarer messages fall back to English). Tribal languages and Bhojpuri read the page in their school language.
const MORE: Record<string, Record<string, string>> = {
  bn: { createEyebrow: 'তোমার অ্যাকাউন্ট খোলো', loginEyebrow: 'তোমার পড়ার জায়গা', getStarted: 'শুরু করো', welcome: 'আবার স্বাগতম', createSub: 'কীভাবে অ্যাকাউন্ট খুলবে বেছে নাও।', loginSub: 'পড়া চালিয়ে যেতে লগ ইন করো।', google: 'Google দিয়ে এগোও', or: 'অথবা', email: 'ইমেল', phone: 'ফোন', fullName: 'পুরো নাম', emailAddr: 'ইমেল ঠিকানা', password: 'পাসওয়ার্ড', show: 'দেখাও', hide: 'লুকাও', forgot: 'পাসওয়ার্ড ভুলে গেছ?', wait: 'একটু অপেক্ষা করো…', create: 'অ্যাকাউন্ট খোলো', login: 'লগ ইন', phoneNo: 'ফোন নম্বর', code: 'OTP কোড', verify: 'যাচাই করে এগোও', send: 'OTP পাঠাও', have: 'অ্যাকাউন্ট আছে?', new: 'সেতুতে নতুন?', makeOne: 'অ্যাকাউন্ট খোলো', skip: 'অ্যাকাউন্ট ছাড়াই এগোও', skipNote: 'অ্যাকাউন্ট ছাড়াও সব পড়া চলবে — এই ফোনেই, নেট না থাকলেও।' },
  kn: { createEyebrow: 'ನಿನ್ನ ಖಾತೆ ತೆರೆ', loginEyebrow: 'ನಿನ್ನ ಓದಿನ ಜಾಗ', getStarted: 'ಆರಂಭಿಸು', welcome: 'ಮತ್ತೆ ಸ್ವಾಗತ', createSub: 'ಖಾತೆ ತೆರೆಯುವ ವಿಧಾನ ಆರಿಸು.', loginSub: 'ಓದು ಮುಂದುವರಿಸಲು ಲಾಗ್ ಇನ್ ಮಾಡು.', google: 'Google ಮೂಲಕ ಮುಂದುವರಿ', or: 'ಅಥವಾ', email: 'ಇಮೇಲ್', phone: 'ಫೋನ್', fullName: 'ಪೂರ್ಣ ಹೆಸರು', emailAddr: 'ಇಮೇಲ್ ವಿಳಾಸ', password: 'ಪಾಸ್‌ವರ್ಡ್', show: 'ತೋರಿಸು', hide: 'ಮರೆಮಾಡು', forgot: 'ಪಾಸ್‌ವರ್ಡ್ ಮರೆತೆಯಾ?', wait: 'ಸ್ವಲ್ಪ ಕಾಯಿ…', create: 'ಖಾತೆ ತೆರೆ', login: 'ಲಾಗ್ ಇನ್', phoneNo: 'ಫೋನ್ ಸಂಖ್ಯೆ', code: 'OTP ಕೋಡ್', verify: 'ಪರಿಶೀಲಿಸಿ ಮುಂದುವರಿ', send: 'OTP ಕಳುಹಿಸು', have: 'ಖಾತೆ ಇದೆಯಾ?', new: 'ಸೇತುವಿಗೆ ಹೊಸಬರಾ?', makeOne: 'ಖಾತೆ ತೆರೆ', skip: 'ಖಾತೆ ಇಲ್ಲದೆ ಮುಂದುವರಿ', skipNote: 'ಖಾತೆ ಇಲ್ಲದೆಯೂ ಎಲ್ಲ ಓದು ನಡೆಯುತ್ತದೆ — ಇದೇ ಫೋನಿನಲ್ಲಿ, ನೆಟ್ ಇಲ್ಲದಿದ್ದರೂ.' },
  te: { createEyebrow: 'నీ ఖాతా తెరువు', loginEyebrow: 'నీ చదువు చోటు', getStarted: 'మొదలుపెట్టు', welcome: 'మళ్ళీ స్వాగతం', createSub: 'ఖాతా ఎలా తెరవాలో ఎంచుకో.', loginSub: 'చదువు కొనసాగించడానికి లాగిన్ అవ్వు.', google: 'Google తో కొనసాగు', or: 'లేదా', email: 'ఈమెయిల్', phone: 'ఫోన్', fullName: 'పూర్తి పేరు', emailAddr: 'ఈమెయిల్ చిరునామా', password: 'పాస్‌వర్డ్', show: 'చూపించు', hide: 'దాచు', forgot: 'పాస్‌వర్డ్ మర్చిపోయావా?', wait: 'కొంచెం ఆగు…', create: 'ఖాతా తెరువు', login: 'లాగిన్', phoneNo: 'ఫోన్ నంబర్', code: 'OTP కోడ్', verify: 'తనిఖీ చేసి కొనసాగు', send: 'OTP పంపు', have: 'ఖాతా ఉందా?', new: 'సేతుకు కొత్తా?', makeOne: 'ఖాతా తెరువు', skip: 'ఖాతా లేకుండా కొనసాగు', skipNote: 'ఖాతా లేకపోయినా చదువంతా సాగుతుంది — ఈ ఫోన్‌లోనే, నెట్ లేకపోయినా.' },
  ta: { createEyebrow: 'உன் கணக்கைத் தொடங்கு', loginEyebrow: 'உன் படிப்பு இடம்', getStarted: 'தொடங்கு', welcome: 'மீண்டும் வருக', createSub: 'கணக்கைத் தொடங்கும் வழியைத் தேர்ந்தெடு.', loginSub: 'படிப்பைத் தொடர உள்நுழை.', google: 'Google மூலம் தொடர்', or: 'அல்லது', email: 'மின்னஞ்சல்', phone: 'தொலைபேசி', fullName: 'முழுப் பெயர்', emailAddr: 'மின்னஞ்சல் முகவரி', password: 'கடவுச்சொல்', show: 'காட்டு', hide: 'மறை', forgot: 'கடவுச்சொல் மறந்ததா?', wait: 'சற்றுக் காத்திரு…', create: 'கணக்கைத் தொடங்கு', login: 'உள்நுழை', phoneNo: 'தொலைபேசி எண்', code: 'OTP குறியீடு', verify: 'சரிபார்த்துத் தொடர்', send: 'OTP அனுப்பு', have: 'கணக்கு உள்ளதா?', new: 'சேதுவுக்குப் புதியவரா?', makeOne: 'கணக்கைத் தொடங்கு', skip: 'கணக்கு இல்லாமல் தொடர்', skipNote: 'கணக்கு இல்லாமலும் எல்லாப் படிப்பும் நடக்கும் — இந்தத் தொலைபேசியிலேயே, இணையம் இல்லாவிட்டாலும்.' },
  mr: { createEyebrow: 'तुझे खाते उघड', loginEyebrow: 'तुझी अभ्यासाची जागा', getStarted: 'सुरू कर', welcome: 'पुन्हा स्वागत', createSub: 'खाते कसे उघडायचे ते निवड.', loginSub: 'अभ्यास पुढे चालू ठेवण्यासाठी लॉग इन कर.', google: 'Google ने पुढे जा', or: 'किंवा', email: 'ईमेल', phone: 'फोन', fullName: 'पूर्ण नाव', emailAddr: 'ईमेल पत्ता', password: 'पासवर्ड', show: 'दाखव', hide: 'लपव', forgot: 'पासवर्ड विसरलास?', wait: 'थोडं थांब…', create: 'खाते उघड', login: 'लॉग इन', phoneNo: 'फोन नंबर', code: 'OTP कोड', verify: 'तपासून पुढे जा', send: 'OTP पाठव', have: 'खाते आहे?', new: 'सेतूवर नवीन?', makeOne: 'खाते उघड', skip: 'खात्याशिवाय पुढे जा', skipNote: 'खात्याशिवायही सगळा अभ्यास चालेल — याच फोनवर, नेट नसतानाही.' },
};
const pageLang = (l: string) => (W[l] || MORE[l] ? l : LANGUAGES[l]?.school ?? 'en');

/** the language for this page: a button that opens a list of all her languages, with a search */
function LangMenu({ value, onPick }: { value: string; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const find = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    // type straight away with a keyboard; on a touch phone the keyboard opens only when she taps the search
    if (matchMedia('(pointer: fine)').matches) find.current?.focus();
    const away = (e: Event) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    addEventListener('pointerdown', away);
    return () => removeEventListener('pointerdown', away);
  }, [open]);
  const t = q.trim().toLocaleLowerCase();
  const shown = Object.values(LANGUAGES).filter((l) => !t || [l.name, l.english, l.id].some((v) => v.toLocaleLowerCase().includes(t)));
  const cur = LANGUAGES[value];
  return <div class="lang-menu" ref={box} onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.preventDefault(); setOpen(false); } }}>
    <button type="button" class="lang-menu-button" aria-haspopup="listbox" aria-expanded={open} onClick={() => { setOpen(!open); setQ(''); }}>
      <Icon name="globe" size={17} /><span>{cur?.name ?? value}</span>{cur && cur.english !== cur.name && <span class="lang-menu-en">{cur.english}</span>}<Icon name="down" size={16} />
    </button>
    {open && <div class="lang-menu-pop">
      <label class="lang-menu-search"><Icon name="search" size={16} /><input ref={find} type="search" value={q} placeholder="Search · ଖୋଜ · खोजें" aria-label="Search language"
        onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && shown[0]) { e.preventDefault(); onPick(shown[0].id); setOpen(false); } }} /></label>
      <ul role="listbox" aria-label="Language">
        {shown.map((l) => <li><button type="button" role="option" aria-selected={l.id === value} class={l.id === value ? 'active' : ''} onClick={() => { onPick(l.id); setOpen(false); }}>
          <span>{l.name}</span>{l.english !== l.name && <span class="lang-menu-en">{l.english}</span>}{l.id === value && <Icon name="check" size={16} />}
        </button></li>)}
        {!shown.length && <li class="lang-menu-none">—</li>}
      </ul>
    </div>}
  </div>;
}

function AuthPage({ mode, auth, pending, setPending, onSkip }: { mode: 'login' | 'register'; auth: Auth; pending: AuthCredential | null; setPending: (c: AuthCredential | null) => void; onSkip: () => void }) {
  const isRegister = mode === 'register';
  const [lang, setLang] = useState(() => { const k = keep('setu-auth-lang'); return k && LANGUAGES[k] ? k : 'or'; });
  const L = pageLang(lang);
  const w = (k: string) => W[L]?.[k] ?? MORE[L]?.[k] ?? W.en![k] ?? k;
  const [method, setMethod] = useState<'email' | 'phone'>('email');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [phone, setPhone] = useState('');
  const [countryCode, setCountryCode] = useState('+91');
  const [otp, setOtp] = useState('');
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const verifier = useRef<RecaptchaVerifier | null>(null);
  useEffect(() => { if (cooldown <= 0) return; const timer = window.setTimeout(() => setCooldown(cooldown - 1), 1000); return () => clearTimeout(timer); }, [cooldown]);
  useEffect(() => () => verifier.current?.clear(), []);
  const fb = () => import('firebase/auth');
  const say = (e: unknown) => setMessage(authMessage(e, w));
  const linkPending = async (u: User) => { if (!pending) return; const { linkWithCredential } = await fb(); await linkWithCredential(u, pending); setPending(null); };
  const run = async (task: () => Promise<User>) => {
    setMessage(''); setBusy(true);
    try { await linkPending(await task()); go('/dashboard'); } catch (e) {
      const { PhoneAuthProvider } = await fb();
      const p = PhoneAuthProvider.credentialFromError(e as never);
      if (p) { setPending(p); setMessage(w('linkPhone')); } else say(e);
    } finally { setBusy(false); }
  };
  const submitEmail = (e: Event) => { e.preventDefault(); void run(async () => {
    const f = await fb();
    if (isRegister) { const c = await f.createUserWithEmailAndPassword(auth, email.trim(), password); if (name.trim()) await f.updateProfile(c.user, { displayName: name.trim() }); return c.user; }
    return (await f.signInWithEmailAndPassword(auth, email.trim(), password)).user;
  }); };
  const google = () => { setMessage(''); setBusy(true); void (async () => {
    const f = await fb();
    try { const c = await f.signInWithPopup(auth, new f.GoogleAuthProvider()); await linkPending(c.user); go('/dashboard'); } catch (e) {
      const p = f.GoogleAuthProvider.credentialFromError(e as never);
      if (p) { setPending(p); setMessage(w('linkGoogle')); } else say(e);
    } finally { setBusy(false); }
  })(); };
  const sendOtp = async () => {
    setMessage(''); setBusy(true);
    const f = await fb();
    try {
      verifier.current?.clear(); verifier.current = new f.RecaptchaVerifier(auth, 'setu-recaptcha', { size: 'invisible' });
      const full = `${countryCode}${phone.replace(/\D/g, '').replace(/^0+/, '')}`;
      setConfirmation(await f.signInWithPhoneNumber(auth, full, verifier.current)); setCooldown(60); setMessage(w('sent'));
    } catch (e) { verifier.current?.clear(); verifier.current = null; say(e); } finally { setBusy(false); }
  };
  const verifyOtp = (e: Event) => { e.preventDefault(); if (confirmation) void run(async () => (await confirmation.confirm(otp.trim())).user); };
  const resetPassword = () => {
    if (!email.trim()) return setMessage(w('resetFirst'));
    void (async () => { setBusy(true); setMessage(''); try { const f = await fb(); await f.sendPasswordResetEmail(auth, email.trim()); setMessage(w('resetSent')); } catch (e) { say(e); } finally { setBusy(false); } })();
  };
  const digits = phone.replace(/\D/g, '').length;
  return <main class={'auth-page' + (!isRegister ? ' login-page' : '')} lang={L}>
    <div class={'auth-side' + (!isRegister ? ' login-side' : '')}><span class="wordmark"><Logo size={36} /><span>Setu</span></span></div>
    <section class="auth-panel"><div class="auth-card">
      <LangMenu value={lang} onPick={(id) => { setLang(id); keep('setu-auth-lang', id); }} />
      <p class="eyebrow">{w(isRegister ? 'createEyebrow' : 'loginEyebrow')}</p>
      <h2>{w(isRegister ? 'getStarted' : 'welcome')}</h2>
      <p class="auth-subtitle">{w(isRegister ? 'createSub' : 'loginSub')}</p>
      <button class="google-button" type="button" disabled={busy} onClick={google}><GoogleMark /> {w('google')}</button>
      <div class="auth-divider"><span>{w('or')}</span></div>
      <div class="method-tabs" role="tablist"><button type="button" role="tab" aria-selected={method === 'email'} class={method === 'email' ? 'active' : ''} onClick={() => { setMethod('email'); setMessage(''); }}>{w('email')}</button><button type="button" role="tab" aria-selected={method === 'phone'} class={method === 'phone' ? 'active' : ''} onClick={() => { setMethod('phone'); setMessage(''); }}>{w('phone')}</button></div>
      {method === 'email'
        ? <form class="auth-form" onSubmit={submitEmail}>
            {isRegister && <label>{w('fullName')}<input autoComplete="name" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} required /></label>}
            <label>{w('emailAddr')}<input type="email" autoComplete="email" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} required /></label>
            <label>{w('password')}<span class="password-wrap"><input type={showPassword ? 'text' : 'password'} autoComplete={isRegister ? 'new-password' : 'current-password'} minLength={6} value={password} onInput={(e) => setPassword((e.target as HTMLInputElement).value)} required /><button type="button" class="show-password" onClick={() => setShowPassword(!showPassword)}>{w(showPassword ? 'hide' : 'show')}</button></span></label>
            {!isRegister && <button type="button" class="forgot-link" onClick={resetPassword} disabled={busy}>{w('forgot')}</button>}
            <button class="auth-submit" type="submit" disabled={busy}>{busy ? w('wait') : w(isRegister ? 'create' : 'login')} <span aria-hidden="true">→</span></button>
          </form>
        : <div class="auth-form">
            <label>{w('phoneNo')} <span class="country-phone"><select aria-label="Country code" value={countryCode} onChange={(e) => setCountryCode((e.target as HTMLSelectElement).value)} disabled={!!confirmation}><option value="+91">India (+91)</option><option value="+880">Bangladesh (+880)</option><option value="+977">Nepal (+977)</option><option value="+94">Sri Lanka (+94)</option><option value="+971">UAE (+971)</option><option value="+1">US/Canada (+1)</option><option value="+44">UK (+44)</option></select><input type="tel" autoComplete="tel-national" inputMode="numeric" placeholder="98765 43210" value={phone} onInput={(e) => setPhone((e.target as HTMLInputElement).value)} aria-label={w('phoneNo')} disabled={!!confirmation} required /></span></label>
            {confirmation && <form onSubmit={verifyOtp}>
              <label>{w('code')}<input autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={otp} onInput={(e) => setOtp((e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 6))} required /></label>
              <button class="auth-submit" type="submit" disabled={busy || otp.length < 6}>{busy ? w('verifying') : w('verify')} <span aria-hidden="true">→</span></button>
              <button type="button" class="forgot-link" disabled={busy || cooldown > 0} onClick={() => void sendOtp()}>{cooldown > 0 ? w('resendIn').replace('{0}', String(cooldown)) : w('resend')}</button>
              <button type="button" class="forgot-link" onClick={() => { setConfirmation(null); setOtp(''); setMessage(''); }}>{w('changePhone')}</button>
            </form>}
            {!confirmation && <button class="auth-submit" type="button" disabled={busy || digits < 6 || digits > 14} onClick={() => void sendOtp()}>{busy ? w('sending') : w('send')} <span aria-hidden="true">→</span></button>}
          </div>}
      <div id="setu-recaptcha" />
      {message && <p class={message === w('sent') || message === w('resetSent') ? 'auth-message success' : 'auth-message'} role="status">{message}</p>}
      <p class="auth-switch">{w(isRegister ? 'have' : 'new')} <Link href={isRegister ? '/login' : '/register'}>{w(isRegister ? 'login' : 'makeOne')}</Link></p>
      <div class="auth-skip"><button type="button" class="skip-button" onClick={onSkip}>{w('skip')} →</button><p>{w('skipNote')}</p></div>
    </div></section>
  </main>;
}

function authMessage(error: unknown, w: (k: string) => string): string {
  const code = (error as { code?: string })?.code ?? '';
  const key: Record<string, string> = {
    'auth/invalid-email': 'badEmail', 'auth/invalid-credential': 'badLogin', 'auth/user-not-found': 'badLogin', 'auth/wrong-password': 'badLogin',
    'auth/email-already-in-use': 'inUse', 'auth/weak-password': 'weak', 'auth/popup-closed-by-user': 'popup', 'auth/cancelled-popup-request': 'popup',
    'auth/invalid-phone-number': 'badPhone', 'auth/too-many-requests': 'tooMany', 'auth/invalid-verification-code': 'badCode', 'auth/code-expired': 'badCode',
    'auth/network-request-failed': 'net', 'auth/unauthorized-domain': 'domain', 'auth/captcha-check-failed': 'domain', 'auth/operation-not-allowed': 'disabled', 'auth/configuration-not-found': 'disabled',
  };
  return `${w(key[code] ?? 'failed')}${code && !key[code] ? ` (${code})` : ''}`;
}

function GoogleMark() { return <svg width="19" height="19" viewBox="0 0 48 48" aria-hidden="true"><path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5.1h6.7c3.9-3.6 6-8.8 6-15Z"/><path fill="#34A853" d="M24 44c5.5 0 10.1-1.8 13.5-4.8l-6.7-5.1c-1.8 1.2-4 1.9-6.8 1.9-5.2 0-9.6-3.5-11.2-8.2H5.9v5.2A20 20 0 0 0 24 44Z"/><path fill="#FBBC05" d="M12.8 27.8a12 12 0 0 1 0-7.6V15H5.9a20 20 0 0 0 0 17.9l6.9-5.1Z"/><path fill="#EA4335" d="M24 12.1c3 0 5.7 1 7.8 3.1l5.9-5.9C34.1 6 29.5 4 24 4A20 20 0 0 0 5.9 15l6.9 5.2c1.6-4.7 6-8.1 11.2-8.1Z"/></svg>; }
