import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { Check, Copy } from 'lucide-react';
import { useLanguageStore, useToastStore } from '../../store';

interface Props {
  text: string;
  className?: string;
  compact?: boolean;
  ariaLabel?: string;
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Some embedded or permission-restricted browsers expose Clipboard API
      // but reject writes. Fall through to the compatible selection method.
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.inset = '-9999px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('Copy failed');
}

export default function CopyButton({
  text,
  className = '',
  compact = false,
  ariaLabel,
}: Props) {
  const { t } = useLanguageStore();
  const { addToast } = useToastStore();
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canCopy = text.length > 0;

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    []
  );

  const handleCopy = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!canCopy) return;

    try {
      await copyText(text);
      setCopied(true);
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      addToast(t('common.copy_error'), 'error');
    }
  };

  const label = copied ? t('common.copied') : t('common.copy');

  return (
    <button
      type="button"
      className={`btn btn-secondary btn-sm copy-button ${
        compact ? 'copy-button-compact' : ''
      } ${copied ? 'is-copied' : ''} ${className}`.trim()}
      onClick={handleCopy}
      disabled={!canCopy}
      aria-label={ariaLabel || label}
      title={canCopy ? label : t('common.nothing_to_copy')}
    >
      {copied ? (
        <Check size={14} aria-hidden="true" />
      ) : (
        <Copy size={14} aria-hidden="true" />
      )}
      <span aria-live="polite">{label}</span>
    </button>
  );
}
