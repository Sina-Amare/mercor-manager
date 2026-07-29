import { useState } from 'react';
import { CheckCircle2, Loader2, ScanSearch, TriangleAlert, X } from 'lucide-react';
import { checkSubmission, type SubmissionIssue } from '../../../api/ai';
import { useLanguageStore, useToastStore } from '../../../store';
import useAiAvailable from '../../../hooks/useAiAvailable';
import type { Draft } from './useTaskDraft';

interface Props {
  draft: Draft;
  disabled?: boolean;
}

/**
 * A last look before a task goes to review — empty fields, a final answer that
 * does not answer the prompt, obvious placeholders. Purely advisory: it never
 * blocks the submit button, because the cost of a wrong "no" here is a person
 * arguing with a model about their own work.
 */
export default function AiSubmissionCheck({ draft, disabled }: Props) {
  const { t } = useLanguageStore();
  const { addToast } = useToastStore();
  const available = useAiAvailable();
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<SubmissionIssue[] | null>(null);

  if (!available) return null;

  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const found = await checkSubmission({
        prompt: draft.submission_prompt,
        dsp: draft.submission_dsp,
        final_answer: draft.submission_final_answer,
        notes: draft.submission_notes,
      });
      setIssues(found);
    } catch (error) {
      addToast(error instanceof Error ? error.message : t('ai.failed'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ai-check">
      <div className="ai-check-header">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => void run()}
          disabled={disabled || busy}
        >
          {busy ? (
            <Loader2 size={14} className="spin" aria-hidden="true" />
          ) : (
            <ScanSearch size={14} aria-hidden="true" />
          )}
          {t('ai.check_submission')}
        </button>
        <span className="ai-check-hint">{t('ai.check_help')}</span>
      </div>

      {issues !== null && (
        <div className="ai-check-results" role="status">
          <button
            type="button"
            className="btn btn-ghost btn-icon btn-sm ai-check-dismiss"
            onClick={() => setIssues(null)}
            aria-label={t('common.dismiss')}
          >
            <X size={13} />
          </button>

          {issues.length === 0 ? (
            <p className="ai-check-clear">
              <CheckCircle2 size={15} aria-hidden="true" />
              {t('ai.check_clear')}
            </p>
          ) : (
            <ul className="ai-check-list">
              {issues.map((issue, index) => (
                <li key={`${issue.field}-${index}`}>
                  <TriangleAlert size={13} aria-hidden="true" />
                  <span className="ai-check-field">{t(`ai.field_${issue.field}`)}</span>
                  <span>{issue.issue}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="ai-check-disclaimer">{t('ai.advisory_only')}</p>
        </div>
      )}
    </div>
  );
}
