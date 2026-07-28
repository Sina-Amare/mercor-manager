import { useState, useCallback, useEffect, useRef } from 'react';
import { Upload as UploadIcon, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { useLanguageStore, useAppStore, useToastStore } from '../store';
import { createTask, checkDuplicateTaskId } from '../api/tasks';

export default function UploadTasks() {
  const { t } = useLanguageStore();
  const { members, addTask } = useAppStore();
  const { addToast } = useToastStore();

  const [taskId, setTaskId] = useState('');
  const [body, setBody] = useState('');
  const [assignTo, setAssignTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // Duplicate detection state
  const [dupStatus, setDupStatus] = useState<'idle' | 'checking' | 'new' | 'duplicate'>('idle');
  const [dupMessage, setDupMessage] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Real-time duplicate check
  const checkDuplicate = useCallback(
    async (id: string) => {
      if (!id.trim()) {
        setDupStatus('idle');
        setDupMessage('');
        return;
      }
      setDupStatus('checking');
      try {
        const result = await checkDuplicateTaskId(id.trim());
        if (result.isDuplicate) {
          setDupStatus('duplicate');
          setDupMessage(`${t('upload.duplicate_other')} ${result.assignedToName}`);
        } else {
          setDupStatus('new');
          setDupMessage(t('upload.new_task'));
        }
      } catch {
        setDupStatus('idle');
      }
    },
    [t]
  );

  // Local check
  const localCheck = useCallback(
    (id: string) => {
      if (!id.trim()) return;
      const result = useAppStore.getState().checkDuplicate(id.trim());
      if (result.isDuplicate) {
        setDupStatus('duplicate');
        setDupMessage(`${t('upload.duplicate_other')} ${result.assignedTo?.name || 'unknown'}`);
      }
    },
    [t]
  );

  useEffect(() => {
    if (!taskId.trim()) {
      setDupStatus('idle');
      setDupMessage('');
      return;
    }

    localCheck(taskId);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      checkDuplicate(taskId);
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [taskId, checkDuplicate, localCheck]);

  const handleOpenConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskId.trim() || !body.trim() || !assignTo) return;
    if (dupStatus === 'duplicate') return;
    setShowConfirmModal(true);
  };

  const handleConfirmUpload = async () => {
    setShowConfirmModal(false);
    setLoading(true);
    try {
      const task = await createTask({
        task_id: taskId.trim(),
        body: body.trim(),
        assigned_to: assignTo,
      });
      addTask(task);
      addToast(t('upload.success'), 'success');
      setTaskId('');
      setBody('');
      setDupStatus('idle');
      setDupMessage('');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create task';
      addToast(message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const assignedMember = members.find((m) => m.id === assignTo);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('upload.title')}</h1>
          <p className="page-subtitle">{t('upload.subtitle')}</p>
        </div>
      </div>

      <div className="card" style={{ maxWidth: '640px' }}>
        <form onSubmit={handleOpenConfirm}>
          {/* Task ID with duplicate detection */}
          <div className="form-group">
            <label className="form-label" htmlFor="task-id">
              {t('upload.task_id_label')}
            </label>
            <input
              id="task-id"
              type="text"
              className="form-input input-mono"
              placeholder={t('upload.task_id_placeholder')}
              value={taskId}
              onChange={(e) => setTaskId(e.target.value)}
              required
              autoFocus
            />
            {dupStatus !== 'idle' && (
              <div
                className={`dup-check ${
                  dupStatus === 'checking'
                    ? 'is-checking'
                    : dupStatus === 'new'
                    ? 'is-new'
                    : 'is-duplicate'
                }`}
              >
                {dupStatus === 'checking' && <Loader2 size={16} className="spin" />}
                {dupStatus === 'new' && <CheckCircle2 size={16} />}
                {dupStatus === 'duplicate' && <AlertTriangle size={16} />}
                <span>{dupStatus === 'checking' ? t('upload.checking') : dupMessage}</span>
              </div>
            )}
          </div>

          {/* Task Body */}
          <div className="form-group">
            <label className="form-label" htmlFor="task-body">
              {t('upload.body_label')}
            </label>
            <textarea
              id="task-body"
              className="form-textarea"
              placeholder={t('upload.body_placeholder')}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              required
              rows={6}
            />
          </div>

          {/* Assign To */}
          <div className="form-group">
            <label className="form-label" htmlFor="assign-to">
              {t('upload.assign_label')}
            </label>
            <select
              id="assign-to"
              className="form-select"
              value={assignTo}
              onChange={(e) => setAssignTo(e.target.value)}
              required
            >
              <option value="">{t('upload.assign_placeholder')}</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} (@{m.username})
                </option>
              ))}
            </select>
          </div>

          {/* Submit */}
          <button
            type="submit"
            className="btn btn-primary btn-lg"
            disabled={loading || dupStatus === 'duplicate' || !taskId.trim() || !body.trim() || !assignTo}
            style={{ width: '100%' }}
          >
            {loading ? (
              <Loader2 size={18} className="spin" />
            ) : (
              <UploadIcon size={18} />
            )}
            {loading ? t('common.loading') : t('upload.submit')}
          </button>
        </form>
      </div>

      {/* Upload Confirmation Modal */}
      {showConfirmModal && (
        <>
          <div className="modal-backdrop" onClick={() => setShowConfirmModal(false)} />
          <div className="modal">
            <div className="modal-header">
              <h3 className="modal-title">Confirm Task Assignment</h3>
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setShowConfirmModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)' }}>
                Are you sure you want to create task <strong className="input-mono">{taskId}</strong> and assign it to <strong>{assignedMember?.name}</strong> (@{assignedMember?.username})?
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowConfirmModal(false)}>
                {t('common.cancel')}
              </button>
              <button className="btn btn-primary" onClick={handleConfirmUpload} disabled={loading}>
                <UploadIcon size={16} />
                Confirm & Create Task
              </button>
            </div>
          </div>
        </>
      )}

      {/* Spinner animation */}
      <style>{`
        .spin {
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
