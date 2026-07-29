import { ArrowLeft, ArrowRight, RefreshCw } from 'lucide-react';
import type { Task } from '../../../types';
import { STATUS_CONFIG } from '../../../types';
import { useLanguageStore } from '../../../store';
import type { Transition } from '../../../workflow';

interface Props {
  task: Task;
  transitions: Transition[];
  onRun: (transition: Transition) => void;
  saving: boolean;
  dirty: boolean;
}

const TONE_BY_TARGET: Record<string, string> = {
  member_discarded: 'btn-danger',
  admin_discarded: 'btn-danger',
  approved: 'btn-success',
  swf: 'btn-success',
  swof: 'btn-secondary',
  sent_back: 'btn-warning',
};

/**
 * Three groups, because "what can I do here" splits three ways: go on, go back,
 * or fix a fact that was recorded wrong. Correcting SWF to SWOF is not a step
 * backwards and should not be dressed as one.
 */
export default function ActionBar({ task, transitions, onRun, saving, dirty }: Props) {
  const { t } = useLanguageStore();

  const back = transitions.filter((item) => item.kind === 'back');
  const sideways = transitions.filter((item) => item.kind === 'sideways');
  const forward = transitions.filter((item) => item.kind === 'forward');

  if (back.length + sideways.length + forward.length === 0) return null;

  const renderButton = (transition: Transition, extraClass = '') => {
    const blockedKey = transition.blockedBy?.(task) ?? null;
    return (
      <button
        key={`${transition.from}-${transition.to}`}
        type="button"
        className={`btn btn-sm ${TONE_BY_TARGET[transition.to] || 'btn-secondary'} ${extraClass}`}
        onClick={() => onRun(transition)}
        disabled={saving || Boolean(blockedKey)}
        title={blockedKey ? t(blockedKey) : undefined}
      >
        <span aria-hidden="true">{STATUS_CONFIG[transition.to].icon}</span>
        {t(transition.labelKey)}
      </button>
    );
  };

  return (
    <div className="task-action-bar">
      {dirty && (
        <p className="task-action-dirty" role="status">
          {t('tasks.unsaved_included')}
        </p>
      )}

      <div className="task-action-groups">
        {back.length > 0 && (
          <div className="task-action-group task-action-group-previous">
            <span className="task-action-group-label">
              <ArrowLeft size={13} aria-hidden="true" />
              {t('tasks.previous_step')}
            </span>
            <div className="task-action-buttons">{back.map((item) => renderButton(item))}</div>
          </div>
        )}

        {sideways.length > 0 && (
          <div className="task-action-group task-action-group-correct">
            <span className="task-action-group-label">
              <RefreshCw size={13} aria-hidden="true" />
              {t('tasks.correct_verdict')}
            </span>
            <div className="task-action-buttons">
              {sideways.map((item) => renderButton(item, 'btn-outline'))}
            </div>
          </div>
        )}

        {forward.length > 0 && (
          <div className="task-action-group task-action-group-next">
            <span className="task-action-group-label">
              {t('tasks.next_step')}
              <ArrowRight size={13} aria-hidden="true" />
            </span>
            <div className="task-action-buttons">{forward.map((item) => renderButton(item))}</div>
          </div>
        )}
      </div>
    </div>
  );
}
