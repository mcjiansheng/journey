import React, {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  ArrowLeft,
  Bell,
  Check,
  ChevronRight,
  Cloud,
  Eye,
  LogOut,
  Map,
  Palette,
  UserRound,
} from 'lucide-react';
import { Modal, Field, AsyncButton, errorMessage } from './ui.jsx';
import SyncSettings from './SyncSettings.jsx';
import SelectionTrack from './SelectionTrack.jsx';
import { reducedMotion } from '../usePageNavigation.js';
import {
  getFeedbackPreferences,
  setFeedbackPreferences,
  supportsHaptics,
  supportsNativeSwitch,
} from '../feedback.js';
import {
  appearanceKey,
  appearanceSave,
  readAppearance,
  mergeAccountAppearance,
  applyAppearance,
  accountAppearanceKeys,
} from '../appearance.js';
import { palettePreviews } from '../palette-meta.js';
import './personal-settings.css';
const categories = [
  ['appearance', '外观', Palette],
  ['accessibility', '辅助功能', Eye],
  ['notifications', '通知与提示', Bell],
  ['map', '地图', Map],
  ['sync', '保存与同步', Cloud],
  ['account', '账号', UserRound],
];
function Switch({ title, description, checked, onChange, disabled }) {
  const descriptionId = useId();
  return (
    <label className="feedback-setting personal-setting-row">
      <span>
        <strong>{title}</strong>
        {description && <small id={descriptionId}>{description}</small>}
      </span>
      <input
        type="checkbox"
        aria-label={title}
        aria-describedby={description ? descriptionId : undefined}
        role="switch"
        switch=""
        data-native-switch={supportsNativeSwitch() ? 'true' : 'false'}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
function Segmented({ title, description, value, onChange, disabled }) {
  return (
    <fieldset className="personal-segment-setting">
      <legend>{title}</legend>
      <p className="muted">{description}</p>
      <SelectionTrack className="personal-segments" activeKey={value}>
        {[
          ['system', '跟随系统'],
          [false, '关'],
          [true, '开'],
        ].map(([key, label]) => (
          <button
            type="button"
            key={String(key)}
            className={value === key ? 'selected' : ''}
            aria-pressed={value === key}
            disabled={disabled}
            onClick={() => onChange(key)}
          >
            {label}
          </button>
        ))}
      </SelectionTrack>
    </fieldset>
  );
}
function Preview({ colors }) {
  return (
    <span
      className="personal-preview"
      aria-hidden="true"
      style={{
        '--preview-page': colors.page,
        '--preview-surface': colors.surface,
        '--preview-primary': colors.primary,
        '--preview-text': colors.text,
      }}
    >
      <i className="preview-sidebar">
        <b />
        <b />
        <b />
      </i>
      <i className="preview-content">
        <b />
        <span />
        <span />
      </i>
    </span>
  );
}
export default function PersonalSettings({ journey: j, onClose, initialCategory = null }) {
  const [category, setCategory] = useState(initialCategory);
  const [prefs, setPrefs] = useState(() =>
    mergeAccountAppearance(readAppearance(), j.user?.preferences),
  );
  const [name, setName] = useState(j.user?.displayName || '');
  const [error, setError] = useState('');
  const saving = useSyncExternalStore(appearanceSave.subscribe, appearanceSave.getSnapshot);
  const [permission, setPermission] = useState(() =>
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  );
  const [systemDark, setSystemDark] = useState(
    () => matchMedia('(prefers-color-scheme: dark)').matches,
  );
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const media = matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemDark(media.matches);
    media.addEventListener('change', update);
    return () => {
      mounted.current = false;
      media.removeEventListener('change', update);
    };
  }, []);
  const heading = useRef(null);
  const indexPanel = useRef(null);
  const categoryPanel = useRef(null);
  const previousCategory = useRef(category);
  useEffect(() => {
    setPrefs(mergeAccountAppearance(readAppearance(), j.user?.preferences));
  }, [j.user?.preferences]);
  useEffect(() => {
    if (category) heading.current?.focus();
  }, [category]);
  useLayoutEffect(() => {
    if (previousCategory.current === category) return;
    previousCategory.current = category;
    if (reducedMotion()) return;
    const panel =
      category === null && matchMedia('(max-width: 760px)').matches
        ? indexPanel.current
        : categoryPanel.current;
    const animation = panel.animate(
      [
        { opacity: 0, transform: 'translateY(5px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      { duration: 160, easing: 'cubic-bezier(.2,.7,.2,1)' },
    );
    return () => animation.cancel();
  }, [category]);
  const available = categories.filter(([id]) => id !== 'sync' || j.user);
  const selected = category || 'appearance';
  const label = categories.find(([id]) => id === selected)?.[1];
  async function preference(key, value) {
    if (!appearanceSave.begin()) return;
    setError('');
    const previous = readAppearance();
    const next = { ...previous, [key]: value };
    try {
      if (key === 'interactionSound') setFeedbackPreferences({ sound: value });
      else if (key === 'interactionHaptics') setFeedbackPreferences({ haptics: value });
      else localStorage.setItem(appearanceKey, JSON.stringify(next));
      setPrefs(next);
      applyAppearance(next);
      if (j.user && accountAppearanceKeys.includes(key))
        await j.updateProfile({ preferences: { [key]: value } });
    } catch (e) {
      // Closing the dialog does not turn a failed save into a persisted preference.
      // Restore only this field, and only while it still belongs to this account/change.
      const current = readAppearance();
      if ((!j.user || j.isCurrentUser(j.user.id)) && current[key] === value) {
        const restored = { ...current, [key]: previous[key] };
        localStorage.setItem(appearanceKey, JSON.stringify(restored));
        applyAppearance(restored);
        if (mounted.current) setPrefs(restored);
      }
      if (mounted.current) setError(errorMessage(e));
      else if (!j.user || j.isCurrentUser(j.user.id)) j.notify?.({ message: errorMessage(e) });
    } finally {
      appearanceSave.end();
    }
  }
  async function authorize() {
    setError('');
    try {
      if (typeof Notification === 'undefined') throw new Error('当前浏览器不支持系统通知。');
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result === 'granted') await preference('collaborationNotifications', true);
      else setError('可在浏览器的网站设置中允许通知。');
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  const palette = prefs.palette || 'forest';
  const summary = {
    appearance: `${palettePreviews[palette]?.label || '森林绿'} · ${{ system: '跟随系统', light: '浅色', dark: '深色' }[prefs.theme || 'system']}`,
    accessibility:
      prefs.reducedMotion === true
        ? '减少动态效果'
        : prefs.reducedMotion === false
          ? '动态效果开启'
          : '跟随系统',
    notifications:
      prefs.collaborationNotifications && permission === 'granted' ? '提醒已开启' : '提醒已关闭',
    map: (prefs.autoCollapseMapSidebar ?? true) ? '自动收起侧栏' : '保持侧栏展开',
    sync: j.pendingCount ? `${j.pendingCount} 项待上传` : '查看同步状态',
    account: j.user?.identifier || '尚未登录',
  };
  const profile = (
    <div className="personal-profile">
      <span className="avatar">{j.user?.displayName?.slice(0, 1) || <UserRound size={22} />}</span>
      <span>
        <strong>{j.user?.displayName || '我的设置'}</strong>
        <small>{j.user?.identifier || '登录后可同步外观偏好'}</small>
      </span>
    </div>
  );
  return (
    <Modal
      title="我的设置"
      className={`personal-settings-modal ${category ? 'has-category' : ''}`}
      onClose={onClose}
      wide
    >
      <p className="personal-scope muted">只对你自己生效，在所有旅程中通用</p>
      <div className="personal-layout">
        <aside className="personal-index" ref={indexPanel}>
          {profile}
          <SelectionTrack as="nav" aria-label="设置分类" activeKey={selected}>
            {available.map(([id, title, Icon]) => (
              <React.Fragment key={id}>
                {(id === 'appearance' || id === 'sync') && (
                  <small className="personal-group-label">
                    {id === 'appearance' ? '偏好' : '数据'}
                  </small>
                )}
                <button
                  className={`${selected === id ? 'selected' : ''} ${id === 'map' ? 'personal-desktop-only' : ''}`}
                  key={id}
                  aria-current={selected === id ? 'page' : undefined}
                  onClick={() => setCategory(id)}
                >
                  <Icon size={19} />
                  <span>
                    <strong>{title}</strong>
                    <small>{summary[id]}</small>
                  </span>
                  <ChevronRight size={16} />
                </button>
              </React.Fragment>
            ))}
          </SelectionTrack>
          {j.user && (
            <button
              className="text-button danger personal-logout"
              onClick={() => j.logout().catch((e) => setError(errorMessage(e)))}
            >
              <LogOut size={17} />
              退出登录
            </button>
          )}
        </aside>
        <section className="personal-category" aria-label={label} ref={categoryPanel}>
          <button className="text-button personal-back" onClick={() => setCategory(null)}>
            <ArrowLeft size={18} />
            我的设置
          </button>
          <h3 tabIndex={-1} ref={heading}>
            {label}
          </h3>
          {selected === 'appearance' && (
            <>
              <fieldset className="personal-choice-field">
                <legend>主题色</legend>
                <div className="personal-palette-cards">
                  {Object.entries(palettePreviews).map(([key, info]) => (
                    <button
                      key={key}
                      aria-pressed={palette === key}
                      disabled={saving}
                      onClick={() => preference('palette', key)}
                    >
                      <Preview
                        colors={
                          info[
                            prefs.theme === 'dark' ||
                            ((!prefs.theme || prefs.theme === 'system') && systemDark)
                              ? 'dark'
                              : 'light'
                          ]
                        }
                      />
                      <span>
                        {info.label}
                        {palette === key && <Check size={16} />}
                      </span>
                    </button>
                  ))}
                </div>
              </fieldset>
              <fieldset className="personal-choice-field">
                <legend>明暗</legend>
                <div className="personal-theme-cards">
                  {[
                    ['system', '跟随系统'],
                    ['light', '浅色'],
                    ['dark', '深色'],
                  ].map(([key, title]) => (
                    <button
                      key={key}
                      aria-pressed={(prefs.theme || 'system') === key}
                      disabled={saving}
                      onClick={() => preference('theme', key)}
                    >
                      <span className={key === 'system' ? 'preview-system' : ''}>
                        <Preview
                          colors={palettePreviews[palette][key === 'dark' ? 'dark' : 'light']}
                        />
                        {key === 'system' && <Preview colors={palettePreviews[palette].dark} />}
                      </span>
                      <span>{title}</span>
                    </button>
                  ))}
                </div>
              </fieldset>
              <Segmented
                title="减少透明效果"
                description="使用不透明的实底卡片和面板，不显示毛玻璃和高光。"
                value={prefs.reducedTransparency ?? 'system'}
                disabled={saving}
                onChange={(value) => preference('reducedTransparency', value)}
              />
            </>
          )}
          {selected === 'accessibility' && (
            <Segmented
              title="减少动态效果"
              description="减少界面切换和展开时的动画。"
              value={prefs.reducedMotion ?? 'system'}
              disabled={saving}
              onChange={(value) => preference('reducedMotion', value)}
            />
          )}
          {selected === 'notifications' && (
            <>
              <Switch
                title="同伴修改提醒"
                description="页面打开时接收协作更新。"
                checked={!!prefs.collaborationNotifications && permission === 'granted'}
                disabled={saving || permission !== 'granted'}
                onChange={(value) => preference('collaborationNotifications', value)}
              />
              {permission !== 'granted' && (
                <div className="personal-notification-permission">
                  <small className="muted">
                    {permission === 'unsupported'
                      ? '当前浏览器不支持系统通知。'
                      : '允许浏览器通知后，可接收同伴修改提醒。'}
                  </small>
                  {permission !== 'unsupported' && (
                    <AsyncButton className="text-button" onClick={authorize}>
                      去授权
                    </AsyncButton>
                  )}
                </div>
              )}
              <Switch
                title="轻提示音"
                description="点击按钮等控件时，播放一声简短的提示音。"
                checked={prefs.interactionSound ?? getFeedbackPreferences().sound}
                disabled={saving}
                onChange={(value) => preference('interactionSound', value)}
              />
              {supportsHaptics() && (
                <div className="personal-mobile-only">
                  <Switch
                    title="触感反馈"
                    description="点击按钮等控件时，手机轻微振动一下。"
                    checked={prefs.interactionHaptics ?? getFeedbackPreferences().haptics}
                    disabled={saving}
                    onChange={(value) => preference('interactionHaptics', value)}
                  />
                </div>
              )}
              <p className="personal-footnote muted">
                提醒只在“同行”页面打开时出现，不会在关闭页面后推送。
              </p>
            </>
          )}
          {selected === 'map' && (
            <Switch
              title="地图自动收起侧栏"
              description="打开地图时，为地图留出更多空间。"
              checked={prefs.autoCollapseMapSidebar ?? true}
              disabled={saving}
              onChange={(value) => preference('autoCollapseMapSidebar', value)}
            />
          )}
          {selected === 'sync' && j.user && <SyncSettings journey={j} />}
          {selected === 'account' &&
            (j.user ? (
              <>
                <Field label="你的称呼">
                  <input
                    value={name}
                    disabled={saving}
                    maxLength={80}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={async () => {
                      if (
                        name.trim() &&
                        name.trim() !== j.user.displayName &&
                        appearanceSave.begin()
                      ) {
                        try {
                          await j.updateProfile({ displayName: name.trim() });
                          if (mounted.current) setError('');
                        } catch (e) {
                          if (mounted.current) setError(errorMessage(e));
                          else j.notify?.({ message: errorMessage(e) });
                        } finally {
                          appearanceSave.end();
                        }
                      }
                    }}
                  />
                </Field>
                <p className="muted">{j.user.identifier}</p>
              </>
            ) : (
              <p className="muted">登录后，可与同伴共同安排旅程。</p>
            ))}
        </section>
      </div>
      {error && (
        <p className="field-error personal-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
