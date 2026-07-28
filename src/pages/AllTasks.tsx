import { useLanguageStore, useAppStore } from '../store';
import TaskTable from '../components/tasks/TaskTable';

export default function AllTasks() {
  const { t } = useLanguageStore();
  const { tasks } = useAppStore();

  return (
    <TaskTable
      tasks={tasks}
      title={t('nav.all_tasks')}
      subtitle={`${tasks.length} ${t('common.total')}`}
    />
  );
}
