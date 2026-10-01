import { getAuth } from "firebase-admin/auth";
import { adminApp } from "./lib/firebaseAdmin.mjs";
import { broadcastNotification } from "./lib/messaging.mjs";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// Called explicitly by the app and the site right after a receipt is
// published or a meeting is created — replaces the (undeployable, Blaze
// plan required) onReceiptPublished / onMeetingCreate Cloud Functions'
// database-write triggers with an equivalent explicit call.
//
// This endpoint has no other gate before Firebase Cloud Messaging — anyone
// who could reach it unauthenticated could push arbitrary-titled
// notifications to every device in the group. Requiring a valid Firebase ID
// token ties every broadcast to a real signed-in project user (the app,
// site, and receipt pages all already sign users in — anonymously for the
// receipt pages — specifically so this check has something to verify).
export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: CORS_HEADERS, body: "Method Not Allowed" };
  }

  const authHeader = event.headers?.authorization || event.headers?.Authorization || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!idToken) {
    return { statusCode: 401, headers: CORS_HEADERS, body: "Missing bearer token" };
  }
  try {
    await getAuth(adminApp()).verifyIdToken(idToken);
  } catch (error) {
    console.error("notify-broadcast: token verification failed", error);
    return { statusCode: 401, headers: CORS_HEADERS, body: "Invalid token" };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers: CORS_HEADERS, body: "Invalid JSON" };
  }

  const title = String(payload.title || "").trim();
  const body = String(payload.body || "").trim();
  if (!title) {
    return { statusCode: 400, headers: CORS_HEADERS, body: "title is required" };
  }

  try {
    await broadcastNotification(title, body);
  } catch (error) {
    console.error("broadcastNotification failed", error);
    return { statusCode: 500, headers: CORS_HEADERS, body: "Failed to send notification" };
  }

  return { statusCode: 200, headers: CORS_HEADERS, body: "ok" };
};
