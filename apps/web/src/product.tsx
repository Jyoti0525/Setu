import { useEffect, useRef, useState } from 'preact/hooks';
import { onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, updateProfile, GoogleAuthProvider, PhoneAuthProvider, linkWithCredential, signInWithPopup, RecaptchaVerifier, signInWithPhoneNumber, signOut, type AuthCredential, type ConfirmationResult, type User } from 'firebase/auth';
import { auth, firebaseConfigured } from './firebase.ts';
import type { FirebaseError } from 'firebase/app';
import { App as LearnerApp } from './app.tsx';
import { Logo } from './icons.tsx';

type Page = 'home' | 'login' | 'register' | 'dashboard';
const subjects = ['All Subjects', 'Geography and Economics', 'Life Science', 'Physical Science'];

function pageFromLocation(): Page {
  const path = location.pathname.replace(/\/$/, '') || '/';
  return path === '/login' || path === '/register' || path === '/dashboard' ? path.slice(1) as Page : 'home';
}
function go(path: string) { history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate')); window.scrollTo(0, 0); }
function Link({ href, children, className = '' }: { href: string; children: preact.ComponentChildren; className?: string }) {
  return <a class={className} href={href} onClick={(e) => { if (!e.metaKey && !e.ctrlKey && e.button === 0) { e.preventDefault(); go(href); } }}>{children}</a>;
}

export function ProductApp() {
  const [page, setPage] = useState<Page>(pageFromLocation());
  const [user, setUser] = useState<User | null>(null);
  const [pendingCredential, setPendingCredential] = useState<AuthCredential | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const pop = () => setPage(pageFromLocation());
    addEventListener('popstate', pop);
    if (!auth) { setReady(true); return () => removeEventListener('popstate', pop); }
    const off = onAuthStateChanged(auth, (u) => { setUser(u); setReady(true); });
    return () => { off(); removeEventListener('popstate', pop); };
  }, []);
  useEffect(() => {
    if (!ready) return;
    if (page === 'dashboard' && !user) go('/login');
    else if (page === 'home' && user) go('/dashboard');
    else if ((page === 'login' || page === 'register') && user) go('/dashboard');
  }, [page, user, ready]);
  if (!ready) return <main class="auth-loading" aria-label="Loading account"><Logo size={56} /><span>Loading Setu…</span></main>;
  if (page === 'dashboard') return user ? <LearnerApp accountId={user.uid} displayName={user.displayName} onLogout={async () => { await signOut(auth!); go('/login'); }} onProfileName={async (name) => { if (auth?.currentUser) await updateProfile(auth.currentUser, { displayName: name }); }} /> : <main class="auth-loading">Taking you to sign in…</main>;
  if (page === 'login' || page === 'register') return <AuthPage mode={page} pendingCredential={pendingCredential} setPendingCredential={setPendingCredential} />;
  return <Landing user={user} />;
}

