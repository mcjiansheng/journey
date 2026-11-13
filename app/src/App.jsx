import SelectionTrack from './components/SelectionTrack.jsx';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Compass,
  CalendarDays,
  Map as MapIcon,
  Wallet,
  SlidersHorizontal as SettingsIcon,
  Users,
  ArrowLeft,
  Cloud,
  CloudOff,
  RefreshCw,
  AlertCircle,
  X,
  UserRound,
  StickyNote,
} from 'lucide-react';
import { useJourney } from './sync.js';
import { usePageNavigation } from './usePageNavigation.js';
import TripMap from './components/TripMap.jsx';
import { Board } from './components/Board.jsx';
import { Login, Home, CreateTrip, JoinTrip } from './components/Entry.jsx';
import ActivityEditor from './components/ActivityEditor.jsx';
import Itinerary, { Reschedule } from './components/Itinerary.jsx';
import Ledger from './components/Ledger.jsx';
import Settings, {
  PersonalSettings,
  Team,
  Deleted,
  TripRecovery,
  applyAppearance,
} from './components/Settings.jsx';
import { ActionNotice, IconButton } from './components/ui.jsx';
import { visibleDays } from './domain.js';
import { appearanceKey, readAppearance, mergeAccountAppearance, boardDock } from './appearance.js';
import { syncStatusText } from './components/SyncSettings.jsx';
const pages = [
  ['itinerary', '行程', CalendarDays],
  ['map', '地图', MapIcon],
  ['board', '白板', StickyNote],
  ['expenses', '费用', Wallet],
  ['settings', '旅程设置', SettingsIcon],
];
function initialInvite() {
  const url = new URL(location.href);
  const code = url.searchParams.get('invite');
  if (code) {
    localStorage.setItem('journey.inviteIntent', code);
    url.searchParams.delete('invite');
    history.replaceState(null, '', url);
  }
  return localStorage.getItem('journey.inviteIntent') || '';
}
export default function App() {
  const journey = usePageNavigation(useJourney());
  const [notice, setNotice] = useState(null);
  const notify = useCallback((value) => setNotice({ ...value, id: crypto.randomUUID() }), []);
  const j = { ...journey, notify };
  const [modal, setModal] = useState(null),
    [edit, setEdit] = useState(null),
    [intent, setIntent] = useState(initialInvite);
  const scrollRef = useRef(null);
  const editorRef = useRef(null);
  const [wideEditor, setWideEditor] = useState(() => matchMedia('(min-width: 1280px)').matches);
  useEffect(() => {
    const query = matchMedia('(min-width: 1280px)');
    const update = () => setWideEditor(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  const [expenseActivityId, setExpenseActivityId] = useState(null);
  const tripId = j.snapshot?.trip?.id;
  useEffect(() => setNotice(null), [j.user?.id, tripId]);
  useEffect(() => setExpenseActivityId(null), [j.user?.id, tripId]);
  // Going offline is said once per visit, quietly; after that the header's
  // 连接中断 badge carries it (offline use should not keep interrupting).
  const offlineToldRef = useRef(false);
  useEffect(() => {
    if (j.status !== 'offline' || !j.user || offlineToldRef.current) return;
    offlineToldRef.current = true;
    notify({ message: '已离线：修改先保存在本机，联网后自动同步', timeout: 4000 });
  }, [j.status, j.user, notify]);
  const editingActivity = edit?.object
    ? j.snapshot?.objects?.find((o) => o.id === edit.object.id) || edit.object
    : null;
  const editingDayId = editingActivity?.payload?.dayId || edit?.initial?.dayId;
  const editingDayDeleted =
    !!editingDayId &&
    j.snapshot?.objects?.some((o) => o.id === editingDayId && o.state === 'deleted');
  const tripDeleted = j.snapshot?.trip?.state === 'deleted';
  const page = tripDeleted ? 'recovery' : j.context?.page || 'itinerary';
  // Map and board share the immersive shell: collapsed sidebar, floating header.
  const immersive = page === 'map' || page === 'board';
  const [panelDock, setPanelDock] = useState(() => boardDock(readAppearance()));
  const journeyRef = useRef(journey);
  journeyRef.current = journey;
  const changePanelDock = useCallback((value) => {
    setPanelDock(value);
    const next = { ...readAppearance(), boardPanelDock: value };
    localStorage.setItem(appearanceKey, JSON.stringify(next));
    const jr = journeyRef.current;
    if (jr.user) jr.updateProfile({ preferences: { boardPanelDock: value } }).catch(() => {});
  }, []);
  // Members currently on this board get a colored ring in the header (N-9).
  const [boardPeers, setBoardPeers] = useState(() => new Map());
  const onBoardPeers = useCallback((peers) => {
    setBoardPeers((prev) => {
      if (prev.size === peers.size && [...peers].every(([k, v]) => prev.get(k) === v)) return prev;
      return peers;
    });
  }, []);
  useEffect(() => {
    const preferences = mergeAccountAppearance(readAppearance(), j.user?.preferences);
    localStorage.setItem(appearanceKey, JSON.stringify(preferences));
    applyAppearance(preferences);
    setPanelDock(boardDock(preferences));
    const media = matchMedia('(prefers-color-scheme: dark)');
    const update = () => applyAppearance(readAppearance());
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [j.user?.id, j.user?.preferences]);
  useEffect(() => {
    if (j.user && intent) setModal('join');
  }, [j.user?.id, intent]);
  useEffect(() => {
    if (!tripId) {
      setEdit(null);
      return;
    }
    const selection = j.context?.selection;
    if (selection?.type === 'activity') {
      const o = j.snapshot.objects.find((o) => o.id === selection.id);
      setEdit({ object: o || null, initial: { _draftId: selection.id } });
    } else setEdit(null);
  }, [tripId, j.user?.id]);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = j.context?.scroll?.[page] || 0;
  }, [tripId, page]);
  function onEdit(object, initial = {}, trigger = document.activeElement) {
    const pendingId = j.context?.pendingActivityId;
    const unfinishedId = j.snapshot.objects.some((o) => o.kind === 'activity' && o.id === pendingId)
      ? null
      : pendingId;
    const nextId = object?.id || initial._draftId || unfinishedId || crypto.randomUUID();
    if (edit && nextId === (edit.object?.id || edit.initial._draftId)) return;
    const returnFocus =
      trigger?.closest('[data-activity-id]')?.querySelector('.activity-main') || trigger;
    editorRef.current?.requestClose();
    setEdit({ object, returnFocus, initial: { ...initial, _draftId: nextId } });
  }
  function closeEdit() {
    setEdit(null);
    j.setContext({ selection: null });
  }
  function switchPage(p) {
    editorRef.current?.requestClose();
    setExpenseActivityId(null);
    if (!tripDeleted)
      j.setContext({
        page: p,
        ...(p === 'map' && page === 'itinerary'
          ? {
              map: {
                ...j.context.map,
                dayId: j.context.dayId || visibleDays(j.snapshot)[0]?.id || '',
                selectedActivityId: null,
              },
            }
          : {}),
      });
    else if (p === 'settings') setModal('personal');
  }
  function home() {
    editorRef.current?.requestClose();
    setNotice(null);
    if (scrollRef.current)
      j.setContext({ scroll: { ...j.context.scroll, [page]: scrollRef.current.scrollTop } });
    setEdit(null);
    j.goHome();
  }
  const previousPage = useRef(page);
  useEffect(() => {
    if (previousPage.current === 'itinerary' && page !== 'itinerary')
      editorRef.current?.requestClose();
    previousPage.current = page;
  }, [page]);
  const panelOpen = Boolean(
    wideEditor && page === 'itinerary' && tripId && !tripDeleted && !editingDayDeleted && edit,
  );
  const statusText = syncStatusText[j.status] || '正在连接';
  const tripMembers = j.snapshot?.members || [];
  const otherMembers = tripMembers.filter((m) => m.userId !== j.user?.id);
  const selfMembers = tripMembers.filter((m) => m.userId === j.user?.id);
  if (!j.ready)
    return (
      <div className="loading-screen">
        <Compass size={36} />
        <p>正在准备你的旅程…</p>
      </div>
    );
  return (
    <>
      <a className="skip-link" href="#main">
        跳到主要内容
      </a>
      {!j.user ? (
        <div className="auth-page">
          <header className="home-header auth-header">
            <span className="auth-brand">
              <Compass />
              <span>同行</span>
              <small>JOURNEY</small>
            </span>
            <IconButton icon={UserRound} label="我的设置" onClick={() => setModal('personal')} />
          </header>
          {intent && (
            <div className="invite-intent">
              <Users size={18} />
              同伴正在邀请你加入旅程，登录后继续。
            </div>
          )}
          <main id="main">
            <Login journey={j} illustrated />
          </main>
        </div>
      ) : !tripId ? (
        <Home
          journey={j}
          onCreate={() => setModal('create')}
          onJoin={() => setModal('join')}
          onSettings={() => setModal('personal')}
          onSync={() => setModal('sync')}
        />
      ) : (
        <div
          className={`app-shell ${immersive ? 'immersive-shell' : ''} ${page === 'map' ? 'map-shell' : ''} ${page === 'board' ? 'board-shell' : ''}`}
        >
          <aside className="sidebar">
            <button className="brand" onClick={home}>
              <Compass />
              <span>
                同行<small>JOURNEY</small>
              </span>
            </button>
            <div className="sidebar-navigation">
              <button
                className="back-home"
                onClick={home}
                aria-label="我的旅程"
                title="返回我的旅程"
              >
                <ArrowLeft size={20} />
                <span>我的旅程</span>
              </button>
              {!tripDeleted && (
                <SelectionTrack as="nav" activeKey={page} layoutKey={immersive} aria-label="主导航">
                  {pages.map(([key, label, Icon]) => (
                    <button
                      aria-label={label}
                      className={page === key ? 'selected' : ''}
                      aria-current={page === key ? 'page' : undefined}
                      key={key}
                      onClick={() => switchPage(key)}
                    >
                      <Icon size={20} />
                      <span>{label}</span>
                    </button>
                  ))}
                </SelectionTrack>
              )}
            </div>
            <div className="sidebar-foot">
              <button
                className="profile-button"
                aria-label="我的设置"
                onClick={() => setModal('personal')}
              >
                <span className="avatar">
                  {j.user.displayName?.slice(0, 1) || <UserRound size={17} />}
                </span>
                <span>{j.user.displayName}</span>
              </button>
            </div>
          </aside>
          <div className="workspace">
            <header className="trip-header">
              <button className="header-home" onClick={home} aria-label="返回我的旅程">
                <ArrowLeft size={20} />
              </button>
              {
                <div className="trip-title">
                  <span>{j.snapshot.trip.name}</span>
                </div>
              }
              <div className="header-right">
                <div className="map-trip-title" aria-hidden={!immersive}>
                  <span>
                    <span title={j.snapshot.trip.name}>{j.snapshot.trip.name}</span>
                  </span>
                </div>
                <button
                  className={`sync-status ${j.status}`}
                  onClick={() => setModal('sync')}
                  title="查看保存与同步"
                  aria-label={`${statusText}，查看保存与同步`}
                >
                  {j.status === 'offline' ? (
                    <CloudOff size={15} />
                  ) : j.status === 'synced' ? (
                    <Cloud size={16} aria-hidden="true">
                      <path d="m9 14 2 2 4-4" />
                    </Cloud>
                  ) : ['blocked', 'error'].includes(j.status) ? (
                    <AlertCircle size={15} />
                  ) : (
                    <RefreshCw
                      size={15}
                      className={['syncing', 'checking'].includes(j.status) ? 'spin' : ''}
                    />
                  )}
                  <span>{statusText}</span>
                </button>
                <button
                  className={`members-button ${otherMembers.length ? '' : 'solo'}`}
                  onClick={() => setModal('team')}
                  aria-label={`查看 ${j.snapshot.members.length} 位同行伙伴`}
                >
                  <div className="avatar-stack">
                    {/* 同伴排在前面：手机端只显示第一个头像，自己的头像已在右侧“我的设置”入口 */}
                    {[...otherMembers, ...selfMembers].slice(0, 3).map((m) => {
                      const onBoard = page === 'board' && boardPeers.has(m.userId);
                      return (
                        <span
                          className={`avatar ${onBoard ? 'on-board' : ''}`}
                          key={m.userId}
                          style={
                            onBoard
                              ? { '--ring': `var(--peer-${(boardPeers.get(m.userId) % 4) + 1})` }
                              : undefined
                          }
                          title={onBoard ? `${m.displayName} 正在看这块白板` : undefined}
                        >
                          {m.displayName.slice(0, 1)}
                        </span>
                      );
                    })}
                  </div>
                  {otherMembers.length > 1 && (
                    <span className="member-overflow" aria-hidden="true">
                      +{otherMembers.length - 1}
                    </span>
                  )}
                  <Users size={18} />
                </button>
                <button
                  className="my-settings-button"
                  aria-label="我的设置"
                  onClick={() => setModal('personal')}
                >
                  <span className="avatar">
                    {j.user.displayName?.slice(0, 1) || <UserRound size={17} />}
                  </span>
                </button>
              </div>
            </header>
            <div className={`workspace-body${panelOpen ? ' has-activity-panel' : ''}`}>
              <main
                id="main"
                className={`main-content ${page === 'map' ? 'map-content' : ''} ${page === 'board' ? 'board-content' : ''}`}
                ref={scrollRef}
                onScroll={(e) => {
                  clearTimeout(scrollRef.timer);
                  const top = e.currentTarget.scrollTop;
                  scrollRef.timer = setTimeout(
                    () => j.setContext({ scroll: { ...j.context.scroll, [page]: top } }),
                    180,
                  );
                }}
              >
                {!tripDeleted && (
                  <TripMap
                    key={`${j.user.id}:${tripId}`}
                    active={page === 'map'}
                    journey={j}
                    onEditActivity={onEdit}
                  />
                )}{' '}
                {tripDeleted ? (
                  <TripRecovery
                    journey={j}
                    onHome={home}
                    onTeam={() => setModal('team')}
                    onDeleted={() => setModal('deleted')}
                  />
                ) : page === 'map' ? null : page === 'board' ? (
                  <Board
                    key={`${j.user.id}:${tripId}:${j.context?.board?.boardId || 'default'}`}
                    tripId={tripId}
                    boardId={j.context?.board?.boardId}
                    snapshot={j.snapshot}
                    currentUserId={j.user?.id}
                    mutate={j.mutate}
                    notify={notify}
                    modalOpen={Boolean(modal) || Boolean(edit)}
                    dock={panelDock}
                    onDockChange={changePanelDock}
                    boardContext={j.context?.board}
                    onBoardContext={(patch) =>
                      j.setContext({ board: { ...(j.context?.board || {}), ...patch } })
                    }
                    onPeersChange={onBoardPeers}
                    stickers={j.user?.preferences?.stickers}
                    onStickersChange={(list) =>
                      j.updateLocalUser({
                        preferences: { ...(j.user?.preferences || {}), stickers: list },
                      })
                    }
                    onNavigate={(targetPage, targetContext) => {
                      j.setContext({ page: targetPage, ...targetContext });
                    }}
                  />
                ) : page === 'expenses' ? (
                  <Ledger
                    key={`${j.user.id}:${tripId}:${expenseActivityId || 'all'}`}
                    journey={j}
                    onViewActivity={(activity) =>
                      j.setContext({
                        page: 'itinerary',
                        dayId: activity.payload.dayId,
                        focusActivityId: activity.id,
                      })
                    }
                    activityId={expenseActivityId}
                    onClearActivityFilter={() => setExpenseActivityId(null)}
                  />
                ) : page === 'settings' ? (
                  <Settings
                    journey={j}
                    onTeam={() => setModal('team')}
                    onDeleted={() => setModal('deleted')}
                    onDates={() => setModal('dates')}
                    onPersonal={() => setModal('personal')}
                  />
                ) : (
                  <Itinerary
                    selectedActivityId={panelOpen ? edit.object?.id || edit.initial._draftId : null}
                    journey={j}
                    onEdit={onEdit}
                    onDates={() => setModal('dates')}
                    onDeleted={() => setModal('deleted')}
                    onViewExpenses={(activityId) => {
                      setExpenseActivityId(activityId);
                      j.setContext({ page: 'expenses' });
                    }}
                  />
                )}
              </main>
              {tripId && !tripDeleted && !editingDayDeleted && edit && (
                <ActivityEditor
                  key={edit.object?.id || edit.initial._draftId || 'new'}
                  ref={editorRef}
                  panel={panelOpen}
                  returnFocus={edit.returnFocus}
                  journey={j}
                  object={edit.object}
                  initial={edit.initial}
                  onClose={closeEdit}
                />
              )}
            </div>
            {!tripDeleted && (
              <SelectionTrack
                as="nav"
                activeKey={page}
                className="bottom-nav"
                aria-label="手机主导航"
              >
                {pages.map(([key, label, Icon]) => (
                  <button
                    aria-label={label}
                    className={page === key ? 'selected' : ''}
                    aria-current={page === key ? 'page' : undefined}
                    key={key}
                    onClick={() => switchPage(key)}
                  >
                    <Icon size={21} />
                    <span>{label}</span>
                  </button>
                ))}
              </SelectionTrack>
            )}
          </div>
        </div>
      )}
      {j.error && (
        <div className="global-notice" role="alert">
          <AlertCircle size={18} />
          <span>{typeof j.error === 'string' ? j.error : j.error.message}</span>
          <button onClick={() => j.retry().catch(() => {})} className="text-button">
            重试
          </button>
          <IconButton icon={X} label="关闭提示" onClick={() => j.clearError()} />
        </div>
      )}
      {j.sessionExpired && j.user && (
        <div className="session-overlay">
          <p>登录已过期。重新登录后继续，当前输入已保留。</p>
          <Login journey={j} />
        </div>
      )}
      {notice && (
        <ActionNotice
          key={notice.id}
          notice={notice}
          onClose={() => setNotice((current) => (current?.id === notice.id ? null : current))}
        />
      )}{' '}
      {(modal === 'sync' || modal === 'personal') && (
        <PersonalSettings
          key={`${j.user?.id || 'guest'}:${modal}`}
          journey={j}
          initialCategory={modal === 'sync' ? 'sync' : null}
          onClose={() => setModal(null)}
        />
      )}{' '}
      {modal === 'create' && <CreateTrip journey={j} onClose={() => setModal(null)} />}{' '}
      {modal === 'join' && (
        <JoinTrip
          journey={j}
          initialCode={intent}
          onClose={() => {
            setModal(null);
            setIntent('');
          }}
        />
      )}
      {tripId && modal === 'team' && <Team journey={j} onClose={() => setModal(null)} />}{' '}
      {tripId && modal === 'dates' && <Reschedule journey={j} onClose={() => setModal(null)} />}{' '}
      {tripId && modal === 'deleted' && (
        <Deleted journey={j} onClose={() => setModal(null)} onEdit={onEdit} />
      )}{' '}
    </>
  );
}
