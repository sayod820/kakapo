let leafletPromise: Promise<typeof import('leaflet')> | null = null;

export function preloadLeaflet() {
  if (typeof window === 'undefined') return null;
  if (!document.getElementById('leaflet-css')) {
    const link = document.createElement('link');
    link.id = 'leaflet-css';
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);
  }
  if (!leafletPromise) leafletPromise = import('leaflet');
  return leafletPromise;
}

export function loadLeaflet() {
  return preloadLeaflet()!;
}
