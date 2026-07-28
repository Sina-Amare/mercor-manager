import { formatDualDate } from '../../utils/dates';

interface Props {
  date: string;
}

export default function DateDisplay({ date }: Props) {
  if (!date) return <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>;
  const { gregorian, jalali } = formatDualDate(date);

  return (
    <div className="date-dual">
      <span className="date-gregorian">{gregorian}</span>
      <span className="date-jalali">{jalali}</span>
    </div>
  );
}
