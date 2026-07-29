import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useAppStore, useAuthStore, useLanguageStore } from '../store';
import TaskWorkspacePanel from '../components/tasks/workspace/TaskWorkspace';

export default function TaskWorkspacePage() {
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
          <div className="data-table-empty-icon" aria-hidden="true">
            📋
          </div>
          <div className="data-table-empty-text">{t('tasks.not_found')}</div>
          <p className="data-table-empty-help">{t('tasks.not_found_help')}</p>
          <button className="btn btn-secondary" onClick={() => navigate(-1)}>
            <ArrowLeft size={16} aria-hidden="true" />
            {t('common.back')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="task-workspace-page">
      <TaskWorkspacePanel task={task} onClose={() => navigate(-1)} />
    </div>
  );
}
