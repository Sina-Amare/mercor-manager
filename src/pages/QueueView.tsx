import { Navigate, useParams } from 'react-router-dom';
import { useAppStore, useAuthStore, useLanguageStore } from '../store';
import TaskTable from '../components/tasks/TaskTable';
import { findQueue, tasksInQueue } from '../queues';

export default function QueueView() {
  const { queueId } = useParams<{ queueId: string }>();
  const { t } = useLanguageStore();
  const { user } = useAuthStore();
  const { tasks } = useAppStore();

  const queue = findQueue(queueId);

  // A member following an admin's link, or a stale bookmark, lands home rather
  // than on an empty page with no explanation.
  if (!queue) return <Navigate to="/" replace />;
  if (queue.audience === 'admin' && user?.role !== 'admin') return <Navigate to="/" replace />;

  const queueTasks = tasksInQueue(queue, tasks, user);

  return (
    <TaskTable
      tasks={queueTasks}
      title={t(queue.labelKey)}
      subtitle={t(queue.helpKey)}
      showMember={user?.role === 'admin'}
    />
  );
}
