// Matches src/state/helpers.ts's formatWon.
export function formatWon(n) {
  return `${Math.round(n || 0).toLocaleString("ko-KR")}원`;
}
