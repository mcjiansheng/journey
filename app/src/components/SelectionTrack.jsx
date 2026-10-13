import React, {useLayoutEffect, useRef} from 'react';

// One persistent surface moves behind the selected button, including when a
// second selection reverses an in-flight transition or tabs scroll horizontally.
export default function SelectionTrack({as: Element = 'div', activeKey, className = '', children, ...props}) {
  const track = useRef(null);
  const indicator = useRef(null);

  useLayoutEffect(() => {
    const element = track.current;
    const surface = indicator.current;
    function measure() {
      const selected = element.querySelector(':scope > button.selected');
      if (!selected || !selected.offsetWidth) return;
      surface.style.transform = `translate(${selected.offsetLeft}px, ${selected.offsetTop}px)`;
      surface.style.width = `${selected.offsetWidth}px`;
      surface.style.height = `${selected.offsetHeight}px`;
    }
    measure();
    // The initial selection is already in place on the first painted frame.
    const frame = requestAnimationFrame(() => { surface.dataset.ready = ''; });
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    element.querySelectorAll(':scope > button').forEach(button => observer.observe(button));
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [activeKey, children]);

  return <Element {...props} ref={track} className={`${className} selection-track`}>
    <span ref={indicator} className="selection-indicator" aria-hidden="true"/>
    {children}
  </Element>;
}
