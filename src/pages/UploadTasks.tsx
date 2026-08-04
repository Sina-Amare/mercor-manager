import { useState, useCallback, useEffect, useRef } from 'react';
import { Upload as UploadIcon, CheckCircle2, AlertTriangle, Loader2, Wand2, X } from 'lucide-react';
import { useLanguageStore, useAppStore, useToastStore } from '../store';
import { createTask, checkDuplicateTaskId } from '../api/tasks';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import { detectTaskId, normalizeTaskIdInput } from '../utils/taskId';

export default function UploadTasks() {
  const { t } = useLanguageStore();
  const { members, addTask } = useAppStore();
  const { addToast } = useToastStore();

  const [taskId, setTaskId] = useState('');
  const [body, setBody] = useState('');
  const [assignTo, setAssignTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // Tracks whether the ID in the field was found in the pasted body rather than
  // typed. Only an auto-filled value may be replaced by a later paste; anything
  // typed by hand is left alone.
  const [detected, setDetected] = useState<{ id: string; candidates: number } | null>(null);
  const taskIdIsAuto = detected !== null && detected.id === taskId;

  // Duplicate detection state
  const [dupStatus, setDupStatus] = useState<'idle' | 'checking' | 'new' | 'duplicate'>('idle');
  const [dupMessage, setDupMessage] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latestCheckRef = useRef('');
  const submissionLockRef = useRef(false);
  const assignableMembers = members.filter(
    (member) => member.role === 'member' && member.is_active
  );

  // Real-time duplicate check
  const checkDuplicate = useCallback(
    async (id: string) => {
      if (!id.trim()) {
        latestCheckRef.current = '';
        setDupStatus('idle');
        setDupMessage('');
        return;
      }
      latestCheckRef.current = id.trim();
      setDupStatus('checking');
      try {
        const result = await checkDuplicateTaskId(id.trim());
        if (latestCheckRef.current !== id.trim()) return;
        if (result.isDuplicate) {
          setDupStatus('duplicate');
          setDupMessage(
            result.isRecycled
              ? t('upload.duplicate_recycled')
              : `${t('upload.duplicate_other')} ${result.assignedToName}`
          );
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

  // Pull the ID out of whatever was pasted into the body.
  const handleBodyChange = (value: string) => {
    setBody(value);
    if (taskId.trim() && !taskIdIsAuto) return; // never overwrite a typed ID

    const found = detectTaskId(value);
    if (found) {
      setDetected({ id: found.id, candidates: found.candidates });
      setTaskId(found.id);
    } else if (taskIdIsAuto) {
      setDetected(null);
      setTaskId('');
    }
  };

  const handleTaskIdChange = (value: string) => {
    // Pasting the whole task page into this field should still leave just the ID.
    setTaskId(normalizeTaskIdInput(value));
    setDetected(null);
  };

  const handleOpenConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskId.trim() || !body.trim() || !assignTo) return;
    if (dupStatus !== 'new') return;
    setShowConfirmModal(true);
  };

  const handleConfirmUpload = async () => {
    if (submissionLockRef.current) return;
    submissionLockRef.current = true;
    setShowConfirmModal(false);
    setLoading(true);
    try {
      const duplicate = await checkDuplicateTaskId(taskId.trim());
      if (duplicate.isDuplicate) {
        setDupStatus('duplicate');
        const message = duplicate.isRecycled
          ? t('upload.duplicate_recycled')
          : `${t('upload.duplicate_other')} ${duplicate.assignedToName}`;
        setDupMessage(message);
        addToast(
          duplicate.isRecycled ? t('upload.restore_recycled') : t('upload.duplicate_same'),
          'warning'
        );
        return;
      }
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
      submissionLockRef.current = false;
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
              onChange={(e) => handleTaskIdChange(e.target.value)}
              required
              autoFocus
            />

            {/* Say where the ID came from. An input that fills itself with no
                explanation is worse than one you have to fill in. */}
            {taskIdIsAuto && (
              <div className="task-id-detected" role="status">
                <Wand2 size={14} aria-hidden="true" />
                <span>
                  {detected.candidates > 1
                    ? t('upload.detected_ambiguous').replace(
                        '{count}',
                        String(detected.candidates)
                      )
                    : t('upload.detected')}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setDetected(null);
                    setTaskId('');
                  }}
                >
                  <X size={13} aria-hidden="true" />
                  {t('upload.detected_clear')}
                </button>
              </div>
            )}

            {dupStatus !== 'idle' && (
              <div
                role="status"
                aria-live="polite"
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
              onChange={(e) => handleBodyChange(e.target.value)}
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
              {assignableMembers.map((m) => (
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
            disabled={loading || dupStatus !== 'new' || !taskId.trim() || !body.trim() || !assignTo}
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

      {/* Creating a task hands work to a named person, so it confirms — and now
          says who, in their language. */}
      <ConfirmDialog
        open={showConfirmModal}
        title={t('upload.confirm_title')}
        confirmLabel={t('upload.confirm_action')}
        busy={loading}
        onCancel={() => setShowConfirmModal(false)}
        onConfirm={() => void handleConfirmUpload()}
      >
        <p className="confirm-copy">
          {t('upload.confirm_body')
            .replace('{task}', taskId)
            .replace('{member}', assignedMember?.name || '')}
        </p>
      </ConfirmDialog>

    </div>
  );
}
