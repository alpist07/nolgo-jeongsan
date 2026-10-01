import { getDatabase } from "firebase-admin/database";
import { getMessaging } from "firebase-admin/messaging";
import { adminApp } from "./firebaseAdmin.mjs";

const STALE_TOKEN_ERROR_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-argument",
]);

// Ported from the app's (undeployable) functions/src/lib/messaging.ts —
// same broadcast-to-everyone behavior, since the app's data model doesn't
// link Firebase Auth uids to room membership (members are plain name
// strings inside a room) for most notifications.
export async function broadcastNotification(title, body) {
  const db = getDatabase(adminApp());
  const usersSnap = await db.ref("users").get();
  if (!usersSnap.exists()) return;

  const tokens = [];
  usersSnap.forEach((userSnap) => {
    const fcmTokens = userSnap.child("fcmTokens").val();
    if (fcmTokens) tokens.push(...Object.keys(fcmTokens));
    return false;
  });
  await sendAndPruneTokens(tokens, title, body);
}

// Targeted send for the unsettled-balance reminder (Part C) — only the
// given uids' devices, not everyone.
export async function sendToUids(uids, title, body) {
  if (uids.length === 0) return;
  const db = getDatabase(adminApp());
  const tokens = [];
  await Promise.all(
    uids.map(async (uid) => {
      const snap = await db.ref(`users/${uid}/fcmTokens`).get();
      const fcmTokens = snap.val();
      if (fcmTokens) tokens.push(...Object.keys(fcmTokens));
    })
  );
  await sendAndPruneTokens(tokens, title, body);
}

async function sendAndPruneTokens(rawTokens, title, body) {
  // the same device's token can end up registered under more than one uid
  // (e.g. logging into a different account on the same phone without
  // signing out first) — dedupe so that device only gets one push.
  const tokens = [...new Set(rawTokens)];
  if (tokens.length === 0) return;
  const db = getDatabase(adminApp());
  const messaging = getMessaging(adminApp());
  const res = await messaging.sendEachForMulticast({
    tokens,
    notification: { title, body },
  });

  const staleTokens = [];
  res.responses.forEach((r, i) => {
    if (!r.success && STALE_TOKEN_ERROR_CODES.has(r.error?.code)) {
      staleTokens.push(tokens[i]);
    }
  });
  if (staleTokens.length === 0) return;

  const usersSnap = await db.ref("users").get();
  const updates = {};
  usersSnap.forEach((userSnap) => {
    const fcmTokens = userSnap.child("fcmTokens").val();
    if (!fcmTokens) return false;
    for (const t of staleTokens) {
      if (fcmTokens[t]) updates[`users/${userSnap.key}/fcmTokens/${t}`] = null;
    }
    return false;
  });
  if (Object.keys(updates).length > 0) await db.ref().update(updates);
}
