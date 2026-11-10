import React from 'react';
import './widgets.css';
import { widgetModel } from '../../board-widgets.js';
import { ActivityWidget } from './ActivityWidget.jsx';
import { DayWidget } from './DayWidget.jsx';
import { PlaceWidget } from './PlaceWidget.jsx';
import { RouteWidget } from './RouteWidget.jsx';
import { CountdownWidget } from './CountdownWidget.jsx';
import { ClockWidget } from './ClockWidget.jsx';
import { ExpenseWidget } from './ExpenseWidget.jsx';
import { WidgetFrame } from './WidgetFrame.jsx';

export function BoardWidget({ item, snapshot, deviceTimeZone }) {
  const model = widgetModel(snapshot, item, { deviceTimeZone });
  const kind = item.content?.kind;

  switch (kind) {
    case 'activity':
      return <ActivityWidget item={item} model={model} />;
    case 'day':
      return <DayWidget item={item} model={model} />;
    case 'place':
      return <PlaceWidget item={item} model={model} />;
    case 'route':
      return <RouteWidget item={item} model={model} />;
    case 'countdown':
      return <CountdownWidget item={item} model={model} />;
    case 'clock':
      return <ClockWidget item={item} model={model} />;
    case 'expense':
      return <ExpenseWidget item={item} model={model} />;
    default:
      return (
        <WidgetFrame item={item} model={model}>
          <div style={{ padding: 16 }}>未知小组件</div>
        </WidgetFrame>
      );
  }
}

export {
  ActivityWidget,
  DayWidget,
  PlaceWidget,
  RouteWidget,
  CountdownWidget,
  ClockWidget,
  ExpenseWidget,
  WidgetFrame,
};
