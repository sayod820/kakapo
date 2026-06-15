'use client';
import { useEffect, useRef, useState } from 'react';
import { COURIER_MAP_VIEW } from '@/lib/courierData';
import { reverseGeocode } from '@/lib/geocode';

export interface MapPinResult {
  lat: number;
  lng: number;
  address: string;
}

interface Props {
  onSelect: (result: MapPinResult) => void;
  initial?: { lat?: number; lng?: number } | null;
  variant?: 'client' | 'admin';
  hint?: string;
  mapHeight?: number;
}

const THEMES = {
  client: {
    hint: 'Нажмите на карту — курьер увидит эту точку',
    pin: 'linear-gradient(135deg,#1E5BB5,#3B8EF0)',
    gpsPin: 'linear-gradient(135deg,#0F8A3A,#1FD760)',
    btnBg: '#0C1C0F',
    btnBorder: '#162B1A',
    btnText: '#EBF5ED',
    btnMuted: '#3D6645',
    confirm: 'linear-gradient(135deg,#17B34E,#1FD760)',
    confirmText: '#ffffff',
    coordsBg: 'rgba(59,142,240,.08)',
    coordsBorder: 'rgba(59,142,240,.25)',
    coordsText: '#3B8EF0',
    error: '#FF4545',
    spinner: '#1FD760',
  },
  admin: {
    hint: '1. Нажмите на карту  2. «Подтвердить точку»  3. «Сохранить»',
    pin: 'linear-gradient(135deg,#17B34E,#1FD760)',
    gpsPin: 'linear-gradient(135deg,#1E5BB5,#3B8EF0)',
    btnBg: '#0C1C0F',
    btnBorder: '#162B1A',
    btnText: '#EBF5ED',
    btnMuted: '#3D6645',
    confirm: 'linear-gradient(135deg,#17B34E,#1FD760)',
    confirmText: '#030B05',
    coordsBg: 'rgba(31,215,96,.08)',
    coordsBorder: 'rgba(31,215,96,.25)',
    coordsText: '#1FD760',
    error: '#FF4545',
    spinner: '#1FD760',
  },
} as const;

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

function pinIconHtml(gradient: string) {
  return `<div style="width:36px;height:36px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${gradient};display:flex;align-items:center;justify-content:center;box-shadow:0 4px 14px rgba(0,0,0,.35);border:2px solid rgba(255,255,255,.3)"><span style="transform:rotate(45deg);font-size:16px">📍</span></div>`;
}

