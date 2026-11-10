import React, { useEffect, useId, useRef, useState } from 'react';
import { ArrowRight, Eye, EyeOff, LockKeyhole, UserRound } from 'lucide-react';
import { Field, IconButton, errorMessage } from './ui.jsx';

function JourneySketch() {
  return (
    <figure className="journey-sketch">
      <svg
        className="journey-drawing"
        viewBox="0 0 640 460"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <pattern id="atlas-grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M40 0H0V40" stroke="currentColor" strokeOpacity=".1" />
          </pattern>
        </defs>
        <rect x="16" y="16" width="608" height="428" rx="18" className="atlas-paper" />
        <rect x="16" y="16" width="608" height="428" rx="18" fill="url(#atlas-grid)" />
        <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
          <g className="atlas-contours" strokeWidth="1.2">
            <path d="M14 118C106 34 139 69 160 129S232 215 178 268 92 315 16 351" />
            <path d="M14 142C98 63 117 91 139 149S209 211 155 255 84 291 16 327" />
            <path d="M14 168C91 95 102 116 118 167S183 215 133 247 65 277 16 303" />
            <path d="M348 443C296 354 353 300 421 309S501 317 527 251 557 163 624 155" />
            <path d="M376 443C325 359 370 322 426 332S521 340 550 272 575 187 624 181" />
            <path d="M404 443C354 369 391 346 441 357S545 360 574 291 595 214 624 211" />
          </g>
          <path
            className="atlas-river"
            d="M250 16C194 82 337 103 295 171S236 241 291 285 376 360 311 444"
          />
          <path
            className="sketch-route"
            d="M131 306C151 214 230 299 281 223S405 277 489 123"
            strokeWidth="3"
            strokeDasharray="5 9"
          />
          <g transform="translate(131 306)" className="sketch-parallax sketch-pin">
            <circle r="22" className="atlas-waypoint" />
            <circle r="7" fill="currentColor" stroke="none" />
          </g>
          <g transform="translate(281 223)" className="sketch-parallax sketch-photo">
            <circle r="30" className="atlas-waypoint" />
            <path d="M-12 10V-3L0-13 12-3V10H-12ZM-4 10V1H4V10" strokeWidth="2" />
          </g>
          <g transform="translate(489 123)" className="sketch-parallax sketch-plane">
            <circle r="36" className="atlas-destination" />
            <path d="M0 19S-13 0-13-8a13 13 0 0 1 26 0C13 0 0 19 0 19Z" strokeWidth="2" />
            <circle cy="-8" r="4" strokeWidth="2" />
          </g>
          <g transform="translate(546 363)" className="sketch-parallax sketch-compass">
            <circle r="37" strokeOpacity=".3" />
            <g className="sketch-needle">
              <path d="m0-25 9 25-9 25-9-25Z" strokeWidth="1.4" />
              <path d="M0-25 9 0H0Z" fill="currentColor" />
            </g>
            <path d="M-46 0h8m76 0h8M0-46v8m0 76v8" strokeOpacity=".5" />
          </g>
          <g strokeWidth="1.3" strokeOpacity=".55">
            <path d="M49 46h28m-14-14v28M563 49h28m-14-14v28M49 400h28m-14-14v28" />
          </g>
        </g>
      </svg>
      <figcaption>
        一起计划，一起出发<span aria-hidden="true">。</span>
      </figcaption>
    </figure>
  );
}

function useSketchPointer(ref, enabled) {
  useEffect(() => {
    if (!enabled) return;
    const node = ref.current,
      root = document.documentElement;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)'),
      fine = matchMedia('(any-pointer: fine)');
    let frame = 0;
    const reset = () => {
      cancelAnimationFrame(frame);
      node.style.removeProperty('--sketch-x');
      node.style.removeProperty('--sketch-y');
      node.style.removeProperty('--needle-turn');
    };
    const allowed = () =>
      fine.matches &&
      root.dataset.motion !== 'true' &&
      (root.dataset.motion === 'false' || !reduced.matches);
    const move = (event) => {
      if (event.pointerType === 'touch' || !allowed()) return;
      const rect = node.getBoundingClientRect(),
        sketch = node.querySelector('.journey-sketch').getBoundingClientRect();
      const x = Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width) * 2 - 1));
      const y = Math.max(-1, Math.min(1, ((event.clientY - sketch.top) / sketch.height) * 2 - 1));
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        node.style.setProperty('--sketch-x', `${x * 12}px`);
        node.style.setProperty('--sketch-y', `${y * 9}px`);
        node.style.setProperty('--needle-turn', `${x * 22 - y * 9}deg`);
      });
    };
    const preferencesChanged = () => {
      if (!allowed()) reset();
    };
    const observer = new MutationObserver(preferencesChanged);
    observer.observe(root, { attributes: true, attributeFilter: ['data-motion'] });
    reduced.addEventListener('change', preferencesChanged);
    fine.addEventListener('change', preferencesChanged);
    node.addEventListener('pointermove', move, { passive: true });
    node.addEventListener('pointerleave', reset);
    return () => {
      reset();
      observer.disconnect();
      reduced.removeEventListener('change', preferencesChanged);
      fine.removeEventListener('change', preferencesChanged);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerleave', reset);
    };
  }, [ref, enabled]);
}

