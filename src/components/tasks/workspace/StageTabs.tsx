import { ClipboardList, CreditCard, Clapperboard, Gavel, Lock } from 'lucide-react';
import type { ComponentType } from 'react';
import { useLanguageStore } from '../../../store';
import { STAGES, type Stage } from '../../../workflow';

const STAGE_META: Record<Stage, { labelKey: string; icon: ComponentType<{ size?: number }> }> = {
  submission: { labelKey: 'tasks.stage_submission', icon: ClipboardList },
  studio: { labelKey: 'tasks.stage_studio', icon: Clapperboard },
  review: { labelKey: 'tasks.stage_review', icon: Gavel },
  payment: { labelKey: 'tasks.stage_payment', icon: CreditCard },
};

interface Props {
  active: Stage;
  onSelect: (stage: Stage) => void;
  /** Stages the task has not reached yet: shown, disabled, with the unlock reason. */
  lockedStages: Partial<Record<Stage, string>>;
  /** Stage that is waiting on somebody right now. */
  actionableStage: Stage | null;
  /** Stages carrying unsaved edits. */
  dirtyStages: Stage[];
}

/**
 * Locked stages stay visible rather than disappearing: seeing "Review — unlocks
 * after Studio" is how somebody learns the pipeline. Hiding them makes the
 * screen change shape as work progresses and teaches nothing.
 */
export default function StageTabs({
  active,
  onSelect,
  lockedStages,
  actionableStage,
  dirtyStages,
}: Props) {
  const { t, language } = useLanguageStore();

  return (
    <div
      className="stage-tabs"
      role="tablist"
      aria-label={t('tasks.stages')}
      onKeyDown={(event) => {
        // The ARIA tabs pattern: arrows move between tabs, skipping the
        // locked ones. Left/Right flip meaning in RTL so the arrow points
        // where focus is going.
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        const tabs = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>(
            '[role="tab"]:not([aria-disabled="true"])'
          )
        );
        const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
        if (index === -1) return;
        event.preventDefault();
        const forward =
          language === 'fa' ? event.key === 'ArrowLeft' : event.key === 'ArrowRight';
        const next = tabs[(index + (forward ? 1 : tabs.length - 1)) % tabs.length];
        next.focus();
        next.click();
      }}
    >
      {STAGES.map((stage) => {
        const meta = STAGE_META[stage];
        const Icon = meta.icon;
        const lockReason = lockedStages[stage];
        const isActive = active === stage;

        return (
          <button
            key={stage}
            type="button"
            role="tab"
            id={`stage-tab-${stage}`}
            aria-selected={isActive}
            aria-controls={`stage-panel-${stage}`}
            className={`stage-tab ${isActive ? 'active' : ''} ${lockReason ? 'is-locked' : ''}`}
            onClick={() => !lockReason && onSelect(stage)}
            // aria-disabled rather than the disabled attribute: a disabled
            // button cannot receive focus, so a keyboard or screen-reader user
            // could never reach the tab and hear why it is locked.
            aria-disabled={Boolean(lockReason)}
            title={lockReason}
          >
            {lockReason ? <Lock size={15} aria-hidden="true" /> : <Icon size={15} />}
            <span>{t(meta.labelKey)}</span>
            {dirtyStages.includes(stage) && (
              <span className="stage-tab-dot is-dirty" title={t('tasks.unsaved')}>
                <span className="sr-only">{t('tasks.unsaved')}</span>
              </span>
            )}
            {!lockReason && actionableStage === stage && (
              <span className="stage-tab-dot" title={t('tasks.action_needed')}>
                <span className="sr-only">{t('tasks.action_needed')}</span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
