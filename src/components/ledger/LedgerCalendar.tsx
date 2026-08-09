import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useLanguageStore } from '../../store';
import { formatNumber, toJalali } from '../../utils/dates';
import { fromDateKey, toDateKey, weekDays, weeksTouchingMonth } from '../../weeklyLedger';

interface Props {
  year: number;
  month: number;
  /** Friday keys that already have figures saved against them. */
  weeksWithData: Set<string>;
  selectedWeek: string | null;
  onSelectWeek: (fridayKey: string) => void;
  onChangeMonth: (year: number, month: number) => void;
}

/**
 * A month, laid out as Friday-to-Thursday rows.
 *
 * Columns start on Friday rather than Sunday or Saturday because the whole
 * ledger is keyed on the Friday a week begins: with any other first column a
 * week would wrap across two rows and stop being clickable as one thing.
 *
 * Each row is a button, not each day — the unit of work here is the week, and
 * offering seven targets that all do the same thing would only invite the
 * question of what picking a Tuesday means.
 */
export default function LedgerCalendar({
  year,
  month,
  weeksWithData,
  selectedWeek,
  onSelectWeek,
  onChangeMonth,
}: Props) {
  const { t, language } = useLanguageStore();

  const fridays = weeksTouchingMonth(year, month).map(fromDateKey);
  const monthStart = new Date(year, month, 1);
  const today = new Date();

  // The grid is a Gregorian month, so it is named as one — in Persian script
  // and digits, but explicitly on the Gregorian calendar. Plain `fa-IR` would
  // format it on the Persian calendar and label an August grid «مرداد», which
  // is a different month entirely.
  const monthLabel = monthStart.toLocaleDateString(
    language === 'fa' ? 'fa-IR-u-ca-gregory' : 'en-US',
    { month: 'long', year: 'numeric' }
  );
  // …and the Jalali span it covers underneath, which is what a Persian reader
  // actually plans their week by.
  const jalaliLabel = `${toJalali(toDateKey(monthStart), language)} – ${toJalali(
    toDateKey(new Date(year, month + 1, 0)),
    language
  )}`;

  const step = (delta: number) => {
    const next = new Date(year, month + delta, 1);
    onChangeMonth(next.getFullYear(), next.getMonth());
  };

  // Friday first, then round to Thursday.
  const weekdayNames = weekDays(new Date(2026, 7, 7)).map((day) =>
    day.toLocaleDateString(language === 'fa' ? 'fa-IR-u-ca-gregory' : 'en-US', { weekday: 'short' })
  );

  return (
    <section className="card ledger-calendar">
      <div className="ledger-calendar-head">
        <button
          type="button"
          className="btn btn-ghost btn-icon btn-sm"
          onClick={() => step(-1)}
          aria-label={t('ledger.previous_month')}
          title={t('ledger.previous_month')}
        >
          {/* The arrow points at the earlier month in both directions of text. */}
          <ChevronLeft size={16} className="ledger-arrow-back" />
        </button>
        <div className="ledger-calendar-title">
          <h2 className="card-title">{monthLabel}</h2>
          <span className="ledger-calendar-subtitle">{jalaliLabel}</span>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-icon btn-sm"
          onClick={() => step(1)}
          aria-label={t('ledger.next_month')}
          title={t('ledger.next_month')}
        >
          <ChevronRight size={16} className="ledger-arrow-forward" />
        </button>
      </div>

      <div className="ledger-calendar-weekdays" aria-hidden="true">
        {weekdayNames.map((name, index) => (
          <span key={index}>{name}</span>
        ))}
      </div>

      <ul className="ledger-calendar-weeks">
        {fridays.map((friday) => {
          const key = toDateKey(friday);
          const selected = key === selectedWeek;
          const days = weekDays(friday);
          const label = t('ledger.week_of')
            .replace('{from}', days[0].toLocaleDateString(language === 'fa' ? 'fa-IR-u-ca-gregory' : 'en-US', { day: 'numeric', month: 'short' }))
            .replace('{to}', days[6].toLocaleDateString(language === 'fa' ? 'fa-IR-u-ca-gregory' : 'en-US', { day: 'numeric', month: 'short' }));

          return (
            <li key={key}>
              <button
                type="button"
                className={`ledger-week-row ${selected ? 'is-selected' : ''} ${
                  weeksWithData.has(key) ? 'has-data' : ''
                }`}
                onClick={() => onSelectWeek(key)}
                aria-pressed={selected}
                aria-label={label}
              >
                {days.map((day) => {
                  const inMonth = day.getMonth() === month;
                  const isToday = toDateKey(day) === toDateKey(today);
                  return (
                    <span
                      key={toDateKey(day)}
                      className={`ledger-day ${inMonth ? '' : 'is-outside'} ${
                        isToday ? 'is-today' : ''
                      }`}
                    >
                      {formatNumber(day.getDate(), language)}
                    </span>
                  );
                })}
              </button>
            </li>
          );
        })}
      </ul>

      <p className="ledger-calendar-help">{t('ledger.calendar_help')}</p>
    </section>
  );
}

