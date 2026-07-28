import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useAppStore, useAuthStore, useLanguageStore } from '../store';
import TaskDetailPanel from '../components/tasks/TaskDetailPanel';

export default function TaskWorkspace() {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const { tasks } = useAppStore();
  const { user } = useAuthStore();
  const { t } = useLanguageStore();
  const task = tasks.find((candidate) => candidate.id === taskId);

  if (task && user?.role !== 'admin' && task.assigned_to !== user?.id) {
    return <Navigate to="/" replace />;
  }

  if (!task) {
    return (
      <div className="page">
        <div className="data-table-empty">
          <div className="data-table-empty-icon">📋</div>
          <div className="data-table-empty-text">{t('tasks.no_tasks')}</div>
          <button className="btn btn-secondary" onClick={() => navigate(-1)}>
            <ArrowLeft size={16} />
            {t('common.back')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="task-workspace-page">
      <TaskDetailPanel task={task} onClose={() => navigate(-1)} variant="page" />
    </div>
  );
}
