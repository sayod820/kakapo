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
  /** center — метка по центру, карту двигает пользователь; tap — тап/drag маркера */
  pickMode?: 'tap' | 'center';
}

const THEMES = {
  client: {
    hint: 'Нажмите на карту — курьер увидит эту точку',
    centerHint: 'Двигайте карту — метка по центру показывает ваш дом',
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
    centerHint: 'Двигайте карту под меткой  ·  «Подтвердить точку»',
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
  pickMode = 'tap',
}: Props) {
  const theme = THEMES[variant];
  const hintText = hint ?? (pickMode === 'center' ? theme.centerHint : theme.hint);
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
        zoom: pinRef.current ? 17 : COURIER_MAP_VIEW.zoom,
        zoomControl: true,
        attributionControl: false,
        zoomAnimation: false,
        fadeAnimation: false,
        markerZoomAnimation: false,
      });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

      const syncCenterPin = () => {
        const c = map.getCenter();
        setPin({ lat: c.lat, lng: c.lng });
      };

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

      if (pickMode === 'center') {
        map.on('moveend', syncCenterPin);
        syncCenterPin();
      } else {
        if (pinRef.current) placeMarker(pinRef.current.lat, pinRef.current.lng);
        map.on('click', (e: { latlng: { lat: number; lng: number } }) => {
          const { lat, lng } = e.latlng;
          setPin({ lat, lng });
          placeMarker(lat, lng);
        });
      }

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
  }, [pickMode]);

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
          mapRef.current.setView([lat, lng], 17, { animate: false });
          if (pickMode !== 'center') {
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
            });
          }
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
    const activePin = pickMode === 'center' && mapRef.current
      ? (() => {
          const c = mapRef.current.getCenter();
          return { lat: c.lat, lng: c.lng };
        })()
      : pin;
    if (!activePin) {
      setError(pickMode === 'center' ? 'Подождите загрузки карты' : 'Сначала нажмите на карту или используйте GPS');
      return;
    }
    setConfirmLoading(true);
    setError('');
    try {
      const address = await reverseGeocode(activePin.lat, activePin.lng);
      const text = address || `${activePin.lat.toFixed(5)}, ${activePin.lng.toFixed(5)}`;
      onSelect({ lat: activePin.lat, lng: activePin.lng, address: text });
      setPin(activePin);
      setConfirmed(true);
    } catch {
      onSelect({ lat: activePin.lat, lng: activePin.lng, address: `${activePin.lat.toFixed(5)}, ${activePin.lng.toFixed(5)}` });
      setPin(activePin);
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
        {pickMode === 'center' && ready && (
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -100%)',
              pointerEvents: 'none',
              zIndex: 500,
              filter: 'drop-shadow(0 4px 8px rgba(0,0,0,.45))',
            }}
            dangerouslySetInnerHTML={{ __html: pinIconHtml(theme.pin) }}
          />
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
          disabled={(pickMode === 'center' ? !ready : !pin) || confirmLoading}
          className="btn"
          style={{
            flex: 1.2,
            padding: '11px',
            borderRadius: 12,
            background: (pickMode === 'center' ? ready : pin) ? theme.confirm : theme.btnBg,
            border: (pickMode === 'center' ? ready : pin) ? 'none' : `1.5px solid ${theme.btnBorder}`,
            color: (pickMode === 'center' ? ready : pin) ? theme.confirmText : theme.btnMuted,
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
          📍 {pin.lat.toFixed(5)}, {pin.lng.toFixed(5)}{pickMode === 'center' ? ' · двигайте карту' : ' · маркер можно перетащить'}
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
