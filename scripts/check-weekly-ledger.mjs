// The weekly ledger's arithmetic, checked directly against the real module.
//
//   node --experimental-strip-types scripts/check-weekly-ledger.mjs
//
// Runs in `npm run lint`. Node strips the TypeScript itself, so the check
// imports src/weeklyLedger.ts as shipped rather than a copy that can drift.
//
// This is money and hours owed, so the cases that matter are the awkward ones:
// a meter that was never read, a meter that went backwards, a week logged
// beyond what it owed, and somebody splitting a week between two projects that
// pay different rates.
import {
  PROJECT_DEFAULTS,
  emptyProject,
  fridayOnOrBefore,
  toDateKey,
  fromDateKey,
  weeksTouchingMonth,
  isInWeek,
  parseMeter,
  formatMeter,
  projectTotals,
  weekTotals,
  memberTotals,
  suggestedAgnusTasks,
} from '../src/weeklyLedger.ts';

let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

// ─── Week boundaries ─────────────────────────────────────────────────────────

// 2026-08-07 is a Friday.
check(toDateKey(fridayOnOrBefore(new Date(2026, 7, 7))) === '2026-08-07',
  'a Friday is its own week start');
check(toDateKey(fridayOnOrBefore(new Date(2026, 7, 13))) === '2026-08-07',
  'the Thursday after belongs to that week');
check(toDateKey(fridayOnOrBefore(new Date(2026, 7, 14))) === '2026-08-14',
  'the next Friday starts a new week');
check(toDateKey(fridayOnOrBefore(new Date(2026, 7, 6))) === '2026-07-31',
  'the Thursday before belongs to the previous week');

check(isInWeek(new Date(2026, 7, 7), new Date(2026, 7, 7)), 'the Friday itself is in the week');
check(isInWeek(new Date(2026, 7, 13), new Date(2026, 7, 7)), 'the Thursday is in the week');
check(!isInWeek(new Date(2026, 7, 14), new Date(2026, 7, 7)), 'the following Friday is not');
check(!isInWeek(new Date(2026, 7, 6), new Date(2026, 7, 7)), 'the preceding Thursday is not');

// Every day of a month must belong to exactly one listed week, or the calendar
// has days nothing can be entered against.
const weeks = weeksTouchingMonth(2026, 7).map(fromDateKey);
let orphan = null;
let doubled = null;
for (let day = 1; day <= 31; day += 1) {
  const date = new Date(2026, 7, day);
  const hits = weeks.filter((friday) => isInWeek(date, friday)).length;
  if (hits === 0) orphan = day;
  if (hits > 1) doubled = day;
}
check(orphan === null, 'every day of the month falls in a listed week', `day ${orphan}`);
check(doubled === null, 'and in exactly one of them', `day ${doubled}`);

// Local midnight, not UTC — the bug that shifts a whole week by a day.
check(toDateKey(fromDateKey('2026-08-07')) === '2026-08-07', 'date keys survive a round trip');

// ─── The meter ───────────────────────────────────────────────────────────────

check(parseMeter('195:20') === 195 * 60 + 20, 'reads hours:minutes');
check(parseMeter('191') === 191 * 60, 'reads whole hours');
check(parseMeter('195.5') === 195 * 60 + 30, 'reads decimal hours');
check(parseMeter('') === null, 'blank is "not recorded", not zero');
check(parseMeter('  ') === null, 'and so is whitespace');
check(parseMeter('abc') === null, 'garbage is not recorded either');
check(parseMeter('195:75') === null, 'and neither is an impossible minute');
check(formatMeter(195 * 60 + 20) === '195:20', 'writes hours:minutes back');
check(formatMeter(null) === '', 'and nothing at all for a missing reading');

// ─── One project ─────────────────────────────────────────────────────────────

const agnus = (over = {}) => ({ ...emptyProject('w', 'agnus'), ...over });

// The example from the brief: started at 191, now 195:20 → 4h20m logged.
const brief = projectTotals(
  agnus({ tasks_done: 3, tracker_start_minutes: 191 * 60, tracker_end_minutes: 195 * 60 + 20 }),
  []
);
check(brief.earnedHours === 6, 'three AGNUS tasks are worth six hours', `${brief.earnedHours}`);
check(brief.loggedHours === 4.33, 'the meter difference is the hours logged', `${brief.loggedHours}`);
check(brief.remainingHours === 1.67, 'the rest carries forward', `${brief.remainingHours}`);
check(brief.taskPayUsd === 12, 'and they are worth $12', `${brief.taskPayUsd}`);