function Landing({ user }: { user: User | null }) {
  return <div class="marketing">
    <header class="site-nav">
      <Link href="/" className="wordmark"><Logo size={34} /><span>Setu</span></Link>
      <nav aria-label="Main navigation"><a href="#about">About</a><a href="#subjects">Subjects</a></nav>
      <div class="nav-actions">{user ? <Link href="/dashboard" className="nav-login">Open learning</Link> : <><Link href="/login" className="nav-login">Log in</Link><Link href="/register" className="nav-cta">Get started</Link></>}</div>
    </header>
    <main>
      <section class="landing-hero">
        <div class="landing-copy"><p class="eyebrow">A clearer way to learn</p><h1>Learning should bring you closer to your future.</h1><p class="landing-lede">Your subjects. Your resources. Your progress. Setu brings your learning together in one simple place.</p><div class="hero-actions"><Link href={user ? '/dashboard' : '/register'} className="nav-cta">{user ? 'Open Setu' : 'Get started'} <span aria-hidden="true">→</span></Link><a class="text-action" href="#subjects">Explore subjects <span aria-hidden="true">↓</span></a></div><p class="hero-note">A study companion built around your books and learning pace.</p></div>
        <div class="preview-wrap" aria-label="Preview of the Setu subject list"><div class="preview-head"><span class="preview-brand"><Logo size={24} /> Setu</span><span>YOUR SUBJECTS</span></div><div class="preview-title"><span>Learning space</span><strong>Start with a subject</strong><p>Choose what you want to explore today.</p></div><div class="preview-list">{subjects.map((s, i) => <div class="preview-row"><span class="row-index">0{i + 1}</span><strong>{s}</strong><span aria-hidden="true">↗</span></div>)}</div><div class="preview-foot">Your books, ready when you are.</div></div>
      </section>
      <section id="about" class="about-section"><div class="section-intro"><p class="eyebrow">A bridge to what comes next</p><h2>Everything you need to keep learning, in one place.</h2></div><div class="capability-list"><article><span>01</span><div><h3>Explore your subjects</h3><p>Find your learning areas in an organized interface, so it is easier to get to the material you need.</p></div></article><article><span>02</span><div><h3>Learn with your textbooks</h3><p>Ask questions about available textbook material and get explanations grounded in the books Setu has.</p></div></article><article><span>03</span><div><h3>See what you have worked on</h3><p>Use learning progress to revisit topics and continue your practice.</p></div></article><article><span>04</span><div><h3>Choose your language</h3><p>Set your learning language and change it as you go.</p></div></article></div></section>
      <section id="subjects" class="subject-section"><div class="section-intro"><p class="eyebrow">Start anywhere</p><h2>Your learning, organized by subject.</h2><p>Preview the areas available in Setu. Sign in to continue into the learning space.</p></div><div class="public-subject-list">{subjects.map((s) => <div><span>{s}</span><Link href={user ? '/dashboard' : '/register'}>{user ? 'Open' : 'Explore'} <span aria-hidden="true">→</span></Link></div>)}</div></section>
      <section class="closing-cta"><p class="eyebrow">Your next step</p><h2>Take the next step in your learning.</h2><p>Create your Setu account and bring your learning into one place.</p><Link href={user ? '/dashboard' : '/register'} className="nav-cta">{user ? 'Open Setu' : 'Get started with Setu'} <span aria-hidden="true">→</span></Link></section>
    </main>
    <footer class="site-footer"><Link href="/" className="wordmark"><Logo size={28} /><span>Setu</span></Link><span>Learning, connected.</span><nav aria-label="Footer"><a href="#about">About</a><Link href="/login">Log in</Link><Link href="/register">Register</Link></nav></footer>
  </div>;
}

