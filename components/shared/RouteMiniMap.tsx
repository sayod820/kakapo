'use client';
import { useEffect, useRef } from 'react';
import { COURIER_MAP_VIEW } from '@/lib/courierData';

function destroyMap(map: any, container?: HTMLDivElement | null) {
  if (!map) return;
  try {
    map.stop();
    map.eachLayer((layer: any) => { try { map.removeLayer(layer); } catch {} });
    map.off();
    map.remove();
  } catch {}
  if (container) delete (container as any)._leaflet_id;
}

/** Мини-карта Leaflet с маршрутом по дорогам */
export default function RouteMiniMap({
  geometry,
  height = 140,
}: {
  geometry: [number, number][];
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const genRef = useRef(0);

  useEffect(() => {
    if (typeof window === 'undefined' || !ref.current || !geometry.length) return;
    const gen = ++genRef.current;
    let cancelled = false;

    import('leaflet').then(L => {
      if (cancelled || gen !== genRef.current || !ref.current || (ref.current as any)._leaflet_id) return;

      if (!document.getElementById('leaflet-css')) {
        const link = document.createElement('link');
        link.id = 'leaflet-css';
        link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(link);
      }

      const map = L.map(ref.current!, {
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        touchZoom: false,
        zoomAnimation: false,
        fadeAnimation: false,
        markerZoomAnimation: false,
        inertia: false,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

      if (geometry.length >= 2) {
        L.polyline(geometry, { color: '#1FD760', weight: 4, opacity: 0.9 }).addTo(map);
        L.circleMarker(geometry[0], {
          radius: 8, color: '#1FD760', fillColor: '#1FD760', fillOpacity: 1,
        }).addTo(map).bindTooltip('KAKAPO', { permanent: false });
        L.circleMarker(geometry[geometry.length - 1], {
          radius: 8, color: '#3B8EF0', fillColor: '#3B8EF0', fillOpacity: 1,
        }).addTo(map).bindTooltip('Клиент', { permanent: false });

        map.whenReady(() => {
          if (cancelled || gen !== genRef.current) return;
          try {
            const bounds = L.latLngBounds(geometry);
            map.fitBounds(bounds, { animate: false, maxZoom: COURIER_MAP_VIEW.zoom, padding: [24, 24] });
          } catch { /* ignore */ }
        });
      }

      mapRef.current = map;
    });

    return () => {
      cancelled = true;
      genRef.current += 1;
      destroyMap(mapRef.current, ref.current);
      mapRef.current = null;
    };
  }, [geometry]);

  return <div ref={ref} style={{ width: '100%', height, background: '#050F08' }} />;
}
