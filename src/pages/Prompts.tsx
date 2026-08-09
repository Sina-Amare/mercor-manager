import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Globe2,
  Loader2,
  MessageSquareText,
  Pencil,
  Pin,
  PinOff,
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
  PromptConflictError,
} from '../api/prompts';
import {
  fetchPromptPins,
  pinPrompt,
  reorderPromptPins,
  subscribeToPromptPins,
  unpinPrompt,
} from '../api/promptPins';
import type { PromptPin, PromptVisibility, SavedPrompt } from '../types';
import DateDisplay from '../components/shared/DateDisplay';
import CopyButton from '../components/shared/CopyButton';
import { formatNumber } from '../utils/dates';

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
  const { t, language } = useLanguageStore();
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
  const [pins, setPins] = useState<PromptPin[]>([]);
  const [pinBusy, setPinBusy] = useState(false);
  // A write must invalidate a read that is already in flight, and the read
  // lives inside the effect's closure — so the counter has to outlive both.
  const pinsRevision = useRef(0);
  // Re-entrancy guard that does not lag a render behind, so the arrows can stay
  // enabled while a write is running instead of vanishing under the pointer.
  const pinBusyRef = useRef(false);
  // Pin writes run in sequence. A click during a write is queued, not dropped.
  const pinQueue = useRef<Promise<void>>(Promise.resolve());
  // Which control to put focus back on once the strip has re-rendered.
  const [focusAfterMove, setFocusAfterMove] = useState<string | null>(null);
  const [moveAnnouncement, setMoveAnnouncement] = useState('');

  // The id, not the object. `publicUser()` mints a fresh object on every
  // login/updateUser, and both fire several times on a normal page load — the
  // session restore, the auth-state callback, and the roster refresh. Depending
  // on the object tore this whole effect down and rebuilt it each time, so the
  // page opened three realtime channels in a row and closed two of them. A
  // change landing in one of those gaps is simply missed, which is what "it
  // didn't sync until I refreshed" looks like from the outside.
  const userId = user?.id;

  useEffect(() => {
    if (!userId) return;

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
      const pinsAtStart = pinsRevision.current;
      try {
        // Pins are a convenience on top of the list, so they are not allowed to
        // fail the list. An older build against a newer database, or the other
        // way round, still shows the prompts.
        const [latestPrompts, latestPins] = await Promise.all([
          fetchPrompts(userId),
          fetchPromptPins().catch(() => [] as PromptPin[]),
        ]);
        if (active && revisionAtStart === realtimeRevision) {
          setPrompts(sortPrompts(latestPrompts));
          setLoadError('');
          // A reorder that started after this read must not be undone by it.
          // The prompts guard above cannot cover this: it counts realtime
          // events, and a local write is not one.
          if (pinsAtStart === pinsRevision.current) setPins(latestPins);
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
            newPrompt.visibility === 'public' || newPrompt.owner_id === userId;
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

    // A pin written on the other laptop should land here too.
    const unsubscribePins = subscribeToPromptPins(
      () => {
        if (!active) return;
        realtimeRevision += 1;
        void refresh();
      },
      (status) => {
        if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'CLOSED') {
          void refresh();
        }
      }
    );

    // Realtime plus a slow backstop, matching the task subscription.
    const handleFocus = () => void refresh();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void refresh();
    };

    const backstop = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 60_000);

    void refresh();
    window.addEventListener('focus', handleFocus);
    window.addEventListener('online', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      active = false;
      window.clearInterval(backstop);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('online', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
      unsubscribe();
      unsubscribePins();
    };
  }, [t, userId]);

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
            user,
            editingPrompt.updated
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
      if (error instanceof PromptConflictError) {
        addToast(t('prompts.conflict'), 'warning');
      } else {
        addToast(error instanceof Error ? error.message : t('prompts.save_error'), 'error');
      }
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

  // ── Pins ───────────────────────────────────────────────────────────────────
  // A pin points at a prompt id, so one whose prompt has gone — deleted, or a
  // shared prompt that stopped being shared — is dropped from the strip rather
  // than rendered as a blank row. The database cascade removes the row itself.
  const pinnedPrompts = useMemo(() => {
    const byId = new Map(prompts.map((prompt) => [prompt.id, prompt]));
    return pins
      .map((pin) => byId.get(pin.prompt_id))
      .filter((prompt): prompt is SavedPrompt => Boolean(prompt));
  }, [pins, prompts]);

  const isPinned = (promptId: string) => pins.some((pin) => pin.prompt_id === promptId);

  /**
   * Runs pin writes one after another instead of dropping the ones that arrive
   * while another is in flight.
   *
   * Walking a pin from fifth place to first is four clicks in about a second.
   * The previous guard returned early for every click that landed during the
   * ~half-second write-and-reread, so most of them vanished — and because the
   * arrows stay enabled (disabling them steals keyboard focus), the button
   * looked live while doing nothing. Queueing keeps every press.
   */
  const runPinAction = (action: () => Promise<void>, errorKey: string) => {
    const queued = pinQueue.current.then(() => performPinAction(action, errorKey));
    pinQueue.current = queued.catch(() => {});
    return queued;
  };

  const performPinAction = async (action: () => Promise<void>, errorKey: string) => {
    if (!user) return;
    pinBusyRef.current = true;
    pinsRevision.current += 1;
    setPinBusy(true);
    // What the server last agreed to. If the write fails we go back to this,
    // even when the re-read fails too — which is exactly what happens when the
    // connection has dropped. Leaving the optimistic order on screen would show
    // an order that was never saved, and look like it worked.
    const lastKnownGood = pins;
    try {
      await action();
    } catch (error) {
      setPins(lastKnownGood);
      addToast(error instanceof Error ? error.message : t(errorKey), 'error');
    } finally {
      // Re-read either way: on failure to undo the optimistic order, on success
      // to pick up whatever the database actually stored. Bumping the revision
      // again first means a read that started before this write cannot land on
      // top of the answer.
      pinsRevision.current += 1;
      try {
        setPins(await fetchPromptPins());
      } catch {
        // Offline. The catch above has already put the list back to the last
        // state the server confirmed, so the screen is honest either way.
      }
      pinBusyRef.current = false;
      setPinBusy(false);
    }
  };

  const togglePin = (prompt: SavedPrompt) => {
    if (!user) return;
    const pinned = isPinned(prompt.id);
    void runPinAction(
      () =>
        pinned
          ? unpinPrompt(user.id, prompt.id)
          : pinPrompt(user.id, prompt.id, pins),
      'prompts.pin_error'
    );
  };

  /**
   * Moves one pin by one place.
   *
   * The whole resulting order is sent, not the swap, so the outcome does not
   * depend on what the server currently holds — two devices reordering at once
   * cannot interleave into an order neither person asked for.
   */
  const movePin = (promptId: string, direction: -1 | 1) => {
    if (!user) return;
    const visible = pinnedPrompts.map((prompt) => prompt.id);
    const from = visible.indexOf(promptId);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= visible.length) return;
    [visible[from], visible[to]] = [visible[to], visible[from]];

    // A pin whose prompt this browser has not loaded — a shared prompt that
    // stopped being shared, or a list still arriving — is invisible but still
    // real. Keeping it on the end means reordering what you can see never
    // renumbers on top of it, and never drops it from local state either.
    const hidden = pins
      .filter((pin) => !visible.includes(pin.prompt_id))
      .map((pin) => pin.prompt_id);
    const order = [...visible, ...hidden];

    // Show the new order immediately; the refresh in runPinAction reconciles.
    setPins(
      order.map((id, index) => {
        const existing = pins.find((pin) => pin.prompt_id === id);
        return {
          user_id: user.id,
          prompt_id: id,
          sort_order: index,
          created: existing?.created ?? new Date().toISOString(),
        };
      })
    );

    // Keep the person where they were. The button they pressed rides with the
    // item, and if that item has reached an end its button is now disabled, so
    // focus goes to the other arrow rather than being dropped on the document.
    const landedAtEnd = direction === -1 ? to === 0 : to === visible.length - 1;
    setFocusAfterMove(`${promptId}:${landedAtEnd ? -direction : direction}`);
    // Nothing else tells a screen-reader user that the move happened, or where
    // the item landed — the rank badge is decorative.
    const moved = pinnedPrompts.find((prompt) => prompt.id === promptId);
    setMoveAnnouncement(
      t('prompts.moved_to')
        .replace('{title}', moved?.title ?? '')
        .replace('{position}', formatNumber(to + 1, language))
        .replace('{total}', formatNumber(visible.length, language))
    );

    void runPinAction(() => reorderPromptPins(user.id, order), 'prompts.pin_error');
  };

  // Focus survives the re-render that the move causes.
  useEffect(() => {
    if (!focusAfterMove) return;
    const target = document.querySelector<HTMLButtonElement>(
      `[data-pin-control="${CSS.escape(focusAfterMove)}"]`
    );
    target?.focus();
    setFocusAfterMove(null);
  }, [focusAfterMove, pins]);

  const canEdit = (prompt: SavedPrompt) =>
    prompt.created_by
      ? prompt.created_by === user?.id
      : prompt.visibility === 'public'
        ? user?.role === 'admin'
        : prompt.owner_id === user?.id;

  const canDelete = (prompt: SavedPrompt) =>
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

      {pinnedPrompts.length > 0 ? (
        <section className="prompts-pinned" aria-label={t('prompts.pinned')}>
          <h2 className="prompts-pinned-title">
            <Pin size={14} aria-hidden="true" />
            {t('prompts.pinned')}
            <span className="prompts-pinned-help">{t('prompts.pinned_help')}</span>
          </h2>
          {/* Announces where a moved pin landed. The rank badge is decorative,
              so without this a screen-reader user presses "Move up" and is told
              nothing at all. */}
          <p className="sr-only" role="status" aria-live="polite">
            {moveAnnouncement}
          </p>
          {/* role="list" restores what `list-style: none` takes away in Safari
              and VoiceOver, so the strip is still announced as a list of N. */}
          <ol className="prompts-pinned-list" role="list">
            {pinnedPrompts.map((prompt, index) => (
              <li key={prompt.id} className="prompts-pinned-item">
                <span className="prompts-pinned-rank" aria-hidden="true">
                  {formatNumber(index + 1, language)}
                </span>
                <span className="sr-only">
                  {t('prompts.position_of')
                    .replace('{position}', formatNumber(index + 1, language))
                    .replace('{total}', formatNumber(pinnedPrompts.length, language))}
                </span>
                {/* The title is the thing being truncated, so the title is what
                    the tooltip has to show — pointing it at the body popped a
                    50,000-character block over the strip. */}
                <span className="prompts-pinned-name" dir="auto" title={prompt.title}>
                  {prompt.title}
                </span>
                <span className={`prompt-scope prompt-scope-${prompt.visibility}`}>
                  {prompt.visibility === 'public' ? <Globe2 size={12} /> : <UserRound size={12} />}
                  {prompt.visibility === 'public'
                    ? t('prompts.public_badge')
                    : t('prompts.personal_badge')}
                </span>
                <span className="prompts-pinned-actions">
                  <CopyButton
                    text={prompt.body}
                    compact
                    ariaLabel={`${t('common.copy')}: ${prompt.title}`}
                  />
                  {/* Up and down rather than dragging: reachable by keyboard,
                      announced by a screen reader, and nothing to install.

                      Not disabled while a write is running, only at the ends. A
                      button that disables itself under the pointer loses focus
                      to the document body, and walking a pin up five places
                      meant tabbing back through the whole page five times. */}
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon btn-sm"
                    data-pin-control={`${prompt.id}:-1`}
                    onClick={() => movePin(prompt.id, -1)}
                    disabled={index === 0}
                    aria-label={`${t('prompts.move_up')}: ${prompt.title}`}
                    title={t('prompts.move_up')}
                  >
                    <ChevronUp size={15} />
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon btn-sm"
                    data-pin-control={`${prompt.id}:1`}
                    onClick={() => movePin(prompt.id, 1)}
                    disabled={index === pinnedPrompts.length - 1}
                    aria-label={`${t('prompts.move_down')}: ${prompt.title}`}
                    title={t('prompts.move_down')}
                  >
                    <ChevronDown size={15} />
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon btn-sm"
                    onClick={() => togglePin(prompt)}
                    disabled={pinBusy}
                    aria-label={`${t('prompts.unpin')}: ${prompt.title}`}
                    title={t('prompts.unpin')}
                  >
                    <PinOff size={15} />
                  </button>
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

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
                      className={`btn btn-ghost btn-icon btn-sm prompt-pin-button ${
                        isPinned(prompt.id) ? 'is-pinned' : ''
                      }`}
                      onClick={() => togglePin(prompt)}
                      disabled={pinBusy}
                      // No aria-pressed alongside a name that flips. Together
                      // they read as "Remove pin: Alpha, pressed", where the
                      // name says remove and the state says on. The name
                      // carries the meaning; the state would only muddy it.
                      aria-label={`${
                        isPinned(prompt.id) ? t('prompts.unpin') : t('prompts.pin')
                      }: ${prompt.title}`}
                      title={isPinned(prompt.id) ? t('prompts.unpin') : t('prompts.pin')}
                    >
                      {/* One icon, filled when pinned. A crossed-out pin here
                          reads as "not pinned" at a glance, which is the exact
                          opposite of what it means. */}
                      <Pin size={15} fill={isPinned(prompt.id) ? 'currentColor' : 'none'} />
                    </button>
                    <CopyButton
                      text={prompt.body}
                      ariaLabel={`${t('common.copy')}: ${prompt.title}`}
                    />
                    {canEdit(prompt) ? (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm prompt-edit-button"
                        onClick={() => openEdit(prompt)}
                        aria-label={`${t('common.edit')} ${prompt.title}`}
                      >
                        <Pencil size={15} />
                        {t('common.edit')}
                      </button>
                    ) : null}
                    {canDelete(prompt) ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon btn-sm prompt-delete-button"
                        onClick={() => setDeletingPrompt(prompt)}
                        aria-label={`${t('common.delete')} ${prompt.title}`}
                      >
                        <Trash2 size={15} />
                      </button>
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
