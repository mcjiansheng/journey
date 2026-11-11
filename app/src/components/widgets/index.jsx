import React, { useMemo } from 'react';
import './widgets.css';
import { widgetModel, widgetDeps } from '../../board-widgets.js';
import { ActivityWidget } from './ActivityWidget.jsx';
import { DayWidget } from './DayWidget.jsx';
import { PlaceWidget } from './PlaceWidget.jsx';
import { RouteWidget } from './RouteWidget.jsx';
import { PlacesWidget } from './PlacesWidget.jsx';
import { CountdownWidget } from './CountdownWidget.jsx';
import { ClockWidget } from './ClockWidget.jsx';
import { ExpenseWidget } from './ExpenseWidget.jsx';
import { WidgetFrame } from './WidgetFrame.jsx';

export const BoardWidget = React.memo(function BoardWidget({ item, snapshot, deviceTimeZone }) {
  // Recompute the model only when the trip data it reads changes, not on every
  // drag frame or presence update (旧 P2-6).
  // The minute bucket keeps time-based models (countdown, clock, today) fresh.
  const deps = `${widgetDeps(snapshot, item)}|${Math.floor(Date.now() / 60000)}`;
  const model = useMemo(
    () => widgetModel(snapshot, item, { deviceTimeZone }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deps, item.content?.kind, item.style?.size, item.linkedActivityId, deviceTimeZone],
  );
  const kind = item.content?.kind;

  switch (kind) {
    case 'activity':
      return <ActivityWidget item={item} model={model} />;
    case 'day':
      return <DayWidget item={item} model={model} />;
    case 'place':
      return <PlaceWidget item={item} model={model} />;
    case 'places':
      return <PlacesWidget item={item} model={model} />;
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
});

export {
  ActivityWidget,
  DayWidget,
  PlaceWidget,
  RouteWidget,
  PlacesWidget,
  CountdownWidget,
  ClockWidget,
  ExpenseWidget,
  WidgetFrame,
};
