import React, { useEffect, useState } from 'react';
import MapView from '../MapView.jsx';

// Scoped by the user's current trip in App. Keep the canvas after its first
// visit; returning home or changing trips releases it with the workspace.
export default function TripMap({ active, ...props }) {
  const [visited, setVisited] = useState(false);
  useEffect(() => {
    if (!active || visited) return;
    let cancelled = false;
    const transitions = document.querySelector('.sidebar')?.getAnimations() || [];
    // Keep the first map render and SDK work out of the sidebar transition.
    // Cancelling navigation also cancels this pending visit.
    Promise.allSettled(transitions.map((animation) => animation.finished)).then(() => {
      if (!cancelled) setVisited(true);
    });
    return () => {
      cancelled = true;
    };
  }, [active, visited]);
  if (visited) return <MapView {...props} active={active} />;
  return active ? (
    <section className="journey-map" aria-label="正在准备地图" aria-busy="true" />
  ) : null;
}
