import { useParams } from 'react-router-dom';
import { useLanguageStore, useAppStore, useAuthStore } from '../store';
import TaskTable from '../components/tasks/TaskTable';
import { TASK_STATUSES, type TaskStatus } from '../types';
import { formatNumber } from '../utils/dates';

interface Props {
  fixedStatus?: TaskStatus;
  fixedStatuses?: readonly TaskStatus[];
  titleKey?: string;
}

export default function StatusView({ fixedStatus, fixedStatuses, titleKey }: Props) {
  const { status } = useParams<{ status: string }>();
  const { t, language } = useLanguageStore();
  const { user } = useAuthStore();
  const { tasks } = useAppStore();
  const isAdmin = user?.role === 'admin';
  const routeStatus = TASK_STATUSES.find((item) => item === status);
  const activeStatus = fixedStatus || routeStatus;
  const activeStatuses = fixedStatuses || (activeStatus ? [activeStatus] : []);

  const filteredTasks = tasks.filter((task) => {
    if (!activeStatuses.includes(task.status)) return false;
    if (!isAdmin && task.assigned_to !== user?.id) return false;
    return true;
  });

  const statusLabel = titleKey
    ? t(titleKey)
    : activeStatuses.length === 1
      ? t(`status.${activeStatuses[0]}`)
      : t('tasks.no_tasks');

  return (
    <TaskTable
      tasks={filteredTasks}
      title={statusLabel}
      subtitle={`${formatNumber(filteredTasks.length, language)} ${t('common.total')}`}
      showMember={isAdmin}
    />
  );
}