function AuthPage({ mode, pendingCredential, setPendingCredential }: { mode: 'login' | 'register'; pendingCredential: AuthCredential | null; setPendingCredential: (credential: AuthCredential | null) => void }) {
  const isRegister = mode === 'register';
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
  const firebaseRequired = () => { if (!auth) { setMessage('Firebase is not configured yet. Add the VITE_FIREBASE_* values to apps/web/.env.local and restart the app.'); return false; } return true; };
  const finishWithPendingLink = async (signedInUser: User) => { if (!pendingCredential) return; await linkWithCredential(signedInUser, pendingCredential); setPendingCredential(null); };
  const run = async (task: () => Promise<User | void>) => { setMessage(''); setBusy(true); try { const signedIn = await task(); if (signedIn) await finishWithPendingLink(signedIn); go('/dashboard'); } catch (e) { const pending = PhoneAuthProvider.credentialFromError(e as FirebaseError); if (pending) { setPendingCredential(pending); setMessage('This phone is already linked to an account. Sign in with that account’s other method to connect this phone number.'); } else setMessage(authMessage(e)); } finally { setBusy(false); } };
  const submitEmail = (e: Event) => { e.preventDefault(); if (!firebaseRequired()) return; void run(async () => {
    if (isRegister) { const credential = await createUserWithEmailAndPassword(auth!, email.trim(), password); if (name.trim()) await updateProfile(credential.user, { displayName: name.trim() }); return credential.user; }
    const credential = await signInWithEmailAndPassword(auth!, email.trim(), password); await finishWithPendingLink(credential.user); return;
  }); };
  const google = () => { if (!firebaseRequired()) return; setMessage(''); setBusy(true); void (async () => { try { const provider = new GoogleAuthProvider(); const credential = await signInWithPopup(auth!, provider); await finishWithPendingLink(credential.user); go('/dashboard'); } catch (e) { const pending = GoogleAuthProvider.credentialFromError(e as FirebaseError); if (pending) { setPendingCredential(pending); setMessage('This email already has another sign-in method. Sign in with it here and Setu will connect Google to that account.'); } else setMessage(authMessage(e)); } finally { setBusy(false); } })(); };
  const sendOtp = async () => {
    if (!firebaseRequired()) return;
    setMessage(''); setBusy(true);
    try {
      verifier.current?.clear(); verifier.current = new RecaptchaVerifier(auth!, 'setu-recaptcha', { size: 'invisible' });
      const full = `${countryCode}${phone.replace(/\D/g, '').replace(/^0+/, '')}`;
      const result = await signInWithPhoneNumber(auth!, full, verifier.current);
      setConfirmation(result); setCooldown(60); setMessage('A verification code has been sent to your phone.');
    } catch (e) { verifier.current?.clear(); verifier.current = null; setMessage(authMessage(e)); }
    finally { setBusy(false); }
  };
  const verifyOtp = (e: Event) => { e.preventDefault(); if (!confirmation) return; void run(async () => { const credential = await confirmation.confirm(otp.trim()); await finishWithPendingLink(credential.user); return; }).then(() => {}); };
  const resetPassword = () => { if (!firebaseRequired()) return; if (!email.trim()) { setMessage('Enter your email address first, then choose Forgot password.'); return; } void (async () => { setBusy(true); setMessage(''); try { await sendPasswordResetEmail(auth!, email.trim()); setMessage('If an account uses that address, a reset link is on its way.'); } catch (e) { setMessage(authMessage(e)); } finally { setBusy(false); } })(); };
  return <main class="auth-page"><div class="auth-side"><Link href="/" className="wordmark"><Logo size={36} /><span>Setu</span></Link><div><p class="eyebrow">A bridge to your books</p><h1>{isRegister ? 'Make room for learning.' : 'Welcome back.'}</h1><p>Keep your subjects and study sessions together, in one simple place.</p></div><Link href="/" className="auth-back">← Back to Setu</Link></div><section class="auth-panel"><div class="auth-card"><p class="eyebrow">{isRegister ? 'Create your account' : 'Your learning space'}</p><h2>{isRegister ? 'Get started' : 'Welcome back'}</h2><p class="auth-subtitle">{isRegister ? 'Choose how you would like to sign up.' : 'Sign in to continue learning.'}</p>
    <button class="google-button" type="button" disabled={busy} onClick={google}><GoogleMark /> Continue with Google</button><div class="auth-divider"><span>or continue with</span></div>
    <div class="method-tabs" role="tablist" aria-label="Sign-in method"><button type="button" role="tab" aria-selected={method === 'email'} class={method === 'email' ? 'active' : ''} onClick={() => { setMethod('email'); setMessage(''); }}>Email</button><button type="button" role="tab" aria-selected={method === 'phone'} class={method === 'phone' ? 'active' : ''} onClick={() => { setMethod('phone'); setMessage(''); }}>Phone</button></div>
    {method === 'email' ? <form class="auth-form" onSubmit={submitEmail}>{isRegister && <label>Full name<input autoComplete="name" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} required /></label>}<label>Email address<input type="email" autoComplete="email" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} required /></label><label>Password<span class="password-wrap"><input type={showPassword ? 'text' : 'password'} autoComplete={isRegister ? 'new-password' : 'current-password'} minLength={6} value={password} onInput={(e) => setPassword((e.target as HTMLInputElement).value)} required /><button type="button" class="show-password" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? 'Hide' : 'Show'}</button></span></label>{!isRegister && <button type="button" class="forgot-link" onClick={resetPassword} disabled={busy}>Forgot password?</button>}<button class="auth-submit" type="submit" disabled={busy}>{busy ? 'Please wait…' : isRegister ? 'Create account' : 'Log in'} <span aria-hidden="true">→</span></button></form> : <div class="auth-form"><label>Phone number <span class="country-phone"><select aria-label="Country calling code" value={countryCode} onChange={(e) => setCountryCode((e.target as HTMLSelectElement).value)} disabled={!!confirmation}><option value="+91">India (+91)</option><option value="+1">United States/Canada (+1)</option><option value="+44">United Kingdom (+44)</option><option value="+61">Australia (+61)</option><option value="+880">Bangladesh (+880)</option><option value="+977">Nepal (+977)</option><option value="+94">Sri Lanka (+94)</option><option value="+971">UAE (+971)</option></select><input type="tel" autoComplete="tel-national" inputMode="numeric" placeholder="98765 43210" value={phone} onInput={(e) => setPhone((e.target as HTMLInputElement).value)} aria-label="Phone number" disabled={!!confirmation} required /></span></label>{confirmation && <form onSubmit={verifyOtp}><label>Verification code<input autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={otp} onInput={(e) => setOtp((e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 6))} required /></label><button class="auth-submit" type="submit" disabled={busy || otp.length < 6}>{busy ? 'Verifying…' : 'Verify and continue'} <span aria-hidden="true">→</span></button><button type="button" class="forgot-link" disabled={busy || cooldown > 0} onClick={() => void sendOtp()}>{cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}</button><button type="button" class="forgot-link" onClick={() => { setConfirmation(null); setOtp(''); setMessage(''); }}>Change phone number</button></form>}{!confirmation && <button class="auth-submit" type="button" disabled={busy || phone.replace(/\D/g, '').length < 6 || phone.replace(/\D/g, '').length > 14} onClick={() => void sendOtp()}>{busy ? 'Sending code…' : 'Send verification code'} <span aria-hidden="true">→</span></button>}</div>}
    <div id="setu-recaptcha" />{message && <p class={message.startsWith('A verification') ? 'auth-message success' : 'auth-message'} role="status">{message}</p>}{!firebaseConfigured && <p class="setup-note">Authentication needs your Firebase web configuration. The setup is documented in <code>apps/web/.env.example</code>.</p>}<p class="auth-switch">{isRegister ? 'Already have an account?' : 'New to Setu?'} <Link href={isRegister ? '/login' : '/register'}>{isRegister ? 'Log in' : 'Create an account'}</Link></p></div></section></main>;
}

