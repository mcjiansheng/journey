import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { dateAdd } from '../domain.js';
import './date-range-picker.css';

const dateLabel = (date) => {
  const [year, month, day] = date.split('-').map(Number);
  return `${year}年${month}月${day}日`;
};
const monthStart = (date) => `${date.slice(0, 7)}-01`;
function moveMonth(date, amount) {
  const value = new Date(`${monthStart(date)}T12:00:00Z`);
  value.setUTCMonth(value.getUTCMonth() + amount);
  return value.toISOString().slice(0, 10);
}
export default function DateRangePicker({
  startDate,
  endDate,
  originalStartDate,
  originalEndDate,
  onChange,
  onSelectionChange,
}) {
  const [month, setMonth] = useState(() =>
    monthStart(startDate || originalStartDate || new Date().toISOString().slice(0, 10)),
  );
  const [pendingStart, setPendingStart] = useState(null);
  const calendar = useRef(null);
  useEffect(() => {
    setPendingStart(null);
    onSelectionChange(false);
    if (startDate) setMonth(monthStart(startDate));
  }, [startDate, endDate]);
  const start = pendingStart || startDate;
  const end = pendingStart || endDate;
  const offset = (new Date(`${month}T12:00:00Z`).getUTCDay() + 6) % 7;
  const first = dateAdd(month, -offset);
  function select(date) {
    if (!pendingStart) {
      setPendingStart(date);
      onSelectionChange(true);
    } else {
      onChange(
        date < pendingStart ? date : pendingStart,
        date < pendingStart ? pendingStart : date,
      );
      setPendingStart(null);
      onSelectionChange(false);
    }
  }
  function focusDate(date) {
    const target = calendar.current?.querySelector(`[data-date="${date}"]`);
    if (target) target.focus();
    else {
      setMonth(monthStart(date));
      requestAnimationFrame(() =>
        calendar.current?.querySelector(`[data-date="${date}"]`)?.focus(),
      );
    }
  }
  function keyDown(event, date) {
    const weekday = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
    const offsets = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
      Home: -weekday,
      End: 6 - weekday,
    };
    if (event.key in offsets) {
      event.preventDefault();
      focusDate(dateAdd(date, offsets[event.key]));
    }
  }
  return (
    <div className="date-range-picker" role="group" aria-label="日历选择日期范围">
      <div className="date-range-month">
        <button
          type="button"
          className="icon-button"
          aria-label="上个月"
          onClick={() => setMonth(moveMonth(month, -1))}
        >
          <ChevronLeft size={18} />
        </button>
        <strong aria-live="polite">
          {Number(month.slice(0, 4))} 年 {Number(month.slice(5, 7))} 月
        </strong>
        <button
          type="button"
          className="icon-button"
          aria-label="下个月"
          onClick={() => setMonth(moveMonth(month, 1))}
        >
          <ChevronRight size={18} />
        </button>
      </div>
      <p className="date-range-instruction" role="status">
        {pendingStart
          ? `已选 ${dateLabel(pendingStart)}，再选结束日期`
          : '先选开始日期，再选结束日期'}
      </p>
      <div className="date-range-grid" ref={calendar}>
        {['一', '二', '三', '四', '五', '六', '日'].map((day) => (
          <span className="date-range-weekday" key={day} aria-hidden="true">
            {day}
          </span>
        ))}
        {Array.from({ length: 42 }, (_, index) => {
          const date = dateAdd(first, index);
          const inRange = !!start && !!end && date >= start && date <= end;
          const inOriginal =
            !!originalStartDate && date >= originalStartDate && date <= originalEndDate;
          const removed = inOriginal && !!start && !!end && !inRange;
          const endpoint = date === start || date === end;
          return (
            <button
              type="button"
              key={date}
              data-date={date}
              aria-label={`${dateLabel(date)}${date === start ? '，开始日期' : date === end ? '，结束日期' : ''}${removed ? '，移出原旅程范围' : ''}`}
              aria-pressed={inRange}
              className={`date-range-day${date.slice(0, 7) !== month.slice(0, 7) ? ' other-month' : ''}${inRange ? ' in-range' : ''}${endpoint ? ' range-endpoint' : ''}${inOriginal ? ' original-range' : ''}${removed ? ' removed-date' : ''}`}
              onClick={() => select(date)}
              onKeyDown={(event) => keyDown(event, date)}
            >
              {Number(date.slice(8))}
            </button>
          );
        })}
      </div>
      {originalStartDate && (
        <p className="date-range-legend">
          <span aria-hidden="true" />
          虚线日期不在新的旅程范围内
        </p>
      )}
    </div>
  );
}
