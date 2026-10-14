import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
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

/** Create a server verifier using Application Default Credentials or an explicit service account. */
export function createFirebaseTokenVerifier(
  projectId = process.env.FIREBASE_PROJECT_ID,
  serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
): FirebaseTokenVerifier | undefined {
  if (!projectId) return undefined;
  const existing = getApps().find((app) => app.name === 'setu-firebase-auth');
  const app = existing ?? initializeApp({
    projectId,
    credential: serviceAccountJson ? cert(JSON.parse(serviceAccountJson)) : applicationDefault(),
  }, 'setu-firebase-auth');
  const auth = getAuth(app);
  return {
    async verifyIdToken(token) {
      const decoded = await auth.verifyIdToken(token);
      return {
        uid: decoded.uid,
        ...(decoded.email ? { email: decoded.email } : {}),
        ...(decoded.name ? { name: decoded.name } : {}),
        emailVerified: decoded.email_verified ?? false,
      };
    },
  };
}
