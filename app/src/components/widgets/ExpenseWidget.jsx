import React from 'react';
import { WidgetFrame } from './WidgetFrame.jsx';
import { money } from '../../domain.js';

export function ExpenseWidget({ item, model }) {
  const size = model.size || 'S';
  const cur = model.cur || 'CNY';

  // Format amount parts
  const rawParts = new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: cur,
    maximumFractionDigits: 0,
  }).formatToParts(Math.round(model.total / (cur === 'JPY' ? 1 : 100)));

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
