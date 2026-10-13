import {useEffect, useRef} from 'react';
import {flushSync} from 'react-dom';

// Animate context navigation from both the main nav and activity/map links.
export function usePageNavigation(journey) {
  const active = useRef(null);
  const request = useRef(0);

  function cancel() {
    request.current++;
    active.current?.skipTransition();
    active.current = null;
  }

  useEffect(() => cancel, [journey.snapshot?.trip?.id]);

  function setContext(patch) {
    if (!patch.page) return journey.setContext(patch);
    const unchanged = patch.page === journey.context?.page;
    cancel();
    const motion = document.documentElement.dataset.motion;
    const reduced = motion === 'true' || (motion !== 'false' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (unchanged || reduced || !document.startViewTransition) return journey.setContext(patch);

    const current = request.current;
    const transition = document.startViewTransition(() => {
      // A second click or leaving the trip can supersede a pending snapshot.
      if (current === request.current) flushSync(() => journey.setContext(patch));
    });
    active.current = transition;
    // Skipping an interrupted animation rejects ready, while navigation still completes.
    transition.ready.catch(() => {});
    const clear = () => { if (active.current === transition) active.current = null; };
    transition.finished.then(clear, clear);
  }

  return {...journey, setContext, goHome() { cancel(); journey.goHome(); }};
}
