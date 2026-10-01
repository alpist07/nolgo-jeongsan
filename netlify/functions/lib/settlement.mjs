// Plain-JS port of the app's src/state/settlement.ts computeSettlement —
// this codebase already has independent parallel implementations of the
// settlement math between the site (놀고정산.js's calculateTransfers) and
// the app, so duplicating it here for the scheduled reminder follows the
// same existing pattern rather than sharing a module across a build
// boundary. Keep in sync with src/state/settlement.ts if that logic changes.

export function transferKey(from, to) {
  return `${from}@@${to}`;
}

function splitMembersOf(e, allMembers) {
  return e.members && e.members.length ? e.members : allMembers;
}

export function computeSettlement(meeting) {
  const members = meeting.members || [];
  const expenses = meeting.state?.expenses || [];
  const incomes = meeting.state?.incomes || [];
  const completedTransfers = meeting.state?.completedTransfers || {};

  const paid = {};
  const owed = {};
  members.forEach((m) => {
    paid[m] = 0;
    owed[m] = 0;
  });

  const pairDebt = {};
  function addDebt(from, to, amt) {
    if (from === to || amt <= 0) return;
    const key = `${from}->${to}`;
    pairDebt[key] = (pairDebt[key] || 0) + amt;
  }

  for (const e of expenses) {
    if (e.fund) {
      const splitMembers = splitMembersOf(e, members);
      const share = e.amount / (splitMembers.length || members.length || 1);
      for (const mem of splitMembers) {
        if (owed[mem] === undefined) owed[mem] = 0;
        owed[mem] += share;
      }
      continue;
    }

    const fundUsed = Math.min(e.fundUsed || 0, e.amount);
    const personalAmount = e.amount - fundUsed;

    if (paid[e.payer] === undefined) paid[e.payer] = 0;
    paid[e.payer] += personalAmount;

    const splitMembers = splitMembersOf(e, members);
    const share = e.amount / (splitMembers.length || members.length || 1);
    for (const mem of splitMembers) {
      if (owed[mem] === undefined) owed[mem] = 0;
      owed[mem] += share;
    }

    const personalShare = personalAmount / (splitMembers.length || members.length || 1);
    for (const mem of splitMembers) {
      if (mem === e.payer) continue;
      addDebt(mem, e.payer, personalShare);
    }
  }

  for (const inc of incomes) {
    if (paid[inc.payer] === undefined) paid[inc.payer] = 0;
    paid[inc.payer] += inc.amount;
  }

  const transfers = [];
  const seen = new Set();
  for (const a of members) {
    for (const b of members) {
      if (a === b) continue;
      const pairKey = [a, b].sort().join("|");
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);
      const ab = pairDebt[`${a}->${b}`] || 0;
      const ba = pairDebt[`${b}->${a}`] || 0;
      const diff = ab - ba;
      if (Math.abs(diff) < 1) continue;
      const from = diff > 0 ? a : b;
      const to = diff > 0 ? b : a;
      const amount = Math.round(Math.abs(diff));
      if (amount <= 0) continue;
      const key = transferKey(from, to);
      transfers.push({ key, from, to, amount, completed: !!completedTransfers[key] });
    }
  }

  return { transfers };
}
