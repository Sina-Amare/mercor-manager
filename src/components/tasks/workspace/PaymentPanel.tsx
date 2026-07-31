import { useEffect, useRef, useState } from 'react';
import { CheckCircle, Info, RotateCcw, Save } from 'lucide-react';
import type { AppSettings, Task } from '../../../types';
import { useLanguageStore } from '../../../store';
import DateDisplay from '../../shared/DateDisplay';
import { formatCurrency, usdToIrr } from '../../../utils/dates';

interface Props {
  task: Task;
  isAdmin: boolean;
  settings: AppSettings;
  onSaveAmount: (usd: number) => Promise<void>;
  onRequestMarkPaid: (usd: number) => void;
  onRequestRevert: () => void;
  saving: boolean;
}

export default function PaymentPanel({
  task,
  isAdmin,
  settings,
  onSaveAmount,
  onRequestMarkPaid,
  onRequestRevert,
  saving,
}: Props) {
  const { t, language } = useLanguageStore();
  const [usd, setUsd] = useState(task.payment_amount_usd || 0);

  // Amounts stay an explicit save — auto-saving a half-typed number would
  // record "1" on the way to "18". But a background refresh must not overwrite
  // what is being typed either.
  const editingRef = useRef(false);
  editingRef.current = usd !== (task.payment_amount_usd || 0);

  useEffect(() => {
    if (!editingRef.current) setUsd(task.payment_amount_usd || 0);
  }, [task.id, task.payment_amount_usd]);

  const isPaid = task.payment_status === 'paid';
  const isPayable = task.status === 'approved' || isPaid;
  const amountDirty = usd !== (task.payment_amount_usd || 0);
  const amountValid = Number.isFinite(usd) && usd >= 0;

  return (
    <div className="stage-panel">
      <header className="stage-panel-header">
        <div>
          <h2>{t('tasks.payment')}</h2>
          <p>{t('tasks.payment_help')}</p>
        </div>
      </header>

      {/* Visible before approval too, so "when does this pay out?" has an answer
          on screen instead of the section simply not existing yet. */}
      {!isPayable && (
        <div className="stage-notice is-info" role="note">
          <Info size={18} aria-hidden="true" />
          <div>
            <strong>{t('tasks.payment_not_yet_title')}</strong>
            <span>{t('tasks.payment_not_yet_help')}</span>
          </div>
        </div>
      )}

      {isAdmin && isPayable && (
        <div className="payment-editor">
          <div className="payment-editor-row">
            <div className="form-group">
              <label className="form-label" htmlFor="task-payment-usd">
                {t('payments.amount_usd')}
              </label>
              <input
                id="task-payment-usd"
                type="number"
                className="form-input input-mono"
                value={usd}
                onChange={(event) => setUsd(Number(event.target.value))}
                min={0}
                step={0.01}
                disabled={saving}
              />
            </div>
            <button
              className="btn btn-secondary"
              onClick={() => void onSaveAmount(usd)}
              disabled={saving || !amountDirty || !amountValid}
            >
              <Save size={15} aria-hidden="true" />
              {t('common.save')}
            </button>
          </div>

          {usd > 0 && (
            <p className="payment-conversion">
              = {formatCurrency(usdToIrr(usd, settings.usd_to_irr_rate), 'IRR', language)}
            </p>
          )}

          {isPaid ? (
            <div className="payment-settled">
              <span className="status-badge payment-settled-badge">
                {t('payment_status.paid')}
              </span>
              <DateDisplay date={task.payment_date} />
              <button
                className="btn btn-warning btn-sm"
                onClick={onRequestRevert}
                disabled={saving}
              >
                <RotateCcw size={14} aria-hidden="true" />
                {t('payments.revert_pending')}
              </button>
            </div>
          ) : (
            <button
              className="btn btn-success"
              onClick={() => onRequestMarkPaid(usd)}
              disabled={saving || !amountValid || usd <= 0}
            >
              <CheckCircle size={15} aria-hidden="true" />
              {t('payments.mark_paid')}
            </button>
          )}
        </div>
      )}

      {!isAdmin && task.payment_amount_usd > 0 && (
        <div className="payment-member-view">
          <span className="payment-amount payment-amount-lg">
            {formatCurrency(task.payment_amount_usd, 'USD', language)}
          </span>
          <span className="payment-amount-irr">
            {formatCurrency(
              usdToIrr(task.payment_amount_usd, settings.usd_to_irr_rate),
              'IRR',
              language
            )}
          </span>
          <span className={`status-badge ${isPaid ? 'payment-settled-badge' : 'payment-pending-badge'}`}>
            {isPaid ? t('payment_status.paid') : t('payment_status.pending')}
          </span>
          {isPaid && <DateDisplay date={task.payment_date} />}
        </div>
      )}
    </div>
  );
}
