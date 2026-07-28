import { useAuthStore, useLanguageStore, useAppStore } from '../store';
import { formatCurrency, usdToIrr } from '../utils/dates';
import DateDisplay from '../components/shared/DateDisplay';
import StatusBadge from '../components/shared/StatusBadge';
import { useNavigate } from 'react-router-dom';

export default function Payments() {
  const { user } = useAuthStore();
  const { t } = useLanguageStore();
  const { tasks, members, settings } = useAppStore();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'admin';

  // For members, show only their tasks
  const relevantTasks = isAdmin ? tasks : tasks.filter((t) => t.assigned_to === user?.id);
  const paidTasks = relevantTasks.filter((t) => t.payment_status === 'paid');
  const pendingTasks = relevantTasks.filter((t) => t.status === 'approved' && t.payment_status !== 'paid');

  const totalPaidUsd = paidTasks.reduce((sum, t) => sum + t.payment_amount_usd, 0);
  const totalPendingUsd = pendingTasks.reduce((sum, t) => sum + t.payment_amount_usd, 0);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('payments.title')}</h1>
          <p className="page-subtitle">{t('payments.subtitle')}</p>
        </div>
      </div>

      {/* Summary */}
      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
        <div className="stat-card">
          <span className="stat-card-label">{t('dashboard.total_paid')}</span>
          <span className="stat-card-value" style={{ color: 'var(--color-success)' }}>
            {formatCurrency(totalPaidUsd, 'USD')}
          </span>
          <span className="payment-amount-irr">
            {formatCurrency(usdToIrr(totalPaidUsd, settings.usd_to_irr_rate), 'IRR')}
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-card-label">{t('dashboard.pending_payment')}</span>
          <span className="stat-card-value" style={{ color: 'var(--color-warning)' }}>
            {formatCurrency(totalPendingUsd, 'USD')}
          </span>
          <span className="payment-amount-irr">
            {formatCurrency(usdToIrr(totalPendingUsd, settings.usd_to_irr_rate), 'IRR')}
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-card-label">{t('payments.tasks_paid')}</span>
          <span className="stat-card-value">{paidTasks.length}</span>
        </div>
        <div className="stat-card">
          <span className="stat-card-label">{t('payments.tasks_pending')}</span>
          <span className="stat-card-value">{pendingTasks.length}</span>
        </div>
      </div>

      {/* Admin: Per-member table */}
      {isAdmin && (
        <div className="data-table-wrapper" style={{ marginTop: 'var(--space-6)' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('payments.member')}</th>
                <th>{t('payments.tasks_approved')}</th>
                <th>{t('payments.tasks_paid')}</th>
                <th>{t('payments.tasks_pending')}</th>
                <th>{t('payments.total_usd')}</th>
                <th>{t('payments.total_irr')}</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const mTasks = tasks.filter((t) => t.assigned_to === member.id);
                const mApproved = mTasks.filter((t) => t.status === 'approved').length;
                const mPaid = mTasks.filter((t) => t.payment_status === 'paid');
                const mPending = mTasks.filter((t) => t.status === 'approved' && t.payment_status !== 'paid');
                const mTotalPaid = mPaid.reduce((s, t) => s + t.payment_amount_usd, 0);

                return (
                  <tr key={member.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/member/${member.id}`)}>
                    <td>
                      <div className="member-cell">
                        <div className="member-avatar">{member.name.charAt(0).toUpperCase()}</div>
                        {member.name}
                      </div>
                    </td>
                    <td>{mApproved + mPaid.length}</td>
                    <td style={{ color: 'var(--color-success)', fontWeight: 'var(--weight-semibold)' }}>
                      {mPaid.length}
                    </td>
                    <td style={{ color: 'var(--color-warning)', fontWeight: 'var(--weight-semibold)' }}>
                      {mPending.length}
                    </td>
                    <td>
                      <span className="payment-amount">{formatCurrency(mTotalPaid, 'USD')}</span>
                    </td>
                    <td>
                      <span className="payment-amount-irr">
                        {formatCurrency(usdToIrr(mTotalPaid, settings.usd_to_irr_rate), 'IRR')}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Task payment history */}
      <div style={{ marginTop: 'var(--space-6)' }}>
        <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', marginBottom: 'var(--space-4)' }}>
          {t('payments.tasks_paid')}
        </h2>
        <div className="data-table-wrapper">
          {paidTasks.length === 0 ? (
            <div className="data-table-empty">
              <div className="data-table-empty-icon">💰</div>
              <div className="data-table-empty-text">No paid tasks yet</div>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('tasks.task_id')}</th>
                  {isAdmin && <th>{t('tasks.assigned_to')}</th>}
                  <th>{t('tasks.status')}</th>
                  <th>{t('payments.amount_usd')}</th>
                  <th>IRR</th>
                  <th>{t('tasks.created')}</th>
                </tr>
              </thead>
              <tbody>
                {paidTasks.map((task) => (
                  <tr key={task.id}>
                    <td><span className="task-id">{task.task_id}</span></td>
                    {isAdmin && (
                      <td>
                        <div className="member-cell">
                          <div className="member-avatar">
                            {task.expand?.assigned_to?.name?.charAt(0).toUpperCase() || '?'}
                          </div>
                          {task.expand?.assigned_to?.name || '—'}
                        </div>
                      </td>
                    )}
                    <td><StatusBadge status={task.status} /></td>
                    <td><span className="payment-amount">{formatCurrency(task.payment_amount_usd, 'USD')}</span></td>
                    <td>
                      <span className="payment-amount-irr">
                        {formatCurrency(usdToIrr(task.payment_amount_usd, settings.usd_to_irr_rate), 'IRR')}
                      </span>
                    </td>
                    <td><DateDisplay date={task.payment_date} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
