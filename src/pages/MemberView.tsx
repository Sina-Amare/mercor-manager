import { useParams } from 'react-router-dom';
import { useLanguageStore, useAppStore } from '../store';
import TaskTable from '../components/tasks/TaskTable';
import { formatCurrency, formatNumber, usdToIrr } from '../utils/dates';

export default function MemberView() {
  const { memberId } = useParams<{ memberId: string }>();
  const { t, language } = useLanguageStore();
  const { tasks, members, settings, getMemberStats } = useAppStore();

  const member = members.find((m) => m.id === memberId);
  const memberTasks = tasks.filter((t) => t.assigned_to === memberId);
  const stats = memberId ? getMemberStats(memberId) : null;

  if (!member) {
    return (
      <div className="page">
        <h1 className="page-title">Member not found</h1>
      </div>
    );
  }

  return (
    <div>
      {/* Stats */}
      <div className="page" style={{ paddingBottom: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', marginBottom: 'var(--space-5)' }}>
          <div className="member-avatar" style={{ width: '48px', height: '48px', fontSize: 'var(--text-lg)' }}>
            {member.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-bold)' }}>
              {member.name}
            </h2>
            <p className="latin-text" style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
              @{member.username}
            </p>
          </div>
        </div>

        {stats && (
          <div className="stats-grid">
            <div className="stat-card">
              <span className="stat-card-label">{t('members.total_tasks')}</span>
              <span className="stat-card-value">{formatNumber(stats.totalTasks, language)}</span>
            </div>
            <div className="stat-card">
              <span className="stat-card-label">{t('members.approved_tasks')}</span>
              <span className="stat-card-value" style={{ color: 'var(--color-success)' }}>{formatNumber(stats.approved, language)}</span>
            </div>
            <div className="stat-card">
              <span className="stat-card-label">{t('dashboard.total_paid')}</span>
              <span className="stat-card-value">{formatCurrency(stats.totalPaidUsd, 'USD', language)}</span>
              <span className="payment-amount-irr">
                {formatCurrency(usdToIrr(stats.totalPaidUsd, settings.usd_to_irr_rate), 'IRR', language)}
              </span>
            </div>
            <div className="stat-card">
              <span className="stat-card-label">{t('dashboard.pending_payment')}</span>
              <span className="stat-card-value">{formatCurrency(stats.totalPendingUsd, 'USD', language)}</span>
            </div>
          </div>
        )}
      </div>

      <TaskTable
        tasks={memberTasks}
        title={`${t('nav.all_tasks')} — ${member.name}`}
        showMember={false}
      />
    </div>
  );
}
