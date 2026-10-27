import React, {useState} from 'react';
import MapView from '../MapView.jsx';

// Scoped by the user's current trip in App. Keep the canvas after its first
// visit; returning home or changing trips releases it with the workspace.
export default function TripMap({active, ...props}) {
  const [visited, setVisited] = useState(active);
  if (active && !visited) setVisited(true);
  return active || visited ? <MapView {...props} active={active}/> : null;
}
