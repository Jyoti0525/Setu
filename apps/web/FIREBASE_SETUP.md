# Firebase Authentication setup

The public site and authentication screens work without Firebase configuration. Account creation and sign-in become active after the following setup.

## 1. Add the web app configuration

In Firebase Console, open **Project settings → General → Your apps**, register a Web app if needed, and copy its web configuration into `apps/web/.env.local`. Use `apps/web/.env.example` as the template:

```dotenv
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=your-project-id.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_APP_ID=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
```

These are Firebase web-app configuration values and are included in the client bundle. Do not put service-account JSON, Admin SDK private keys, or other server credentials in this file. `.env.local` is git-ignored. Restart the Vite server after changing it.

## 2. Enable sign-in providers

In **Authentication → Sign-in method**, enable:

- **Email/Password** for registration, login, and password reset.
- **Google**, with the appropriate project support email.
- **Phone** for SMS one-time codes.

In **Authentication → Settings → Authorized domains**, confirm `localhost` is listed for local development. Add the production hostname before deployment. Firebase's Phone Auth web flow uses its reCAPTCHA verifier; it is rendered by the app when the user requests a code. SMS delivery and applicable Firebase quotas/billing are controlled by the Firebase project.

## 3. Run locally

From the repository root:

```sh
pnpm install
pnpm --filter @setu/web dev
```

Vite prints the local address (normally `http://localhost:5173`). Open `/` for the public page, `/login` to sign in, or `/register` to create an account. Authenticated sessions continue to `/dashboard`.

## Account and learner profile

Firebase Authentication manages identity. After the first sign-in on a device, Setu asks for the existing learner profile details (name, language, class, and optional class code) and stores the learning profile and learning history locally, as the current application does. The app does not currently have a server-side user-profile API or cloud database that maps Firebase identities to learner history, so signing in on a different device will require setting up a local learner profile there. No Firestore database was added as a second source of truth.

If Firebase reports that an email already uses a different provider during Google sign-in, the page asks the user to sign in with the existing method first and links Google to that Firebase account when possible. Other Firebase identity conflicts are shown as actionable errors.
