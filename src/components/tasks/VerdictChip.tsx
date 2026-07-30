import type { Task } from '../../types';
import { STATUS_CONFIG } from '../../types';
import { useLanguageStore } from '../../store';

interface Props {
  task: Task;
  /** `inline` sits beside the status badge; `stacked` sits under it in tables. */
  variant?: 'inline' | 'stacked';
}

/**
 * What the member actually submitted, kept visible after the task moves on.
 *
 * Once a task reaches Studio or Review its badge only says where it is, and
 * "In Studio" tells you nothing about whether a flaw was found — which is the
 * single most important fact about the work. The verdict was recorded the whole
 * time; it had just stopped being shown.
 *
 * Renders nothing while the status *is* the verdict, so SWF tasks don't get a
 * redundant second SWF chip.
 */
export default function VerdictChip({ task, variant = 'inline' }: Props) {
  const { t } = useLanguageStore();
  const verdict = task.member_verdict;

  if (!verdict || verdict === task.status) return null;

  const config = STATUS_CONFIG[verdict];
  const name = t(`status.${verdict}`);

  return (
    <span
      className={`verdict-chip verdict-chip-${variant}`}
      style={{ color: config.color, borderColor: config.color }}
      title={`${t('tasks.submitted_as')} ${name}`}
    >
      <span className="sr-only">{t('tasks.submitted_as')} </span>
      <span aria-hidden="true">{config.icon}</span>
      {name}
    </span>
  );
}
