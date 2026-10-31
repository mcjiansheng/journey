import React, { useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import SelectionTrack from './SelectionTrack.jsx';
import { reducedMotion } from '../usePageNavigation.js';
import './date-expense-navigation.css';

// Scroll only this strip, so changing a filter never moves the page itself.
export default function ScrollableTabs({
  activeKey,
  className = '',
  trackClassName,
  selection = false,
  children,
  ...props
}) {
  const root = useRef(null);
  const previousSelection = useRef();
  const [edges, setEdges] = useState('');
  useLayoutEffect(() => {
    const strip = root.current.querySelector('.scrollable-tabs-track');
    function measure() {
      setEdges(
        `${strip.scrollLeft > 1 ? ' has-before' : ''}${strip.scrollWidth - strip.clientWidth - strip.scrollLeft > 1 ? ' has-after' : ''}`,
      );
    }
    function revealSelection(center = false) {
      const selected = strip.querySelector(
        'button[aria-selected="true"], button[aria-pressed="true"]',
      );
      if (selected) {
        const bounds = strip.getBoundingClientRect();
        const button = selected.getBoundingClientRect();
        const inset = 24;
        const delta = center
          ? button.left + button.width / 2 - bounds.left - bounds.width / 2
          : button.left < bounds.left + inset
            ? button.left - bounds.left - inset
            : button.right > bounds.right - inset
              ? button.right - bounds.right + inset
              : 0;
        if (delta) strip.scrollLeft += delta;
      }
      measure();
    }
    if (previousSelection.current !== activeKey) {
      revealSelection(true);
      previousSelection.current = activeKey;
    }
    measure();
    let width = strip.clientWidth;
    const observer = new ResizeObserver(() => {
      if (width !== strip.clientWidth) {
        width = strip.clientWidth;
        revealSelection();
      } else measure();
    });
    observer.observe(strip);
    strip.querySelectorAll('button').forEach((button) => observer.observe(button));
    strip.addEventListener('scroll', measure, { passive: true });
    return () => {
      observer.disconnect();
      strip.removeEventListener('scroll', measure);
    };
  }, [activeKey, children]);
  function scroll(direction) {
    const strip = root.current.querySelector('.scrollable-tabs-track');
    strip.scrollBy({
      left: direction * strip.clientWidth * 0.7,
      behavior: reducedMotion() ? 'instant' : 'smooth',
    });
  }
  const Track = selection ? SelectionTrack : 'div';
  return (
    <div ref={root} className={`scrollable-tabs ${className}${edges}`}>
      <Track
        {...props}
        {...(selection ? { activeKey } : {})}
        className={`scrollable-tabs-track ${trackClassName}`}
      >
        {children}
      </Track>
      {edges.includes('has-before') && (
        <button
          className="scrollable-tabs-arrow before"
          aria-label="向前浏览日期"
          onClick={() => scroll(-1)}
        >
          <ChevronLeft size={17} />
        </button>
      )}
      {edges.includes('has-after') && (
        <button
          className="scrollable-tabs-arrow after"
          aria-label="向后浏览日期"
          onClick={() => scroll(1)}
        >
          <ChevronRight size={17} />
        </button>
      )}
    </div>
  );
}
