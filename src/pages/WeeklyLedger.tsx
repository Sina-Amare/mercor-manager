import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CalendarDays, Loader2 } from 'lucide-react';
import { useAppStore, useLanguageStore, useToastStore } from '../store';
import {
  addBonus,
  ensureWeek,
  fetchLedger,
  removeBonus,
  saveWeekMembers,
  saveWeekNotes,
  saveWeekProject,
  subscribeToLedger,
  type LedgerSnapshot,
} from '../api/weeklyLedger';
import {
  PROJECTS,
  currentWeekKey,
  fromDateKey,
  suggestedAgnusTasks,
  toDateKey,
  weekIdFor,
  weekTotals,
  type ProjectKey,
  type WorkWeekMember,
  type WorkWeekProject,
} from '../weeklyLedger';
import { formatCurrency, formatNumber, usdToIrr } from '../utils/dates';
import LedgerCalendar from '../components/ledger/LedgerCalendar';
import WeekPanel from '../components/ledger/WeekPanel';

const EMPTY: LedgerSnapshot = { weeks: [], projects: [], members: [], bonuses: [] };

/**
 * Hours owed and money due, a week at a time.
 *
 * The ledger is deliberately its own page and its own tables rather than an
 * extension of Payments: Payments answers "what is this task worth", and this
 * answers "how many hours must appear in the tracker this week and what does
 * the week come to" — including for Chromium, which the panel knows nothing
 * else about.
 */
