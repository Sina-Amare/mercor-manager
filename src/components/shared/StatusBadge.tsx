import type { TaskStatus } from '../../types';
import { STATUS_CONFIG } from '../../types';
import { useLanguageStore } from '../../store';

interface Props {
  status: TaskStatus;
}

export default function StatusBadge({ status }: Props) {
  const { language } = useLanguageStore();
  const config = STATUS_CONFIG[status];
  if (!config) return <span>{status}</span>;

  return (
    <span
      className="status-badge"
      style={{ color: config.color, backgroundColor: config.bgColor }}
    >
      <span>{config.icon}</span>
      {language === 'fa' ? config.labelFa : config.label}
    </span>
  );
}
