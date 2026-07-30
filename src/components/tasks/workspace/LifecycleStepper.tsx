import { Check, ChevronRight, X } from 'lucide-react';
import type { MemberVerdict, TaskStatus } from '../../../types';
import { useLanguageStore } from '../../../store';
import { formatNumber } from '../../../utils/dates';
import { isNegativeOutcome, type Stage } from '../../../workflow';

interface Step {
  labelKey: string;
  stage: Stage;
  statuses: readonly TaskStatus[];
}

const STEPS: readonly Step[] = [
  { labelKey: 'status.assigned', stage: 'submission', statuses: ['assigned'] },
  { labelKey: 'status.working', stage: 'submission', statuses: ['working'] },
  { labelKey: 'tasks.submitted', stage: 'submission', statuses: ['swf', 'swof', 'member_discarded'] },
  { labelKey: 'status.in_studio', stage: 'studio', statuses: ['on_hold', 'in_studio'] },
  { labelKey: 'status.in_review', stage: 'review', statuses: ['in_review', 'sent_back', 'admin_discarded'] },
  { labelKey: 'tasks.final', stage: 'payment', statuses: ['approved'] },
];

function currentStepIndex(status: TaskStatus): number {
  const index = STEPS.findIndex((step) => step.statuses.includes(status));
  return index === -1 ? 0 : index;
}

interface Props {
  status: TaskStatus;
  /** Names step 3 after what was actually submitted, once it is known. */
  verdict?: MemberVerdict | '';
  onSelectStage: (stage: Stage) => void;
  activeStage: Stage;
}

/**
 * The pipeline, as a control rather than a decoration: each step jumps to the
 * stage that owns it. A discarded or rejected task stops the chain in a warning
 * colour instead of painting the remaining steps as completed — failing used to
 * look identical to finishing.
 */
export default function LifecycleStepper({ status, verdict, onSelectStage, activeStage }: Props) {
  const { t, language } = useLanguageStore();
  const current = currentStepIndex(status);
  const failed = isNegativeOutcome(status);

  return (
    <ol className="stepper" aria-label={t('tasks.lifecycle')}>
      {STEPS.map((step, index) => {
        const isCurrent = index === current;
        const isDone = index < current;
        const state = isCurrent ? (failed ? 'failed' : 'active') : isDone ? 'completed' : 'upcoming';
        // Once a verdict exists, the third step says which one rather than the
        // generic word — that is the fact people are looking for.
        const label =
          step.statuses.includes('swf') && verdict
            ? t(`status.${verdict}`)
            : t(step.labelKey);

        return (
          <li key={step.labelKey} className="stepper-item">
            {index > 0 && (
              <ChevronRight
                className={`stepper-arrow ${index > current ? 'is-ahead' : ''} ${
                  failed && index > current ? 'is-broken' : ''
                }`}
                size={13}
                aria-hidden="true"
              />
            )}
            <button
              type="button"
              className={`stepper-step is-${state} ${activeStage === step.stage ? 'is-selected' : ''}`}
              onClick={() => onSelectStage(step.stage)}
              aria-current={isCurrent ? 'step' : undefined}
            >
              <span className="stepper-marker" aria-hidden="true">
                {state === 'completed' ? (
                  <Check size={11} />
                ) : state === 'failed' ? (
                  <X size={11} />
                ) : (
                  formatNumber(index + 1, language)
                )}
              </span>
              <span className="stepper-label">{label}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
