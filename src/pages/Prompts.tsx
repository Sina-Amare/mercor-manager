import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Copy,
  Globe2,
  Loader2,
  MessageSquareText,
  Pencil,
  Plus,
  Search,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import { useAppStore, useAuthStore, useLanguageStore, useToastStore } from '../store';
import {
  createPrompt,
  deletePrompt,
  fetchPrompts,
  subscribeToPrompts,
  updatePrompt,
} from '../api/prompts';
import type { PromptVisibility, SavedPrompt } from '../types';
import DateDisplay from '../components/shared/DateDisplay';

function sortPrompts(prompts: SavedPrompt[]) {
  return [...prompts].sort(
    (first, second) =>
      new Date(second.updated).getTime() - new Date(first.updated).getTime()
  );
}

function upsertPrompt(prompts: SavedPrompt[], prompt: SavedPrompt) {
  return sortPrompts([prompt, ...prompts.filter((candidate) => candidate.id !== prompt.id)]);
}

export default function Prompts() {
  const { user } = useAuthStore();
  const { members } = useAppStore();
  const { t } = useLanguageStore();
  const { addToast } = useToastStore();
  const [prompts, setPrompts] = useState<SavedPrompt[]>([]);
  const [activeTab, setActiveTab] = useState<PromptVisibility>('public');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [editingPrompt, setEditingPrompt] = useState<SavedPrompt | null>(null);
  const [editorVisibility, setEditorVisibility] = useState<PromptVisibility>('personal');
  const [editorOpen, setEditorOpen] = useState(false);
  const [formTitle, setFormTitle] = useState('');
  const [formBody, setFormBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingPrompt, setDeletingPrompt] = useState<SavedPrompt | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!user) return;

    let active = true;
    let refreshInFlight = false;
    let refreshQueued = false;
    let realtimeRevision = 0;

    const refresh = async () => {
      if (refreshInFlight) {
        refreshQueued = true;
        return;
      }

      refreshInFlight = true;
      const revisionAtStart = realtimeRevision;
      try {
        const latestPrompts = await fetchPrompts(user.id);
        if (active && revisionAtStart === realtimeRevision) {
          setPrompts(sortPrompts(latestPrompts));
          setLoadError('');
        }
      } catch (error) {
        if (active) {
          const message = error instanceof Error ? error.message : t('prompts.load_error');
          setLoadError(message);
        }
      } finally {
        if (active) setLoading(false);
        refreshInFlight = false;
        if (active && refreshQueued) {
          refreshQueued = false;
          void refresh();
        }
      }
    };

    const unsubscribe = subscribeToPrompts(
      ({ eventType, newPrompt, oldPrompt }) => {
        if (!active) return;
        realtimeRevision += 1;

        if (eventType === 'DELETE') {
          const deletedId = oldPrompt?.id;
          if (deletedId) {
            setPrompts((current) => current.filter((prompt) => prompt.id !== deletedId));
          }
        } else if (newPrompt) {
          const isVisible =
            newPrompt.visibility === 'public' || newPrompt.owner_id === user.id;
          setPrompts((current) =>
            isVisible
              ? upsertPrompt(current, newPrompt)
              : current.filter((prompt) => prompt.id !== newPrompt.id)
          );
        }

        void refresh();
      },
      (status) => {
        if (
          status === 'SUBSCRIBED' ||
          status === 'CHANNEL_ERROR' ||
          status === 'TIMED_OUT' ||
          status === 'CLOSED'
        ) {
          void refresh();
        }
      }
    );

    const handleFocus = () => void refresh();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const syncTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 4000);

    void refresh();
    window.addEventListener('focus', handleFocus);
    window.addEventListener('online', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      active = false;
      window.clearInterval(syncTimer);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('online', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
      unsubscribe();
    };
  }, [t, user]);

  const publicCount = prompts.filter((prompt) => prompt.visibility === 'public').length;
  const personalCount = prompts.filter((prompt) => prompt.visibility === 'personal').length;
  const visiblePrompts = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    return prompts.filter((prompt) => {
      if (prompt.visibility !== activeTab) return false;
      if (!normalizedSearch) return true;
      return `${prompt.title}\n${prompt.body}`.toLocaleLowerCase().includes(normalizedSearch);
    });
  }, [activeTab, prompts, search]);

  const openCreate = (visibility: PromptVisibility) => {
    setEditingPrompt(null);
    setEditorVisibility(visibility);
    setFormTitle('');
    setFormBody('');
    setEditorOpen(true);
  };

  const openEdit = (prompt: SavedPrompt) => {
    setEditingPrompt(prompt);
    setEditorVisibility(prompt.visibility);
    setFormTitle(prompt.title);
    setFormBody(prompt.body);
    setEditorOpen(true);
  };

  const closeEditor = () => {
    if (saving) return;
    setEditorOpen(false);
    setEditingPrompt(null);
    setFormTitle('');
    setFormBody('');
  };

  const handleSave = async () => {
    if (!user || saving) return;
    if (!formTitle.trim() || !formBody.trim()) {
      addToast(t('prompts.required'), 'error');
      return;
    }

    setSaving(true);
    try {
      const saved = editingPrompt
        ? await updatePrompt(
            editingPrompt.id,
            { title: formTitle, body: formBody },
            user
          )
        : await createPrompt(
            { title: formTitle, body: formBody, visibility: editorVisibility },
            user
          );
      setPrompts((current) => upsertPrompt(current, saved));
      setActiveTab(saved.visibility);
      addToast(
        editingPrompt ? t('prompts.updated_success') : t('prompts.created_success'),
        'success'
      );
      setEditorOpen(false);
      setEditingPrompt(null);
      setFormTitle('');
      setFormBody('');
    } catch (error) {
      const message = error instanceof Error ? error.message : t('prompts.save_error');
      addToast(message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!user || !deletingPrompt || deleting) return;
    setDeleting(true);
    try {
      await deletePrompt(deletingPrompt.id, user);
      setPrompts((current) =>
        current.filter((prompt) => prompt.id !== deletingPrompt.id)
      );
      setDeletingPrompt(null);
      addToast(t('prompts.deleted_success'), 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : t('prompts.delete_error');
      addToast(message, 'error');
    } finally {
      setDeleting(false);
    }
  };

  const handleCopy = async (prompt: SavedPrompt) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(prompt.body);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = prompt.body;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand('copy');
        textarea.remove();
        if (!copied) throw new Error('Copy failed');
      }
      addToast(t('prompts.copied'), 'success');
    } catch {
      addToast(t('prompts.copy_error'), 'error');
    }
  };

  const canManage = (prompt: SavedPrompt) =>
    prompt.visibility === 'public'
      ? user?.role === 'admin'
      : prompt.owner_id === user?.id;

  return (
    <div className="page prompts-page">
      <div className="page-header prompts-page-header">
        <div>
          <h1 className="page-title">{t('prompts.title')}</h1>
          <p className="page-subtitle">{t('prompts.subtitle')}</p>
        </div>
        {activeTab === 'personal' || user?.role === 'admin' ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => openCreate(activeTab)}
          >
            <Plus size={17} />
            {activeTab === 'public'
              ? t('prompts.add_public')
              : t('prompts.add_personal')}
          </button>
        ) : null}
      </div>

      <div className="prompts-toolbar">
        <div className="prompts-tabs" role="tablist" aria-label={t('prompts.title')}>
          <button
            type="button"
            className={`prompts-tab ${activeTab === 'public' ? 'active' : ''}`}
            onClick={() => setActiveTab('public')}
            role="tab"
            aria-selected={activeTab === 'public'}
          >
            <Globe2 size={17} />
            {t('prompts.public_tab')}
            <span>{publicCount}</span>
          </button>
          <button
            type="button"
            className={`prompts-tab ${activeTab === 'personal' ? 'active' : ''}`}
            onClick={() => setActiveTab('personal')}
            role="tab"
            aria-selected={activeTab === 'personal'}
          >
            <UserRound size={17} />
            {t('prompts.personal_tab')}
            <span>{personalCount}</span>
          </button>
        </div>

        <label className="prompts-search">
          <Search size={17} aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('prompts.search')}
            aria-label={t('prompts.search')}
          />
        </label>
      </div>

      {loadError ? (
        <div className="prompts-error" role="alert">
          <AlertCircle size={18} />
          <span>{loadError}</span>
        </div>
      ) : null}

      {loading ? (
        <div className="prompts-loading" role="status">
          <Loader2 size={22} className="spin" />
          {t('common.loading')}
        </div>
      ) : visiblePrompts.length === 0 ? (
        <div className="prompts-empty">
          <div className="prompts-empty-icon">
            <MessageSquareText size={28} />
          </div>
          <h2>
            {search
              ? t('prompts.no_results')
              : activeTab === 'public'
                ? t('prompts.no_public')
                : t('prompts.no_personal')}
          </h2>
          <p>
            {activeTab === 'public'
              ? t('prompts.no_public_desc')
              : t('prompts.no_personal_desc')}
          </p>
          {!search && (activeTab === 'personal' || user?.role === 'admin') ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => openCreate(activeTab)}
            >
              <Plus size={16} />
              {activeTab === 'public'
                ? t('prompts.add_public')
                : t('prompts.add_personal')}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="prompts-grid">
          {visiblePrompts.map((prompt) => {
            const creator = members.find((member) => member.id === prompt.created_by);
            return (
              <article className="prompt-card" key={prompt.id}>
                <div className="prompt-card-header">
                  <div>
                    <span className={`prompt-scope prompt-scope-${prompt.visibility}`}>
                      {prompt.visibility === 'public' ? (
                        <Globe2 size={13} />
                      ) : (
                        <UserRound size={13} />
                      )}
                      {prompt.visibility === 'public'
                        ? t('prompts.public_badge')
                        : t('prompts.personal_badge')}
                    </span>
                    <h2 dir="auto">{prompt.title}</h2>
                  </div>
                  <div className="prompt-card-actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => void handleCopy(prompt)}
                    >
                      <Copy size={15} />
                      {t('prompts.copy')}
                    </button>
                    {canManage(prompt) ? (
                      <>
                        <button
                          type="button"
                          className="btn btn-ghost btn-icon btn-sm"
                          onClick={() => openEdit(prompt)}
                          aria-label={`${t('common.edit')} ${prompt.title}`}
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-icon btn-sm prompt-delete-button"
                          onClick={() => setDeletingPrompt(prompt)}
                          aria-label={`${t('common.delete')} ${prompt.title}`}
                        >
                          <Trash2 size={15} />
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
                <pre className="prompt-body" dir="auto">{prompt.body}</pre>
                <div className="prompt-card-footer">
                  <span>
                    {prompt.visibility === 'public'
                      ? creator?.name || t('prompts.team_prompt')
                      : t('prompts.only_you')}
                  </span>
                  <DateDisplay date={prompt.updated} />
                </div>
              </article>
            );
          })}
        </div>
      )}

      {editorOpen ? (
        <>
          <button
            type="button"
            className="modal-backdrop"
            onClick={closeEditor}
            aria-label={t('common.close')}
          />
          <div className="modal prompt-editor-modal" role="dialog" aria-modal="true">
            <div className="modal-header">
              <div>
                <h2 className="modal-title">
                  {editingPrompt
                    ? t('prompts.edit_prompt')
                    : editorVisibility === 'public'
                      ? t('prompts.add_public')
                      : t('prompts.add_personal')}
                </h2>
                <p className="prompt-editor-scope">
                  {editorVisibility === 'public'
                    ? t('prompts.public_help')
                    : t('prompts.personal_help')}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-icon btn-sm"
                onClick={closeEditor}
                aria-label={t('common.close')}
              >
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label" htmlFor="prompt-title">
                  {t('prompts.prompt_title')}
                </label>
                <input
                  id="prompt-title"
                  className="form-input"
                  value={formTitle}
                  onChange={(event) => setFormTitle(event.target.value)}
                  placeholder={t('prompts.title_placeholder')}
                  maxLength={120}
                  dir="auto"
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="prompt-body">
                  {t('prompts.prompt_content')}
                </label>
                <textarea
                  id="prompt-body"
                  className="form-textarea prompt-editor-textarea"
                  value={formBody}
                  onChange={(event) => setFormBody(event.target.value)}
                  placeholder={t('prompts.content_placeholder')}
                  maxLength={50000}
                  dir="auto"
                />
                <span className="prompt-character-count">
                  {formBody.length.toLocaleString()} / 50,000
                </span>
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={closeEditor}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleSave()}
                disabled={saving}
              >
                {saving ? <Loader2 size={16} className="spin" /> : null}
                {t('common.save')}
              </button>
            </div>
          </div>
        </>
      ) : null}

      {deletingPrompt ? (
        <>
          <button
            type="button"
            className="modal-backdrop"
            onClick={() => !deleting && setDeletingPrompt(null)}
            aria-label={t('common.close')}
          />
          <div className="modal prompt-delete-modal" role="alertdialog" aria-modal="true">
            <div className="modal-header">
              <h2 className="modal-title">{t('prompts.delete_title')}</h2>
            </div>
            <div className="modal-body">
              <p>{t('prompts.delete_question')}</p>
              <strong dir="auto">{deletingPrompt.title}</strong>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setDeletingPrompt(null)}
                disabled={deleting}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => void handleDelete()}
                disabled={deleting}
              >
                {deleting ? <Loader2 size={16} className="spin" /> : <Trash2 size={16} />}
                {t('common.delete')}
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
