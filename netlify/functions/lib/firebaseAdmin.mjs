import { initializeApp, cert, getApps } from "firebase-admin/app";

const DATABASE_URL = "https://nolgo-jeongsan-default-rtdb.firebaseio.com";

// Cloud Functions triggers can't be deployed on this Firebase project
// (Blaze plan required, unavailable), so push delivery lives here instead —
// a Netlify function using the Admin SDK to bypass database.rules.json
// (needed to read every user's fcmTokens, which per-uid rules otherwise
// block). Credentials come from a service-account JSON stored in the
// FIREBASE_SERVICE_ACCOUNT_JSON Netlify environment variable (Firebase
// console → Project settings → Service accounts → Generate new private key).
export function adminApp() {
  if (getApps().length) return getApps()[0];
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not set");
  const serviceAccount = JSON.parse(raw);
  return initializeApp({
    credential: cert(serviceAccount),
    databaseURL: DATABASE_URL,
  });
}
