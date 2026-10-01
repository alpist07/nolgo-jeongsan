import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";

const databaseUrl = "https://nolgo-jeongsan-default-rtdb.firebaseio.com";

// Database rules require a signed-in user now — sign in silently (no UI
// change) so these REST calls keep working, authenticating each request via
// the RTDB REST API's documented ?auth=<idToken> query param.
const firebaseApp = initializeApp({
  apiKey: "AIzaSyCTSyhsP9twRE7kn5IZ317QII98Eqdm6IY",
  authDomain: "nolgo-jeongsan.firebaseapp.com",
  databaseURL: databaseUrl,
  projectId: "nolgo-jeongsan",
  storageBucket: "nolgo-jeongsan.firebasestorage.app",
  messagingSenderId: "735820612157",
  appId: "1:735820612157:web:0759d5df0b8926c953e054",
});
const firebaseAuth = getAuth(firebaseApp);
const authReady = (async () => {
  await firebaseAuth.authStateReady();
  if (!firebaseAuth.currentUser) await signInAnonymously(firebaseAuth);
})().catch((error) => {
  console.error("Anonymous sign-in failed", error);
});
async function authQuery(forceRefresh = false) {
  await authReady;
  const user = firebaseAuth.currentUser || (await signInAnonymously(firebaseAuth).catch(() => null))?.user;
  const token = await user?.getIdToken(forceRefresh).catch(() => null);
  return token ? `?auth=${token}` : "";
}

async function firebaseRequest(path, options) {
  let response = await fetch(`${databaseUrl}/${path}.json${await authQuery()}`, options);
  if (response.status === 401 || response.status === 403) {
    response = await fetch(`${databaseUrl}/${path}.json${await authQuery(true)}`, options);
  }
  return response;
}

