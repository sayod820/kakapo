'use client';
import { useState, useCallback, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { calcDeliveryPrice, fetchOrderDeliveryRoute, formatKm, roundRouteKm, STORE_LOCATION } from '@/lib/courierData';
import { usePricing, usePickupLocations } from '@/lib/courierStore';
import { reverseGeocode, forwardGeocode } from '@/lib/geocode';

const RouteMiniMap = dynamic(() => import('./RouteMiniMap'), { ssr: false });
const AddressMapPicker = dynamic(() => import('./AddressMapPicker'), { ssr: false });

interface AddressResult {
  address: string;
  lat: number;
  lng: number;
  distanceKm: number;
  durationMin: number;
  geometry: [number, number][];
}

interface Props {
  value: string;
  onChange: (val: string) => void;
  weightKg?: number;
  orderAmount?: number;
  pickupIds?: string[];
  onPriceChange?: (
    price: ReturnType<typeof calcDeliveryPrice>,
    dist: number,
    meta: { lat: number; lng: number; durationMin: number; geometry: [number, number][]; pickupIds: string[] }
  ) => void;
  /** Сброс расчёта доставки (когда адрес изменён без точки на карте) */
  onClear?: () => void;
  /** Уже сохранённые координаты — подтвердить на карте автоматически */
  initialCoords?: { lat: number; lng: number } | null;
  /** Скрыть кнопку «Изменить адрес» (расчёт и карта маршрута остаются) */
  hideChangeAddress?: boolean;
}

export default function GeoAddressPicker({ value, onChange, weightKg = 2, orderAmount = 0, pickupIds = ['store'], onPriceChange, onClear, initialCoords = null, hideChangeAddress = false }: Props) {
  const { pricing } = usePricing();
  const locations = usePickupLocations();
  const [gpsLoading, setGpsLoading] = useState(false);
  const [routeLoading, setRouteLoading] = useState(false);
  const [gpsError, setGpsError] = useState('');
  const [suggestions, setSuggestions] = useState<{ lat: number; lng: number; display: string }[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [resolved, setResolved] = useState<AddressResult | null>(null);
  const [showPinMap, setShowPinMap] = useState(false);
  const [draftPin, setDraftPin] = useState<{ lat: number; lng: number } | null>(null);
  const seededCoordsRef = useRef<string>('');
  const onPriceChangeRef = useRef(onPriceChange);
  onPriceChangeRef.current = onPriceChange;

  const resetCalculation = useCallback(() => {
    setResolved(null);
    seededCoordsRef.current = '';
    onClear?.();
  }, [onClear]);

  const resolveCoords = useCallback(async (lat: number, lng: number, address: string) => {
    setRouteLoading(true);
    try {
      const route = await fetchOrderDeliveryRoute({ pickupIds, lat, lng }, locations);
      const result: AddressResult = {
        address,
        lat,
        lng,
        distanceKm: roundRouteKm(route.distanceKm),
        durationMin: route.durationMin,
        geometry: route.geometry,
      };
      setResolved(result);
      setShowPinMap(false);
      const price = calcDeliveryPrice({ orderAmount, distanceKm: route.distanceKm, weightKg, pricing });
      onPriceChangeRef.current?.(price, route.distanceKm, {
        lat,
        lng,
        durationMin: route.durationMin,
        geometry: route.geometry,
        pickupIds,
      });
    } finally {
      setRouteLoading(false);
    }
  }, [orderAmount, weightKg, pricing, onPriceChange, pickupIds, locations]);

  useEffect(() => {
    if (!initialCoords?.lat || !initialCoords?.lng || !value?.trim()) return
    const key = `${initialCoords.lat.toFixed(5)}:${initialCoords.lng.toFixed(5)}:${value.trim()}`
    if (seededCoordsRef.current === key) return
    seededCoordsRef.current = key
    setResolved(null)
    setDraftPin({ lat: initialCoords.lat, lng: initialCoords.lng })
    void resolveCoords(initialCoords.lat, initialCoords.lng, value)
  }, [initialCoords?.lat, initialCoords?.lng, value, resolveCoords])

  useEffect(() => {
    if (!resolved) return
    const price = calcDeliveryPrice({ orderAmount, distanceKm: resolved.distanceKm, weightKg, pricing })
    onPriceChangeRef.current?.(price, resolved.distanceKm, {
      lat: resolved.lat,
      lng: resolved.lng,
      durationMin: resolved.durationMin,
      geometry: resolved.geometry,
      pickupIds,
    })
  }, [resolved, orderAmount, weightKg, pricing, pickupIds])

  const openMap = (initial?: { lat: number; lng: number } | null) => {
    setDraftPin(initial ?? draftPin ?? { lat: STORE_LOCATION.lat, lng: STORE_LOCATION.lng });
    setShowPinMap(true);
    resetCalculation();
  };

  const confirmPin = async ({ lat, lng, address }: { lat: number; lng: number; address: string }) => {
    const text = address || value || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    onChange(text);
    setDraftPin({ lat, lng });
    await resolveCoords(lat, lng, text);
  };

  const useGPS = () => {
    if (!navigator.geolocation) {
      setGpsError('GPS недоступен в вашем браузере');
      return;
    }
    setGpsLoading(true);
    setGpsError('');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        const addr = await reverseGeocode(lat, lng);
        const text = addr || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        onChange(text);
        setDraftPin({ lat, lng });
        setShowPinMap(true);
        resetCalculation();
        setGpsLoading(false);
      },
      (err) => {
        setGpsError(
          err.code === 1 ? 'Доступ к GPS запрещён. Разреши в настройках браузера.' :
          err.code === 2 ? 'GPS сигнал недоступен. Попробуй ещё раз.' :
          'Время ожидания GPS истекло. Попробуй ещё раз.'
        );
        setGpsLoading(false);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  };

  let searchTimer: ReturnType<typeof setTimeout>;
  const handleInput = (val: string) => {
    onChange(val);
    setSuggestions([]);
    setShowPinMap(false);
    setDraftPin(null);
    resetCalculation();
    clearTimeout(searchTimer);
    if (val.length < 3) return;
    setSearchLoading(true);
    searchTimer = setTimeout(async () => {
      const results = await forwardGeocode(val);
      setSuggestions(results);
      setSearchLoading(false);
    }, 600);
  };

  const pickSuggestion = async (s: { lat: number; lng: number; display: string }) => {
    const text = s.display.split(',').slice(0, 3).join(',');
    onChange(text);
    setSuggestions([]);
    setDraftPin({ lat: s.lat, lng: s.lng });
    setShowPinMap(true);
    resetCalculation();
  };

  const price = resolved
    ? calcDeliveryPrice({ orderAmount, distanceKm: resolved.distanceKm, weightKg, pricing })
    : null;

  const routeLabel = pickupIds.length > 1
    ? `${pickupIds.length} точки → клиент`
    : pickupIds[0] === 'store'
      ? 'магазин → клиент'
      : 'ресторан → клиент';

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ position: 'relative', display: 'flex', gap: 8 }}>
        <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
          <div style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', fontSize: 16, zIndex: 2 }}>📍</div>
          <input
            className="inp"
            value={value}
            onChange={e => handleInput(e.target.value)}
            placeholder="Улица, дом — затем укажите точку на карте"
            style={{ width: '100%', paddingLeft: 38, paddingRight: searchLoading ? 36 : 14 }}
          />
          {searchLoading && (
            <div style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', width: 16, height: 16, borderRadius: '50%', border: '2px solid rgba(31,215,96,.3)', borderTopColor: 'var(--gr)', animation: 'spin 1s linear infinite' }} />
          )}
        </div>
        <button
          type="button"
          onClick={useGPS}
          disabled={gpsLoading || routeLoading}
          style={{ flexShrink: 0, width: 48, height: 48, borderRadius: 13, background: resolved ? 'rgba(31,215,96,.12)' : 'var(--l3)', border: `1.5px solid ${resolved ? 'rgba(31,215,96,.4)' : 'var(--b1)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 20, transition: 'all .2s', boxShadow: resolved ? '0 4px 14px rgba(31,215,96,.2)' : undefined }}
          title="GPS — затем подтвердите точку на карте"
        >
          {gpsLoading || routeLoading
            ? <div style={{ width: 18, height: 18, borderRadius: '50%', border: '2.5px solid rgba(31,215,96,.3)', borderTopColor: 'var(--gr)', animation: 'spin 1s linear infinite' }} />
            : resolved ? '✅' : '📡'
          }
        </button>
      </div>

      {gpsError && (
        <div style={{ marginTop: 8, padding: '9px 12px', borderRadius: 10, background: 'rgba(255,69,69,.08)', border: '1px solid rgba(255,69,69,.25)', fontSize: 12, color: 'var(--red)', display: 'flex', alignItems: 'center', gap: 7 }}>
          ⚠️ {gpsError}
        </div>
      )}

      {suggestions.length > 0 && (
        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 50, background: 'var(--l1)', border: '1px solid var(--b1)', borderRadius: 14, overflow: 'hidden', boxShadow: '0 12px 40px rgba(0,0,0,.6)' }}>
          {suggestions.map((s, i) => (
            <div key={i} onClick={() => pickSuggestion(s)}
              style={{ padding: '11px 14px', cursor: 'pointer', borderBottom: i < suggestions.length - 1 ? '1px solid var(--b1)' : 'none', transition: 'background .15s', display: 'flex', alignItems: 'center', gap: 10 }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(31,215,96,.06)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
              <span style={{ fontSize: 16, flexShrink: 0 }}>📍</span>
              <span style={{ fontSize: 12, lineHeight: 1.4, color: 'var(--t1)' }}>{s.display.split(',').slice(0, 4).join(', ')}</span>
            </div>
          ))}
        </div>
      )}

      {/* Обязательный шаг: точка на карте */}
      {!resolved && !showPinMap && (
        <button
          type="button"
          onClick={() => openMap()}
          style={{ width: '100%', marginTop: 10, padding: '13px 14px', borderRadius: 14, background: 'rgba(31,215,96,.08)', border: '1.5px solid rgba(31,215,96,.35)', color: 'var(--gr)', fontSize: 13, fontWeight: 700, fontFamily: 'Nunito', cursor: 'pointer' }}
        >
          🗺 Указать точку на карте *
        </button>
      )}

      {!resolved && showPinMap && (
        <div style={{ marginTop: 10, padding: 12, borderRadius: 16, border: '1px solid rgba(59,142,240,.3)', background: 'rgba(59,142,240,.05)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--sky)', marginBottom: 8 }}>
            Шаг 2 · Подтвердите точку дома на карте
          </div>
          <AddressMapPicker
            key={`pin-${draftPin?.lat}-${draftPin?.lng}`}
            initial={draftPin}
            onSelect={confirmPin}
          />
          <button
            type="button"
            onClick={() => setShowPinMap(false)}
            style={{ marginTop: 8, fontSize: 11, color: 'var(--t3)', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'Nunito', fontWeight: 600 }}
          >
            ← Скрыть карту
          </button>
        </div>
      )}

      {!resolved && value && !showPinMap && (
        <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 10, background: 'rgba(255,184,0,.08)', border: '1px solid rgba(255,184,0,.25)', fontSize: 11, color: 'var(--gd)', fontWeight: 600 }}>
          ⚠️ Без точки на карте доставка не рассчитается — нажмите «🗺 Указать точку на карте»
        </div>
      )}

      {routeLoading && (
        <div style={{ marginTop: 10, height: 80, borderRadius: 14, background: '#050F08', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, border: '1px solid rgba(31,215,96,.25)' }}>
          <div style={{ width: 24, height: 24, borderRadius: '50%', border: '3px solid rgba(31,215,96,.2)', borderTopColor: 'var(--gr)', animation: 'spin 1s linear infinite' }} />
          <span style={{ fontSize: 12, color: 'var(--t2)' }}>Считаем маршрут и доставку…</span>
        </div>
      )}

      {resolved && price && !routeLoading && (
        <div style={{ marginTop: 10, borderRadius: 16, overflow: 'hidden', border: '1px solid rgba(31,215,96,.25)' }}>
          <div style={{ position: 'relative', isolation: 'isolate', zIndex: 0 }}>
            <RouteMiniMap geometry={resolved.geometry} height={140} />
            <div style={{ position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', padding: '4px 12px', borderRadius: 20, background: 'rgba(3,11,5,.85)', border: '1px solid rgba(31,215,96,.3)', fontSize: 11, fontWeight: 700, color: 'var(--gr)', whiteSpace: 'nowrap', zIndex: 500 }}>
              🛣 {formatKm(resolved.distanceKm)} · {routeLabel} · ~{resolved.durationMin} мин
            </div>
          </div>

          <div style={{ background: 'rgba(9,21,8,.95)', padding: '14px 16px' }}>
            <div style={{ fontSize: 11, color: 'var(--gr)', fontWeight: 700, marginBottom: 8 }}>
              ✓ Точка подтверждена · {resolved.lat.toFixed(5)}, {resolved.lng.toFixed(5)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 10 }}>
              Расчёт стоимости доставки
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 12 }}>
              {price.breakdown.map((line, i) => (
                <div key={i} style={{ fontSize: 12, color: line.startsWith('✅') ? 'var(--gr)' : 'var(--t2)' }}>{line}</div>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderRadius: 12, background: price.isFree ? 'rgba(31,215,96,.1)' : 'rgba(255,184,0,.08)', border: `1px solid ${price.isFree ? 'rgba(31,215,96,.3)' : 'rgba(255,184,0,.25)'}` }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: price.isFree ? 'var(--gr)' : 'var(--t1)' }}>
                  {price.isFree ? '🎉 Доставка бесплатна!' : 'Стоимость доставки'}
                </div>
                {price.freeReason && <div style={{ fontSize: 11, color: 'var(--t2)', marginTop: 2 }}>{price.freeReason}</div>}
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                {price.isFree
                  ? <span className="ub" style={{ fontFamily: 'Unbounded', fontSize: 16, fontWeight: 900, color: 'var(--gr)' }}>0 ЅМ</span>
                  : <span className="ub" style={{ fontFamily: 'Unbounded', fontSize: 16, fontWeight: 900, color: 'var(--gd)' }}>{price.total.toFixed(2)} ЅМ</span>
                }
              </div>
            </div>
            {!hideChangeAddress && (
            <button
              type="button"
              onClick={() => { setResolved(null); setShowPinMap(false); setDraftPin(null); onChange(''); resetCalculation(); }}
              style={{ marginTop: 10, fontSize: 11, color: 'var(--t3)', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'Nunito', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}
            >
              ✕ Изменить адрес
            </button>
            )}
          </div>
        </div>
      )}

      {!resolved && !value && (
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--t3)' }}>
          <span>💡</span>
          <span>Адрес + <span style={{ color: 'var(--gr)', fontWeight: 700 }}>точка на карте</span> — тогда посчитаем доставку</span>
        </div>
      )}
    </div>
  );
}
