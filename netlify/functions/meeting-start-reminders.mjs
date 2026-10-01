import { getDatabase } from "firebase-admin/database";
import { adminApp } from "./lib/firebaseAdmin.mjs";
import { broadcastNotification } from "./lib/messaging.mjs";

// "N분 전" reminder for each entry in a crew's state.schedules list (see
// src/state/types.ts's Schedule — a crew can have multiple 약속/일정,
// each with its own name/place/date/time), running as a Netlify Scheduled
// Function instead of a Cloud Functions scheduler trigger.
const DEFAULT_REMINDER_MINUTES = [10, 60];

function reminderLabel(minutes) {
  if (minutes % 1440 === 0) return `${minutes / 1440}일`;
  if (minutes % 60 === 0) return `${minutes / 60}시간`;
  return `${minutes}분`;
}

function reminderThresholds(scheduleSnap) {
  const configured = scheduleSnap.child("remindersConfigured").val() === true;
  const saved = scheduleSnap.child("reminderMinutes").val();
  const values = configured ? (Array.isArray(saved) ? saved : []) : DEFAULT_REMINDER_MINUTES;
  return [...new Set(values.map(Number))]
    .filter((minutes) => Number.isInteger(minutes) && minutes > 0 && minutes <= 10080)
    .map((minutesBefore) => ({ minutesBefore, key: `${minutesBefore}m`, label: reminderLabel(minutesBefore) }));
}

// Schedule date/time is stored as plain "YYYY-MM-DD" + "HH:mm" (Korea-local,
// no timezone info) — this app has one audience (KST), so interpret them as
// KST explicitly rather than relying on the function's runtime timezone.
function scheduleStartMs(date, time) {
  if (!date || !time) return null;
  const ms = new Date(`${date}T${time}:00+09:00`).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export const config = { schedule: "*/5 * * * *" };

export default async () => {
  const db = getDatabase(adminApp());
  const roomsSnap = await db.ref("rooms").get();
  if (!roomsSnap.exists()) return new Response("no rooms", { status: 200 });

  const now = Date.now();
  const updates = {};
  const pendingNotifications = [];

  roomsSnap.forEach((roomSnap) => {
    const roomId = roomSnap.key;
    roomSnap.child("meetings").forEach((meetingSnap) => {
      const meetingId = meetingSnap.key;
      meetingSnap.child("state/schedules").forEach((scheduleSnap) => {
        const scheduleId = scheduleSnap.key;
        const date = scheduleSnap.child("date").val();
        const time = scheduleSnap.child("time").val();
        const name = scheduleSnap.child("name").val();
        const place = scheduleSnap.child("place").val();
        if (!date || !time || !roomId || !meetingId || !scheduleId) return false;

        const startMs = scheduleStartMs(date, time);
        if (startMs === null || startMs <= now) return false;

        const minutesUntilStart = (startMs - now) / 60000;
        for (const threshold of reminderThresholds(scheduleSnap)) {
          if (minutesUntilStart > threshold.minutesBefore) continue;
          const alreadySent = scheduleSnap.child(`remindersSent/${threshold.key}`).val() === true;
          if (alreadySent) continue;

          updates[
            `rooms/${roomId}/meetings/${meetingId}/state/schedules/${scheduleId}/remindersSent/${threshold.key}`
          ] = true;
          const body = `${name || "약속"}${place ? ` (${place})` : ""} 시작 ${threshold.label} 전입니다`;
          pendingNotifications.push(broadcastNotification("일정이 곧 시작해요", body));
        }
        return false;
      });
    });
    return false;
  });

  await Promise.all(pendingNotifications);
  if (Object.keys(updates).length > 0) await db.ref().update(updates);
  return new Response("ok", { status: 200 });
};
