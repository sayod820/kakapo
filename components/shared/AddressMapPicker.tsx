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
  /** Подпись над адресом в режиме center (как «Откуда» в такси) */
  addressLabel?: string;
}

const THEMES = {
  client: {
    hint: 'Нажмите на карту — курьер увидит эту точку',
    centerHint: 'Двигайте карту — остриё метки показывает ваш дом',
    pin: 'linear-gradient(135deg,#1E5BB5,#3B8EF0)',
    centerPinFill: '#1FD760',
    centerPinDark: '#0F8A3A',
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
    centerHint: 'Двигайте карту — остриё метки = точка доставки',
    pin: 'linear-gradient(135deg,#17B34E,#1FD760)',
    centerPinFill: '#1FD760',
    centerPinDark: '#0F8A3A',
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

/** Масштаб при выборе точки — несколько кварталов (как на экране «Новый адрес») */
const CENTER_PICK_ZOOM = COURIER_MAP_VIEW.zoom;
const CENTER_PICK_GPS_ZOOM = 15;

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

/** Цельная метка (как в такси): круг + короткий ножок, без разрыва; при движении вся метка поднимается */
function CenterPinOverlay({
  fill,
  fillDark,
  address,
  loading,
  moving,
  addressVisible,
  dropKey,
  addressLabel = 'Адрес',
}: {
  fill: string;
  fillDark: string;
  address: string;
  loading: boolean;
  moving: boolean;
  addressVisible: boolean;
  dropKey: number;
  addressLabel?: string;
}) {
  const lift = moving ? 22 : 0;
  const pinH = 54;
  const pinW = 48;
  const showBubble = !moving && (loading || addressVisible);
  const gradId = `kpin-${fill.replace('#', '')}`;

  return (
    <>
      <style>{`
        @keyframes kakapoPinDrop {
          0% { transform: translate(-50%, calc(-100% - 22px)); }
          55% { transform: translate(-50%, calc(-100% + 4px)); }
          75% { transform: translate(-50%, calc(-100% - 2px)); }
          100% { transform: translate(-50%, -100%); }
        }
        @keyframes kakapoBubbleIn {
          from { opacity: 0; transform: translateX(-50%) translateY(8px) scale(0.96); }
          to { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
        }
      `}</style>
      <div
        aria-hidden
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: pinW,
          transform: moving
            ? `translate(-50%, calc(-100% - ${lift}px))`
            : dropKey > 0
              ? undefined
              : 'translate(-50%, -100%)',
          animation: !moving && dropKey > 0 ? 'kakapoPinDrop 0.45s cubic-bezier(.34,1.2,.64,1) both' : undefined,
          transition: moving ? 'transform 0.18s ease-out' : undefined,
          pointerEvents: 'none',
          zIndex: 500,
        }}
      >
        {showBubble && (
          <div
            style={{
              position: 'absolute',
              bottom: pinH + 10,
              left: '50%',
              transform: 'translateX(-50%)',
              padding: '10px 14px',
              borderRadius: 14,
              background: '#fff',
              boxShadow: '0 4px 20px rgba(0,0,0,.18), 0 1px 4px rgba(0,0,0,.08)',
              minWidth: 160,
              maxWidth: 280,
              animation: addressVisible && !loading ? 'kakapoBubbleIn 0.35s cubic-bezier(.16,1,.3,1) both' : undefined,
            }}
          >
            <div style={{ fontSize: 10, color: '#8A8A8A', fontWeight: 600, marginBottom: 3, fontFamily: 'Nunito' }}>
              {addressLabel}
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1A1A1A', lineHeight: 1.35, fontFamily: 'Nunito', wordBreak: 'break-word' }}>
              {loading ? 'Определяем адрес…' : address}
            </div>
          </div>
        )}

        <svg
          width={pinW}
          height={pinH}
          viewBox="0 0 48 54"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{ display: 'block', filter: 'drop-shadow(0 5px 12px rgba(0,0,0,.32))' }}
        >
          <ellipse cx="24" cy="51.5" rx={moving ? 4 : 8} ry={moving ? 1.2 : 2.2} fill="rgba(0,0,0,.18)" style={{ transition: 'all 0.18s ease-out' }} />
          <path
            d="M24 52.5 C24 52.5 8.5 34 8.5 21.5 C8.5 12.4 15.4 5 24 5 C32.6 5 39.5 12.4 39.5 21.5 C39.5 34 24 52.5 24 52.5 Z"
            fill={`url(#${gradId})`}
            stroke="#fff"
            strokeWidth="3"
            strokeLinejoin="round"
          />
          <circle cx="24" cy="21" r="11.5" fill="#fff" />
          {loading && !moving ? (
            <circle cx="24" cy="21" r="6" stroke={fill} strokeWidth="2.5" fill="none" strokeLinecap="round" strokeDasharray="10 16">
              <animateTransform attributeName="transform" type="rotate" from="0 24 21" to="360 24 21" dur="0.8s" repeatCount="indefinite" />
            </circle>
          ) : (
            <rect x="16.5" y="19.4" width="15" height="3.2" rx="1.6" fill={fill} />
          )}
          <defs>
            <linearGradient id={gradId} x1="10" y1="5" x2="38" y2="52" gradientUnits="userSpaceOnUse">
              <stop stopColor={fillDark} />
              <stop offset="1" stopColor={fill} />
            </linearGradient>
          </defs>
        </svg>
      </div>
    </>
  );
}

