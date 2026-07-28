import { formatDualDate } from '../../utils/dates';
import { useLanguageStore } from '../../store';

interface Props {
  date: string;
}

export default function DateDisplay({ date }: Props) {
  const { language } = useLanguageStore();
  if (!date) return <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>;
  const { gregorian, jalali } = formatDualDate(date, language);
  if (!gregorian && !jalali) {
    return <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>;
  }

  return (
    <div className="date-dual">
      {language === 'fa' ? (
        <>
          <span className="date-jalali date-primary">{jalali}</span>
          <span className="date-gregorian date-secondary latin-text">{gregorian}</span>
        </>
      ) : (
        <>
          <span className="date-gregorian date-primary">{gregorian}</span>
          <span className="date-jalali date-secondary">{jalali}</span>
        </>
      )}
    </div>
  );
}
