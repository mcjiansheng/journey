import React from 'react';
import { WidgetFrame } from './WidgetFrame.jsx';
import { currencyFactor } from '../../domain.js';

export function ExpenseWidget({ item, model }) {
  const size = model.size || 'S';
  const cur = model.cur || 'CNY';

  // Format amount parts
  const rawParts = new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: cur,
    maximumFractionDigits: 0,
  }).formatToParts(Math.round(model.total / currencyFactor(cur)));

  const sym = rawParts
    .filter((p) => p.type === 'currency')
    .map((p) => p.value)
    .join('');
  const num = rawParts
    .filter((p) => p.type !== 'currency' && p.type !== 'literal')
    .map((p) => p.value)
    .join('');

  const sub = model.count
    ? [model.formattedPer ? `人均 ${model.formattedPer}` : null, `${model.count} 笔`]
        .filter(Boolean)
        .join(' · ')
    : '还没有记账';

  const bars = (
    <div className="bars">
      {model.perDay.map((v, i) => {
        const height = (model.max ? 3 + (27 * v) / model.max : 3).toFixed(1);
        const isOn = i === model.hi && v > 0;
        return (
          <span key={i} className="b">
            <i className={isOn ? 'on' : ''} style={{ '--h': `${height}px` }} />
            <em>{i + 1}</em>
          </span>
        );
      })}
    </div>
  );

  const left = (
    <>
      <div className="top">
        <span className="eyebrow">已支付</span>
        <span className="coin">
          <svg className="ic" viewBox="0 0 24 24">
            <path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5" />
            <path d="M17 14h.01" />
          </svg>
        </span>
      </div>
      <div className="amt">
        <small>{sym}</small>
        {num}
      </div>
      <div className="sub">{sub}</div>
      {bars}
    </>
  );

  const otherCurrencies = Object.keys(model.others || {});
  const variant = item.style?.variant || 'plain';

  if (variant === 'receipt') {
    const lines = model.top.slice(0, size === 'S' ? 2 : 4);
    return (
      <WidgetFrame
        item={item}
        model={model}
        className={`w-exp ${size.toLowerCase()}`}
        ariaLabel={`费用小组件：已支付 ${sym}${num}`}
      >
        <div className="receipt">
          <div className="rc-head">旅途小票 · {model.count} 笔</div>
          <div className="rc-lines">
            {lines.length ? (
              lines.map((e, idx) => (
                <div key={idx} className="rc-line">
                  <span className="t ellipsis">{e.title}</span>
                  <span className="v">{e.formatted}</span>
                </div>
              ))
            ) : (
              <div className="rc-line muted">还没有记账</div>
            )}
          </div>
          <div className="rc-total">
            <span>合计</span>
            <b>
              {sym}
              {num}
            </b>
          </div>
          {size === 'M' && model.formattedPer && (
            <div className="rc-foot">人均 {model.formattedPer}</div>
          )}
        </div>
      </WidgetFrame>
    );
  }
  if (variant === 'ring' || variant === 'minimal') {
    const planned = model.total + (model.est || 0);
    const frac = planned ? model.total / planned : 0;
    const c = 2 * Math.PI * 40;
    return (
      <WidgetFrame
        item={item}
        model={model}
        className={`w-exp ${size.toLowerCase()}`}
        ariaLabel={`费用小组件：已支付 ${sym}${num}`}
      >
        <div className={variant === 'ring' ? 'exp-ring' : 'exp-mini'}>
          {variant === 'ring' && (
            <svg viewBox="0 0 100 100" className="ring-svg">
              <circle cx="50" cy="50" r="40" className="track" />
              <circle
                cx="50"
                cy="50"
                r="40"
                className="bar"
                strokeDasharray={`${(c * frac).toFixed(1)} ${c.toFixed(1)}`}
              />
            </svg>
          )}
          <div className="exp-center">
            <small>已支付</small>
            <b>
              <i>{sym}</i>
              {num}
            </b>
            <small>{sub}</small>
          </div>
          {size === 'M' && (
            <div className="exp-side">
              <div>
                <em>已付</em>
                {model.formattedTotal}
              </div>
              <div>
                <em>预计</em>
                {model.formattedEst || '—'}
              </div>
              {model.formattedPer && (
                <div>
                  <em>人均</em>
                  {model.formattedPer}
                </div>
              )}
            </div>
          )}
        </div>
      </WidgetFrame>
    );
  }

  return (
    <WidgetFrame
      item={item}
      model={model}
      className={`w-exp ${size.toLowerCase()}`}
      ariaLabel={`费用小组件：已支付 ${sym}${num}`}
    >
      <div className="pad">
        {size === 'S' ? (
          left
        ) : (
          <>
            <div className="l">{left}</div>
            <div className="r">
              <span className="eyebrow">花得最多</span>
              {model.top.length ? (
                model.top.map((e, idx) => (
                  <div key={idx} className="er">
                    <span className="t ellipsis">{e.title}</span>
                    <span className="d">{e.dayText}</span>
                    <span className="v">{e.formatted}</span>
                  </div>
                ))
              ) : (
                <div className="none">还没有已支付的记录</div>
              )}
              <div className="foot">
                {model.formattedEst && <span className="est">预计还有 {model.formattedEst}</span>}
                {otherCurrencies.length > 0 && <span>另有 {otherCurrencies.join('、')}</span>}
              </div>
            </div>
          </>
        )}
      </div>
    </WidgetFrame>
  );
}
