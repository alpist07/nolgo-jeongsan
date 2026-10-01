import { getDatabase } from "firebase-admin/database";
import { adminApp } from "./lib/firebaseAdmin.mjs";
import { sendToUids } from "./lib/messaging.mjs";
import { computeSettlement } from "./lib/settlement.mjs";
import { formatWon } from "./lib/format.mjs";

// Must match src/state/RoomContext.tsx's DEFAULT_ROOM_ID — this app serves
// one shared friend group in a single hardcoded room, not many independent
// rooms.
const DEFAULT_ROOM_ID = "room-78664b1a-5e50-4758-80b0-5645e1000e5d";
const REMIND_AFTER_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

// Runs daily (rather than "every 3 days") and checks elapsed time itself —
// a fixed 3-day cron would drift or get skipped across deploys/downtime,
// while a daily check against a stored last-sent timestamp self-heals.
export const config = { schedule: "@daily" };

export default async () => {
  const db = getDatabase(adminApp());
  const roomSnap = await db.ref(`rooms/${DEFAULT_ROOM_ID}`).get();
  if (!roomSnap.exists()) return new Response("no room", { status: 200 });

  const room = roomSnap.val();
  const meetings = room.meetings && typeof room.meetings === "object" ? room.meetings : {};
  const now = Date.now();
  const updates = {};
  const sends = [];

  for (const [meetingId, meeting] of Object.entries(meetings)) {
    const memberLinks = meeting?.state?.memberLinks || {};
    const { transfers } = computeSettlement(meeting);
    for (const transfer of transfers) {
      if (transfer.completed) continue;
      // only the debtor (from) gets a reminder — the person owed money
      // doesn't need a "you're unsettled" nudge.
      const uid = memberLinks[transfer.from];
      if (!uid) continue; // not linked to an account via an invite link yet

      const lastSentAt = meeting?.state?.unsettledReminders?.[uid]?.[transfer.key] || 0;
      if (now - lastSentAt < REMIND_AFTER_MS) continue;

      sends.push(
        sendToUids(
          [uid],
          "미정산 알림",
          `${transfer.to}님에게 아직 ${formatWon(transfer.amount)}을 보내지 않았어요`
        )
      );
      updates[`rooms/${DEFAULT_ROOM_ID}/meetings/${meetingId}/state/unsettledReminders/${uid}/${transfer.key}`] = now;
    }
  }

  await Promise.all(sends);
  if (Object.keys(updates).length > 0) await db.ref().update(updates);

  return new Response("ok", { status: 200 });
};