function authMessage(error: unknown): string {
  const code = (error as { code?: string })?.code ?? '';
  const known: Record<string, string> = {
    'auth/invalid-email': 'Enter a valid email address.', 'auth/invalid-credential': 'That email and password combination was not recognized.', 'auth/user-not-found': 'That email and password combination was not recognized.', 'auth/wrong-password': 'That email and password combination was not recognized.', 'auth/email-already-in-use': 'An account already uses that email. Try logging in instead.', 'auth/weak-password': 'Choose a password with at least 6 characters.', 'auth/popup-closed-by-user': 'Google sign-in was closed before it finished.', 'auth/popup-blocked': 'Your browser blocked the Google sign-in window. Allow popups and try again.', 'auth/account-exists-with-different-credential': 'This email already uses another sign-in method. Log in with that method first, then link providers in your account settings.', 'auth/invalid-phone-number': 'Enter a valid 10-digit Indian phone number.', 'auth/too-many-requests': 'Too many attempts. Wait a little before trying again.', 'auth/invalid-verification-code': 'That verification code did not match. Check it and try again.', 'auth/code-expired': 'That code has expired. Request a new one.', 'auth/network-request-failed': 'Check your internet connection and try again.', 'auth/unauthorized-domain': 'This domain is not authorized in Firebase Authentication settings.',
  };
  return known[code] ?? 'We could not complete sign-in. Check your details and Firebase settings, then try again.';
}

function GoogleMark() { return <svg width="19" height="19" viewBox="0 0 48 48" aria-hidden="true"><path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5.1h6.7c3.9-3.6 6-8.8 6-15Z"/><path fill="#34A853" d="M24 44c5.5 0 10.1-1.8 13.5-4.8l-6.7-5.1c-1.8 1.2-4 1.9-6.8 1.9-5.2 0-9.6-3.5-11.2-8.2H5.9v5.2A20 20 0 0 0 24 44Z"/><path fill="#FBBC05" d="M12.8 27.8a12 12 0 0 1 0-7.6V15H5.9a20 20 0 0 0 0 17.9l6.9-5.1Z"/><path fill="#EA4335" d="M24 12.1c3 0 5.7 1 7.8 3.1l5.9-5.9C34.1 6 29.5 4 24 4A20 20 0 0 0 5.9 15l6.9 5.2c1.6-4.7 6-8.1 11.2-8.1Z"/></svg>; }
