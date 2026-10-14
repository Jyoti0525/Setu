// Who is signed in (Firebase Authentication: email + password, Google, phone OTP). Checking a sign-in needs only the
// project id: firebase-admin checks the token's signature against Google's public keys, so no service-account key
// is needed. Unset FIREBASE_PROJECT_ID → no check; learning still works on the device token alone.
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

export interface FirebaseIdentity {
  uid: string;
  email?: string;
  name?: string;
  emailVerified: boolean;
}

export interface FirebaseTokenVerifier {
  verifyIdToken(token: string): Promise<FirebaseIdentity>;
}

export function createFirebaseTokenVerifier(
  projectId = process.env.FIREBASE_PROJECT_ID,
  serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
): FirebaseTokenVerifier | undefined {
  if (!projectId) return undefined;
  const app = getApps().find((a) => a.name === 'setu-firebase-auth')
    ?? initializeApp({ projectId, ...(serviceAccountJson ? { credential: cert(JSON.parse(serviceAccountJson)) } : {}) }, 'setu-firebase-auth');
  const auth = getAuth(app);
  return {
    async verifyIdToken(token) {
      const d = await auth.verifyIdToken(token);
      return { uid: d.uid, ...(d.email ? { email: d.email } : {}), ...(d.name ? { name: d.name } : {}), emailVerified: d.email_verified ?? false };
    },
  };
}