function ModeCopy({ register, login, registration }) {
  return (
    <span className="login-copy">
      <span data-copy="login" aria-hidden={register}>
        {login}
      </span>
      <span data-copy="register" aria-hidden={!register}>
        {registration}
      </span>
    </span>
  );
}

function RegisterField({ register, children }) {
  return (
    <div className="login-reveal" aria-hidden={!register} inert={!register}>
      <div>{children}</div>
    </div>
  );
}

function validateIdentifier(value) {
  const v = (value || '').trim();
  if (!v) return '请输入手机号或邮箱';
  if (v.includes('@')) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.toLowerCase())) return '请输入有效邮箱地址';
    return '';
  }
  const clean = v.replace(/[\s-]/g, '');
  if (/^1\d{10}$/.test(clean) || /^\+[1-9]\d{7,14}$/.test(clean)) return '';
  return '请输入有效手机号（11位）或有效邮箱';
}

function validateDisplayName(value, register) {
  if (!register) return '';
  const v = (value || '').trim();
  if (!v) return '请输入称呼';
  if (v.length > 80) return '称呼最多 80 个字符';
  return '';
}

function validatePassword(value, register) {
  if (!value) return '请输入密码';
  if (register) {
    if (value.length < 10) return '密码长度至少需 10 个字符';
    if (value.length > 128) return '密码最多 128 个字符';
  }
  return '';
}

function validateConfirmation(confirmation, password, register) {
  if (!register) return '';
  if (!confirmation) return '请再次输入密码以确认';
  if (confirmation !== password) return '两次输入的密码不一致';
  return '';
}

