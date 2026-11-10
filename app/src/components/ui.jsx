import React, { useEffect, useRef, useState, useId } from 'react';
import { X, Loader2, ArrowLeft, ChevronDown } from 'lucide-react';
import { reducedMotion } from '../usePageNavigation.js';
export function IconButton({ icon: Icon, label, ...props }) {
  return (
    <button type="button" className="icon-button" aria-label={label} title={label} {...props}>
      <Icon size={20} />
    </button>
  );
}
let modalDepth = 0;
export function Modal({
  title,
  children,
  onClose,
  wide = false,
  className = '',
  initialFocus = 'title',
  action,
  dismissOnBackdrop = false,
  nonModal = false,
  returnFocus,
}) {
  const ref = useRef(null),
    titleRef = useRef(null),
    titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = returnFocus || document.activeElement,
      dialog = ref.current;
    if (!nonModal) {
      modalDepth++;
      document.documentElement.classList.add('has-modal');
    }
    // Entrance belongs to opening the dialog. Restoring motion later must not
    // replay it on a dialog that is already visible.
    const finishEntrance = (event) => {
      if (event.target === dialog && event.animationName === 'modal-enter')
        delete dialog.dataset.enter;
    };
    dialog.addEventListener('animationend', finishEntrance);
    dialog.addEventListener('animationcancel', finishEntrance);
    if (!reducedMotion()) dialog.dataset.enter = '';
    if (nonModal) dialog.show();
    else dialog.showModal();
    const escape = (event) => {
      if (event.key === 'Escape' && modalDepth === 0) {
        event.preventDefault();
        closeRef.current();
      }
    };
    if (nonModal) document.addEventListener('keydown', escape);
    const target =
      initialFocus === 'title'
        ? titleRef.current
        : dialog.querySelector(initialFocus === 'input' ? 'input,select,textarea' : initialFocus);
    (target || titleRef.current)?.focus({ preventScroll: true });
    return () => {
      dialog.removeEventListener('animationend', finishEntrance);
      dialog.removeEventListener('animationcancel', finishEntrance);
      delete dialog.dataset.enter;
      dialog.close();
      if (nonModal) document.removeEventListener('keydown', escape);
      else modalDepth--;
      if (modalDepth === 0) document.documentElement.classList.remove('has-modal');
      if (previous?.isConnected) previous.focus?.({ preventScroll: true });
    };
  }, [nonModal]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-modal={nonModal ? false : true}
      className={`modal ${wide ? 'wide' : ''} ${className}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (dismissOnBackdrop && e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-head">
        <h2 ref={titleRef} tabIndex={-1} id={titleId}>
          {title}
        </h2>
        {action ?? <IconButton icon={X} label="关闭" onClick={onClose} />}
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
export function ActionNotice({ notice, onClose }) {
  const [error, setError] = useState('');
  return (
    <div className="action-notice" role="status">
      <span>{error || notice.message}</span>
      {notice.onAction && (
        <AsyncButton
          className="text-button"
          onClick={async () => {
            try {
              setError('');
              await notice.onAction();
              onClose();
            } catch (e) {
              setError(errorMessage(e));
            }
          }}
        >
          {notice.actionLabel || '撤销'}
        </AsyncButton>
      )}
      <IconButton icon={X} label="关闭操作提示" onClick={onClose} />
    </div>
  );
}
export function Field({ label, error, children, help }) {
  const fieldId = useId();
  const helpId = `${fieldId}-help`,
    errorId = `${fieldId}-error`;
  let associated = false;
  const content = React.Children.map(children, (child) => {
    if (
      !associated &&
      React.isValidElement(child) &&
      ['input', 'select', 'textarea'].includes(child.type)
    ) {
      associated = true;
      return React.cloneElement(child, {
        id: child.props.id || fieldId,
        'aria-describedby':
          [child.props['aria-describedby'], help ? helpId : null, error ? errorId : null]
            .filter(Boolean)
            .join(' ') || undefined,
        'aria-invalid': error ? true : child.props['aria-invalid'],
      });
    }
    return child;
  });
  return (
    <div className="field">
      <label htmlFor={fieldId}>{label}</label>
      {content}
      {help && <small id={helpId}>{help}</small>}
      {error && (
        <small id={errorId} className="field-error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}
export function Empty({ icon: Icon, title, children, action }) {
  return (
    <div className="empty">
      {Icon && (
        <span className="empty-icon">
          <Icon size={28} />
        </span>
      )}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
export function AsyncButton({ onClick, children, ...props }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      {...props}
      disabled={busy || props.disabled}
      onClick={async (e) => {
        setBusy(true);
        try {
          await onClick?.(e);
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy && <Loader2 size={16} className="spin" />}
      {children}
    </button>
  );
}
export function Section({ title, children, action }) {
  return (
    <section className="section">
      <div className="section-heading">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
export function Back({ onClick, children = '返回' }) {
  return (
    <button className="text-button" onClick={onClick}>
      <ArrowLeft size={17} />
      {children}
    </button>
  );
}
export const id = () => crypto.randomUUID();
export function errorMessage(e) {
  if (!e) return '操作未能完成，请稍后重试；若持续出现请刷新页面。';
  if (e.code === 'ORIGIN_REJECTED') {
    return '当前网页访问地址与服务端安全配置不一致。请使用配置的标准网址访问，或联系管理员设置 APP_ORIGIN。';
  }
  if (e.code === 'CSRF_REJECTED') {
    return '页面会话安全凭据已失效，请刷新页面后重试。';
  }
  if (e.code === 'LOGIN_INVALID') {
    return '账号或密码不正确，请核对后重新输入。';
  }
  if (e.code === 'RATE_LIMITED') {
    return '操作过于频繁，请稍候片刻后再试。';
  }
  if (e.code === 'NETWORK') {
    return '网络连接中断，请检查网络设置后重试。';
  }
  if (e.code === 'STALE_GENERATION') {
    return '其他同行成员刚刚更新了此内容，请刷新查看最新版本。';
  }
  if (e.code === 'CLOCK_UNCERTAIN') {
    return '未能确认离线修改的先后顺序，请保持网络连接后重新保存。';
  }
  if (e.code === 'CLOCK_INVALID') {
    return '设备系统时间与服务器差异过大，请核对设备系统时间后重试。';
  }
  return e.message || '操作未能完成，请稍后重试；若持续出现请刷新页面。';
}
export const clone = (x) => JSON.parse(JSON.stringify(x));
export function money(minor, currency = 'CNY') {
  if (minor === null || minor === undefined) return '金额待定';
  try {
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(minor / currencyFactor(currency));
  } catch {
    return `${minor} ${currency}`;
  }
}
export const active = (snapshot, kind) =>
  snapshot?.objects?.filter((o) => o.kind === kind && o.state === 'active') || [];
export function useDraft(j, key, initial) {
  const localKey = `journey.form:${j.user?.id || 'guest'}:${key}`;
  const [value, setValue] = useState(() => {
    if (j.snapshot) return j.context?.drafts?.[key] ?? initial;
    try {
      return JSON.parse(localStorage.getItem(localKey)) ?? initial;
    } catch {
      return initial;
    }
  });
  function update(next) {
    setValue(next);
    if (j.snapshot) j.setDraft(key, next);
    else if (next === null) localStorage.removeItem(localKey);
    else localStorage.setItem(localKey, JSON.stringify(next));
  }
  return [value, update];
}

export function currencyFactor(currency) {
  return (
    10 **
    new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits
  );
}
