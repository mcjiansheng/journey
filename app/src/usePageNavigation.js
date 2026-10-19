import {useLayoutEffect, useRef} from 'react';

export function reducedMotion() {
  const motion = document.documentElement.dataset.motion;
  return motion === 'true' || (motion !== 'false' && matchMedia('(prefers-reduced-motion: reduce)').matches);
}

// Keep navigation synchronous. Only the new content enters; the persistent
// controls use interruptible CSS transitions rather than scaled page snapshots.
export function usePageNavigation(journey) {
  const previous = useRef(null);
  const tripId = journey.snapshot?.trip?.id;
  const page = journey.context?.page || 'itinerary';

  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = {tripId, page};
    if (!tripId || before?.tripId !== tripId || before.page === page || reducedMotion()) return;
    const content = document.querySelector(page === 'map'
      ? '.main-content > .journey-map' : '.main-content > .page');
    if (!content) return;
    // A transform on the map would change the containing block of its fixed canvas.
    const frames = page === 'map'
      ? [{opacity: .65}, {opacity: 1}]
      : [{opacity: .65, transform: 'translateY(6px)'}, {opacity: 1, transform: 'translateY(0)'}];
    const animation = content.animate(frames, {duration: 200, easing: 'cubic-bezier(.2,.7,.2,1)'});
    return () => animation.cancel();
  }, [tripId, page]);

  return journey;
}