export default function Login({ journey: j, onDone, illustrated = false }) {
  const [form, setForm] = useState(() => {
    try {
      return (
        JSON.parse(sessionStorage.getItem('journey.loginDraft')) || {
          identifier: '',
          password: '',
          displayName: '',
          register: false,
        }
      );
    } catch {
      return { identifier: '', password: '', displayName: '', register: false };
    }
  });
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [showPassword, setShowPassword] = useState(false);
  const [confirmation, setConfirmation] = useState(''),
    [confirmationTouched, setConfirmationTouched] = useState(false),
    [showConfirmation, setShowConfirmation] = useState(false);
  const [identifierTouched, setIdentifierTouched] = useState(false),
    [displayNameTouched, setDisplayNameTouched] = useState(false),
    [passwordTouched, setPasswordTouched] = useState(false),
    [serverErrors, setServerErrors] = useState({});
  const layout = useRef(null),
    identifierInput = useRef(null),
    displayNameInput = useRef(null),
    passwordInput = useRef(null),
    confirmationInput = useRef(null),
    headingId = useId();

  const identifierError = identifierTouched
    ? serverErrors.identifier || validateIdentifier(form.identifier)
    : '';
  const displayNameError =
    form.register && displayNameTouched
      ? serverErrors.displayName || validateDisplayName(form.displayName, form.register)
      : '';
  const passwordError = passwordTouched
    ? serverErrors.password || validatePassword(form.password, form.register)
    : '';
  const confirmationError =
    form.register && confirmationTouched
      ? validateConfirmation(confirmation, form.password, form.register)
      : '';

  useSketchPointer(layout, illustrated);
  function change(key, value) {
    const n = { ...form, [key]: value };
    setForm(n);
    setError('');
    if (serverErrors[key]) {
      setServerErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
    if (key === 'register') {
      setIdentifierTouched(false);
      setDisplayNameTouched(false);
      setPasswordTouched(false);
      setConfirmationTouched(false);
      setShowConfirmation(false);
      setServerErrors({});
    }
    sessionStorage.setItem('journey.loginDraft', JSON.stringify({ ...n, password: '' }));
  }
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setError('');
    setServerErrors({});

    setIdentifierTouched(true);
    setPasswordTouched(true);
    if (form.register) {
      setDisplayNameTouched(true);
      setConfirmationTouched(true);
    }

    const idErr = validateIdentifier(form.identifier);
    if (idErr) {
      identifierInput.current?.focus();
      return;
    }
    const nameErr = validateDisplayName(form.displayName, form.register);
    if (form.register && nameErr) {
      displayNameInput.current?.focus();
      return;
    }
    const pwdErr = validatePassword(form.password, form.register);
    if (pwdErr) {
      passwordInput.current?.focus();
      return;
    }
    const cfmErr = validateConfirmation(confirmation, form.password, form.register);
    if (form.register && cfmErr) {
      confirmationInput.current?.focus();
      return;
    }

    setBusy(true);
    try {
      await j.login(form);
      sessionStorage.removeItem('journey.loginDraft');
      onDone?.();
    } catch (e) {
      if (e.code === 'ACCOUNT_EXISTS') {
        setServerErrors({ identifier: e.message });
        identifierInput.current?.focus();
      } else if (e.details && Array.isArray(e.details)) {
        const fieldMap = {};
        for (const item of e.details) {
          const field = item.path?.[0];
          if (field) fieldMap[field] = item.message;
        }
        setServerErrors(fieldMap);
        if (fieldMap.identifier) identifierInput.current?.focus();
        else if (fieldMap.displayName) displayNameInput.current?.focus();
        else if (fieldMap.password) passwordInput.current?.focus();
      }
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const card = (
    <section
      className="login-card"
      data-mode={form.register ? 'register' : 'login'}
      aria-labelledby={headingId}
    >
      <header className="login-heading">
        <h1 id={headingId}>
          <ModeCopy register={form.register} login="欢迎回来" registration="从这里，一起出发" />
        </h1>
        <p>
          <ModeCopy
            register={form.register}
            login="登录后，继续你的旅行计划"
            registration="创建账号，开启你的下一程"
          />
        </p>
      </header>
      <div className="segmented login-mode" role="group" aria-label="账号操作">
        <button
          type="button"
          aria-pressed={!form.register}
          className={!form.register ? 'selected' : ''}
          disabled={busy}
          onClick={() => change('register', false)}
        >
          登录
        </button>
        <button
          type="button"
          aria-pressed={form.register}
          className={form.register ? 'selected' : ''}
          disabled={busy}
          onClick={() => change('register', true)}
        >
          创建账号
        </button>
      </div>
      <form className="login-form" aria-busy={busy} onSubmit={submit} noValidate>
        <Field label="手机号或邮箱" error={identifierError}>
          <input
            ref={identifierInput}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            disabled={busy}
            value={form.identifier}
            onChange={(e) => change('identifier', e.target.value)}
            onBlur={() => setIdentifierTouched(true)}
            placeholder="输入手机号或邮箱"
          />
          <UserRound className="login-field-icon" size={18} aria-hidden="true" />
        </Field>
        <RegisterField register={form.register}>
          <Field label="你的称呼" error={displayNameError}>
            <input
              ref={displayNameInput}
              autoComplete="nickname"
              required={form.register}
              disabled={busy || !form.register}
              maxLength={80}
              value={form.displayName}
              onChange={(e) => change('displayName', e.target.value)}
              onBlur={() => setDisplayNameTouched(true)}
              placeholder="怎么称呼你"
            />
            <UserRound className="login-field-icon" size={18} aria-hidden="true" />
          </Field>
        </RegisterField>
        <Field label="密码" error={passwordError}>
          <input
            ref={passwordInput}
            type={showPassword ? 'text' : 'password'}
            autoComplete={form.register ? 'new-password' : 'current-password'}
            required
            disabled={busy}
            minLength={form.register ? 10 : undefined}
            maxLength={128}
            value={form.password}
            onChange={(e) => change('password', e.target.value)}
            onBlur={() => setPasswordTouched(true)}
            placeholder={form.register ? '10 至 128 个字符' : '输入密码'}
          />
          <LockKeyhole className="login-field-icon" size={18} aria-hidden="true" />
          <IconButton
            icon={showPassword ? EyeOff : Eye}
            label={showPassword ? '隐藏密码' : '显示密码'}
            onClick={() => setShowPassword((v) => !v)}
          />
        </Field>
        <RegisterField register={form.register}>
          <Field label="确认密码" error={confirmationError}>
            <input
              ref={confirmationInput}
              type={showConfirmation ? 'text' : 'password'}
              autoComplete="new-password"
              required={form.register}
              disabled={busy || !form.register}
              maxLength={128}
              value={confirmation}
              onChange={(e) => {
                setConfirmation(e.target.value);
                if (confirmationTouched) setError('');
              }}
              onBlur={() => setConfirmationTouched(true)}
              placeholder="再次输入密码"
            />
            <LockKeyhole className="login-field-icon" size={18} aria-hidden="true" />
            <IconButton
              icon={showConfirmation ? EyeOff : Eye}
              label={showConfirmation ? '隐藏确认密码' : '显示确认密码'}
              disabled={busy || !form.register}
              onClick={() => setShowConfirmation((v) => !v)}
            />
          </Field>
        </RegisterField>
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy} type="submit">
          {busy ? (
            <span>正在继续…</span>
          ) : (
            <ModeCopy register={form.register} login="登录并继续" registration="创建账号并继续" />
          )}
          <ArrowRight size={18} aria-hidden="true" />
        </button>
      </form>
    </section>
  );
  return illustrated ? (
    <div className="auth-layout" ref={layout}>
      <JourneySketch />
      {card}
    </div>
  ) : (
    card
  );
}
