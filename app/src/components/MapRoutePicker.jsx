import React, {useId, useLayoutEffect, useRef, useState} from 'react';
import {Check, ChevronDown} from 'lucide-react';

export default function MapRoutePicker({value, options, onChange}) {
  const id = useId();
  const root = useRef(null);
  const trigger = useRef(null);
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(value);
  const selected = Math.max(0, options.findIndex(option => option.value === value));
  const focusedIndex = options.findIndex(option => option.value === focused);
  const focusTarget = focusedIndex < 0 ? selected : focusedIndex;
  const optionValues = JSON.stringify(options.map(option => option.value));

  useLayoutEffect(() => {
    if (open) root.current.querySelectorAll('[role=option]')[focusTarget]?.focus();
  }, [open, focusTarget, optionValues]);

  function close(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) trigger.current.focus();
  }
  function show() { setFocused(options[selected].value); setOpen(true); }
  function choose(option) { onChange(option.value); close(true); }
  function keyDown(event) {
    const steps = {ArrowDown: 1, ArrowUp: -1};
    if (event.key in steps) {
      event.preventDefault();
      setFocused(options[(focusTarget + steps[event.key] + options.length) % options.length].value);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      setFocused(options[event.key === 'Home' ? 0 : options.length - 1].value);
    } else if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); close(true);
    }
  }

  return <div ref={root} className="map-route-picker" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) close();
  }}>
    <button ref={trigger} className="map-route-trigger" aria-label="地图路线日期"
      aria-haspopup="listbox" aria-expanded={open} aria-controls={id} aria-describedby={`${id}-value`}
      onClick={() => open ? close() : show()}
      onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); show(); }
      }}>
      <span id={`${id}-value`} key={value} className="map-route-label"><span className="map-route-full-label">{options[selected].label}</span><span className="map-route-compact-label">{options[selected].compactLabel||options[selected].label}</span></span>
      <ChevronDown size={17}/>
    </button>
    <div className={`map-route-menu glass ${open ? 'is-open' : ''}`} aria-hidden={!open} inert={!open}>
      <div className="map-route-menu-clip">
        <div id={id} role="listbox" aria-label="地图路线日期" className="map-route-options" onKeyDown={keyDown}>
          {options.map((option, index) => <button key={option.value} role="option"
            aria-selected={value === option.value} tabIndex={focusTarget === index ? 0 : -1}
            onFocus={() => setFocused(option.value)} onClick={() => choose(option)}>
            <span>{option.label}{option.date && <small>{option.date}</small>}</span>
            {value === option.value && <Check size={17}/>}</button>)}
        </div>
      </div>
    </div>
  </div>;
}
