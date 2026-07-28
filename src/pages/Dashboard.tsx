import {
  BarChart3,
  CheckCircle2,
  Clock,
  ClipboardList,
  DollarSign,
  AlertCircle,
  Users,
  TrendingUp,
} from 'lucide-react';
import { useAuthStore, useLanguageStore, useAppStore } from '../store';
import { formatCurrency, usdToIrr } from '../utils/dates';
import { useNavigate } from 'react-router-dom';

export default function Dashboard() {
  const { user } = useAuthStore();
  const { t } = useLanguageStore();
  const { tasks, members, settings } = useAppStore();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'admin';
  const teamMembers = members.filter((member) => member.role === 'member' && member.is_active);

  // Filter tasks for member view
  const myTasks = isAdmin ? tasks : tasks.filter((t) => t.assigned_to === user?.id);

  const stats = {
    total: myTasks.length,
    assigned: myTasks.filter((t) => t.status === 'assigned').length,
    working: myTasks.filter((t) => t.status === 'working').length,
    needsReview: myTasks.filter((t) =>
      ['swf', 'swof', 'member_discarded'].includes(t.status)
    ).length,
    inProgress: myTasks.filter((t) =>
      ['in_studio', 'in_review', 'on_hold', 'sent_back'].includes(t.status)
    ).length,
    approved: myTasks.filter((t) => t.status === 'approved').length,
    totalPaidUsd: myTasks
      .filter((t) => t.payment_status === 'paid')
      .reduce((sum, t) => sum + t.payment_amount_usd, 0),
    pendingPaymentUsd: myTasks
      .filter((t) => t.status === 'approved' && t.payment_status !== 'paid')
      .reduce((sum, t) => sum + t.payment_amount_usd, 0),
  };

  const statCards = [
    {
      label: t('dashboard.total_tasks'),
      value: stats.total,
      icon: BarChart3,
      color: 'var(--color-primary)',
      bg: 'var(--color-primary-50)',
    },
    {
      label: t('dashboard.assigned'),
      value: stats.assigned,
      icon: ClipboardList,
      color: 'var(--color-info)',
      bg: 'var(--color-info-bg)',
    },
    {
      label: t('dashboard.in_progress'),
      value: stats.working + stats.inProgress,
      icon: Clock,
      color: 'var(--color-warning)',
      bg: 'var(--color-warning-bg)',
    },
    {
      label: t('dashboard.approved'),
      value: stats.approved,
      icon: CheckCircle2,
      color: 'var(--color-success)',
      bg: 'var(--color-success-bg)',
    },
  ];

  if (isAdmin) {
    statCards.push({
      label: t('dashboard.needs_review'),
      value: stats.needsReview,
      icon: AlertCircle,
      color: 'var(--color-danger)',
      bg: 'var(--color-danger-bg)',
    });
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">
            {t('dashboard.welcome')}, {user?.name} 👋
          </h1>
          <p className="page-subtitle">{t('dashboard.overview')}</p>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="stats-grid">
        {statCards.map((card) => (
          <div key={card.label} className="stat-card">
            <div
              className="stat-card-icon"
              style={{ background: card.bg, color: card.color }}
            >
              <card.icon size={22} />
            </div>
            <span className="stat-card-label">{card.label}</span>
            <span className="stat-card-value">{card.value}</span>
          </div>
        ))}
      </div>

      {/* Payment Summary */}
      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
        <div className="stat-card">
          <div
            className="stat-card-icon"
            style={{ background: 'var(--color-success-bg)', color: 'var(--color-success)' }}
          >
            <DollarSign size={22} />
          </div>
          <span className="stat-card-label">{t('dashboard.total_paid')}</span>
          <span className="stat-card-value">{formatCurrency(stats.totalPaidUsd, 'USD')}</span>
          <span className="payment-amount-irr">
            {formatCurrency(usdToIrr(stats.totalPaidUsd, settings.usd_to_irr_rate), 'IRR')}
          </span>
        </div>
        <div className="stat-card">
          <div
            className="stat-card-icon"
            style={{ background: 'var(--color-warning-bg)', color: 'var(--color-warning)' }}
          >
            <TrendingUp size={22} />
          </div>
          <span className="stat-card-label">{t('dashboard.pending_payment')}</span>
          <span className="stat-card-value">{formatCurrency(stats.pendingPaymentUsd, 'USD')}</span>
          <span className="payment-amount-irr">
            {formatCurrency(usdToIrr(stats.pendingPaymentUsd, settings.usd_to_irr_rate), 'IRR')}
          </span>
        </div>
      </div>

      {/* Admin: Member Overview Cards */}
      {isAdmin && teamMembers.length > 0 && (
        <div style={{ marginTop: 'var(--space-6)' }}>
          <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', marginBottom: 'var(--space-4)' }}>
            <Users size={20} style={{ display: 'inline', verticalAlign: 'middle', marginInlineEnd: '8px' }} />
            {t('members.title')}
          </h2>
          <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
            {teamMembers.map((member) => {
              const memberTasks = tasks.filter((t) => t.assigned_to === member.id);
              const memberApproved = memberTasks.filter((t) => t.status === 'approved').length;
              const memberPaid = memberTasks.filter((t) => t.payment_status === 'paid').length;
              return (
                <article
                  role="button"
                  tabIndex={0}
                  key={member.id}
                  className="card member-overview-card"
                  onClick={() => navigate(`/member/${member.id}`)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      navigate(`/member/${member.id}`);
                    }
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
                    <div className="member-avatar" style={{ width: '40px', height: '40px', fontSize: 'var(--text-base)' }}>
                      {member.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontWeight: 'var(--weight-semibold)' }}>{member.name}</div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                        @{member.username}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-2)', textAlign: 'center' }}>
                    <div>
                      <div style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-bold)' }}>
                        {memberTasks.length}
                      </div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                        {t('members.total_tasks')}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-bold)', color: 'var(--color-success)' }}>
                        {memberApproved}
                      </div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                        {t('members.approved_tasks')}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-bold)', color: 'var(--color-primary)' }}>
                        {memberPaid}
                      </div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                        {t('members.paid_tasks')}
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