// Matches the app's own DEFAULT_ROOM_ID (src/state/RoomContext.tsx) and
// 놀고정산.js's setupRoomId() — without this, opening history without a
// ?room= link falls back to a blank room and shows "저장된 영수증이
// 없습니다" even though the group's real receipts exist elsewhere.
const DEFAULT_ROOM_ID = "room-78664b1a-5e50-4758-80b0-5645e1000e5d";
const params = new URLSearchParams(location.search);
const roomId = String(params.get("room") || DEFAULT_ROOM_ID).replace(/[.#$/[\]]/g, "-");
const list = document.querySelector("#historyList");
let receipts = [];
let mode = "all";

const escapeHtml = (value) => String(value || "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const onlyNumber = (value) => Number(String(value || "").replace(/[^\d.-]/g, ""));
const formatWon = (value) => `${Math.round(value || 0).toLocaleString("ko-KR")}원`;
const receiptDate = (item) => item.mode === "budget" ? item.plannedDate : item.usedDate;
const receiptItems = (item) => {
  const preferred = item.mode === "budget" ? item.budgetItems : item.settlementItems;
  if (Array.isArray(preferred) && preferred.length) return preferred;
  const fallback = item.mode === "budget" ? item.settlementItems : item.budgetItems;
  if (Array.isArray(fallback) && fallback.length) return fallback;
  // the app (놀고정산앱) stores items as a single `items` array instead of
  // budgetItems/settlementItems — its amounts are compatible as-is for the
  // count/total this history list needs.
  return Array.isArray(item.items) ? item.items : [];
};
const receiptTotal = (item) => receiptItems(item).reduce((sum, row) => sum + onlyNumber(row.amount), 0);

function render() {
  const filtered = receipts.filter((item) => mode === "all" || item.mode === mode);
  list.innerHTML = filtered.length ? filtered.map((item) => {
    const query = new URLSearchParams({ id: item.receiptId });
    if (roomId) query.set("room", roomId);
    return `<div class="history-item">
      <a class="history-open" href="index.html?${query.toString()}">
        <span class="history-type ${item.mode}">${item.mode === "budget" ? "예산" : "정산"}</span>
        <span class="history-copy"><strong>${escapeHtml(item.title || (item.mode === "budget" ? "예산 영수증" : "정산 영수증"))}</strong><small>${escapeHtml(item.event || "모임 미지정")} · ${escapeHtml(receiptDate(item) || "날짜 미지정")}</small></span>
        <b>${formatWon(receiptTotal(item))}</b><span class="history-arrow history-edit-label">수정 ›</span>
      </a>
      <button class="history-delete" data-delete-receipt="${escapeHtml(item.receiptId)}" type="button">삭제</button>
    </div>`;
  }).join("") : '<div class="history-empty">저장된 영수증이 없습니다.</div>';
}

document.querySelector("#historyBack").href = `index.html${roomId ? `?room=${encodeURIComponent(roomId)}` : ""}`;
document.querySelectorAll("[data-history-mode]").forEach((button) => button.addEventListener("click", () => {
  mode = button.dataset.historyMode;
  document.querySelectorAll("[data-history-mode]").forEach((item) => item.classList.toggle("active", item === button));
  render();
}));

list.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-delete-receipt]");
  if (!button) return;
  const receiptId = button.dataset.deleteReceipt;
  if (!confirm("이 영수증을 삭제할까요? 연결된 지출내역도 함께 삭제됩니다.")) return;
  button.disabled = true;
  try {
    const target = receipts.find((item) => item.receiptId === receiptId);
    const targetRoomId = target?.roomId || roomId;
    if (targetRoomId) {
      const roomResponse = await firebaseRequest(`rooms/${encodeURIComponent(targetRoomId)}`);
      const room = roomResponse.ok ? await roomResponse.json() : null;
      // meetings is a keyed object ({ [meetingId]: meeting }), not an array —
      // matches the app/site's current schema (kept this way so Cloud
      // Functions can trigger on individual meeting creation).
      const meetingList = room?.meetings && typeof room.meetings === "object" ? Object.values(room.meetings) : [];
      // Only meetings that actually referenced this receipt need to be
      // written back — patching just those (via PATCH, Firebase's
      // multi-path update()) instead of PUT-ing the whole room means a
      // sibling crew that changed on another device between the read above
      // and this write can never be clobbered.
      const patch = {};
      meetingList.forEach((meeting) => {
        if (!Array.isArray(meeting?.state?.expenses)) return;
        const filtered = meeting.state.expenses.filter((item) => item?.receiptId !== receiptId);
        if (filtered.length === meeting.state.expenses.length) return;
        meeting.state.expenses = filtered;
        patch[`meetings/${meeting.id}`] = meeting;
      });
      if (Object.keys(patch).length) {
        patch.updatedAt = Date.now();
        await firebaseRequest(`rooms/${encodeURIComponent(targetRoomId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch)
        });
      }
    }
    const response = await firebaseRequest(`receipts/${encodeURIComponent(receiptId)}`, { method: "DELETE" });
    if (!response.ok) throw new Error("delete failed");
    receipts = receipts.filter((item) => item.receiptId !== receiptId);
    render();
  } catch {
    button.disabled = false;
    alert("영수증을 삭제하지 못했습니다.");
  }
});

try {
  const response = await firebaseRequest("receipts");
  if (!response.ok) throw new Error("영수증을 불러오지 못했습니다.");
  const data = await response.json();
  receipts = Object.entries(data || {}).map(([id, item]) => {
    const normalizedMode = item.mode === "budget" && !item.budgetItems?.length && item.settlementItems?.length ? "settlement" : item.mode;
    return { ...item, mode: normalizedMode, receiptId: item.receiptId || id };
  })
    .filter((item) => !roomId || item.roomId === roomId)
    .filter((item) => receiptItems(item).length > 0)
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
  render();
} catch {
  list.innerHTML = '<div class="history-empty">영수증을 불러오지 못했습니다.</div>';
}
