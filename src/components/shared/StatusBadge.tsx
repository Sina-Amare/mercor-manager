import type { TaskStatus } from '../../types';
import { STATUS_CONFIG } from '../../types';
import { useLanguageStore } from '../../store';

interface Props {
  status: TaskStatus;
}

export default function StatusBadge({ status }: Props) {
  const { t } = useLanguageStore();
  const config = STATUS_CONFIG[status];
  if (!config) return <span>{status}</span>;

  return (
    <span
      className="status-badge"
      style={{ color: config.color, backgroundColor: config.bgColor }}
    >
      {/* Decorative: screen readers would otherwise announce "grinning face"
          where the label already says what the status is. */}
      <span aria-hidden="true">{config.icon}</span>
      {t(`status.${status}`)}
    </span>
  );
}
