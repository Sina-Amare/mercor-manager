import { HelpCircle } from 'lucide-react';
import type { TaskStatus } from '../../types';
import { useLanguageStore } from '../../store';

interface Props {
  /** Only shown for the statuses whose names are jargon. */
  status?: TaskStatus;
}

const EXPLAINED: readonly TaskStatus[] = ['swf', 'swof'];

/**
 * SWF and SWOF are the two words the whole workflow turns on, and nothing in
 * the app said what they meant. This is that one sentence, where it is needed.
 */
export default function StatusGlossary({ status }: Props) {
  const { t } = useLanguageStore();
  if (status && !EXPLAINED.includes(status)) return null;

  return (
    <details className="status-glossary">
      <summary aria-label={t('tasks.glossary_title')} title={t('tasks.glossary_title')}>
        <HelpCircle size={15} aria-hidden="true" />
      </summary>
      <div className="status-glossary-card" role="note">
        <h3>{t('tasks.glossary_title')}</h3>
        <dl>
          <dt>{t('status.swf')}</dt>
          <dd>{t('tasks.glossary_swf')}</dd>
          <dt>{t('status.swof')}</dt>
          <dd>{t('tasks.glossary_swof')}</dd>
        </dl>
      </div>
    </details>
  );
}
