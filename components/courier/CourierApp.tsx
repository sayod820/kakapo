'use client'
import { useState, useEffect, useRef, useMemo } from 'react'
import { calcDeliveryFee, fetchRoute, DEFAULT_PRICING, fetchOrderDeliveryRoute, formatKm, STORE_LOCATION } from '@/lib/courierData'
import { usePricingStore, usePickups, usePickupLocations, hydrateCourierStores } from '@/lib/courierStore'
import { DEMO_COURIER_ORDERS, DEMO_COURIER_HISTORY } from '@/lib/demoOrders'
import { useOrderRoadKm } from '@/lib/useOrderRoadKm'
import { useOrders, USE_API } from '@/lib/store'
import { mapOrdersForCourier, isCourierReadyOrder } from '@/lib/orderUiMap'
import { useApiSync } from '@/lib/useApiSync'
import type { PickupPoint } from '@/lib/pickups'

/* ══════════════════════════════════════════════════════
   KAKAPO КУРЬЕР — карта со всеми заказами + список
   Выбор заказа с карты или из списка · приём · маршрут
══════════════════════════════════════════════════════ */

const CSS = `
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent;}
  html,body{background:#030B05;color:#EBF5ED;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased;overflow-x:hidden;}
  .ub{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;}
  .btn{cursor:pointer;border:none;transition:all .2s cubic-bezier(.16,1,.3,1);}
  .btn:active{transform:scale(.96);}
  @keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
  @keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
  @keyframes fadeIn{from{opacity:0}to{opacity:1}}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
  @keyframes ping{0%{transform:scale(1);opacity:.7}100%{transform:scale(2.6);opacity:0}}
  @keyframes bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
  @keyframes slideUp{from{opacity:0;transform:translateY(40px)}to{opacity:1;transform:translateY(0)}}
  @keyframes dashmove{to{stroke-dashoffset:-24}}
  @keyframes glow{0%,100%{box-shadow:0 0 12px rgba(59,142,240,.4)}50%{box-shadow:0 0 24px rgba(59,142,240,.7)}}
  ::-webkit-scrollbar{width:0;height:0;}
`;

const COURIER = { name:'Фирдавс Назаров', vehicle:'🏍 TJ 1234 AA', rating:4.9 };

function useTariff() {
  return usePricingStore(s => s.pricing);
}

function calcDelivery(dist: number, weight: number, TARIFF = DEFAULT_PRICING): number {
  return calcDeliveryFee(dist, weight, TARIFF);
}

function getOrderKm(o: { id: string }, roadKm: Record<string, number>): number | null {
  return roadKm[o.id] ?? null;
}

function kmStr(km: number | null): string {
  return km != null ? formatKm(km, false) : '…';
}

function orderDelivery(o: { id: string; weight: number }, roadKm: Record<string, number>, TARIFF = DEFAULT_PRICING): number | null {
  const km = getOrderKm(o, roadKm);
  return km != null ? calcDelivery(km, o.weight, TARIFF) : null;
}

function isMapAlive(map: any): boolean {
  try {
    const el = map?.getContainer?.();
    return !!(map?._loaded && el?.isConnected && map.getPane?.('mapPane'));
  } catch {
    return false;
  }
}

function safeFitBounds(map: any, bounds: any) {
  if (!isMapAlive(map)) return;
  try {
    map.stop();
    const center = bounds.getCenter();
    const zoom = Math.min(map.getBoundsZoom(bounds, false), 18);
    map.setView(center, zoom, { animate: false, reset: true });
  } catch { /* карта уже уничтожена */ }
}

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

/* Центр карты по умолчанию (г. Яван) — без GPS курьера */
const MAP_CENTER = { lat: STORE_LOCATION.lat, lng: STORE_LOCATION.lng };