const unread = projectTotals(agnus({ tasks_done: 3 }), []);
check(unread.loggedHours === null, 'no reading means hours logged is unknown');
check(unread.remainingHours === null, 'so the remainder is unknown too, not the full debt');

const backwards = projectTotals(
  agnus({ tasks_done: 1, tracker_start_minutes: 200 * 60, tracker_end_minutes: 10 * 60 }),
  []
);
check(backwards.meterWentBackwards, 'a meter that went backwards is flagged');
check(backwards.loggedHours === null, 'and is not reported as negative or absolute hours');

const carried = projectTotals(agnus({
  tasks_done: 2, carry_in_hours: 5,
  tracker_start_minutes: 0, tracker_end_minutes: 60,
}), []);
check(carried.requiredHours === 9, 'hours owed from before are added on top', `${carried.requiredHours}`);
check(carried.remainingHours === 8, 'and are still owed after logging an hour', `${carried.remainingHours}`);

const over = projectTotals(agnus({
  tasks_done: 1, tracker_start_minutes: 0, tracker_end_minutes: 5 * 60,
}), []);
check(over.remainingHours === -3, 'logging more than owed carries a credit', `${over.remainingHours}`);

const bonused = projectTotals(agnus({ tasks_done: 2 }), [
  { id: 'b1', week_id: 'w', user_id: 'u1', project: 'agnus', amount_usd: 5, note: '', created: '' },
  { id: 'b2', week_id: 'w', user_id: 'u1', project: 'agnus', amount_usd: 2.5, note: '', created: '' },
  { id: 'b3', week_id: 'w', user_id: 'u1', project: 'chromium', amount_usd: 99, note: '', created: '' },
]);
check(bonused.bonusTasks === 2, 'bonused tasks are counted, not typed', `${bonused.bonusTasks}`);
check(bonused.bonusUsd === 7.5, 'their amounts are summed', `${bonused.bonusUsd}`);
check(bonused.totalUsd === 15.5, 'and added to the task pay', `${bonused.totalUsd}`);

// Postgres hands numerics back as strings often enough to matter.
const asStrings = projectTotals(
  agnus({ tasks_done: '2', hours_per_task: '2.00', usd_per_task: '4.00', carry_in_hours: '1.5' }),
  []
);
check(asStrings.earnedHours === 4 && asStrings.taskPayUsd === 8 && asStrings.requiredHours === 5.5,
  'numerics arriving as strings still add up',
  `${asStrings.earnedHours}h ${asStrings.taskPayUsd}$ ${asStrings.requiredHours}h`);

// ─── A whole week ────────────────────────────────────────────────────────────

const rows = [
  agnus({ tasks_done: 3, tracker_start_minutes: 0, tracker_end_minutes: 4 * 60 }),
  { ...emptyProject('w', 'chromium'), tasks_done: 2, tracker_start_minutes: 0, tracker_end_minutes: 6 * 60 },
];
const week = weekTotals(rows, []);
check(week.earnedHours === 14, 'the week is worth 3×2 + 2×4 = 14 hours', `${week.earnedHours}`);
check(week.loggedHours === 10, 'ten hours were logged across both', `${week.loggedHours}`);
check(week.remainingHours === 4, 'four roll into next week', `${week.remainingHours}`);
check(week.totalUsd === 28, 'and the week is worth $28', `${week.totalUsd}`);
check(!week.partial, 'nothing is missing');

const half = weekTotals([rows[0], emptyProject('w', 'chromium')], []);
check(half.partial, 'one unread meter makes the week partial');
check(half.loggedHours === 4, 'what is known is still totalled', `${half.loggedHours}`);
check(half.remainingHours === null, 'but the carry-over is withheld rather than guessed');

check(weekTotals([], []).totalUsd === 0, 'an untouched week is worth nothing');
check(weekTotals([], []).byProject.chromium.tasksDone === 0, 'and reports both projects anyway');

// ─── People ──────────────────────────────────────────────────────────────────

