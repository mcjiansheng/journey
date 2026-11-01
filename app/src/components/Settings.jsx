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
import { timezoneLabel } from '../destination-timezone.js';
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
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  return (
    <div className="page settings-page">
      <h1 className="workspace-heading">旅程设置</h1>
      <p className="muted">修改会同步给全部 {j.snapshot.members.length} 位同伴</p>
      <Section title="当前旅程">
        <div className="form-grid">
          <Field label="旅程名称">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                if (name.trim()) patch('name', name.trim());
                else setError('旅程名称不能为空。');
              }}
            />
          </Field>
          <Field label="目的地">
            <input
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              onBlur={() => patch('destination', destination)}
            />
          </Field>
        </div>
        <Field label="旅程时区">
          <select value={trip.timezone} onChange={(e) => patch('timezone', e.target.value)}>
            {[...new Set([trip.timezone, 'UTC', ...Intl.supportedValuesOf('timeZone')])].map(
              (zone) => (
                <option key={zone} value={zone}>
                  {timezoneLabel(zone)} · {zone}
                </option>
              ),
            )}
          </select>
        </Field>
        <button className="settings-link" onClick={onDates}>
          <span>日期与计划天数</span>
          <span>
            {trip.startDate || '日期未定'} · {trip.dayCount} 天<ChevronRight size={17} />
          </span>
        </button>
        <button className="settings-link" onClick={onTeam}>
          <span>成员与邀请</span>
          <span>
            {j.snapshot.members.length} 位同伴
            <ChevronRight size={17} />
          </span>
        </button>
        <button className="settings-link" onClick={onDeleted}>
          <span>已删除的内容</span>
          <ChevronRight size={17} />
        </button>
        {owner && (
          <TeamModeSetting
            value={pendingMode || trip.teamMode}
            pending={pendingMode !== null}
            error={modeError}
            onChange={changeTeamMode}
          />
        )}
        <details className="lifecycle-menu">
          <summary>旅程删除与恢复</summary>
          <ObjectActions journey={j} object={{ ...trip, kind: 'trip' }} />
        </details>
        <div className="button-row">
          <AsyncButton
            className="text-button"
            onClick={async () => {
              try {
                const t = j.trips.find((t) => t.id === trip.id);
                await j.api(`/api/trips/${trip.id}/archive`, {
                  method: 'POST',
                  body: { archived: !t?.archived },
                });
                await j.refreshTrips();
              } catch (e) {
                setError(errorMessage(e));
              }
            }}
          >
            <Archive size={16} />
            {j.trips.find((t) => t.id === trip.id)?.archived ? '取消归档' : '归档旅程'}
          </AsyncButton>
          <button className="text-button danger" onClick={() => setExit(true)}>
            <LogOut size={16} />
            退出旅程
          </button>
        </div>
      </Section>
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