export default function WeeklyLedger() {
  const { t, language } = useLanguageStore();
  const { members, settings, tasks } = useAppStore();
  const { addToast } = useToastStore();

  const [snapshot, setSnapshot] = useState<LedgerSnapshot>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);

  const today = new Date();
  const [month, setMonth] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [selectedWeek, setSelectedWeek] = useState<string>(currentWeekKey());

  const team = useMemo(
    () => members.filter((member) => member.is_active).sort((a, b) => a.name.localeCompare(b.name)),
    [members]
  );

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await fetchLedger());
      setLoadError('');
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t('ledger.load_error'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    let active = true;
    void refresh();

    const unsubscribe = subscribeToLedger(
      () => {
        if (active) void refresh();
      },
      (status) => {
        if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'CLOSED') {
          if (active) void refresh();
        }
      }
    );

    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      active = false;
      window.removeEventListener('focus', onFocus);
      unsubscribe();
    };
  }, [refresh]);

  // Read by the create-week effect without becoming a dependency of it.
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  const weekId = weekIdFor(selectedWeek);
  const friday = fromDateKey(selectedWeek);

  const weekProjects = snapshot.projects.filter((row) => row.week_id === weekId);
  const weekMembers = snapshot.members.filter((row) => row.week_id === weekId);
  const weekBonuses = snapshot.bonuses.filter((row) => row.week_id === weekId);
  const weekRow = snapshot.weeks.find((row) => row.id === weekId);

  const weeksWithData = useMemo(
    () => new Set(snapshot.weeks.map((row) => row.starts_on)),
    [snapshot.weeks]
  );

  /** What the previous week finished still owing, per project. */
  const carryFromLastWeek = useMemo(() => {
    const previousKey = toDateKey(
      new Date(friday.getFullYear(), friday.getMonth(), friday.getDate() - 7)
    );
    const previous = snapshot.projects.filter((row) => row.week_id === weekIdFor(previousKey));
    const map = {} as Record<ProjectKey, number | null>;
    const totals = weekTotals(previous, snapshot.bonuses.filter((b) => b.week_id === weekIdFor(previousKey)));
    for (const project of PROJECTS) map[project] = totals.byProject[project].remainingHours;
    return map;
  }, [friday, snapshot.bonuses, snapshot.projects]);

  const agnusSuggestion = useMemo(() => suggestedAgnusTasks(tasks, friday), [friday, tasks]);

  // Opening a week creates its rows, so the admin never has to "add" one first.
  //
  // Attempted at most once per week, tracked in a ref. `friday` is a fresh Date
  // and `snapshot.projects` a fresh array on every render, so depending on
  // either re-ran this effect continuously — and a failing ensureWeek then
  // retried, and toasted, without limit.
  const ensuredWeeks = useRef(new Set<string>());
  useEffect(() => {
    if (loading || weekRow || ensuredWeeks.current.has(selectedWeek)) return;
    ensuredWeeks.current.add(selectedWeek);

    let active = true;
    const start = fromDateKey(selectedWeek);
    const previousKey = toDateKey(
      new Date(start.getFullYear(), start.getMonth(), start.getDate() - 7)
    );
    const seed = snapshotRef.current.projects.filter(
      (row) => row.week_id === weekIdFor(previousKey)
    );
    void ensureWeek(selectedWeek, seed)
      .then(() => {
        if (active) return refresh();
      })
      .catch((error) => {
        // Let it be retried deliberately rather than in a loop.
        ensuredWeeks.current.delete(selectedWeek);
        addToast(error instanceof Error ? error.message : t('ledger.load_error'), 'error');
      });
    return () => {
      active = false;
    };
  }, [addToast, loading, refresh, selectedWeek, t, weekRow]);

  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      addToast(error instanceof Error ? error.message : t('ledger.save_error'), 'error');
    } finally {
      await refresh();
      setBusy(false);
    }
  };

  const handleSave = (draft: {
    projects: WorkWeekProject[];
    members: WorkWeekMember[];
    notes: string;
  }) =>
    run(async () => {
      await ensureWeek(selectedWeek);
      for (const project of draft.projects) {
        await saveWeekProject({ ...project, week_id: weekId });
      }
      await saveWeekMembers(draft.members.map((row) => ({ ...row, week_id: weekId })));
      if (draft.notes !== (weekRow?.notes ?? '')) await saveWeekNotes(weekId, draft.notes);
      addToast(t('ledger.saved'), 'success');
    });

  const [liveTotals, setLiveTotals] = useState<{
    requiredHours: number;
    loggedHours: number | null;
    remainingHours: number | null;
    totalUsd: number;
  } | null>(null);
  const totals = liveTotals ?? weekTotals(weekProjects, weekBonuses);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('ledger.title')}</h1>
          <p className="page-subtitle">{t('ledger.subtitle')}</p>
        </div>
      </div>

      {loadError ? (
        <div className="prompts-error" role="alert">
          <AlertCircle size={18} />
          <span>{loadError}</span>
        </div>
      ) : null}

      {loading ? (
        <div className="prompts-loading" role="status">
          <Loader2 size={22} className="spin" />
          {t('common.loading')}
        </div>
      ) : (
        <>
          <div className="stats-grid stats-grid-compact">
            <div className="stat-card">
              <span className="stat-card-label">{t('ledger.required_hours')}</span>
              <span className="stat-card-value">
                {formatNumber(totals.requiredHours, language)}
              </span>
            </div>
            <div className="stat-card">
              <span className="stat-card-label">{t('ledger.logged_hours')}</span>
              <span className="stat-card-value">
                {totals.loggedHours === null ? '—' : formatNumber(totals.loggedHours, language)}
              </span>
            </div>
            <div className="stat-card">
              <span className="stat-card-label">{t('ledger.carry_out')}</span>
              <span
                className={`stat-card-value ${
                  totals.remainingHours && totals.remainingHours > 0
                    ? 'stat-card-value-warning'
                    : 'stat-card-value-success'
                }`}
              >
                {totals.remainingHours === null ? '—' : formatNumber(totals.remainingHours, language)}
              </span>
            </div>
            <div className="stat-card">
              <span className="stat-card-label">{t('ledger.week_total')}</span>
              <span className="stat-card-value stat-card-value-success">
                {formatCurrency(totals.totalUsd, 'USD', language)}
              </span>
              <span className="payment-amount-irr">
                {formatCurrency(
                  usdToIrr(totals.totalUsd, settings.usd_to_irr_rate),
                  'IRR',
                  language
                )}
              </span>
            </div>
          </div>

          <div className="ledger-layout section-gap">
            <LedgerCalendar
              year={month.year}
              month={month.month}
              weeksWithData={weeksWithData}
              selectedWeek={selectedWeek}
              onSelectWeek={(key) => {
                // The month stays put. The first row of a month usually starts in
                // the previous one, and jumping there on click moved the grid
                // out from under the pointer.
                setSelectedWeek(key);
                setLiveTotals(null);
              }}
              onChangeMonth={(year, nextMonth) => setMonth({ year, month: nextMonth })}
            />

            <div className="ledger-week-heading">
              <CalendarDays size={16} aria-hidden="true" />
              <h2 className="section-heading">
                {t('ledger.week_of')
                  .replace(
                    '{from}',
                    friday.toLocaleDateString(language === 'fa' ? 'fa-IR-u-ca-gregory' : 'en-US', {
                      day: 'numeric',
                      month: 'short',
                    })
                  )
                  .replace(
                    '{to}',
                    new Date(friday.getFullYear(), friday.getMonth(), friday.getDate() + 6)
                      .toLocaleDateString(language === 'fa' ? 'fa-IR-u-ca-gregory' : 'en-US', {
                        day: 'numeric',
                        month: 'short',
                      })
                  )}
              </h2>
            </div>

            <WeekPanel
              key={weekId}
              weekId={weekId}
              members={team}
              projects={weekProjects}
              memberRows={weekMembers}
              bonuses={weekBonuses}
              usdToIrrRate={settings.usd_to_irr_rate}
              agnusSuggestion={agnusSuggestion}
              carryFromLastWeek={carryFromLastWeek}
              notes={weekRow?.notes ?? ''}
              busy={busy}
              onSave={handleSave}
              onAddBonus={(input) =>
                run(async () => {
                  await ensureWeek(selectedWeek);
                  await addBonus({ ...input, weekId });
                })
              }
              onRemoveBonus={(id) => run(() => removeBonus(id))}
              onTotalsChange={setLiveTotals}
            />
          </div>
        </>
      )}
    </div>
  );
}