/** Интерактивная карта: выбор точки (тап, перетаскивание или GPS) */
export default function AddressMapPicker({
  onSelect,
  initial,
  variant = 'client',
  hint,
  mapHeight = 220,
}: Props) {
  const theme = THEMES[variant];
  const hintText = hint ?? theme.hint;
  const pinGradientRef = useRef(theme.pin);
  pinGradientRef.current = theme.pin;

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const genRef = useRef(0);
  const pinRef = useRef<{ lat: number; lng: number } | null>(
    initial?.lat != null && initial?.lng != null ? { lat: initial.lat, lng: initial.lng } : null,
  );

  const [ready, setReady] = useState(false);
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(pinRef.current);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { pinRef.current = pin; }, [pin]);
  useEffect(() => { setConfirmed(false); }, [pin?.lat, pin?.lng]);

  useEffect(() => {
    if (typeof window === 'undefined' || !containerRef.current) return;
    const gen = ++genRef.current;
    let cancelled = false;

    import('leaflet').then(L => {
      if (cancelled || gen !== genRef.current || !containerRef.current || (containerRef.current as any)._leaflet_id) return;

      if (!document.getElementById('leaflet-css')) {
        const link = document.createElement('link');
        link.id = 'leaflet-css';
        link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(link);
      }

      const start = pinRef.current ?? { lat: COURIER_MAP_VIEW.lat, lng: COURIER_MAP_VIEW.lng };
      const map = L.map(containerRef.current!, {
        center: [start.lat, start.lng],
        zoom: COURIER_MAP_VIEW.zoom,
        zoomControl: true,
        attributionControl: false,
        zoomAnimation: false,
        fadeAnimation: false,
        markerZoomAnimation: false,
      });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

      const placeMarker = (lat: number, lng: number, gradient = pinGradientRef.current) => {
        if (markerRef.current) {
          try { markerRef.current.remove(); } catch {}
        }
        const icon = L.divIcon({
          html: pinIconHtml(gradient),
          className: '',
          iconSize: [36, 36],
          iconAnchor: [18, 36],
        });
        markerRef.current = L.marker([lat, lng], { icon, draggable: true, zIndexOffset: 1000 }).addTo(map);
        markerRef.current.on('dragend', () => {
          const p = markerRef.current.getLatLng();
          setPin({ lat: p.lat, lng: p.lng });
        });
      };

      if (pinRef.current) placeMarker(pinRef.current.lat, pinRef.current.lng);

      map.on('click', (e: { latlng: { lat: number; lng: number } }) => {
        const { lat, lng } = e.latlng;
        setPin({ lat, lng });
        placeMarker(lat, lng);
      });

      mapRef.current = map;
      map.whenReady(() => {
        if (!cancelled && gen === genRef.current) {
          setReady(true);
          setTimeout(() => { try { map.invalidateSize(); } catch {} }, 80);
        }
      });
    });

    return () => {
      cancelled = true;
      genRef.current += 1;
      if (markerRef.current) { try { markerRef.current.remove(); } catch {} markerRef.current = null; }
      destroyMap(mapRef.current, containerRef.current);
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  const useGPS = () => {
    if (!navigator.geolocation) {
      setError('GPS недоступен');
      return;
    }
    setGpsLoading(true);
    setError('');
    navigator.geolocation.getCurrentPosition(
      pos => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setPin({ lat, lng });
        if (mapRef.current) {
          import('leaflet').then(L => {
            if (markerRef.current) try { markerRef.current.remove(); } catch {}
            const icon = L.divIcon({
              html: pinIconHtml(theme.gpsPin),
              className: '',
              iconSize: [36, 36],
              iconAnchor: [18, 36],
            });
            markerRef.current = L.marker([lat, lng], { icon, draggable: true, zIndexOffset: 1000 }).addTo(mapRef.current);
            markerRef.current.on('dragend', () => {
              const p = markerRef.current.getLatLng();
              setPin({ lat: p.lat, lng: p.lng });
            });
            mapRef.current.setView([lat, lng], 17, { animate: false });
          });
        }
        setGpsLoading(false);
      },
      err => {
        setError(err.code === 1 ? 'Доступ к GPS запрещён' : 'GPS недоступен');
        setGpsLoading(false);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  };

  const confirm = async () => {
    if (!pin) {
      setError('Сначала нажмите на карту или используйте GPS');
      return;
    }
    setConfirmLoading(true);
    setError('');
    try {
      const address = await reverseGeocode(pin.lat, pin.lng);
      const text = address || `${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}`;
      onSelect({ lat: pin.lat, lng: pin.lng, address: text });
      setConfirmed(true);
    } catch {
      onSelect({ lat: pin.lat, lng: pin.lng, address: `${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}` });
      setConfirmed(true);
    } finally {
      setConfirmLoading(false);
    }
  };

  return (
    <div>
      <div style={{ position: 'relative', borderRadius: 14, overflow: 'hidden', border: `1px solid ${theme.coordsBorder}`, marginBottom: 10 }}>
        <div ref={containerRef} style={{ width: '100%', height: mapHeight, background: '#050F08' }} />
        {!ready && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#050F08' }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', border: '3px solid rgba(31,215,96,.2)', borderTopColor: theme.spinner, animation: 'spin 1s linear infinite' }} />
          </div>
        )}
        <div style={{ position: 'absolute', top: 10, left: 10, right: 10, padding: '6px 10px', borderRadius: 10, background: 'rgba(3,11,5,.88)', fontSize: 11, color: theme.btnText, pointerEvents: 'none' }}>
          {hintText}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <button
          type="button"
          onClick={useGPS}
          disabled={gpsLoading}
          className="btn"
          style={{ flex: 1, padding: '11px', borderRadius: 12, background: theme.btnBg, border: `1.5px solid ${theme.btnBorder}`, color: theme.btnText, fontSize: 12, fontWeight: 700, fontFamily: 'Nunito', opacity: gpsLoading ? 0.7 : 1 }}
        >
          {gpsLoading ? '…' : '📡'} GPS
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={!pin || confirmLoading}
          className="btn"
          style={{
            flex: 1.2,
            padding: '11px',
            borderRadius: 12,
            background: pin ? theme.confirm : theme.btnBg,
            border: pin ? 'none' : `1.5px solid ${theme.btnBorder}`,
            color: pin ? theme.confirmText : theme.btnMuted,
            fontSize: 12,
            fontWeight: 800,
            fontFamily: 'Nunito',
            opacity: confirmLoading ? 0.7 : 1,
          }}
        >
          {confirmLoading ? '…' : confirmed ? '✓ Подтверждено' : '✓ Подтвердить точку'}
        </button>
      </div>

      {pin && (
        <div style={{ padding: '8px 12px', borderRadius: 10, background: theme.coordsBg, border: `1px solid ${theme.coordsBorder}`, fontSize: 11, color: theme.coordsText, marginBottom: 8 }}>
          📍 {pin.lat.toFixed(5)}, {pin.lng.toFixed(5)} · маркер можно перетащить
        </div>
      )}
      {confirmed && (
        <div style={{ padding: '8px 12px', borderRadius: 10, background: 'rgba(31,215,96,.12)', border: '1px solid rgba(31,215,96,.35)', fontSize: 11, color: '#1FD760', marginBottom: 8, fontWeight: 700 }}>
          ✓ Точка подтверждена — нажмите «Сохранить» внизу формы
        </div>
      )}
      {error && (
        <div style={{ fontSize: 11, color: theme.error, marginBottom: 8 }}>⚠️ {error}</div>
      )}
    </div>
  );
}