/** Интерактивная карта: выбор точки (тап, перетаскивание или GPS) */
export default function AddressMapPicker({
  onSelect,
  initial,
  variant = 'client',
  hint,
  mapHeight = 220,
  pickMode = 'tap',
  addressLabel = 'Адрес доставки',
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
  const [liveAddress, setLiveAddress] = useState('');
  const [addressLoading, setAddressLoading] = useState(false);
  const [addressVisible, setAddressVisible] = useState(false);
  const [mapMoving, setMapMoving] = useState(false);
  const [dropKey, setDropKey] = useState(0);
  const geocodeReqRef = useRef(0);
  const geocodeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resolveAddress = (lat: number, lng: number, delayMs = 0) => {
    if (geocodeTimerRef.current) clearTimeout(geocodeTimerRef.current);
    geocodeTimerRef.current = setTimeout(async () => {
      const req = ++geocodeReqRef.current;
      setAddressLoading(true);
      setAddressVisible(false);
      try {
        const address = await reverseGeocode(lat, lng);
        if (req !== geocodeReqRef.current) return;
        setLiveAddress(address || `${lat.toFixed(5)}, ${lng.toFixed(5)}`);
        setAddressVisible(true);
      } catch {
        if (req === geocodeReqRef.current) {
          setLiveAddress(`${lat.toFixed(5)}, ${lng.toFixed(5)}`);
          setAddressVisible(true);
        }
      } finally {
        if (req === geocodeReqRef.current) setAddressLoading(false);
      }
    }, delayMs);
  };

  const onMapMoveStart = () => {
    geocodeReqRef.current += 1;
    if (geocodeTimerRef.current) clearTimeout(geocodeTimerRef.current);
    setMapMoving(true);
    setAddressVisible(false);
    setAddressLoading(false);
  };

  useEffect(() => { pinRef.current = pin; }, [pin]);
  useEffect(() => { setConfirmed(false); }, [pin?.lat, pin?.lng]);

  useEffect(() => () => {
    if (geocodeTimerRef.current) clearTimeout(geocodeTimerRef.current);
  }, []);

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
      const startZoom = pickMode === 'center'
        ? CENTER_PICK_ZOOM
        : (pinRef.current ? 17 : COURIER_MAP_VIEW.zoom);
      const map = L.map(containerRef.current!, {
        center: [start.lat, start.lng],
        zoom: startZoom,
        minZoom: 12,
        maxZoom: 19,
        zoomControl: true,
        attributionControl: false,
        zoomAnimation: false,
        fadeAnimation: false,
        markerZoomAnimation: false,
      });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

      const updateCenterCoords = () => {
        const c = map.getCenter();
        setPin({ lat: c.lat, lng: c.lng });
        return c;
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
        map.on('movestart', onMapMoveStart);
        map.on('moveend', () => {
          setMapMoving(false);
          setDropKey(k => k + 1);
          const c = updateCenterCoords();
          resolveAddress(c.lat, c.lng, 380);
        });
        const c0 = updateCenterCoords();
        resolveAddress(c0.lat, c0.lng, 250);
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
      if (geocodeTimerRef.current) clearTimeout(geocodeTimerRef.current);
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
          const gpsZoom = pickMode === 'center' ? CENTER_PICK_GPS_ZOOM : 17;
          mapRef.current.setView([lat, lng], gpsZoom, { animate: false });
          if (pickMode === 'center') {
            setAddressVisible(false);
            setAddressLoading(true);
            reverseGeocode(lat, lng).then(addr => {
              setLiveAddress(addr || `${lat.toFixed(5)}, ${lng.toFixed(5)}`);
              setAddressLoading(false);
              setAddressVisible(true);
            }).catch(() => {
              setLiveAddress(`${lat.toFixed(5)}, ${lng.toFixed(5)}`);
              setAddressLoading(false);
              setAddressVisible(true);
            });
          } else {
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
      let text = liveAddress.trim();
      if (!text || addressLoading) {
        text = await reverseGeocode(activePin.lat, activePin.lng);
      }
      if (!text) text = `${activePin.lat.toFixed(5)}, ${activePin.lng.toFixed(5)}`;
      onSelect({ lat: activePin.lat, lng: activePin.lng, address: text });
      setPin(activePin);
      setLiveAddress(text);
      setConfirmed(true);
    } catch {
      const fallback = liveAddress || `${activePin.lat.toFixed(5)}, ${activePin.lng.toFixed(5)}`;
      onSelect({ lat: activePin.lat, lng: activePin.lng, address: fallback });
      setPin(activePin);
      setConfirmed(true);
    } finally {
      setConfirmLoading(false);
    }
  };

  return (
    <div>
      <div style={{ position: 'relative', borderRadius: 14, overflow: pickMode === 'center' ? 'visible' : 'hidden', border: pickMode === 'center' ? 'none' : `1px solid ${theme.coordsBorder}`, marginBottom: 10 }}>
        <div ref={containerRef} style={{ width: '100%', height: mapHeight, background: '#050F08' }} />
        {!ready && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#050F08' }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', border: '3px solid rgba(31,215,96,.2)', borderTopColor: theme.spinner, animation: 'spin 1s linear infinite' }} />
          </div>
        )}
        {pickMode === 'center' && ready && (
          <CenterPinOverlay
            fill={theme.centerPinFill}
            fillDark={theme.centerPinDark}
            address={liveAddress}
            loading={addressLoading}
            moving={mapMoving}
            addressVisible={addressVisible}
            dropKey={dropKey}
            addressLabel={addressLabel}
          />
        )}
        {pickMode !== 'center' && (
          <div style={{ position: 'absolute', top: 10, left: 10, right: 10, padding: '6px 10px', borderRadius: 10, background: 'rgba(3,11,5,.88)', fontSize: 11, color: theme.btnText, pointerEvents: 'none' }}>
            {hintText}
          </div>
        )}
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

      {pin && pickMode !== 'center' && (
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
