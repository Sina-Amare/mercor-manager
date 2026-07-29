import { useId, type ReactNode } from 'react';
import CopyButton from '../../shared/CopyButton';
import AiPolishButton from './AiPolishButton';
import { useLanguageStore } from '../../../store';

interface Props {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  help?: string;
  /** Shown as a small required marker and wired to aria-required. */
  required?: boolean;
  readOnly?: boolean;
  disabled?: boolean;
  rows?: number;
  tone?: 'default' | 'studio';
  /** Extra controls beside the copy button. */
  actions?: ReactNode;
  /** Offers the "polish to English" assist under the field when AI is set up. */
  aiAssist?: boolean;
  id?: string;
}

/**
 * One shared field of the collaborative submission. Label, copy button, help
 * text and textarea were repeated verbatim five times in the old detail panel;
 * they live here once so every field behaves the same.
 */
export default function FieldEditor({
  label,
  value,
  onChange,
  placeholder,
  help,
  required = false,
  readOnly = false,
  disabled = false,
  rows = 5,
  tone = 'default',
  actions,
  aiAssist = false,
  id,
}: Props) {
  const { t } = useLanguageStore();
  const generatedId = useId();
  const fieldId = id || generatedId;
  const helpId = `${fieldId}-help`;

  return (
    <div className={`field-editor ${tone === 'studio' ? 'field-editor-studio' : ''}`}>
      <div className="field-editor-heading">
        <label htmlFor={fieldId}>
          {label}
          {required && (
            <span className="field-editor-required" aria-hidden="true">
              *
            </span>
          )}
        </label>
        <div className="field-editor-actions">
          {actions}
          <CopyButton text={value} compact ariaLabel={`${t('common.copy')}: ${label}`} />
        </div>
      </div>

      {help && (
        <small className="field-editor-help" id={helpId}>
          {help}
        </small>
      )}

      <textarea
        id={fieldId}
        className="form-textarea task-submission-textarea"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={readOnly ? '' : placeholder}
        rows={rows}
        dir="auto"
        readOnly={readOnly}
        disabled={disabled}
        required={required}
        aria-required={required}
        aria-describedby={help ? helpId : undefined}
      />

      {aiAssist && !readOnly && !disabled && (
        <div className="field-editor-footer">
          <AiPolishButton value={value} onAccept={onChange} disabled={disabled} />
        </div>
      )}
    </div>
  );
}
