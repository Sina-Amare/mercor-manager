import { useState } from 'react';
import { Check, Loader2, Sparkles, X } from 'lucide-react';
import { polishToEnglish } from '../../../api/ai';
import { useLanguageStore, useToastStore } from '../../../store';
import useAiAvailable from '../../../hooks/useAiAvailable';

interface Props {
  value: string;
  onAccept: (text: string) => void;
  disabled?: boolean;
}

/**
 * The team thinks in Persian and submits in English, which is the one chore
 * that repeats on every task. The rewrite is always shown for review and never
 * writes over the field on its own — the human stays the author.
 */
export default function AiPolishButton({ value, onAccept, disabled }: Props) {
  const { t } = useLanguageStore();
  const { addToast } = useToastStore();
  const available = useAiAvailable();
  const [busy, setBusy] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);

  if (!available) return null;

  const run = async () => {
    if (!value.trim() || busy) return;
    setBusy(true);
    try {
      const polished = await polishToEnglish(value);
      if (polished.trim() && polished.trim() !== value.trim()) {
        setSuggestion(polished);
      } else {
        addToast(t('ai.no_change'), 'success');
      }
    } catch (error) {
      addToast(error instanceof Error ? error.message : t('ai.failed'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost btn-sm ai-button"
        onClick={() => void run()}
        disabled={disabled || busy || !value.trim()}
        title={t('ai.polish_help')}
      >
        {busy ? (
          <Loader2 size={13} className="spin" aria-hidden="true" />
        ) : (
          <Sparkles size={13} aria-hidden="true" />
        )}
        {t('ai.polish')}
      </button>

      {suggestion !== null && (
        <div className="ai-suggestion" role="region" aria-label={t('ai.suggestion')}>
          <div className="ai-suggestion-header">
            <Sparkles size={13} aria-hidden="true" />
            <strong>{t('ai.suggestion')}</strong>
            <span>{t('ai.review_before_use')}</span>
          </div>
          <pre className="ai-suggestion-body" dir="auto">
            {suggestion}
          </pre>
          <div className="ai-suggestion-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setSuggestion(null)}
            >
              <X size={13} aria-hidden="true" />
              {t('ai.discard')}
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                onAccept(suggestion);
                setSuggestion(null);
              }}
            >
              <Check size={13} aria-hidden="true" />
              {t('ai.use_this')}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
