import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Plus, Save, Trash2, Wand2 } from 'lucide-react';
import { useLanguageStore } from '../../store';
import { formatCurrency, formatNumber, usdToIrr } from '../../utils/dates';
import {
  PROJECTS,
  emptyProject,
  formatMeter,
  memberTotals,
  parseMeter,
  projectTotals,
  weekTotals,
  type ProjectKey,
  type WorkWeekBonus,
  type WorkWeekMember,
  type WorkWeekProject,
} from '../../weeklyLedger';
import type { User } from '../../types';

interface Props {
  weekId: string;
  members: User[];
  projects: WorkWeekProject[];
  memberRows: WorkWeekMember[];
  bonuses: WorkWeekBonus[];
  usdToIrrRate: number;
  /** Approved AGNUS tasks inside this week, offered as a starting point. */
  agnusSuggestion: number;
  /** Hours still owed on each project at the end of the previous week. */
  carryFromLastWeek: Record<ProjectKey, number | null>;
  notes: string;
  busy: boolean;
  onSave: (draft: {
    projects: WorkWeekProject[];
    members: WorkWeekMember[];
    notes: string;
  }) => Promise<void>;
  onAddBonus: (input: { userId: string | null; project: ProjectKey; amountUsd: number; note: string }) => Promise<void>;
  onRemoveBonus: (id: string) => Promise<void>;
  /** Keeps the summary at the top of the page showing what is on screen. */
  onTotalsChange: (totals: {
    requiredHours: number;
    loggedHours: number | null;
    remainingHours: number | null;
    totalUsd: number;
  }) => void;
}

const memberKey = (userId: string, project: ProjectKey) => `${userId}:${project}`;

/**
 * One week, opened.
 *
 * Everything typed here is held as a draft until Save, because the figures are
 * interdependent — changing a rate before correcting a task count would
 * otherwise write, and briefly display, a number nobody meant. Bonuses are the
 * exception: adding or removing one is a discrete act with nothing to
 * reconcile, so it writes immediately.
 */