const people = [
  { id: 'u1', name: 'Nastaran' },
  { id: 'u2', name: 'Milad' },
];
const totals = memberTotals(
  people,
  [
    { week_id: 'w', user_id: 'u1', project: 'agnus', tasks_done: 3 },
    { week_id: 'w', user_id: 'u1', project: 'chromium', tasks_done: 1 },
    { week_id: 'w', user_id: 'u2', project: 'chromium', tasks_done: 2 },
  ],
  rows,
  [
    { id: 'b1', week_id: 'w', user_id: 'u1', project: 'agnus', amount_usd: 3, note: '', created: '' },
    { id: 'b2', week_id: 'w', user_id: 'u2', project: 'chromium', amount_usd: 10, note: '', created: '' },
  ]
);
const nastaran = totals.find((row) => row.userId === 'u1');
const milad = totals.find((row) => row.userId === 'u2');
check(nastaran.taskPayUsd === 20, 'each project pays at its own rate: 3×$4 + 1×$8', `${nastaran.taskPayUsd}`);
check(nastaran.totalUsd === 23, 'plus their bonus', `${nastaran.totalUsd}`);
check(nastaran.bonusTasks === 1, 'and one of their tasks had one', `${nastaran.bonusTasks}`);
check(milad.totalUsd === 26, 'the other is paid 2×$8 + $10', `${milad.totalUsd}`);

// The invariant worth having: when the per-person counts add up to the project
// counts, the two ways of totalling the week must agree to the cent. If they
// ever diverge, one side is using the wrong rate.
const perPerson = [
  { week_id: 'w', user_id: 'u1', project: 'agnus', tasks_done: 2 },
  { week_id: 'w', user_id: 'u2', project: 'agnus', tasks_done: 1 },
  { week_id: 'w', user_id: 'u1', project: 'chromium', tasks_done: 1 },
  { week_id: 'w', user_id: 'u2', project: 'chromium', tasks_done: 1 },
];
const sharedBonuses = [
  { id: 'b1', week_id: 'w', user_id: 'u1', project: 'agnus', amount_usd: 3, note: '', created: '' },
  { id: 'b2', week_id: 'w', user_id: 'u2', project: 'chromium', amount_usd: 10, note: '', created: '' },
];
const reconciled = weekTotals(rows, sharedBonuses);
const perPersonTotal = memberTotals(people, perPerson, rows, sharedBonuses)
  .reduce((total, row) => total + row.totalUsd, 0);
check(perPersonTotal === reconciled.totalUsd,
  'per-person pay reconciles with the project totals to the cent',
  `${perPersonTotal} vs ${reconciled.totalUsd}`);
check(reconciled.bonusTasks === 2, 'and the week counts both bonused tasks', `${reconciled.bonusTasks}`);

// ─── The AGNUS suggestion ────────────────────────────────────────────────────

const friday = new Date(2026, 7, 7);
const task = (over) => ({ status: 'approved', admin_verdict_date: '', updated: '', ...over });
const suggested = suggestedAgnusTasks([
  task({ admin_verdict_date: new Date(2026, 7, 7, 9).toISOString() }),
  task({ admin_verdict_date: new Date(2026, 7, 13, 23).toISOString() }),
  task({ admin_verdict_date: new Date(2026, 7, 14, 1).toISOString() }),
  task({ admin_verdict_date: new Date(2026, 7, 6, 23).toISOString() }),
  task({ status: 'in_review', admin_verdict_date: new Date(2026, 7, 8).toISOString() }),
  task({ updated: new Date(2026, 7, 9).toISOString() }),
  task({ admin_verdict_date: 'nonsense' }),
], friday);
check(suggested === 3, 'counts approvals inside the week, falling back to updated', `${suggested}`);

check(PROJECT_DEFAULTS.agnus.hoursPerTask === 2 && PROJECT_DEFAULTS.agnus.usdPerTask === 4,
  'AGNUS defaults to 2 hours and $4 a task');
check(PROJECT_DEFAULTS.chromium.hoursPerTask === 4 && PROJECT_DEFAULTS.chromium.usdPerTask === 8,
  'Chromium defaults to 4 hours and $8 a task');

console.log(failures ? `\n${failures} check(s) failed.` : `\nWeekly ledger: all checks passed.`);
process.exit(failures ? 1 : 0);