/** Разводит маркеры с одинаковыми координатами, чтобы все заказы были видны на карте */
function spreadOrderCoords<T extends { id: string; lat: number; lng: number }>(orders: T[]) {
  const groups = new Map<string, T[]>()
  for (const o of orders) {
    const key = `${o.lat.toFixed(4)}_${o.lng.toFixed(4)}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(o)
  }
  const out = new Map<string, { lat: number; lng: number }>()
  for (const group of groups.values()) {
    if (group.length === 1) {
      out.set(group[0].id, { lat: group[0].lat, lng: group[0].lng })
    } else {
      group.forEach((o, i) => {
        const a = (2 * Math.PI * i) / group.length
        out.set(o.id, { lat: o.lat + Math.sin(a) * 0.00028, lng: o.lng + Math.cos(a) * 0.00028 })
      })
    }
  }
  return out
}

function useCourierLocation() {
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const watchRef = useRef<number | null>(null);

  const stopWatch = () => {
    if (watchRef.current != null) {
      navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
    }
  };

  const enable = () => {
    if (!navigator.geolocation) {
      setError('GPS недоступен в браузере');
      return;
    }
    setLoading(true);
    setError('');
    navigator.geolocation.getCurrentPosition(
      p => {
        setPos({ lat: p.coords.latitude, lng: p.coords.longitude });
        setLoading(false);
        stopWatch();
        watchRef.current = navigator.geolocation.watchPosition(
          wp => setPos({ lat: wp.coords.latitude, lng: wp.coords.longitude }),
          () => {},
          { enableHighAccuracy: true, maximumAge: 5000 }
        );
      },
      err => {
        setError(
          err.code === 1 ? 'Доступ к GPS запрещён' :
          err.code === 2 ? 'GPS сигнал недоступен' :
          'Время ожидания GPS истекло'
        );
        setLoading(false);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  };

  const disable = () => {
    stopWatch();
    setPos(null);
    setError('');
  };

  useEffect(() => () => stopWatch(), []);

  return { pos, loading, error, enable, disable, enabled: pos != null };
}

/* Точки забора — из общего store (синхрон с админкой) */
function buildPickupsMap(list: PickupPoint[]) {
  return Object.fromEntries(list.map(p => [p.id, {
    id: p.id, name: p.name, addr: p.addr, phone: p.phone, e: p.e, color: p.color, lat: p.lat, lng: p.lng,
  }]));
}

const HISTORY = DEMO_COURIER_HISTORY;

/* ─────────────────────────────────────────────────────
    РЕАЛЬНАЯ КАРТА OpenStreetMap + Leaflet
───────────────────────────────────────────────────── */
function LeafletMap({ orders, selected, onSelect, pickupIdx = 0, step, height = 280, TARIFF = DEFAULT_PRICING, roadKm = {}, sheetOpen = false, courierPos = null, onEnableLocation, locationLoading = false, locationError = '', PICKUPS = {}, pickupLocations = {} }: {
  orders: typeof DEMO_COURIER_ORDERS; selected: any; onSelect: (o: any) => void; height?: number; pickupIdx?: number; step?: string; TARIFF?: typeof DEFAULT_PRICING; roadKm?: Record<string, number>; sheetOpen?: boolean
  courierPos?: { lat: number; lng: number } | null; onEnableLocation?: () => void; locationLoading?: boolean; locationError?: string
  PICKUPS?: Record<string, { id: string; name: string; addr: string; phone: string; e: string; color: string; lat: number; lng: number }>
  pickupLocations?: import('@/lib/pickups').PickupLocationMap
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<any>(null);
  const mapGenRef    = useRef(0);
  const markersRef   = useRef<any[]>([]);
  const routesRef    = useRef<any[]>([]);
  const fitTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFitKeyRef = useRef('');
  const routeFitKeyRef = useRef('');
  const roadKmRef = useRef(roadKm);
  const courierPosRef = useRef(courierPos);
  const pickupLocRef = useRef(pickupLocations);
  const [ready, setReady] = useState(false);

  useEffect(() => { roadKmRef.current = roadKm; }, [roadKm]);
  useEffect(() => { courierPosRef.current = courierPos; }, [courierPos]);
  useEffect(() => { pickupLocRef.current = pickupLocations; }, [pickupLocations]);

  const scheduleFit = (bounds: any, fitKey: string) => {
    if (routeFitKeyRef.current === fitKey) return;
    routeFitKeyRef.current = fitKey;
    if (fitTimerRef.current) clearTimeout(fitTimerRef.current);
    fitTimerRef.current = setTimeout(() => {
      fitTimerRef.current = null;
      if (isMapAlive(mapRef.current)) safeFitBounds(mapRef.current, bounds);
    }, 80);
  };

  /* подключаем Leaflet CSS один раз */
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id   = 'leaflet-css';
      link.rel  = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }
  }, []);

  /* инициализируем карту */
  useEffect(() => {
    if (typeof window === 'undefined' || !containerRef.current) return;
    const gen = ++mapGenRef.current;
    let cancelled = false;

    import('leaflet').then(L => {
      if (cancelled || gen !== mapGenRef.current || !containerRef.current) return;
      if (mapRef.current || (containerRef.current as any)._leaflet_id) return;

      (L.Icon.Default.prototype as any)._getIconUrl = undefined;
      L.Icon.Default.mergeOptions({
        iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });

      const map = L.map(containerRef.current!, {
        center: [MAP_CENTER.lat, MAP_CENTER.lng],
        zoom: 15,
        zoomControl: false,
        attributionControl: false,
        zoomAnimation: false,
        fadeAnimation: false,
        markerZoomAnimation: false,
        inertia: false,
      });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
      mapRef.current = map;
      map.whenReady(() => {
        if (cancelled || gen !== mapGenRef.current) return;
        setReady(true);
      });
    });

    return () => {
      cancelled = true;
      mapGenRef.current += 1;
      if (fitTimerRef.current) { clearTimeout(fitTimerRef.current); fitTimerRef.current = null; }
      routesRef.current.forEach(r => { try { r.remove(); } catch {} });
      routesRef.current = [];
      markersRef.current.forEach(m => { try { m.remove(); } catch {} });
      markersRef.current = [];
      destroyMap(mapRef.current, containerRef.current);
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  /* обновляем маркеры при изменении данных */
  useEffect(() => {
    if (!ready || !isMapAlive(mapRef.current)) return;
    const gen = mapGenRef.current;

    import('leaflet').then(L => {
      if (gen !== mapGenRef.current || !isMapAlive(mapRef.current)) return;
      const map = mapRef.current;

      markersRef.current.forEach(m => { try { m.remove(); } catch {} });
      markersRef.current = [];

      const mkIcon = (html: string, w: number, h: number, ax: number, ay: number) =>
        L.divIcon({ html, className:'', iconSize:[w,h], iconAnchor:[ax,ay], popupAnchor:[0,-ay] });

      if (selected && selected.pickupIds && step) {
        selected.pickupIds.forEach((pid: string, i: number) => {
          const pk = PICKUPS[pid] || PICKUPS.store;
          const isCurrent = step === 'toPickup' && i === pickupIdx;
          const isDone    = step === 'toClient' || step === 'done' || (step === 'toPickup' && i < pickupIdx);
          const sz = isCurrent ? 40 : 30;
          const icon = mkIcon(
            `<div style="width:${sz}px;height:${sz}px;border-radius:10px;background:${isCurrent?pk.color+'33':isDone?'rgba(6,16,10,.7)':'rgba(6,16,10,.92)'};border:2px solid ${isCurrent?pk.color:isDone?pk.color+'55':'#2a4a2a'};display:flex;align-items:center;justify-content:center;font-size:${isCurrent?20:15}px;box-shadow:${isCurrent?`0 0 16px ${pk.color}99`:'none'};opacity:${isDone?0.5:1}">${isDone?'✓':pk.e}</div>`,
            sz, sz, sz/2, sz/2
          );
          const m = L.marker([pk.lat, pk.lng], { icon, zIndexOffset: isCurrent ? 600 : 200 }).addTo(map);
          m.bindTooltip(`${i+1}. ${pk.name}`, { direction:'top', offset:[0,-sz/2] });
          markersRef.current.push(m);
        });
      }

      const coords = spreadOrderCoords(orders)
      orders.forEach((o, i) => {
        const isSel = selected?.id === o.id;
        const pos = coords.get(o.id) || { lat: o.lat, lng: o.lng };
        const sz = isSel ? 44 : 36;
        const label = i + 1;
        const icon = mkIcon(
          `<div style="width:${sz}px;height:${sz}px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${isSel?'linear-gradient(135deg,#1E5BB5,#3B8EF0)':'linear-gradient(135deg,#7a2020,#FF4545)'};display:flex;align-items:center;justify-content:center;box-shadow:${isSel?'0 4px 16px rgba(59,142,240,.6)':'0 3px 12px rgba(255,69,69,.5)'};border:2px solid rgba(255,255,255,.25)"><span style="transform:rotate(45deg);font-size:${isSel?16:13}px;font-weight:900;color:#fff">${label}</span></div>`,
          sz, sz, sz/2, sz
        );
        const m = L.marker([pos.lat, pos.lng], { icon, zIndexOffset: isSel ? 800 : 100 }).addTo(map);
        m.on('click', () => onSelect(o));
        const km = getOrderKm(o, roadKmRef.current);
        const kmLabel = km != null ? formatKm(km) : '… км';
        const dlv = km != null ? calcDelivery(km, o.weight, TARIFF) : '…';
        m.bindTooltip(`${o.client} · ${kmLabel} · доставка ${dlv} ЅМ`, { direction:'top', offset:[0,-sz] });
        markersRef.current.push(m);
      });

      const pos = courierPosRef.current;
      if (pos) {
        const courierIcon = mkIcon(
          `<div style="width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,#0F8A3A,#1FD760);display:flex;align-items:center;justify-content:center;font-size:20px;box-shadow:0 4px 16px rgba(31,215,96,.7);border:2px solid rgba(255,255,255,.25)">🛵</div>`,
          38, 38, 19, 19
        );
        markersRef.current.push(
          L.marker([pos.lat, pos.lng], { icon: courierIcon, zIndexOffset: 1000 }).addTo(map)
        );
      }

      if (!step && orders.length) {
        const fitKey = orders.map(o => o.id).join(',') + (pos ? `:${pos.lat.toFixed(4)}` : '');
        if (lastFitKeyRef.current !== fitKey) {
          lastFitKeyRef.current = fitKey;
          const bounds: [number, number][] = orders.map(o => {
            const c = coords.get(o.id) || { lat: o.lat, lng: o.lng };
            return [c.lat, c.lng];
          });
          if (pos) bounds.push([pos.lat, pos.lng]);
          scheduleFit(L.latLngBounds(bounds), `orders:${fitKey}`);
        }
      }
    });
  }, [ready, orders, selected, pickupIdx, step, onSelect, TARIFF, courierPos]);

  /* маршрут доставки: магазин/ресторан → клиент (+ пунктир курьера при активной доставке) */
  useEffect(() => {
    if (!ready || !isMapAlive(mapRef.current) || !selected?.pickupIds || !step) return;
    const gen = mapGenRef.current;
    let cancelled = false;
    const selId = selected.id as string;
    const deliveryFitKey = `delivery:${selId}`;

    import('leaflet').then(async L => {
      routesRef.current.forEach(r => { try { r.remove(); } catch {} });
      routesRef.current = [];

      /* основная линия — только от точек забора до клиента */
      const delivery = await fetchOrderDeliveryRoute(selected, pickupLocRef.current);
      if (cancelled || gen !== mapGenRef.current || !isMapAlive(mapRef.current)) return;

      routesRef.current.push(
        L.polyline(delivery.geometry, { color: '#1FD760', weight: 5, opacity: 0.9 }).addTo(mapRef.current)
      );

      /* пунктир — где едет курьер (только если включён GPS) */
      const pos = courierPosRef.current;
      if (pos && (step === 'toPickup' || step === 'toClient')) {
        const pids: string[] = selected.pickupIds;
        const navPoints = step === 'toClient'
          ? [{ lat: pos.lat, lng: pos.lng }, { lat: selected.lat, lng: selected.lng }]
          : (() => {
              const curPk = PICKUPS[pids[pickupIdx]] || PICKUPS.store;
              return [{ lat: pos.lat, lng: pos.lng }, { lat: curPk.lat, lng: curPk.lng }];
            })();
        const nav = await fetchRoute(navPoints);
        if (!cancelled && gen === mapGenRef.current && isMapAlive(mapRef.current)) {
          routesRef.current.push(
            L.polyline(nav.geometry, {
              color: step === 'toClient' ? '#3B8EF0' : '#FFB800',
              weight: 3, opacity: 0.55, dashArray: '8 6',
            }).addTo(mapRef.current)
          );
        }
      }

      if (delivery.geometry.length >= 2) {
        scheduleFit(L.latLngBounds(delivery.geometry), deliveryFitKey);
      }
    });

    return () => {
      cancelled = true;
      routesRef.current.forEach(r => { try { r.remove(); } catch {} });
      routesRef.current = [];
    };
  }, [ready, selected, pickupIdx, step, sheetOpen, courierPos, pickupLocations]);

  useEffect(() => {
    if (!selected) routeFitKeyRef.current = '';
  }, [selected]);

  const displayKm = selected ? getOrderKm(selected, roadKm) : null;

  return (
    <div style={{ position:'relative', height }}>
      <div ref={containerRef} style={{ width:'100%', height:'100%' }}/>
      {!sheetOpen && (
        <div style={{ position:'absolute', top:12, left:12, padding:'7px 12px', borderRadius:12, background:'rgba(3,11,5,.88)', backdropFilter:'blur(10px)', border:'1px solid rgba(59,142,240,.3)', zIndex:999, pointerEvents:'none' }}>
          <div className="ub" style={{ fontSize:17, fontWeight:900, color:'#3B8EF0' }}>{orders.length}</div>
          <div style={{ fontSize:9, color:'#8FB897' }}>заказов рядом</div>
        </div>
      )}
      {!sheetOpen && displayKm != null && (
        <div style={{ position:'absolute', bottom:12, left:12, padding:'6px 12px', borderRadius:12, background:'rgba(3,11,5,.88)', backdropFilter:'blur(10px)', border:'1px solid rgba(31,215,96,.35)', zIndex:999, pointerEvents:'none', fontSize:11, fontWeight:700, color:'#1FD760' }}>
          🛣 {formatKm(displayKm)} · забор → клиент
        </div>
      )}
      {!sheetOpen && !courierPos && onEnableLocation && (
        <div style={{ position:'absolute', bottom:12, right:12, zIndex:999, display:'flex', flexDirection:'column', alignItems:'flex-end', gap:6, maxWidth:'calc(100% - 24px)' }}>
          {locationError && (
            <div style={{ padding:'6px 10px', borderRadius:10, background:'rgba(255,69,69,.12)', border:'1px solid rgba(255,69,69,.3)', fontSize:10, color:'#FF4545', textAlign:'right' }}>
              {locationError}
            </div>
          )}
          <button
            type="button"
            onClick={onEnableLocation}
            disabled={locationLoading}
            className="btn"
            style={{ padding:'10px 14px', borderRadius:12, background:'linear-gradient(135deg,#0F8A3A,#1FD760)', border:'none', color:'#030B05', fontWeight:800, fontSize:12, display:'flex', alignItems:'center', gap:6, boxShadow:'0 4px 16px rgba(31,215,96,.45)', opacity:locationLoading?0.7:1 }}
          >
            {locationLoading ? (
              <div style={{ width:14, height:14, borderRadius:'50%', border:'2px solid rgba(3,11,5,.3)', borderTopColor:'#030B05', animation:'spin 1s linear infinite' }}/>
            ) : '📍'}
            {locationLoading ? 'Ищем GPS…' : 'Моя локация'}
          </button>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────
   ГЛАВНОЕ ПРИЛОЖЕНИЕ
───────────────────────────────────────────────────── */
export default function CourierApp() {
  useApiSync('courier');
  const TARIFF = useTariff();
  const apiOrders = useOrders(s => s.orders);
  const updateStatus = useOrders(s => s.updateStatus);
  const ORDERS = useMemo(
    () => {
      if (!USE_API && !apiOrders.length) return DEMO_COURIER_ORDERS
      return mapOrdersForCourier(apiOrders.filter(isCourierReadyOrder))
    },
    [apiOrders]
  );
  const pickupsList = usePickups();
  const pickupLocations = usePickupLocations();
  const PICKUPS = buildPickupsMap(pickupsList);
  const [logged,    setLogged]    = useState(false);
  const { roadKm, loading: kmLoading } = useOrderRoadKm(ORDERS, logged);
  const { pos: courierPos, loading: locationLoading, error: locationError, enable: enableLocation, disable: disableLocation, enabled: locationEnabled } = useCourierLocation();
  const [tab,       setTab]       = useState('orders');
  const [status,    setStatus]    = useState('available');
  const [selected,  setSelected]  = useState<any>(null);
  const [active,     setActive]     = useState<any>(null);
  const [step,       setStep]       = useState<'toPickup'|'toClient'|'done'>('toPickup');
  const [pickupIdx,  setPickupIdx]  = useState(0);
  const [completed,  setCompleted]  = useState<string[]>([]);
  const [otp,       setOtp]       = useState(['','','','']);
  const [err,       setErr]       = useState('');
  const [load,      setLoad]      = useState(false);

  useEffect(() => { hydrateCourierStores(); }, []);

  const verify = () => {
    if (otp.join('').length < 4) return;
    setLoad(true);
    setTimeout(()=>{
      if (otp.join('') === '1234') setLogged(true);
      else { setErr('Неверный код · Демо: 1234'); setOtp(['','','','']); }
      setLoad(false);
    }, 700);
  };

  const accept = async (o: any) => {
    setActive(o);
    setStatus('busy');
    setStep('toPickup');
    setPickupIdx(0);
    setSelected(null);
    setTab('active');
    await updateStatus(o.id, 'courier_picked');
  };
  const finish = async () => {
    if (active) await updateStatus(active.id, 'delivered');
    if (active) setCompleted(c => [...c, active.id]);
    setActive(null);
    setStatus('available');
    setTab('orders');
  };
  const nextStop = () => {
    if (pickupIdx < active.pickupIds.length - 1) {
      setPickupIdx(i => i + 1);
    } else {
      setStep('toClient');
      if (active) updateStatus(active.id, 'delivering');
    }
  };

  const available = ORDERS.filter(o =>
    !completed.includes(o.id) &&
    o.id !== active?.id,
  );

  /* ── ЛОГИН ── */
  if (!logged) return (
    <>
      <style>{CSS}</style>
      <div style={{ minHeight:'100vh', background:'#030B05', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:24, maxWidth:480, margin:'0 auto' }}>
        <a href="/" style={{ position:'absolute', top:20, left:20, width:38, height:38, borderRadius:10, background:'#091508', border:'1px solid #162B1A', display:'flex', alignItems:'center', justifyContent:'center', textDecoration:'none', color:'#8FB897', fontSize:16 }}>←</a>
        <div style={{ textAlign:'center', marginBottom:28 }}>
          <div style={{ fontSize:60, marginBottom:14 }}>🛵</div>
          <div className="ub" style={{ fontSize:22, fontWeight:900, color:'#3B8EF0', marginBottom:4 }}>Курьер KAKAPO</div>
          <div style={{ fontSize:13, color:'#8FB897' }}>Введите OTP код из SMS</div>
        </div>
        <div style={{ width:'100%', maxWidth:340, background:'#091508', border:'1px solid #162B1A', borderRadius:22, padding:26 }}>
          {err && <div style={{ padding:'9px', borderRadius:10, background:'rgba(255,69,69,.1)', border:'1px solid rgba(255,69,69,.3)', fontSize:12, color:'#FF4545', marginBottom:14, textAlign:'center' }}>⚠️ {err}</div>}
          <div style={{ display:'flex', gap:10, justifyContent:'center', marginBottom:16 }}>
            {otp.map((v,i)=>(
              <input key={i} id={`o${i}`} value={v} type="tel" maxLength={1} inputMode="numeric"
                onChange={e=>{const d=[...otp];d[i]=e.target.value.replace(/\D/,'').slice(-1);setOtp(d);if(e.target.value&&i<3)(document.getElementById(`o${i+1}`) as HTMLInputElement)?.focus();}}
                onKeyDown={e=>{if(e.key==='Backspace'&&!v&&i>0)(document.getElementById(`o${i-1}`) as HTMLInputElement)?.focus();}}
                style={{ width:54, height:62, borderRadius:15, border:`2px solid ${v?'rgba(59,142,240,.5)':'#162B1A'}`, background:v?'rgba(59,142,240,.08)':'#0C1C0F', textAlign:'center', fontSize:26, fontWeight:900, color:'#EBF5ED', outline:'none' }}/>
            ))}
          </div>
          <div style={{ padding:'10px', borderRadius:10, background:'rgba(59,142,240,.06)', border:'1px solid rgba(59,142,240,.2)', fontSize:12, color:'#8FB897', marginBottom:14, textAlign:'center' }}>
            💡 Демо OTP: <span style={{ color:'#3B8EF0', fontWeight:800 }}>1 2 3 4</span>
          </div>
          <button onClick={verify} className="btn" style={{ width:'100%', padding:15, borderRadius:15, background:'linear-gradient(135deg,#1E5BB5,#3B8EF0)', border:'none', color:'white', fontWeight:800, fontSize:15, display:'flex', alignItems:'center', justifyContent:'center', gap:8, opacity:otp.join('').length<4?.5:1 }}>
            {load ? <div style={{ width:18, height:18, borderRadius:'50%', border:'2.5px solid rgba(255,255,255,.3)', borderTopColor:'white', animation:'spin 1s linear infinite' }}/> : '🛵 Войти'}
          </button>
        </div>
      </div>
    </>
  );

  return (
    <>
      <style>{CSS}</style>
      <div style={{ minHeight:'100vh', background:'#030B05', maxWidth:480, margin:'0 auto', paddingBottom:78 }}>

        {/* HEADER */}
        <header style={{ position:'sticky', top:0, zIndex:100, background:'rgba(3,11,5,.97)', backdropFilter:'blur(24px)', borderBottom:'1px solid #162B1A', padding:'12px 18px', display:'flex', alignItems:'center', gap:10 }}>
          <a href="/" style={{ width:36, height:36, borderRadius:10, background:'#0C1C0F', border:'1px solid #162B1A', display:'flex', alignItems:'center', justifyContent:'center', textDecoration:'none', color:'#8FB897', fontSize:15, flexShrink:0 }}>←</a>
          <div style={{ width:40, height:40, borderRadius:13, background:'linear-gradient(135deg,#1E5BB5,#3B8EF0)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:20, flexShrink:0 }}>🛵</div>
          <div style={{ flex:1 }}>
            <div className="ub" style={{ fontSize:14, fontWeight:900 }}>{COURIER.name}</div>
            <div style={{ display:'flex', alignItems:'center', gap:5, marginTop:1 }}>
              <div style={{ width:6, height:6, borderRadius:'50%', background:status==='available'?'#1FD760':status==='busy'?'#FFB800':'#3D6645', animation:'pulse 2s infinite' }}/>
              <span style={{ fontSize:10, color:'#8FB897' }}>{status==='available'?'Свободен':status==='busy'?'В заказе':'Офлайн'} · {COURIER.vehicle}</span>
            </div>
          </div>
          <div style={{ textAlign:'right' }}>
            <div style={{ fontSize:9, color:'#3D6645' }}>Сегодня</div>
            <div className="ub" style={{ fontSize:15, fontWeight:900, color:'#1FD760' }}>42 ЅМ</div>
          </div>
          <button
            type="button"
            onClick={locationEnabled ? disableLocation : enableLocation}
            disabled={locationLoading}
            className="btn"
            title={locationEnabled ? 'GPS включён · нажмите чтобы выключить' : 'Включить GPS'}
            style={{ width:36, height:36, borderRadius:10, flexShrink:0, border:`1.5px solid ${locationEnabled?'rgba(31,215,96,.5)':'#162B1A'}`, background:locationEnabled?'rgba(31,215,96,.15)':'#0C1C0F', color:locationEnabled?'#1FD760':'#5a7a62', fontSize:16, display:'flex', alignItems:'center', justifyContent:'center', opacity:locationLoading?0.6:1, filter:locationEnabled?'none':'grayscale(1)' }}
          >
            {locationLoading ? '…' : '📍'}
          </button>
        </header>

        {/* ═══ ВКЛАДКА ЗАКАЗЫ ═══ */}
        {tab==='orders' && (
          <div>
            <div style={{ display:'flex', gap:8, padding:'12px 18px 0' }}>
              {([['available','Свободен','#1FD760'],['busy','В заказе','#FFB800'],['offline','Офлайн','#3D6645']] as const).map(([s,l,c])=>(
                <button key={s} onClick={()=>setStatus(s)} className="btn" style={{ flex:1, padding:'9px 6px', borderRadius:11, fontSize:11, fontWeight:700, border:`1.5px solid ${status===s?c:'#162B1A'}`, background:status===s?c+'18':'#091508', color:status===s?c:'#8FB897' }}>{l}</button>
              ))}
            </div>

            {status==='offline' ? (
              <div style={{ textAlign:'center', padding:'70px 20px', color:'#8FB897' }}>
                <div style={{ fontSize:52, marginBottom:14 }}>😴</div>
                <div className="ub" style={{ fontSize:16, fontWeight:800, marginBottom:6 }}>Вы офлайн</div>
                <div style={{ fontSize:12, color:'#3D6645' }}>Включите «Свободен» чтобы видеть заказы</div>
              </div>
            ) : (
              <>
                <div style={{ margin:'12px 0 0' }}>
                  <LeafletMap key="orders-map" orders={available} selected={selected} onSelect={setSelected} TARIFF={TARIFF} roadKm={roadKm} sheetOpen={!!selected} courierPos={courierPos} onEnableLocation={enableLocation} locationLoading={locationLoading} locationError={locationError} PICKUPS={PICKUPS} pickupLocations={pickupLocations} />
                </div>

                {/* BOTTOM SHEET — детали заказа, фиксированный оверлей */}
                {selected && (
                  <div style={{ position:'fixed', inset:0, zIndex:500, display:'flex', flexDirection:'column', justifyContent:'flex-end', alignItems:'center' }}>
                    {/* затемнение */}
                    <div onClick={()=>setSelected(null)} style={{ position:'absolute', inset:0, background:'rgba(0,0,0,.7)', backdropFilter:'blur(4px)' }}/>
                    {/* карточка */}
                    <div style={{ position:'relative', width:'100%', maxWidth:480, background:'#0C1C0F', borderRadius:'22px 22px 0 0', padding:'20px 18px calc(32px + env(safe-area-inset-bottom, 0px))', maxHeight:'85vh', overflowY:'auto', boxShadow:'0 -12px 40px rgba(0,0,0,.8)' }}>
                      {/* ручка */}
                      <div style={{ width:36, height:4, borderRadius:2, background:'#2A4A2A', margin:'0 auto 14px' }}/>

                      {/* ID + сумма доставки */}
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
                        <div className="ub" style={{ fontSize:14, fontWeight:900, color:'#3B8EF0' }}>{selected.id}</div>
                        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                          <span style={{ padding:'4px 10px', borderRadius:10, fontSize:10, fontWeight:700, background:'rgba(59,142,240,.1)', color:'#3B8EF0', border:'1px solid rgba(59,142,240,.25)' }}>
                            🛣 {getOrderKm(selected, roadKm) != null ? formatKm(getOrderKm(selected, roadKm)!) : '…'}
                          </span>
                          <div style={{ display:'flex', alignItems:'center', gap:6, padding:'4px 10px', borderRadius:10, background:'rgba(31,215,96,.12)', border:'1px solid rgba(31,215,96,.3)' }}>
                            <span style={{ fontSize:10, color:'#1FD760' }}>доставка</span>
                            <span className="ub" style={{ fontSize:15, fontWeight:900, color:'#1FD760' }}>{orderDelivery(selected, roadKm, TARIFF) ?? '…'} ЅМ</span>
                          </div>
                        </div>
                      </div>

                      {/* маршрут: точки забора → клиент */}
                      <div style={{ background:'#091508', border:'1px solid #162B1A', borderRadius:14, padding:'12px 14px', marginBottom:12 }}>
                        {selected.pickupIds.map((pid:string, pi:number) => {
                          const pk = PICKUPS[pid]||PICKUPS.store;
                          return (
                            <div key={pi} style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8 }}>
                              <div style={{ width:32, height:32, borderRadius:9, background:pk.color+'22', border:`1.5px solid ${pk.color}55`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, flexShrink:0 }}>{pk.e}</div>
                              <div style={{ flex:1 }}>
                                <div style={{ fontSize:10, color:'#3D6645', fontWeight:700 }}>{pk.id==='store'?'ЗАБРАТЬ ИЗ МАГАЗИНА':'ЗАБРАТЬ ИЗ РЕСТОРАНА'}</div>
                                <div style={{ fontSize:13, fontWeight:700, color:pk.color }}>{pk.name}</div>
                                <div style={{ fontSize:10, color:'#3D6645' }}>{pk.addr}</div>
                              </div>
                            </div>
                          );
                        })}
                        <div style={{ display:'flex', alignItems:'center', gap:10, paddingTop:8, borderTop:'1px dashed #1D3822' }}>
                          <div style={{ width:32, height:32, borderRadius:9, background:'rgba(59,142,240,.12)', border:'1.5px solid rgba(59,142,240,.3)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, flexShrink:0 }}>📍</div>
                          <div style={{ flex:1 }}>
                            <div style={{ fontSize:10, color:'#3D6645', fontWeight:700 }}>ДОСТАВИТЬ КЛИЕНТУ</div>
                            <div style={{ fontSize:13, fontWeight:700, color:'#EBF5ED' }}>{selected.client}</div>
                            <div style={{ fontSize:10, color:'#8FB897' }}>{selected.addr}</div>
                          </div>
                        </div>
                      </div>

                      {/* теги */}
                      <div style={{ display:'flex', gap:7, flexWrap:'wrap', marginBottom:12 }}>
                        <span style={{ padding:'4px 9px', borderRadius:8, fontSize:11, fontWeight:700, background:'rgba(59,142,240,.1)', color:'#3B8EF0', border:'1px solid rgba(59,142,240,.25)' }}>🛣 {getOrderKm(selected, roadKm) != null ? `${formatKm(getOrderKm(selected, roadKm)!)} · забор → клиент` : '… · забор → клиент'}</span>
                        <span style={{ padding:'4px 9px', borderRadius:8, fontSize:11, fontWeight:700, background:'rgba(255,184,0,.1)', color:'#FFB800', border:'1px solid rgba(255,184,0,.25)' }}>⚖️ {selected.weight} кг</span>
                      </div>
                      {/* состав */}
                      <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:14 }}>
                        {selected.items.map((it: any,i: number)=><span key={i} style={{ padding:'4px 9px', borderRadius:8, fontSize:11, background:'#091508', border:'1px solid #162B1A', color:'#8FB897' }}>{it.e} {it.n} ×{it.q}</span>)}
                      </div>
                      {/* оплата: товары + доставка = наличными у клиента */}
                      <div style={{ background:'rgba(31,215,96,.07)', border:'1.5px solid rgba(31,215,96,.35)', borderRadius:14, padding:'13px 15px', marginBottom:16 }}>
                        {(() => {
                          const km = getOrderKm(selected, roadKm);
                          const dlv = orderDelivery(selected, roadKm, TARIFF);
                          const isHeavy = selected.weight > TARIFF.heavyKg;
                          const extraKm = km != null && km > TARIFF.baseDist ? km - TARIFF.baseDist : 0;
                          const total = dlv != null ? selected.sum + dlv : null;
                          return (
                            <>
                              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:10 }}>
                                <span style={{ fontSize:12, color:'#8FB897' }}>Продукт</span>
                                <span style={{ fontSize:12, fontWeight:700 }}>{selected.sum.toFixed(2)} ЅМ</span>
                              </div>
                              <div style={{ fontSize:10, color:'#3D6645', fontWeight:700, marginBottom:8, letterSpacing:1 }}>ДОСТАВКА</div>
                              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
                                <span style={{ fontSize:12, color:'#8FB897' }}>Забор → клиент (по дорогам)</span>
                                <span style={{ fontSize:12, fontWeight:700 }}>{km != null ? formatKm(km) : '…'}</span>
                              </div>
                              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
                                <span style={{ fontSize:12, color:'#8FB897' }}>База (до {TARIFF.baseDist} км)</span>
                                <span style={{ fontSize:12, fontWeight:700 }}>{TARIFF.base} ЅМ</span>
                              </div>
                              {extraKm > 0 && dlv != null && (
                                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
                                  <span style={{ fontSize:11, color:'#3D6645' }}>+ {formatKm(extraKm)} × {TARIFF.perKm} ЅМ</span>
                                  <span style={{ fontSize:11, color:'#3D6645' }}>+{Math.ceil(extraKm * TARIFF.perKm)} ЅМ</span>
                                </div>
                              )}
                              {isHeavy && (
                                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
                                  <span style={{ fontSize:11, color:'#FFB800' }}>⚖️ Тяжёлый груз ({selected.weight} кг)</span>
                                  <span style={{ fontSize:11, color:'#FFB800' }}>+{TARIFF.heavyExtra} ЅМ</span>
                                </div>
                              )}
                              <div style={{ display:'flex', justifyContent:'space-between', marginTop:6, marginBottom:8 }}>
                                <span style={{ fontSize:12, fontWeight:700, color:'#EBF5ED' }}>Доставка итого</span>
                                <span style={{ fontSize:12, fontWeight:700, color:'#EBF5ED' }}>{dlv ?? '…'} ЅМ</span>
                              </div>
                              <div style={{ borderTop:'1px dashed rgba(31,215,96,.3)', paddingTop:10, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                                <div>
                                  <div style={{ fontSize:13, fontWeight:800, color:'#1FD760' }}>💵 НАЛИЧНЫМИ</div>
                                  <div style={{ fontSize:10, color:'#3D6645', marginTop:2 }}>взять с клиента</div>
                                </div>
                                <span className="ub" style={{ fontSize:26, fontWeight:900, color:'#1FD760' }}>{total != null ? `${total.toFixed(2)} ЅМ` : '…'}</span>
                              </div>
                            </>
                          );
                        })()}
                      </div>
                      {/* кнопки */}
                      <div style={{ display:'flex', gap:8 }}>
                        <button onClick={()=>setSelected(null)} className="btn" style={{ padding:'14px 18px', borderRadius:14, background:'#162B1A', border:'none', color:'#8FB897', fontWeight:700, fontSize:14 }}>✕</button>
                        <button onClick={()=>accept(selected)} className="btn" style={{ flex:1, padding:14, borderRadius:14, background:'linear-gradient(135deg,#17B34E,#1FD760)', border:'none', color:'#030B05', fontWeight:800, fontSize:13, display:'flex', flexDirection:'column', alignItems:'center', gap:2 }}>
                          <span>✓ Принять заказ</span>
                          <span style={{ fontSize:11, fontWeight:700, opacity:.85 }}>наличными {(() => { const d = orderDelivery(selected, roadKm, TARIFF); return d != null ? `${(selected.sum + d).toFixed(2)} ЅМ` : '…'; })()}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                <div style={{ padding:'18px 18px 0' }}>
                  <div className="ub" style={{ fontSize:14, fontWeight:800, marginBottom:12, display:'flex', alignItems:'center', gap:8 }}>
                    Доступные заказы
                    <span style={{ padding:'2px 8px', borderRadius:8, fontSize:11, fontWeight:800, background:'rgba(255,69,69,.12)', color:'#FF4545', border:'1px solid rgba(255,69,69,.28)' }}>{available.length}</span>
                    {kmLoading && <span style={{ fontSize:10, color:'#3D6645', fontWeight:600 }}>· считаем км…</span>}
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                    {available.length === 0 && (
                      <div style={{ textAlign:'center', padding:'28px 16px', color:'#8FB897', background:'#091508', border:'1px solid #162B1A', borderRadius:16 }}>
                        <div style={{ fontSize:32, marginBottom:8 }}>📭</div>
                        <div style={{ fontSize:13, fontWeight:700, marginBottom:4 }}>Нет доступных заказов</div>
                        <div style={{ fontSize:11, color:'#3D6645' }}>{active ? 'Активная доставка на вкладке «Доставка»' : 'Новые появятся после оформления в магазине'}</div>
                      </div>
                    )}
                    {available.map((o,idx)=>{
                      const isSel = selected?.id === o.id;
                      const km = getOrderKm(o, roadKm);
                      const dlv = orderDelivery(o, roadKm, TARIFF);
                      return (
                        <div key={o.id} onClick={()=>setSelected(o)} className="btn"
                          style={{ background:isSel?'rgba(59,142,240,.08)':'#091508', border:`1.5px solid ${isSel?'rgba(59,142,240,.4)':'#162B1A'}`, borderRadius:16, padding:'14px 15px', textAlign:'left' }}>
                          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
                            <div style={{ display:'flex', alignItems:'center', gap:9 }}>
                              <div style={{ width:34, height:34, borderRadius:10, background:isSel?'linear-gradient(135deg,#1E5BB5,#3B8EF0)':'#0C1C0F', border:`1px solid ${isSel?'transparent':'#162B1A'}`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, fontWeight:900, color:isSel?'white':'#3B8EF0' }}>{idx+1}</div>
                              <div>
                                <div className="ub" style={{ fontSize:13, fontWeight:800, color:'#3B8EF0' }}>{o.id}</div>
                                <div style={{ fontSize:11, color:'#8FB897' }}>{o.client.split(' ')[0]} · {o.time}</div>
                              </div>
                            </div>
                            <div style={{ textAlign:'right' }}>
                              <div className="ub" style={{ fontSize:17, fontWeight:900, color:'#1FD760' }}>{dlv ?? '…'} ЅМ</div>
                              <div style={{ fontSize:9, color:'#3D6645' }}>доставка · {km != null ? `${formatKm(km)} забор→клиент` : '…'}</div>
                            </div>
                          </div>
                          <div style={{ fontSize:11, color:'#8FB897', marginBottom:6, display:'flex', alignItems:'center', gap:4, flexWrap:'wrap' }}>
                            {o.pickupIds.map((pid:string,pi:number) => {
                              const pk = PICKUPS[pid]||PICKUPS.store;
                              return <span key={pi} style={{ color:pk.color, fontWeight:700 }}>{pi>0?'→ ':''}{pk.e} {pk.name.split(' ')[0]}</span>;
                            })} <span style={{ color:'#8FB897' }}>→ 📍 {o.addr}</span>
                          </div>
                          <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                            <span style={{ padding:'3px 8px', borderRadius:7, fontSize:10, fontWeight:700, background:'rgba(59,142,240,.1)', color:'#3B8EF0' }}>🛣 {km != null ? formatKm(km) : '…'}</span>
                            <span style={{ padding:'3px 8px', borderRadius:7, fontSize:10, fontWeight:700, background:'rgba(255,184,0,.1)', color:'#FFB800' }}>{o.weight} кг</span>
                            <span style={{ padding:'3px 8px', borderRadius:7, fontSize:10, fontWeight:700, background:'#0C1C0F', color:'#8FB897' }}>{o.items.length} пр.</span>
                            {isSel && <span style={{ marginLeft:'auto', fontSize:11, color:'#3B8EF0', fontWeight:700 }}>выбран ↑</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ═══ ВКЛАДКА АКТИВНАЯ ДОСТАВКА ═══ */}
        {tab==='active' && (
          active ? (
            <div>
              <LeafletMap key="active-map" orders={[active]} selected={active} onSelect={()=>{}} height={250} pickupIdx={pickupIdx} step={step} TARIFF={TARIFF} roadKm={roadKm} courierPos={courierPos} onEnableLocation={enableLocation} locationLoading={locationLoading} locationError={locationError} PICKUPS={PICKUPS} pickupLocations={pickupLocations}/>
              <div style={{ padding:'16px 18px' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
                  <div>
                    <span className="ub" style={{ fontSize:16, fontWeight:900, color:'#3B8EF0' }}>{active.id}</span>
                    <div style={{ fontSize:12, color:'#8FB897', marginTop:2 }}>{active.client}</div>
                  </div>
                  <div style={{ textAlign:'right' }}>
                    <div className="ub" style={{ fontSize:20, fontWeight:900, color:'#1FD760' }}>{orderDelivery(active, roadKm, TARIFF) ?? '…'} ЅМ</div>
                    <div style={{ fontSize:9, color:'#3D6645' }}>доставка · {getOrderKm(active, roadKm) != null ? `${formatKm(getOrderKm(active, roadKm)!)} забор→клиент` : '…'}</div>
                  </div>
                </div>

                {/* ── ДИНАМИЧЕСКИЕ ШАГИ ── */}
                <div style={{ display:'flex', marginBottom:18, overflowX:'auto' }}>
                  {active.pickupIds.map((pid: string, i: number) => {
                    const pk = PICKUPS[pid] || PICKUPS.store;
                    const isAct = step === 'toPickup' && pickupIdx === i;
                    const isDone = step === 'toClient' || step === 'done' || (step === 'toPickup' && i < pickupIdx);
                    return (
                      <div key={i} style={{ flex:1, textAlign:'center', position:'relative', minWidth:60 }}>
                        <div style={{ position:'absolute', top:18, left:'50%', width:'100%', height:2, background:isDone?pk.color:'#162B1A' }}/>
                        <div style={{ width:38, height:38, borderRadius:'50%', background:isAct?pk.color:isDone?pk.color+'33':'#0C1C0F', border:`2px solid ${isAct?pk.color:isDone?pk.color:'#162B1A'}`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, margin:'0 auto 6px', position:'relative', zIndex:1, animation:isAct?'glow 1.8s infinite':'none' }}>
                          {isDone ? '✓' : pk.e}
                        </div>
                        <div style={{ fontSize:9, fontWeight:isAct?700:400, color:isAct?pk.color:isDone?pk.color:'#3D6645', whiteSpace:'nowrap' }}>{pk.name.split(' ')[0]}</div>
                      </div>
                    );
                  })}
                  {/* шаг «К клиенту» */}
                  {(() => {
                    const isAct = step === 'toClient';
                    const isDone = step === 'done';
                    return (
                      <div style={{ flex:1, textAlign:'center', position:'relative', minWidth:60 }}>
                        <div style={{ position:'absolute', top:18, left:'50%', width:'100%', height:2, background:isDone?'#1FD760':'#162B1A' }}/>
                        <div style={{ width:38, height:38, borderRadius:'50%', background:isAct?'#3B8EF0':isDone?'#1FD760':'#0C1C0F', border:`2px solid ${isAct?'#3B8EF0':isDone?'#1FD760':'#162B1A'}`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, margin:'0 auto 6px', position:'relative', zIndex:1, animation:isAct?'glow 1.8s infinite':'none' }}>
                          {isDone ? '✓' : '🛵'}
                        </div>
                        <div style={{ fontSize:9, fontWeight:isAct?700:400, color:isAct?'#3B8EF0':isDone?'#1FD760':'#3D6645' }}>К клиенту</div>
                      </div>
                    );
                  })()}
                  {/* шаг «Готово» */}
                  {(() => {
                    const isDone = step === 'done';
                    return (
                      <div style={{ flex:1, textAlign:'center', position:'relative', minWidth:60 }}>
                        <div style={{ width:38, height:38, borderRadius:'50%', background:isDone?'#1FD760':'#0C1C0F', border:`2px solid ${isDone?'#1FD760':'#162B1A'}`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, margin:'0 auto 6px', position:'relative', zIndex:1 }}>✓</div>
                        <div style={{ fontSize:9, color:isDone?'#1FD760':'#3D6645' }}>Готово</div>
                      </div>
                    );
                  })()}
                </div>

                {/* ── КАРТОЧКА МАРШРУТА ── */}
                <div style={{ background:'#091508', border:'1px solid #162B1A', borderRadius:16, padding:'14px 16px', marginBottom:14 }}>
                  {step === 'toPickup' && (() => {
                    const pk = PICKUPS[active.pickupIds[pickupIdx]] || PICKUPS.store;
                    return (
                      <div style={{ display:'flex', gap:10, marginBottom:active.pickupIds.length > 1 ? 12 : 0, paddingBottom:active.pickupIds.length > 1 ? 12 : 0, borderBottom:active.pickupIds.length > 1 ? '1px solid #162B1A' : 'none' }}>
                        <div style={{ width:10, height:10, borderRadius:'50%', background:pk.color, marginTop:4, flexShrink:0 }}/>
                        <div style={{ flex:1 }}>
                          <div style={{ fontSize:10, color:'#3D6645' }}>
                            ТОЧКА {pickupIdx+1} из {active.pickupIds.length} — {pk.id==='store'?'МАГАЗИН':'РЕСТОРАН'}
                          </div>
                          <div style={{ fontSize:13, fontWeight:700, color:'#EBF5ED' }}>{pk.e} {pk.name}</div>
                          <div style={{ fontSize:11, color:'#3D6645', marginTop:1 }}>{pk.addr}</div>
                        </div>
                        <a href={`tel:${pk.phone}`} style={{ padding:'7px 11px', borderRadius:9, background:`${pk.color}18`, border:`1px solid ${pk.color}44`, color:pk.color, fontSize:13, textDecoration:'none', alignSelf:'center' }}>📞</a>
                      </div>
                    );
                  })()}
                  {step === 'toPickup' && active.pickupIds.length > 1 && pickupIdx < active.pickupIds.length - 1 && (
                    <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:8 }}>
                      {active.pickupIds.slice(pickupIdx+1).map((pid:string, i:number) => {
                        const pk = PICKUPS[pid]||PICKUPS.store;
                        return <span key={i} style={{ padding:'3px 8px', borderRadius:7, fontSize:10, background:`${pk.color}11`, border:`1px solid ${pk.color}33`, color:pk.color }}>{pk.e} {pk.name.split(' ')[0]}</span>;
                      })}
                      <span style={{ padding:'3px 8px', borderRadius:7, fontSize:10, color:'#3D6645' }}>→ следующие точки</span>
                    </div>
                  )}
                  <div style={{ display:'flex', gap:10, marginTop: step === 'toPickup' ? 12 : 0 }}>
                    <div style={{ width:10, height:10, borderRadius:2, background:'#3B8EF0', marginTop:4, flexShrink:0 }}/>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:10, color:'#3D6645', opacity: step === 'toPickup' ? 0.6 : 1 }}>ДОСТАВИТЬ КЛИЕНТУ</div>
                      <div style={{ fontSize:13, fontWeight:700, color: step === 'toPickup' ? '#3D6645' : '#EBF5ED' }}>{active.addr}</div>
                      <div style={{ fontSize:11, color:'#8FB897', marginTop:1 }}>{active.client}</div>
                    </div>
                    <a href={`tel:${active.phone}`} style={{ padding:'7px 11px', borderRadius:9, background:'rgba(59,142,240,.1)', border:'1px solid rgba(59,142,240,.3)', color:'#3B8EF0', fontSize:13, textDecoration:'none', alignSelf:'center' }}>📞</a>
                  </div>
                </div>

                <div style={{ background:'#091508', border:'1px solid #162B1A', borderRadius:16, padding:'12px 16px', marginBottom:14 }}>
                  <div style={{ fontSize:11, color:'#3D6645', marginBottom:8, fontWeight:700 }}>СОСТАВ ЗАКАЗА</div>
                  <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                    {active.items.map((it: any,i: number)=>(
                      <div key={i} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:13 }}>
                        <span style={{ color:'#EBF5ED' }}>{it.e} {it.n} <span style={{ color:'#3D6645' }}>×{it.q}</span></span>
                        <span style={{ fontWeight:700, color:'#8FB897' }}>{(it.p*it.q).toFixed(2)} ЅМ</span>
                      </div>
                    ))}
                  </div>
                </div>

                {(() => {
                  const km = getOrderKm(active, roadKm);
                  const dlv = orderDelivery(active, roadKm, TARIFF);
                  const extraKm = km != null && km > TARIFF.baseDist ? km - TARIFF.baseDist : 0;
                  const isHeavy = active.weight > TARIFF.heavyKg;
                  return (
                    <div style={{ background:'rgba(31,215,96,.08)', border:'2px solid rgba(31,215,96,.4)', borderRadius:16, padding:'16px', marginBottom:18 }}>
                      <div style={{ fontSize:10, color:'#3D6645', fontWeight:700, marginBottom:10, letterSpacing:1 }}>ИТОГО К ПОЛУЧЕНИЮ</div>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
                        <span style={{ fontSize:12, color:'#8FB897' }}>Продукт</span>
                        <span style={{ fontSize:13, fontWeight:700 }}>{active.sum.toFixed(2)} ЅМ</span>
                      </div>
                      <div style={{ fontSize:10, color:'#3D6645', fontWeight:700, marginBottom:8, letterSpacing:1 }}>ДОСТАВКА</div>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:3 }}>
                        <span style={{ fontSize:12, color:'#8FB897' }}>Забор → клиент (по дорогам)</span>
                        <span style={{ fontSize:12, fontWeight:700 }}>{km != null ? formatKm(km) : '…'}</span>
                      </div>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:3 }}>
                        <span style={{ fontSize:12, color:'#8FB897' }}>База (до {TARIFF.baseDist} км)</span>
                        <span style={{ fontSize:12, fontWeight:700 }}>{TARIFF.base} ЅМ</span>
                      </div>
                      {extraKm > 0 && dlv != null && (
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:3 }}>
                          <span style={{ fontSize:11, color:'#3D6645' }}>+ {formatKm(extraKm)} × {TARIFF.perKm} ЅМ</span>
                          <span style={{ fontSize:11, color:'#3D6645' }}>+{Math.ceil(extraKm * TARIFF.perKm)} ЅМ</span>
                        </div>
                      )}
                      {isHeavy && (
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:3 }}>
                          <span style={{ fontSize:11, color:'#FFB800' }}>⚖️ Тяжёлый груз ({active.weight} кг)</span>
                          <span style={{ fontSize:11, color:'#FFB800' }}>+{TARIFF.heavyExtra} ЅМ</span>
                        </div>
                      )}
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:6, marginBottom:8 }}>
                        <span style={{ fontSize:12, fontWeight:700, color:'#EBF5ED' }}>Доставка итого</span>
                        <span style={{ fontSize:12, fontWeight:700, color:'#EBF5ED' }}>{dlv ?? '…'} ЅМ</span>
                      </div>
                      <div style={{ borderTop:'1px dashed rgba(31,215,96,.3)', paddingTop:12, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                        <div>
                          <div style={{ fontSize:13, fontWeight:800, color:'#1FD760' }}>💵 НАЛИЧНЫМИ</div>
                          <div style={{ fontSize:10, color:'#3D6645', marginTop:2 }}>взять с клиента</div>
                        </div>
                        <div className="ub" style={{ fontSize:30, fontWeight:900, color:'#1FD760' }}>{dlv != null ? `${(active.sum + dlv).toFixed(2)} ` : '… '}<span style={{ fontSize:16 }}>ЅМ</span></div>
                      </div>
                    </div>
                  );
                })()}

                {step==='toPickup' && (() => {
                  const pk = PICKUPS[active.pickupIds[pickupIdx]] || PICKUPS.store;
                  const hasMore = pickupIdx < active.pickupIds.length - 1;
                  return (
                    <button onClick={nextStop} className="btn" style={{ width:'100%', padding:15, borderRadius:15, background:`linear-gradient(135deg,${pk.color}BB,${pk.color})`, border:'none', color:'#030B05', fontWeight:800, fontSize:14 }}>
                      📦 Забрал у «{pk.name.split(' ')[0]}» — {hasMore ? `еду к следующей точке →` : 'еду к клиенту 🛵'}
                    </button>
                  );
                })()}
                {step==='toClient' && <button onClick={()=>setStep('done')} className="btn" style={{ width:'100%', padding:15, borderRadius:15, background:'linear-gradient(135deg,#1E5BB5,#3B8EF0)', border:'none', color:'white', fontWeight:800, fontSize:15 }}>🏁 Я на месте у клиента</button>}
                {step==='done'     && <button onClick={finish} className="btn" style={{ width:'100%', padding:15, borderRadius:15, background:'linear-gradient(135deg,#17B34E,#1FD760)', border:'none', color:'#030B05', fontWeight:800, fontSize:15, boxShadow:'0 8px 24px rgba(31,215,96,.4)' }}>✓ Доставлено — получить {(() => { const d = orderDelivery(active, roadKm, TARIFF); return d != null ? `${(active.sum + d).toFixed(2)} ЅМ` : '…'; })()}</button>}
              </div>
            </div>
          ) : (
            <div style={{ textAlign:'center', padding:'80px 20px', color:'#8FB897' }}>
              <div style={{ fontSize:54, marginBottom:14 }}>🛵</div>
              <div className="ub" style={{ fontSize:16, fontWeight:800, marginBottom:6 }}>Нет активной доставки</div>
              <div style={{ fontSize:12, color:'#3D6645', marginBottom:20 }}>Примите заказ во вкладке «Заказы»</div>
              <button onClick={()=>setTab('orders')} className="btn" style={{ padding:'11px 22px', borderRadius:12, background:'rgba(59,142,240,.12)', border:'1.5px solid rgba(59,142,240,.3)', color:'#3B8EF0', fontWeight:700, fontSize:13 }}>← К заказам</button>
            </div>
          )
        )}

        {/* ═══ ВКЛАДКА ЗАРАБОТОК ═══ */}
        {tab==='earnings' && (
          <div style={{ padding:'14px 18px' }}>
            <div style={{ background:'linear-gradient(135deg,#0A1828,#163050)', border:'1px solid rgba(59,142,240,.3)', borderRadius:20, padding:'22px', marginBottom:16, textAlign:'center' }}>
              <div style={{ fontSize:11, color:'#8FB897', marginBottom:6 }}>Доставки сегодня</div>
              <div className="ub" style={{ fontSize:40, fontWeight:900, color:'#1FD760', marginBottom:4 }}>210 ЅМ</div>
              <div style={{ fontSize:12, color:'#3B8EF0' }}>14 доставок · 4.9 ★</div>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:18 }}>
              {([['За неделю','1 240 ЅМ','#1FD760'],['Всего доставок','342','#3B8EF0'],['Ср. за день','177 ЅМ','#FFB800'],['Рейтинг','4.9 ★','#FFB800']] as const).map(([l,v,c],i)=>(
                <div key={i} style={{ background:'#091508', border:'1px solid #162B1A', borderRadius:14, padding:'15px', textAlign:'center' }}>
                  <div className="ub" style={{ fontSize:18, fontWeight:900, color:c, marginBottom:3 }}>{v}</div>
                  <div style={{ fontSize:10, color:'#3D6645' }}>{l}</div>
                </div>
              ))}
            </div>
            <div className="ub" style={{ fontSize:14, fontWeight:800, marginBottom:12 }}>История доставок</div>
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {HISTORY.map((h,i)=>(
                <div key={i} style={{ background:'#091508', border:'1px solid #162B1A', borderRadius:13, padding:'12px 14px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                    <div style={{ width:34, height:34, borderRadius:9, background:'rgba(31,215,96,.12)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:14 }}>✓</div>
                    <div>
                      <div style={{ fontSize:13, fontWeight:700 }}>{h.id} · {h.client}</div>
                      <div style={{ fontSize:11, color:'#3D6645' }}>{h.addr} · {'★'.repeat(h.rating)}</div>
                    </div>
                  </div>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontSize:10, color:'#3D6645' }}>{h.time}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* NAV */}
        <nav style={{ position:'fixed', bottom:0, left:'50%', transform:'translateX(-50%)', width:'100%', maxWidth:480, background:'rgba(3,11,5,.97)', backdropFilter:'blur(26px)', borderTop:'1px solid #162B1A', padding:'8px 18px 18px', display:'flex', justifyContent:'space-around', zIndex:90 }}>
          {([['orders','📋','Заказы'],['active','🛵','Доставка'],['earnings','💰','Заработок']] as const).map(([id,icon,label])=>(
            <button key={id} onClick={()=>setTab(id)} className="btn" style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:3, padding:'5px 18px', borderRadius:11, background:tab===id?'rgba(59,142,240,.12)':'transparent', border:`1.5px solid ${tab===id?'rgba(59,142,240,.3)':'transparent'}`, position:'relative' }}>
              <span style={{ fontSize:20 }}>{icon}</span>
              <span style={{ fontSize:10, fontWeight:tab===id?800:600, color:tab===id?'#3B8EF0':'#3D6645' }}>{label}</span>
              {id==='active' && active && <div style={{ position:'absolute', top:2, right:12, width:8, height:8, borderRadius:'50%', background:'#FFB800', animation:'pulse 1.5s infinite' }}/>}
            </button>
          ))}
        </nav>
      </div>
    </>
  );
}
