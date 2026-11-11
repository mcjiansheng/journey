import React from 'react';
import { WIDGET_SIZES, widgetSize } from '../../board-widgets.js';

export function WidgetFrame({ item, model, children, className = '', style = {}, ariaLabel = '' }) {
  const size = widgetSize(item);
  const [baseW, baseH] = WIDGET_SIZES[size] || [168, 168];
  const fw = item.frame?.w || baseW;
  const fh = item.frame?.h || baseH;
  const wk = fw / baseW;

  const isGone = Boolean(model?.gone);

  return (
    <div
      className={`widget-frame ${isGone ? 'is-gone' : ''} ${className}`}
      role="region"
      aria-label={ariaLabel || model?.title || '小组件'}
      style={{
        width: fw,
        height: fh,
        '--wk': wk,
        ...style,
      }}
    >
      <div
        key={size}
        className={`w ${className}`}
        style={{
          width: baseW,
          height: baseH,
          transform: `scale(${wk})`,
          ...style,
        }}
      >
        {isGone && <span className="pill gone-pill">已移除</span>}
        {children}
      </div>
    </div>
  );
}
