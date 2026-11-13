import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  Link,
  Copy,
  Check,
  LogOut,
  Trash2,
  Archive,
  ChevronRight,
  MoreHorizontal,
} from 'lucide-react';
import { Modal, Field, AsyncButton, Section, Empty, errorMessage } from './ui.jsx';
import { ObjectActions } from './Itinerary.jsx';
import { dateAdd } from '../domain.js';
import './trip-settings.css';
import { knownDestinationTimezone, timezoneLabel } from '../destination-timezone.js';
import { supportsNativeSwitch } from '../feedback.js';
import { TeamModeSetting } from './TeamModePicker.jsx';
export { applyAppearance } from '../appearance.js';
export { default as PersonalSettings } from './PersonalSettings.jsx';
export function Team({ journey: j, onClose }) {
  const trip = j.snapshot.trip;
  const members = j.snapshot.members;
  const me = members.find((m) => m.userId === j.user.id);
  const owner = trip.ownerId === j.user.id,
    manage = owner || me?.isAdmin;
  const [error, setError] = useState(''),
    [invites, setInvites] = useState([]),
    [invite, setInvite] = useState(null),
    [qr, setQr] = useState(''),
    [hours, setHours] = useState('24'),
    [copied, setCopied] = useState('');
  async function reload() {
    if (!manage) return;
    try {
      const r = await j.api(`/api/trips/${trip.id}/invites`);
      setInvites(r.invites || []);
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  useEffect(() => {
    if (manage) reload();
  }, []);
  useEffect(() => {
    if (invite)
      QRCode.toDataURL(invite.url, {
        margin: 2,
        width: 240,
        color: { dark: '#185548', light: '#ffffff' },
      })
        .then(setQr)
        .catch((e) => setError(errorMessage(e)));
  }, [invite]);
  async function change(path, method, body) {
    try {
      setError('');
      await j.api(path, { method, body });
      await j.refresh();
      await reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  async function copy(value, key) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied(''), 2000);
    } catch {
      setError('复制未完成，请长按或选中内容复制。');
    }
  }
  return (
    <Modal title="同行的伙伴" onClose={onClose} wide>
      <div className="team-intro">
        <h3>{trip.name}</h3>
        <span className="tag">{trip.teamMode === 'admin' ? '管理员团队' : '平等团队'}</span>
      </div>
      {trip.teamMode === 'equal' && (
        <p className="muted team-permission-help">
          平等团队中的管理员可以恢复已删除的内容，并管理邀请。
        </p>
      )}
      <div className="members">
        {members.map((m) => (
          <article key={m.userId} className="member-row">
            <span className="avatar">{m.displayName.slice(0, 1)}</span>
            <div className="member-info">
              <strong>
                {m.displayName}
                {m.userId === j.user.id ? '（你）' : ''}
              </strong>
              <small>{m.userId === trip.ownerId ? '创建者' : m.isAdmin ? '管理员' : '成员'}</small>
            </div>
            {owner && m.userId !== trip.ownerId && (
              <div className="member-controls">
                <label className="feedback-setting">
                  <span>管理员</span>
                  <input
                    type="checkbox"
                    role="switch"
                    switch=""
                    data-native-switch={supportsNativeSwitch() ? 'true' : 'false'}
                    checked={m.isAdmin}
                    onChange={(e) =>
                      change(`/api/trips/${trip.id}/members/${m.userId}`, 'PATCH', {
                        isAdmin: e.target.checked,
                      })
                    }
                  />
                </label>
                <label className="feedback-setting">
                  <span>可邀请</span>
                  <input
                    type="checkbox"
                    role="switch"
                    switch=""
                    data-native-switch={supportsNativeSwitch() ? 'true' : 'false'}
                    checked={m.canInvite}
                    onChange={(e) =>
                      change(`/api/trips/${trip.id}/members/${m.userId}`, 'PATCH', {
                        canInvite: e.target.checked,
                      })
                    }
                  />
                </label>
              </div>
            )}
            {manage && m.userId !== trip.ownerId && m.userId !== j.user.id && (
              <details className="member-more">
                <summary aria-label={`${m.displayName}的更多操作`}>
                  <MoreHorizontal size={20} />
                </summary>
                <div className="member-more-panel">
                  <button
                    className="text-button danger"
                    onClick={() => {
                      if (confirm(`将 ${m.displayName} 移出旅程？`))
                        change(`/api/trips/${trip.id}/members/${m.userId}`, 'DELETE');
                    }}
                  >
                    <Trash2 size={16} />
                    移除成员
                  </button>
                </div>
              </details>
            )}
          </article>
        ))}
      </div>
      {(me?.canInvite || owner) && (
        <Section title="邀请新伙伴">
          <div className="invite-controls">
            <Field label="有效期">
              <select value={hours} onChange={(e) => setHours(e.target.value)}>
                <option value="1">1 小时</option>
                <option value="24">1 天</option>
                <option value="72">3 天</option>
                <option value="168">7 天</option>
              </select>
            </Field>
            <AsyncButton
              className="primary"
              onClick={async () => {
                try {
                  const r = await j.api(`/api/trips/${trip.id}/invites`, {
                    method: 'POST',
                    body: { expiresInHours: Number(hours) },
                  });
                  setInvite(r);
                  await reload();
                } catch (e) {
                  setError(errorMessage(e));
                }
              }}
            >
              <Link size={16} />
              生成邀请
            </AsyncButton>
          </div>
          {invite && (
            <div className="share-invite">
              {qr && (
                <img src={qr} width="192" height="192" alt={`加入 ${trip.name} 的邀请二维码`} />
              )}
              <strong className="invite-code">{invite.code}</strong>
              <small>有效至 {new Date(invite.expiresAt).toLocaleString('zh-CN')}</small>
              <div className="button-row">
                <button className="secondary small" onClick={() => copy(invite.code, 'code')}>
                  {copied === 'code' ? <Check size={15} /> : <Copy size={15} />}复制编码
                </button>
                <button className="secondary small" onClick={() => copy(invite.url, 'url')}>
                  {copied === 'url' ? <Check size={15} /> : <Link size={15} />}复制链接
                </button>
              </div>
              <input
                aria-label="邀请链接"
                readOnly
                value={invite.url}
                onFocus={(e) => e.target.select()}
              />
            </div>
          )}
        </Section>
      )}
      {manage && invites.length > 0 && (
        <details>
          <summary>已发出的邀请</summary>
          {invites.map((i) => (
            <div className="setting-row" key={i.id}>
              <span>
                {i.revokedAt
                  ? '已撤销'
                  : new Date(i.expiresAt).getTime() < Date.now()
                    ? '已过期'
                    : `有效至 ${new Date(i.expiresAt).toLocaleString('zh-CN')}`}
              </span>
              {!i.revokedAt && (
                <button
                  className="text-button danger"
                  onClick={() => change(`/api/trips/${trip.id}/invites/${i.id}`, 'DELETE')}
                >
                  撤销
                </button>
              )}
            </div>
          ))}
        </details>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
export function Deleted({ journey: j, onClose, onEdit }) {
  const list = j.snapshot.objects.filter(
    (o) =>
      o.state === 'deleted' && ['activity', 'favorite', 'expense', 'day', 'route'].includes(o.kind),
  );
  function title(o) {
    if (o.kind === 'day') return o.payload.date || `第${o.payload.ordinal}天`;
    if (o.kind === 'route') {
      const from = o.payload.fromId
        ? j.snapshot.objects.find((a) => a.id === o.payload.fromId)?.payload.title
        : o.payload.fromPlace?.name;
      const to = j.snapshot.objects.find((a) => a.id === o.payload.toId)?.payload.title;
      return `${from || '出发地'} → ${to || '目的地'}`;
    }
    return o.payload.title || o.payload.name;
  }
  return (
    <Modal title="已删除的内容" onClose={onClose}>
      <p className="muted">恢复后，使用这项内容的最新修改。</p>
      {list.length ? (
        list.map((o) => (
          <article className="deleted-row" key={o.id}>
            <span className="tag">
              {
                {
                  activity: '活动',
                  favorite: '收藏',
                  expense: '费用',
                  day: '计划日',
                  route: '路程',
                }[o.kind]
              }
            </span>
            <strong>{title(o)}</strong>
            {o.kind === 'day' && (
              <small className="muted">
                保留{' '}
                {
                  j.snapshot.objects.filter(
                    (a) => a.kind === 'activity' && a.payload.dayId === o.id,
                  ).length
                }{' '}
                项关联活动
              </small>
            )}
            {o.kind === 'activity' && (
              <button className="text-button" onClick={() => onEdit(o)}>
                查看与编辑
              </button>
            )}
            <ObjectActions journey={j} object={o} />
          </article>
        ))
      ) : (
        <Empty icon={Trash2} title="这里还没有内容。" />
      )}
    </Modal>
  );
}
export function TripRecovery({ journey: j, onHome, onTeam, onDeleted }) {
  const trip = j.snapshot.trip;
  return (
    <div className="page trip-recovery">
      <div className="recovery-icon">
        <Archive size={30} />
      </div>
      <h1>{trip.name}</h1>
      <p className="recovery-heading">旅程已删除</p>
      <p className="muted">恢复后可以继续使用这份旅程。</p>
      <ObjectActions journey={j} object={{ ...trip, kind: 'trip' }} />
      <div className="button-row">
        <button className="secondary" onClick={onHome}>
          返回我的旅程
        </button>
        <button className="text-button" onClick={onTeam}>
          查看同行伙伴
        </button>
        <button className="text-button" onClick={onDeleted}>
          已删除的内容
        </button>
      </div>
    </div>
  );
}
export default function Settings({ journey: j, onTeam, onDeleted, onDates, onPersonal }) {
  const trip = j.snapshot.trip;
  const [error, setError] = useState('');
  const [timezoneOpen, setTimezoneOpen] = useState(false),
    [timezoneSearch, setTimezoneSearch] = useState('');
  const preferredZones = [
    ...new Set(
      [
        knownDestinationTimezone(trip.destination || ''),
        Intl.DateTimeFormat().resolvedOptions().timeZone,
        trip.timezone,
      ].filter(Boolean),
    ),
  ];
  const zones = [
    ...new Set([...preferredZones, 'UTC', ...Intl.supportedValuesOf('timeZone')]),
  ].filter((zone) =>
    `${timezoneLabel(zone)} ${zone}`.toLowerCase().includes(timezoneSearch.toLowerCase()),
  );
  const [name, setName] = useState(trip.name),
    [destination, setDestination] = useState(trip.destination || '');
  const [exit, setExit] = useState(false),
    [confirmPurge, setPurge] = useState(false);
  const [pendingMode, setPendingMode] = useState(null),
    [modeError, setModeError] = useState('');
  const owner = trip.ownerId === j.user.id;
  async function changeTeamMode(mode) {
    if (pendingMode || mode === trip.teamMode) return;
    setModeError('');
    setPendingMode(mode);
    try {
      await j.api(`/api/trips/${trip.id}/team`, { method: 'PATCH', body: { teamMode: mode } });
      await j.refresh();
    } catch (e) {
      setModeError(errorMessage(e));
    } finally {
      setPendingMode(null);
    }
  }
  async function patch(key, value) {
    try {
      if (value !== trip[key])
        await j.mutate({ objectId: trip.id, kind: 'patch', patch: { [key]: value } });
      setError('');
      return true;
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  return (
    <div className="page settings-page">
      <h1 className="workspace-heading">旅程设置</h1>
      <p className="muted">
        {j.snapshot.members.length > 1
          ? `修改会同步给其他 ${j.snapshot.members.length - 1} 位同伴`
          : '目前只有你一人。邀请同伴后，这里的修改会同步给他们'}
      </p>
      <Section title="基本信息">
        <label className="settings-link trip-inline-setting">
          <span>名称</span>
          <input
            aria-label="旅程名称"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              if (name.trim()) patch('name', name.trim());
              else setError('旅程名称不能为空。');
            }}
          />
        </label>
        <label className="settings-link trip-inline-setting">
          <span>目的地</span>
          <input
            aria-label="目的地"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            onBlur={() => patch('destination', destination)}
          />
        </label>
        <button className="settings-link" onClick={() => setTimezoneOpen(true)}>
          <span>时区</span>
          <span>
            {timezoneLabel(trip.timezone)}
            <ChevronRight size={17} />
          </span>
        </button>
      </Section>
      <Section title="日程">
        <button className="settings-link" onClick={onDates}>
          <span>日期</span>
          <span>
            {trip.startDate
              ? `${trip.startDate.slice(5).replace('-', '/')} – ${dateAdd(
                  trip.startDate,
                  trip.dayCount - 1,
                )
                  .slice(5)
                  .replace('-', '/')}`
              : '日期未定'}{' '}
            · {trip.dayCount} 天<ChevronRight size={17} />
          </span>
        </button>
      </Section>
      <Section title="成员与权限">
        <button className="settings-link" onClick={onTeam}>
          <span>成员与邀请</span>
          <span>
            {j.snapshot.members.length === 1 ? (
              '仅你一人'
            ) : (
              <>
                <span className="trip-member-avatars" aria-hidden="true">
                  {j.snapshot.members.slice(0, 3).map((member) => (
                    <span className="avatar" key={member.userId}>
                      {member.displayName.slice(0, 1)}
                    </span>
                  ))}
                </span>
                {j.snapshot.members.length} 人
              </>
            )}
            <ChevronRight size={17} />
          </span>
        </button>
        {owner && (
          <TeamModeSetting
            value={pendingMode || trip.teamMode}
            pending={pendingMode !== null}
            error={modeError}
            onChange={changeTeamMode}
          />
        )}
      </Section>
      <Section title="整理">
        <button className="settings-link" onClick={onDeleted}>
          <span>已删除的内容</span>
          <span>
            {
              j.snapshot.objects.filter(
                (o) =>
                  o.state === 'deleted' &&
                  ['activity', 'favorite', 'expense', 'day', 'route'].includes(o.kind),
              ).length
            }
            <ChevronRight size={17} />
          </span>
        </button>
        <AsyncButton
          className="settings-link"
          onClick={async () => {
            const archived = j.trips.find((t) => t.id === trip.id)?.archived;
            if (!archived && !confirm('归档旅程？将从我的旅程列表收起，可随时取消。')) return;
            try {
              await j.api(`/api/trips/${trip.id}/archive`, {
                method: 'POST',
                body: { archived: !archived },
              });
              await j.refreshTrips();
            } catch (e) {
              setError(errorMessage(e));
            }
          }}
        >
          <span>
            {j.trips.find((t) => t.id === trip.id)?.archived ? '取消归档' : '归档旅程'}
            <small className="trip-setting-help">从我的旅程列表收起，可随时取消</small>
          </span>
          <ChevronRight size={17} />
        </AsyncButton>
      </Section>
      <div className="section trip-exit-group">
        {owner && <ObjectActions journey={j} object={{ ...trip, kind: 'trip' }} />}
        <button className="settings-link danger" onClick={() => setExit(true)}>
          <span>
            <LogOut size={16} /> {j.snapshot.members.length === 1 ? '退出并删除旅程' : '退出旅程'}
            {j.snapshot.members.length === 1 && (
              <small className="trip-setting-help">你是唯一的成员，退出后会永久清除旅程</small>
            )}
          </span>
          <ChevronRight size={17} />
        </button>
      </div>
      {timezoneOpen && (
        <Modal title="旅程时区" onClose={() => setTimezoneOpen(false)}>
          <Field label="搜索时区">
            <input
              type="search"
              value={timezoneSearch}
              onChange={(e) => setTimezoneSearch(e.target.value)}
              placeholder="城市、时区名称或 UTC 偏移"
            />
          </Field>
          <div className="timezone-options">
            {!timezoneSearch && <p className="muted">目的地与本机时区优先显示</p>}
            {zones.map((zone) => (
              <button
                key={zone}
                className="settings-link"
                onClick={async () => {
                  if (await patch('timezone', zone)) setTimezoneOpen(false);
                }}
              >
                <span>
                  {timezoneLabel(zone)}
                  <small className="trip-setting-help">{zone}</small>
                </span>
                {zone === trip.timezone && <Check size={17} />}
              </button>
            ))}
            {!zones.length && <p className="muted">没有找到匹配的时区</p>}
          </div>
        </Modal>
      )}
      <button className="text-button" onClick={onPersonal}>
        想改主题色或提醒方式？打开我的设置
      </button>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {exit && (
        <Modal
          title={j.snapshot.members.length === 1 ? '退出并永久清除旅程' : '退出旅程'}
          onClose={() => setExit(false)}
        >
          <p>
            {j.snapshot.members.length === 1
              ? '你是最后一位成员。退出后，旅程及所有内容将永久清除。'
              : '退出后将无法继续查看和编辑这段旅程。'}
          </p>
          {owner && j.snapshot.members.length > 1 && (
            <p className="muted">创建者职责将由团队中的其他成员接任。</p>
          )}
          {j.snapshot.members.length === 1 && (
            <label className="check-row">
              <input
                type="checkbox"
                checked={confirmPurge}
                onChange={(e) => setPurge(e.target.checked)}
              />
              确认永久清除这段旅程及其内容
            </label>
          )}
          <AsyncButton
            className="danger-button full"
            disabled={j.snapshot.members.length === 1 && !confirmPurge}
            onClick={async () => {
              try {
                await j.api(`/api/trips/${trip.id}/leave`, {
                  method: 'POST',
                  body: { confirmPurge },
                });
                j.goHome();
                await j.refreshTrips();
                setExit(false);
              } catch (e) {
                setError(errorMessage(e));
              }
            }}
          >
            确认退出
          </AsyncButton>
        </Modal>
      )}
    </div>
  );
}