export default function WeekPanel({
  weekId,
  members,
  projects,
  memberRows,
  bonuses,
  usdToIrrRate,
  agnusSuggestion,
  carryFromLastWeek,
  notes,
  busy,
  onSave,
  onAddBonus,
  onRemoveBonus,
  onTotalsChange,
}: Props) {
  const { t, language } = useLanguageStore();

  const initialProjects = useMemo(() => {
    const map = {} as Record<ProjectKey, WorkWeekProject>;
    for (const project of PROJECTS) {
      map[project] =
        projects.find((row) => row.project === project) ?? emptyProject(weekId, project);
    }
    return map;
  }, [projects, weekId]);

  const initialMemberTasks = useMemo(() => {
    const map: Record<string, number> = {};
    for (const member of members) {
      for (const project of PROJECTS) {
        map[memberKey(member.id, project)] =
          memberRows.find((row) => row.user_id === member.id && row.project === project)
            ?.tasks_done ?? 0;
      }
    }
    return map;
  }, [memberRows, members]);

  const [draft, setDraft] = useState(initialProjects);
  const [memberTasks, setMemberTasks] = useState(initialMemberTasks);
  const [note, setNote] = useState(notes);
  // Meters are typed as text ("195:20") and only become minutes on save, so a
  // half-typed "19" is not read as nineteen hours.
  const [meters, setMeters] = useState<Record<string, string>>({});

  /**
   * Only the fields this panel edits.
   *
   * Comparing whole rows made any extra column the server happened to return —
   * a timestamp, a column added later — differ for ever from the local draft,
   * which left the panel permanently "dirty": Save never went quiet and every
   * refresh from the server was refused.
   */
  const fingerprint = (rows: Record<ProjectKey, WorkWeekProject>) =>
    PROJECTS.map((project) => {
      const row = rows[project];
      return [
        project,
        Number(row.tasks_done),
        Number(row.hours_per_task),
        Number(row.usd_per_task),
        Number(row.carry_in_hours),
        row.tracker_start_minutes,
        row.tracker_end_minutes,
      ].join('|');
    }).join('||');

  // A realtime change from another tab must not overwrite what is being typed.
  const editingRef = useRef(false);
  const dirty =
    fingerprint(draft) !== fingerprint(initialProjects) ||
    JSON.stringify(memberTasks) !== JSON.stringify(initialMemberTasks) ||
    note !== notes ||
    Object.keys(meters).length > 0;
  editingRef.current = dirty;

  useEffect(() => {
    if (editingRef.current) return;
    setDraft(initialProjects);
    setMemberTasks(initialMemberTasks);
    setNote(notes);
  }, [initialMemberTasks, initialProjects, notes]);

  const meterValue = (project: ProjectKey, which: 'start' | 'end') => {
    const key = `${project}:${which}`;
    if (key in meters) return meters[key];
    const row = draft[project];
    return formatMeter(
      which === 'start' ? row.tracker_start_minutes : row.tracker_end_minutes
    );
  };

  const setMeter = (project: ProjectKey, which: 'start' | 'end', value: string) =>
    setMeters((current) => ({ ...current, [`${project}:${which}`]: value }));

  const patch = (project: ProjectKey, changes: Partial<WorkWeekProject>) =>
    setDraft((current) => ({ ...current, [project]: { ...current[project], ...changes } }));

  /** Applies the typed meter text; invalid text becomes "not recorded". */
  const resolved = useMemo(() => {
    const map = {} as Record<ProjectKey, WorkWeekProject>;
    for (const project of PROJECTS) {
      const row = draft[project];
      const startKey = `${project}:start`;
      const endKey = `${project}:end`;
      map[project] = {
        ...row,
        tracker_start_minutes:
          startKey in meters ? parseMeter(meters[startKey]) : row.tracker_start_minutes,
        tracker_end_minutes:
          endKey in meters ? parseMeter(meters[endKey]) : row.tracker_end_minutes,
      };
    }
    return map;
  }, [draft, meters]);

  const rows = PROJECTS.map((project) => resolved[project]);
  const totals = weekTotals(rows, bonuses);
  const people = memberTotals(
    members,
    Object.entries(memberTasks).map(([key, tasks]) => {
      const [userId, project] = key.split(':');
      return { week_id: weekId, user_id: userId, project: project as ProjectKey, tasks_done: tasks };
    }),
    rows,
    bonuses
  );

  useEffect(() => {
    onTotalsChange({
      requiredHours: totals.requiredHours,
      loggedHours: totals.loggedHours,
      remainingHours: totals.remainingHours,
      totalUsd: totals.totalUsd,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totals.requiredHours, totals.loggedHours, totals.remainingHours, totals.totalUsd]);

  const money = (usd: number) => (
    <>
      <span className="payment-amount">{formatCurrency(usd, 'USD', language)}</span>
      <span className="payment-amount-irr">
        {formatCurrency(usdToIrr(usd, usdToIrrRate), 'IRR', language)}
      </span>
    </>
  );

  const hours = (value: number | null) =>
    value === null ? '—' : `${formatNumber(value, language)} ${t('ledger.h')}`;

  /** True while any meter box holds text that is not a reading. */
  const badMeter = Object.entries(meters).some(
    ([, value]) => value.trim() !== '' && parseMeter(value) === null
  );

  const save = async () => {
    await onSave({
      projects: rows,
      members: Object.entries(memberTasks).map(([key, tasks]) => {
        const [userId, project] = key.split(':');
        return { week_id: weekId, user_id: userId, project: project as ProjectKey, tasks_done: tasks };
      }),
      notes: note,
    });
    // Fold the parsed meters back into the draft before clearing the text
    // overrides. Without this the draft still holds the pre-save readings, the
    // panel counts itself dirty for ever, refuses every refresh from the
    // server, shows empty meter boxes — and a second Save writes NULL over the
    // readings just stored.
    setDraft((current) => {
      const next = { ...current };
      for (const project of PROJECTS) next[project] = resolved[project];
      return next;
    });
    setMeters({});
  };

  // ── Bonus composer ─────────────────────────────────────────────────────────
  const [bonusUser, setBonusUser] = useState(members[0]?.id ?? '');
  const [bonusProject, setBonusProject] = useState<ProjectKey>('agnus');
  const [bonusAmount, setBonusAmount] = useState(0);
  const [bonusNote, setBonusNote] = useState('');

  const submitBonus = async () => {
    if (!Number.isFinite(bonusAmount) || bonusAmount === 0) return;
    await onAddBonus({
      userId: bonusUser || null,
      project: bonusProject,
      amountUsd: bonusAmount,
      note: bonusNote,
    });
    setBonusAmount(0);
    setBonusNote('');
  };

  return (
    <div className="ledger-week-panel">
      <div className="ledger-projects">
        {PROJECTS.map((project) => {
          const row = resolved[project];
          const figures = projectTotals(row, bonuses);
          const suggestion = project === 'agnus' ? agnusSuggestion : null;
          const carry = carryFromLastWeek[project];

          return (
            <section className="card ledger-project" key={project}>
              <div className="card-header">
                <h3 className="card-title">{t(`ledger.project_${project}`)}</h3>
                <span className="ledger-project-rate">
                  {t('ledger.rate_summary')
                    .replace('{hours}', formatNumber(row.hours_per_task, language))
                    .replace('{usd}', formatCurrency(row.usd_per_task, 'USD', language))}
                </span>
              </div>

              <div className="ledger-field-grid">
                <div className="form-group">
                  <label className="form-label" htmlFor={`${project}-tasks`}>
                    {t('ledger.tasks_done')}
                  </label>
                  <input
                    id={`${project}-tasks`}
                    type="number"
                    min={0}
                    className="form-input input-mono"
                    value={row.tasks_done}
                    onChange={(event) =>
                      patch(project, {
                        tasks_done: Math.max(0, Number(event.target.value) || 0),
                        tasks_done_is_manual: true,
                      })
                    }
                  />
                  {/* Only when there is something to suggest. "Use 0 from
                      tasks" is not an offer, it is noise. */}
                  {suggestion !== null && suggestion > 0 && suggestion !== row.tasks_done ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm ledger-suggestion"
                      onClick={() =>
                        patch(project, { tasks_done: suggestion, tasks_done_is_manual: false })
                      }
                    >
                      <Wand2 size={13} />
                      {t('ledger.use_suggestion').replace(
                        '{count}',
                        formatNumber(suggestion, language)
                      )}
                    </button>
                  ) : null}
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor={`${project}-hours`}>
                    {t('ledger.hours_per_task')}
                  </label>
                  <input
                    id={`${project}-hours`}
                    type="number"
                    min={0}
                    step={0.25}
                    className="form-input input-mono"
                    value={row.hours_per_task}
                    onChange={(event) =>
                      patch(project, { hours_per_task: Math.max(0, Number(event.target.value) || 0) })
                    }
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor={`${project}-usd`}>
                    {t('ledger.usd_per_task')}
                  </label>
                  <input
                    id={`${project}-usd`}
                    type="number"
                    min={0}
                    step={0.5}
                    className="form-input input-mono"
                    value={row.usd_per_task}
                    onChange={(event) =>
                      patch(project, { usd_per_task: Math.max(0, Number(event.target.value) || 0) })
                    }
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor={`${project}-carry`}>
                    {t('ledger.carry_in')}
                  </label>
                  <input
                    id={`${project}-carry`}
                    type="number"
                    step={0.25}
                    className="form-input input-mono"
                    value={row.carry_in_hours}
                    onChange={(event) =>
                      patch(project, { carry_in_hours: Number(event.target.value) || 0 })
                    }
                  />
                  {carry !== null && carry !== 0 && carry !== row.carry_in_hours ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm ledger-suggestion"
                      onClick={() => patch(project, { carry_in_hours: carry })}
                    >
                      <Wand2 size={13} />
                      {t('ledger.use_last_week').replace(
                        '{hours}',
                        formatNumber(carry, language)
                      )}
                    </button>
                  ) : null}
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor={`${project}-start`}>
                    {t('ledger.tracker_start')}
                  </label>
                  <input
                    id={`${project}-start`}
                    type="text"
                    inputMode="numeric"
                    placeholder="191:00"
                    className="form-input input-mono"
                    value={meterValue(project, 'start')}
                    aria-invalid={meters[`${project}:start`]?.trim() ? parseMeter(meters[`${project}:start`]) === null : undefined}
                    onChange={(event) => setMeter(project, 'start', event.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor={`${project}-end`}>
                    {t('ledger.tracker_now')}
                  </label>
                  <input
                    id={`${project}-end`}
                    type="text"
                    inputMode="numeric"
                    placeholder="195:20"
                    className="form-input input-mono"
                    value={meterValue(project, 'end')}
                    aria-invalid={meters[`${project}:end`]?.trim() ? parseMeter(meters[`${project}:end`]) === null : undefined}
                    onChange={(event) => setMeter(project, 'end', event.target.value)}
                  />
                </div>
              </div>

              {figures.meterWentBackwards ? (
                <p className="ledger-warning">{t('ledger.meter_backwards')}</p>
              ) : null}

              <dl className="ledger-figures">
                <div>
                  <dt>{t('ledger.earned_hours')}</dt>
                  <dd>{hours(figures.earnedHours)}</dd>
                </div>
                <div>
                  <dt>{t('ledger.required_hours')}</dt>
                  <dd>{hours(figures.requiredHours)}</dd>
                </div>
                <div>
                  <dt>{t('ledger.logged_hours')}</dt>
                  <dd>{hours(figures.loggedHours)}</dd>
                </div>
                <div className={figures.remainingHours && figures.remainingHours > 0 ? 'is-owed' : ''}>
                  <dt>{t('ledger.remaining_hours')}</dt>
                  <dd>{hours(figures.remainingHours)}</dd>
                </div>
                <div>
                  <dt>{t('ledger.bonuses')}</dt>
                  <dd>
                    {formatNumber(figures.bonusTasks, language)} ·{' '}
                    {formatCurrency(figures.bonusUsd, 'USD', language)}
                  </dd>
                </div>
                <div className="ledger-figure-total">
                  <dt>{t('ledger.project_total')}</dt>
                  <dd>{money(figures.totalUsd)}</dd>
                </div>
              </dl>
            </section>
          );
        })}
      </div>

      {/* ── People ────────────────────────────────────────────────────────── */}
      <section className="card section-gap">
        <div className="card-header">
          <h3 className="card-title">{t('ledger.people')}</h3>
        </div>
        <p className="card-help">{t('ledger.people_help')}</p>
        <div className="data-table-wrapper is-flush">
          <table className="data-table">
            <caption className="sr-only">{t('ledger.people')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('payments.member')}</th>
                <th scope="col">{t('ledger.project_agnus')}</th>
                <th scope="col">{t('ledger.project_chromium')}</th>
                <th scope="col">{t('ledger.bonus_tasks')}</th>
                <th scope="col">{t('ledger.bonus_amount')}</th>
                <th scope="col">{t('ledger.owed')}</th>
              </tr>
            </thead>
            <tbody>
              {people.map((person) => (
                <tr key={person.userId}>
                  <td data-label={t('payments.member')}>{person.name}</td>
                  {PROJECTS.map((project) => (
                    <td key={project} data-label={t(`ledger.project_${project}`)}>
                      <input
                        type="number"
                        min={0}
                        className="form-input input-mono ledger-cell-input"
                        aria-label={`${person.name} — ${t(`ledger.project_${project}`)}`}
                        value={memberTasks[memberKey(person.userId, project)] ?? 0}
                        onChange={(event) =>
                          setMemberTasks((current) => ({
                            ...current,
                            [memberKey(person.userId, project)]: Math.max(
                              0,
                              Number(event.target.value) || 0
                            ),
                          }))
                        }
                      />
                    </td>
                  ))}
                  <td data-label={t('ledger.bonus_tasks')}>
                    {formatNumber(person.bonusTasks, language)}
                  </td>
                  <td data-label={t('ledger.bonus_amount')}>
                    {formatCurrency(person.bonusUsd, 'USD', language)}
                  </td>
                  <td data-label={t('ledger.owed')}>{money(person.totalUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Bonuses ───────────────────────────────────────────────────────── */}
      <section className="card section-gap">
        <div className="card-header">
          <h3 className="card-title">{t('ledger.bonuses')}</h3>
        </div>
        <p className="card-help">{t('ledger.bonuses_help')}</p>

        {bonuses.length > 0 ? (
          <ul className="ledger-bonus-list">
            {bonuses.map((bonus) => (
              <li key={bonus.id} className="ledger-bonus">
                <span className="ledger-bonus-who">
                  {members.find((member) => member.id === bonus.user_id)?.name ??
                    t('ledger.unassigned')}
                </span>
                <span className={`prompt-scope prompt-scope-${bonus.project === 'agnus' ? 'public' : 'personal'}`}>
                  {t(`ledger.project_${bonus.project}`)}
                </span>
                <span className="ledger-bonus-note" dir="auto">
                  {bonus.note}
                </span>
                <span className="payment-amount">
                  {formatCurrency(bonus.amount_usd, 'USD', language)}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-icon btn-sm btn-ghost-danger"
                  onClick={() => onRemoveBonus(bonus.id)}
                  disabled={busy}
                  aria-label={t('ledger.remove_bonus')}
                  title={t('ledger.remove_bonus')}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="ledger-bonus-form">
          <select
            className="form-select"
            value={bonusUser}
            onChange={(event) => setBonusUser(event.target.value)}
            aria-label={t('payments.member')}
          >
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
          <select
            className="form-select"
            value={bonusProject}
            onChange={(event) => setBonusProject(event.target.value as ProjectKey)}
            aria-label={t('ledger.project')}
          >
            {PROJECTS.map((project) => (
              <option key={project} value={project}>
                {t(`ledger.project_${project}`)}
              </option>
            ))}
          </select>
          <input
            type="number"
            step={0.5}
            className="form-input input-mono"
            value={bonusAmount}
            onChange={(event) => setBonusAmount(Number(event.target.value) || 0)}
            aria-label={t('ledger.bonus_amount')}
            placeholder="0"
          />
          <input
            type="text"
            className="form-input"
            value={bonusNote}
            onChange={(event) => setBonusNote(event.target.value)}
            aria-label={t('ledger.bonus_note')}
            placeholder={t('ledger.bonus_note')}
            dir="auto"
          />
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={submitBonus}
            disabled={busy || !Number.isFinite(bonusAmount) || bonusAmount === 0}
          >
            <Plus size={14} />
            {t('ledger.add_bonus')}
          </button>
        </div>
      </section>

      {/* ── Week footer ───────────────────────────────────────────────────── */}
      <section className="card section-gap ledger-week-footer">
        <div className="form-group">
          <label className="form-label" htmlFor={`${weekId}-notes`}>
            {t('ledger.notes')}
          </label>
          <textarea
            id={`${weekId}-notes`}
            className="form-textarea"
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            dir="auto"
          />
        </div>

        <dl className="ledger-figures ledger-week-summary">
          <div>
            <dt>{t('ledger.required_hours')}</dt>
            <dd>{hours(totals.requiredHours)}</dd>
          </div>
          <div>
            <dt>{t('ledger.logged_hours')}</dt>
            <dd>{hours(totals.loggedHours)}</dd>
          </div>
          <div className={totals.remainingHours && totals.remainingHours > 0 ? 'is-owed' : ''}>
            <dt>{t('ledger.carry_out')}</dt>
            <dd>{hours(totals.remainingHours)}</dd>
          </div>
          <div className="ledger-figure-total">
            <dt>{t('ledger.week_total')}</dt>
            <dd>{money(totals.totalUsd)}</dd>
          </div>
        </dl>

        {totals.partial ? <p className="ledger-warning">{t('ledger.partial_week')}</p> : null}
        {badMeter ? <p className="ledger-warning">{t('ledger.bad_meter')}</p> : null}

        <div className="ledger-save-row">
          <button className="btn btn-primary" onClick={save} disabled={busy || !dirty || badMeter}>
            {busy ? <Loader2 size={15} className="spin" /> : <Save size={15} />}
            {t('ledger.save_week')}
          </button>
        </div>
      </section>
    </div>
  );
}
