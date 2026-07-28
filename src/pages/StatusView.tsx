import { useParams } from 'react-router-dom';
import { useLanguageStore, useAppStore, useAuthStore } from '../store';
import TaskTable from '../components/tasks/TaskTable';

export default function StatusView() {
  const { status } = useParams<{ status: string }>();
  const { t } = useLanguageStore();
  const { user } = useAuthStore();
  const { tasks } = useAppStore();
  const isAdmin = user?.role === 'admin';

  const filteredTasks = tasks.filter((task) => {
    if (task.status !== status) return false;
    if (!isAdmin && task.assigned_to !== user?.id) return false;
    return true;
  });

  const statusLabel = status ? (t(`status.${status}`) || status) : '';

  return (
    <TaskTable
      tasks={filteredTasks}
      title={statusLabel}
      subtitle={`${filteredTasks.length} ${t('common.total')}`}
      showMember={isAdmin}
    />
  );
}
