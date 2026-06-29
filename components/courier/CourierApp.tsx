'use client'
import { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react'
import { calcDeliveryFee, fetchRoute, DEFAULT_PRICING, fetchOrderDeliveryRoute, formatKm, COURIER_MAP_VIEW } from '@/lib/courierData'
import { resolveOrderDeliveryFee, buildDeliveryFeePatch } from '@/lib/deliveryFee'
import { usePricingStore, usePickups, usePickupLocations, hydrateCourierStores } from '@/lib/courierStore'
import { useCourierTeam, useCourierTeamStore } from '@/lib/courierTeamStore'
import { countCourierActiveOrders, isMyCourierOrder, findCourierByPhone, vehicleIcon } from '@/lib/courierTeam'
import { reloadCourierTeamStore, syncCourierTeamFromApi } from '@/lib/courierTeamStore'
import { loadCourierSession, clearCourierSession, type CourierSession } from '@/lib/courierSession'
import CourierLoginPage from '@/components/courier/CourierLoginPage'
import { DEMO_COURIER_ORDERS } from '@/lib/demoOrders'
import { buildCourierStats, COURIER_NAME, formatSm } from '@/lib/courierStats'
import { useOrderRoadKm } from '@/lib/useOrderRoadKm'
import { useOrders, USE_API } from '@/lib/store'
import { mapOrdersForCourier, mapOrdersForCourierMap, mapSingleOrderForCourier, isCourierMapOrder, isCourierFullyReadyOrder, courierMapStatusLabel, courierWaitingBanner } from '@/lib/orderUiMap'
import {
  normalizeOrder,
  buildCourierRoute,
  getAllPickupIds,
  getCourierAcceptPickupIds,
  getPendingPartsForCourier,
  formatCourierWaitingMessage,
  deriveCourierProgress,
  isPickupPointReady,
} from '@/lib/orderParts'
import type { Order } from '@/lib/types'
import { useApiSync } from '@/lib/useApiSync'
import { useAppNavigation } from '@/lib/useAppNavigation'
import AppNavigationBoundary from '@/components/shared/AppNavigationBoundary'
import { resolveCourierPayment } from '@/lib/courierPayment'

/* ══════════════════════════════════════════════════════
   КАКАПО КУРЬЕР — карта со всеми заказами + список
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

type PickupMeta = { id: string; name: string; addr: string; phone: string; e: string; color: string }

function CourierPickupPoints({
  orderRaw,
  PICKUPS,
  onFocus,
}: {
  orderRaw: Order | null | undefined
  PICKUPS: Record<string, PickupMeta>
  onFocus?: (pid: string) => void
}) {
  if (!orderRaw) return null
  const order = normalizeOrder(orderRaw)
  const picked = new Set(order.pickedUpIds || [])
  const allIds = getAllPickupIds(order)
  const route = order.courierRoute?.length
    ? [...order.courierRoute, ...allIds.filter(id => !order.courierRoute!.includes(id))]
    : allIds
  const points = [...new Set(route)]
  const focusPid = order.courierRoute?.find(pid => !picked.has(pid))
    || points.find(pid => !picked.has(pid) && isPickupPointReady(order, pid))
    || null

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: '#8FB897', marginBottom: 10, letterSpacing: 0.4 }}>
        📍 Точки забора
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {points.map((pid) => {
          const pk = PICKUPS[pid] || PICKUPS.store
          const isPicked = picked.has(pid)
          const ready = isPickupPointReady(order, pid)
          const isFocus = focusPid === pid && !isPicked
          const kind = pid === 'store' ? 'Магазин' : 'Ресторан'

          let badge = '⏳ Готовится'
          let badgeColor = '#FFB800'
          if (isPicked) {
            badge = '✓ Забрано'
            badgeColor = pk.color
          } else if (ready) {
            badge = pid === 'store' ? 'Ждёт передачи от сборщика' : 'Ждёт передачи от ресторана'
            badgeColor = '#3B8EF0'
          }

          return (
            <button
              key={pid}
              type="button"
              onClick={() => ready && !isPicked && onFocus?.(pid)}
              className="btn"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '14px 14px',
                borderRadius: 14,
                textAlign: 'left',
                width: '100%',
                background: isPicked ? `${pk.color}12` : isFocus ? `${pk.color}18` : '#091508',
                border: `1.5px solid ${isPicked ? pk.color + '55' : isFocus ? pk.color : '#162B1A'}`,
                opacity: !ready && !isPicked ? 0.72 : 1,
                cursor: ready && !isPicked ? 'pointer' : 'default',
              }}
            >
              <div style={{
                width: 42, height: 42, borderRadius: 12, flexShrink: 0,
                background: isPicked ? `${pk.color}33` : `${pk.color}18`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
              }}>
                {isPicked ? '✓' : pk.e}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#3D6645', marginBottom: 2 }}>{kind}</div>
                <div style={{ fontSize: 13, fontWeight: 800, color: isPicked ? pk.color : '#EBF5ED' }}>{pk.name}</div>
                <div style={{ fontSize: 10, color: '#8FB897', marginTop: 2 }}>{pk.addr}</div>
                <div style={{ fontSize: 10, fontWeight: 700, color: badgeColor, marginTop: 6 }}>{badge}</div>
              </div>
              {ready && !isPicked && (
                <span style={{ fontSize: 10, fontWeight: 700, color: isFocus ? pk.color : '#3D6645', flexShrink: 0 }}>
                  {isFocus ? '→ еду сюда' : 'выбрать'}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

const COURIER = { name: COURIER_NAME, vehicle: '🏍 TJ 1234 AA', rating: 4.9 };

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

function orderDelivery(
  o: { id: string; weight: number; status?: string; deliveryFee?: number; deliveryFeeLocked?: boolean; total?: number; distanceKm?: number; items?: unknown[]; weightKg?: number },
  roadKm: Record<string, number>,
  TARIFF = DEFAULT_PRICING,
): number | null {
  const fee = resolveOrderDeliveryFee(o as import('@/lib/types').Order, TARIFF, roadKm)
  return fee
}

function CourierPaymentFooter({
  order,
  dlv,
  size = 'md',
}: {
  order: { sum: number; paymentMethod?: string; creditAmount?: number; cashDue?: number; pay?: string }
  dlv: number | null
  size?: 'md' | 'lg'
}) {
  const pm = resolveCourierPayment(
    {
      total: (order.cashDue ?? 0) + (order.creditAmount ?? order.sum),
      deliveryFee: dlv ?? undefined,
      creditAmount: order.creditAmount,
      payment_method: order.paymentMethod,
      pay: order.paymentMethod ?? order.pay,
    },
    dlv,
  )
  const amountSize = size === 'lg' ? 30 : 26
  if (pm.isCredit) {
    return (
      <div style={{ borderTop: '1px dashed rgba(255,184,0,.35)', paddingTop: size === 'lg' ? 12 : 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#FFB800' }}>👑 В ДОЛГ (VIP)</div>
            <div style={{ fontSize: 10, color: '#3D6645', marginTop: 2 }}>товары — уже на карте клиента</div>
      </div>
          <span className="ub" style={{ fontSize: amountSize - 6, fontWeight: 900, color: '#FFB800' }}>{pm.credit.toFixed(2)} ЅМ</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#1FD760' }}>💵 НАЛИЧНЫМИ</div>
            <div style={{ fontSize: 10, color: '#3D6645', marginTop: 2 }}>только доставка</div>
        </div>
          <span className="ub" style={{ fontSize: amountSize, fontWeight: 900, color: '#1FD760' }}>{pm.cash.toFixed(2)} ЅМ</span>
      </div>
    </div>
  )
  }
  return (
    <div style={{ borderTop: '1px dashed rgba(31,215,96,.3)', paddingTop: size === 'lg' ? 12 : 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#1FD760' }}>💵 {pm.payLabel.toUpperCase()}</div>
        <div style={{ fontSize: 10, color: '#3D6645', marginTop: 2 }}>взять с клиента</div>
      </div>
      <span className="ub" style={{ fontSize: amountSize, fontWeight: 900, color: '#1FD760' }}>{dlv != null ? `${pm.cash.toFixed(2)}` : '…'} ЅМ</span>
    </div>
  )
}

function courierCashToCollect(
  order: { sum: number; paymentMethod?: string; creditAmount?: number; cashDue?: number; pay?: string },
  dlv: number | null,
): string {
  const pm = resolveCourierPayment(
    {
      total: (order.cashDue ?? 0) + (order.creditAmount ?? order.sum),
      deliveryFee: dlv ?? undefined,
      creditAmount: order.creditAmount,
      payment_method: order.paymentMethod,
      pay: order.paymentMethod ?? order.pay,
    },
    dlv,
  )
  return dlv != null ? `${pm.cash.toFixed(2)} ЅМ` : '…'
}

function isMapAlive(map: any): boolean {
  try {
    const el = map?.getContainer?.();
    return !!(map?._loaded && el?.isConnected && map.getPane?.('mapPane'));
  } catch {
    return false;
  }
}

function applyDefaultMapView(map: any) {
  if (!isMapAlive(map)) return;
  try {
    map.stop();
    map.setView(
      [COURIER_MAP_VIEW.lat, COURIER_MAP_VIEW.lng],
      COURIER_MAP_VIEW.zoom,
      { animate: false, reset: true },
    );
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

/* ─────────────────────────────────────────────────────
    РЕАЛЬНАЯ КАРТА OpenStreetMap + Leaflet
───────────────────────────────────────────────────── */
function LeafletMap({ orders, selected, onSelect, pickupIdx = 0, step, height = 280, TARIFF = DEFAULT_PRICING, roadKm = {}, sheetOpen = false, courierPos = null, onEnableLocation, locationLoading = false, locationError = '', PICKUPS = {}, pickupLocations = {}, myDeliveryList = false }: {
  orders: typeof DEMO_COURIER_ORDERS; selected: any; onSelect: (o: any) => void; height?: number; pickupIdx?: number; step?: string; TARIFF?: typeof DEFAULT_PRICING; roadKm?: Record<string, number>; sheetOpen?: boolean
  courierPos?: { lat: number; lng: number } | null; onEnableLocation?: () => void; locationLoading?: boolean; locationError?: string
  PICKUPS?: Record<string, { id: string; name: string; addr: string; phone: string; e: string; color: string; lat: number; lng: number }>
  pickupLocations?: import('@/lib/pickups').PickupLocationMap
  /** Список «Мои доставки» — только маркеры заказов (клиенты), без точек забора */
  myDeliveryList?: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<any>(null);
  const mapGenRef    = useRef(0);
  const markersRef   = useRef<any[]>([]);
  const routesRef    = useRef<any[]>([]);
  const roadKmRef = useRef(roadKm);
  const courierPosRef = useRef(courierPos);
  const pickupLocRef = useRef(pickupLocations);
  const [ready, setReady] = useState(false);

  useEffect(() => { roadKmRef.current = roadKm; }, [roadKm]);
  useEffect(() => { courierPosRef.current = courierPos; }, [courierPos]);
  useEffect(() => { pickupLocRef.current = pickupLocations; }, [pickupLocations]);

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
        center: [COURIER_MAP_VIEW.lat, COURIER_MAP_VIEW.lng],
        zoom: COURIER_MAP_VIEW.zoom,
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
        applyDefaultMapView(map);
        setReady(true);
      });
    });

    return () => {
      cancelled = true;
      mapGenRef.current += 1;
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

      if (selected && (selected.mapPickupIds ?? selected.pickupIds) && step) {
        const displayPickups = selected.mapPickupIds ?? selected.pickupIds
        displayPickups.forEach((pid: string, i: number) => {
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

      /* точки забора на обзорной карте — ресторан/магазин как у магазина: жёлтый=готовится, цвет=можно забирать */
      if (!myDeliveryList && !selected) {
        orders.forEach((o) => {
          (o.pendingParts || []).forEach((pp: { pickupId: string; label: string; status: string }) => {
            const pk = PICKUPS[pp.pickupId] || PICKUPS.store;
            if (!pk) return;
            const sz = 28;
            const icon = mkIcon(
              `<div style="width:${sz}px;height:${sz}px;border-radius:8px;background:rgba(255,184,0,.12);border:2px dashed rgba(255,184,0,.55);display:flex;align-items:center;justify-content:center;font-size:14px">${pk.e}</div>`,
              sz, sz, sz/2, sz/2
            );
            const m = L.marker([pk.lat, pk.lng], { icon, zIndexOffset: 80 }).addTo(map);
            m.bindTooltip(`${o.id} · ${pp.label} — ${pp.status}`, { direction: 'top', offset: [0, -sz/2] });
            m.on('click', () => onSelect(o));
            markersRef.current.push(m);
          });
          (o.pickupIds || []).forEach((pid: string) => {
            const pk = PICKUPS[pid] || PICKUPS.store;
            if (!pk) return;
            const sz = 34;
            const icon = mkIcon(
              `<div style="width:${sz}px;height:${sz}px;border-radius:10px;background:${pk.color}33;border:2.5px solid ${pk.color};display:flex;align-items:center;justify-content:center;font-size:16px;box-shadow:0 0 14px ${pk.color}99">${pk.e}</div>`,
              sz, sz, sz/2, sz/2
            );
            const m = L.marker([pk.lat, pk.lng], { icon, zIndexOffset: 180 }).addTo(map);
            m.bindTooltip(`${o.id} · ✓ ${pk.name} — можно забирать`, { direction: 'top', offset: [0, -sz/2] });
            m.on('click', () => onSelect(o));
            markersRef.current.push(m);
          });
        });
      }

      const coords = spreadOrderCoords(orders)
      orders.forEach((o, i) => {
        const isSel = selected?.id === o.id;
        const isWaiting = !myDeliveryList && o.mapStatus === 'waiting';
        const isPreparing = !myDeliveryList && o.mapStatus === 'preparing';
        const pos = coords.get(o.id) || { lat: o.lat, lng: o.lng };
        const sz = isSel ? 44 : 36;
        const label = i + 1;
        const pinBg = isSel
          ? 'linear-gradient(135deg,#1E5BB5,#3B8EF0)'
          : isWaiting
            ? 'linear-gradient(135deg,#4A5568,#8FB897)'
          : isPreparing
            ? 'linear-gradient(135deg,#B8860B,#FFB800)'
            : myDeliveryList
              ? 'linear-gradient(135deg,#1E5BB5,#3B8EF0)'
              : 'linear-gradient(135deg,#0F8A3A,#1FD760)';
        const pinShadow = isSel
          ? '0 4px 16px rgba(59,142,240,.6)'
          : isWaiting
            ? '0 3px 12px rgba(143,184,151,.45)'
          : isPreparing
            ? '0 3px 12px rgba(255,184,0,.5)'
            : myDeliveryList
              ? '0 3px 12px rgba(59,142,240,.45)'
              : '0 3px 12px rgba(31,215,96,.5)';
        const icon = mkIcon(
          `<div style="width:${sz}px;height:${sz}px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${pinBg};display:flex;align-items:center;justify-content:center;box-shadow:${pinShadow};border:2px solid rgba(255,255,255,.25)"><span style="transform:rotate(45deg);font-size:${isSel?16:13}px;font-weight:900;color:#fff">${label}</span></div>`,
          sz, sz, sz/2, sz
        );
        const m = L.marker([pos.lat, pos.lng], { icon, zIndexOffset: isSel ? 800 : 100 }).addTo(map);
        m.on('click', () => onSelect(o));
        const km = getOrderKm(o, roadKmRef.current);
        const kmLabel = km != null ? formatKm(km) : '… км';
        const dlv = km != null ? calcDelivery(km, o.weight, TARIFF) : '…';
        const kind = o.orderKind || (o.mixed ? 'mixed' : o.items?.some((it: any) => it.source === 'restaurant') ? 'restaurant' : 'market');
        const statusHint = myDeliveryList ? '' : isWaiting
          ? (kind === 'restaurant' ? ' · ждём ресторан' : kind === 'mixed' ? ' · ожидает' : ' · ещё не собирается')
          : isPreparing
            ? (kind === 'restaurant' ? ' · готовится на кухне' : ' · готовится')
            : ' · можно забирать';
        m.bindTooltip(`${o.id} · ${o.client}${statusHint} · ${kmLabel} · ${dlv} ЅМ`, { direction:'top', offset:[0,-sz] });
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
    });
  }, [ready, orders, selected, pickupIdx, step, onSelect, TARIFF, courierPos, myDeliveryList]);

  /* маршрут доставки: магазин/ресторан → клиент (+ пунктир курьера при активной доставке) */
  useEffect(() => {
    if (!ready || !isMapAlive(mapRef.current) || !selected?.pickupIds || !step) return;
    const gen = mapGenRef.current;
    let cancelled = false;

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
    });

    return () => {
      cancelled = true;
      routesRef.current.forEach(r => { try { r.remove(); } catch {} });
      routesRef.current = [];
    };
  }, [ready, selected, pickupIdx, step, sheetOpen, courierPos, pickupLocations]);

  const displayKm = selected ? getOrderKm(selected, roadKm) : null;

  return (
    <div style={{ position:'relative', height }}>
      <div ref={containerRef} style={{ width:'100%', height:'100%' }}/>
      {!sheetOpen && (
        <div style={{ position:'absolute', top:12, left:12, padding:'7px 12px', borderRadius:12, background:'rgba(3,11,5,.88)', backdropFilter:'blur(10px)', border:'1px solid rgba(59,142,240,.3)', zIndex:999, pointerEvents:'none' }}>
          <div className="ub" style={{ fontSize:17, fontWeight:900, color:'#3B8EF0' }}>{orders.length}</div>
          <div style={{ fontSize:9, color:'#8FB897' }}>на карте</div>
        </div>
      )}
      {!sheetOpen && orders.length > 0 && myDeliveryList && (
        <div style={{ position:'absolute', top:12, right:12, padding:'8px 10px', borderRadius:12, background:'rgba(3,11,5,.88)', backdropFilter:'blur(10px)', border:'1px solid #162B1A', zIndex:999, pointerEvents:'none', display:'flex', alignItems:'center', gap:6, fontSize:10, color:'#8FB897' }}>
          <span style={{ width:10, height:10, borderRadius:'50% 50% 50% 0', transform:'rotate(-45deg)', background:'#3B8EF0', flexShrink:0 }}/>
          Адрес доставки
        </div>
      )}
      {!sheetOpen && orders.length > 0 && !myDeliveryList && !step && (
        <div style={{ position:'absolute', top:12, right:12, padding:'8px 10px', borderRadius:12, background:'rgba(3,11,5,.88)', backdropFilter:'blur(10px)', border:'1px solid #162B1A', zIndex:999, pointerEvents:'none', display:'flex', flexDirection:'column', gap:5 }}>
          <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:10, color:'#8FB897' }}>
            <span style={{ width:10, height:10, borderRadius:'50% 50% 50% 0', transform:'rotate(-45deg)', background:'#FFB800', flexShrink:0 }}/>
            Готовится
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:10, color:'#8FB897' }}>
            <span style={{ width:10, height:10, borderRadius:'50% 50% 50% 0', transform:'rotate(-45deg)', background:'#1FD760', flexShrink:0 }}/>
            Можно забирать
          </div>
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
function CourierSessionBoot() {
  return (
    <div style={{ minHeight: '100vh', background: '#030B05', maxWidth: 480, margin: '0 auto' }} />
  );
}

export default function CourierApp() {
  return (
    <AppNavigationBoundary>
      <CourierAppInner />
    </AppNavigationBoundary>
  );
}

function CourierAppInner() {
  useApiSync('courier');
  const { page: tab, navigate: setTab } = useAppNavigation('orders');
  const TARIFF = useTariff();
  const couriers = useCourierTeam();
  const teamApiReady = useCourierTeamStore(s => s.apiReady);
  const teamHydrated = useCourierTeamStore(s => s.hydrated);
  const [session, setSession] = useState<CourierSession | null>(null);
  const [sessionReady, setSessionReady] = useState(false);

  useLayoutEffect(() => {
    setSession(loadCourierSession());
    setSessionReady(true);
    hydrateCourierStores();
    void syncCourierTeamFromApi();
  }, []);

  const courierProfile = useMemo(() => {
    if (!session) return null
    const byId = couriers.find(c => c.id === session.courierId)
    const byPhone = findCourierByPhone(couriers, session.phone)
    return byId || byPhone || null
  }, [couriers, session]);

  const activePhone = session?.phone || '';
  const courierDisplayName = courierProfile?.name || session?.name || COURIER_NAME;

  const logout = () => {
    clearCourierSession();
    setSession(null);
  };
  const apiOrders = useOrders(s => s.orders);
  const updateStatus = useOrders(s => s.updateStatus);
  const setCourierRoute = useOrders(s => s.setCourierRoute);
  const ORDERS = useMemo(
    () => {
      if (!USE_API && !apiOrders.length) {
        return DEMO_COURIER_ORDERS.filter(o => o.mapStatus === 'ready' && o.pickupIds.length > 0)
      }
      return mapOrdersForCourier(apiOrders.filter(isCourierFullyReadyOrder))
    },
    [apiOrders]
  );
  const MAP_ORDERS = useMemo(
    () => {
      if (!USE_API && !apiOrders.length) return DEMO_COURIER_ORDERS
      return mapOrdersForCourierMap(apiOrders.filter(isCourierMapOrder))
    },
    [apiOrders]
  );
  const pickupsList = usePickups();
  const pickupLocations = usePickupLocations();
  const PICKUPS = buildPickupsMap(pickupsList);
  const { pos: courierPos, loading: locationLoading, error: locationError, enable: enableLocation, disable: disableLocation, enabled: locationEnabled } = useCourierLocation();
  const [status,    setStatus]    = useState('available');
  const [selected,  setSelected]  = useState<any>(null);
  const [detailOrderId, setDetailOrderId] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);

  const selectedLive = useMemo(() => {
    if (!selected?.id) return null
    return ORDERS.find(o => o.id === selected.id)
      ?? MAP_ORDERS.find(o => o.id === selected.id)
      ?? selected
  }, [selected, ORDERS, MAP_ORDERS]);

  const myActiveOrders = useMemo(() => {
    if (!courierProfile) return []
    return apiOrders
      .filter(o => isMyCourierOrder(o, courierProfile))
      .map(raw => mapSingleOrderForCourier(normalizeOrder(raw)))
  }, [apiOrders, courierProfile]);

  const myActiveOrderIds = useMemo(() => new Set(myActiveOrders.map(o => o.id)), [myActiveOrders]);

  const activeRaw = useMemo(() => {
    if (!detailOrderId) return null
    return apiOrders.find(o => o.id === detailOrderId) ?? null
  }, [detailOrderId, apiOrders]);

  const active = useMemo(() => {
    if (!detailOrderId) return null
    return myActiveOrders.find(o => o.id === detailOrderId) ?? null
  }, [detailOrderId, myActiveOrders]);

  const { step, pickupIdx } = useMemo(() => {
    if (!activeRaw) return { step: 'toPickup' as const, pickupIdx: 0 }
    return deriveCourierProgress(normalizeOrder(activeRaw))
  }, [activeRaw]);

  const openDeliveryDetail = (orderId: string) => {
    setDetailOrderId(orderId)
  }

  const goToDeliveryList = () => setDetailOrderId(null)
  const ordersForRoadKm = useMemo(() => {
    const extra = myActiveOrders.filter(o => !MAP_ORDERS.some(m => m.id === o.id))
    return extra.length ? [...MAP_ORDERS, ...extra] : MAP_ORDERS
  }, [MAP_ORDERS, myActiveOrders]);
  const { roadKm, loading: kmLoading } = useOrderRoadKm(ordersForRoadKm, true);
  const courierStats = useMemo(() => {
    const base = buildCourierStats(apiOrders, roadKm, TARIFF, courierDisplayName)
    if (courierProfile) return { ...base, rating: courierProfile.rating }
    return base
  }, [apiOrders, roadKm, TARIFF, courierDisplayName, courierProfile]);
  const waitingForPickup = !!(active && !active.pickupIds.length && active.pendingParts?.length);
  const [acceptErr, setAcceptErr] = useState('');

  useEffect(() => {
    const syncTeam = () => {
      void syncCourierTeamFromApi();
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'kakapo-couriers' && !USE_API) reloadCourierTeamStore();
    };
    window.addEventListener('focus', syncTeam);
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') syncTeam();
    });
    return () => {
      window.removeEventListener('focus', syncTeam);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  useEffect(() => {
    if (!USE_API) return
    if (myActiveOrders.length) setStatus('busy')
    else if (!detailOrderId) setStatus('available')
  }, [myActiveOrders.length, detailOrderId]);

  const canAcceptMore = () => {
    if (courierProfile.blocked) return { ok: false, msg: 'Аккаунт заблокирован администратором' };
    const max = courierProfile.maxActiveOrders;
    const active = countCourierActiveOrders(apiOrders, { name: courierProfile.name, phone: activePhone });
    if (active >= max) {
      return { ok: false, msg: `Лимит: ${active}/${max} заказ(ов) одновременно` };
    }
    return { ok: true, max, active };
  };

  const confirmAccept = async (o: any, route: string[]) => {
    setStatus('busy');
    setSelected(null);
    setDetailOrderId(o.id);
    setTab('active');
    const raw = apiOrders.find(x => x.id === o.id);
    const keepStatus = raw && ['assembler_done', 'ready'].includes(normalizeOrder(raw).status)
      ? normalizeOrder(raw).status
      : 'assembler_done';
    await updateStatus(o.id, keepStatus, {
      courier: { name: courierDisplayName, phone: activePhone },
      courierRoute: route,
      courierAtClient: false,
    });
  };

  const accept = async (o: any) => {
    if (acceptingId) return;
    const raw = apiOrders.find(x => x.id === o.id);
    const order = raw ? normalizeOrder(raw) : null;
    const live = order ? mapSingleOrderForCourier(order) : o;

    if (live.mapStatus === 'waiting' || live.mapStatus === 'preparing') {
      setAcceptErr('Заказ ещё не готов — подождите ресторан');
      return;
    }

    const ready = order ? getCourierAcceptPickupIds(order) : (o.pickupIds || []);
    if (!ready.length) {
      setAcceptErr('Синхронизация… попробуйте через секунду');
      return;
    }

    const gate = canAcceptMore();
    if (!gate.ok) {
      setAcceptErr(gate.msg);
      return;
    }
    setAcceptErr('');
    const route = order ? getAllPickupIds(order) : ready;
    setAcceptingId(o.id);
    try {
      await confirmAccept(live, route);
    } catch {
      setAcceptErr('Не удалось принять заказ — попробуйте ещё раз');
    } finally {
      setAcceptingId(null);
    }
  };

  const chooseFirstPickup = (pid: string) => {
    if (!detailOrderId) return;
    const raw = apiOrders.find(o => o.id === detailOrderId);
    if (!raw) return;
    const route = buildCourierRoute(pid, normalizeOrder(raw));
    void setCourierRoute(detailOrderId, route);
  };
  const finish = async () => {
    if (!detailOrderId) return;
    const deliveredAt = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const finishedId = detailOrderId;
    const raw = apiOrders.find(o => o.id === finishedId);
    const feePatch = raw
      ? buildDeliveryFeePatch(normalizeOrder(raw), TARIFF, roadKm)
      : { deliveryFee: (active ? orderDelivery(active, roadKm, TARIFF) : 0) ?? 0, deliveryFeeLocked: true as const };
    await updateStatus(finishedId, 'delivered', {
      courier: { name: courierDisplayName, phone: activePhone },
      deliveredAt,
      courierAtClient: false,
      ...feePatch,
    });
    setDetailOrderId(null);
    const remaining = myActiveOrders.filter(o => o.id !== finishedId).length;
    if (remaining) {
      setStatus('busy');
      setTab('active');
    } else {
      setStatus('available');
      setTab('earnings');
    }
  };
  const nextStop = async () => {
    if (!active || !detailOrderId || !activeRaw) return;
    const order = normalizeOrder(activeRaw);
    const picked = new Set(order.pickedUpIds || [])
    const readyPoints = getAllPickupIds(order).filter(pid => isPickupPointReady(order, pid))
    const readyCollected = readyPoints.length > 0 && readyPoints.every(pid => picked.has(pid))
    if (!readyCollected || getPendingPartsForCourier(order).length) return;
    await updateStatus(active.id, 'delivering', { courierAtClient: false });
  };

  const mapOrders = MAP_ORDERS.filter(o => !myActiveOrderIds.has(o.id));

  const available = ORDERS.filter(o =>
    !myActiveOrderIds.has(o.id) &&
    o.pickupIds.length > 0,
  );

  if (!sessionReady || (session && !courierProfile && (!teamHydrated || !teamApiReady))) {
    return (
      <>
      <style>{CSS}</style>
        <CourierSessionBoot />
      </>
    );
  }

  if (!session || !courierProfile) {
    return (
      <>
        <style>{CSS}</style>
        <CourierLoginPage couriers={couriers} onSuccess={setSession} />
      </>
    );
  }

  return (
    <>
      <style>{CSS}</style>
      <div style={{ minHeight:'100vh', background:'#030B05', maxWidth:480, margin:'0 auto', paddingBottom:78 }}>

        {/* HEADER */}
        <header style={{ position:'sticky', top:0, zIndex:100, background:'rgba(3,11,5,.97)', backdropFilter:'blur(24px)', borderBottom:'1px solid #162B1A', padding:'12px 18px', display:'flex', alignItems:'center', gap:10 }}>
          <a href="/" style={{ width:36, height:36, borderRadius:10, background:'#0C1C0F', border:'1px solid #162B1A', display:'flex', alignItems:'center', justifyContent:'center', textDecoration:'none', color:'#8FB897', fontSize:15, flexShrink:0 }}>←</a>
          <div style={{ width:40, height:40, borderRadius:13, background:'linear-gradient(135deg,#1E5BB5,#3B8EF0)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:20, flexShrink:0 }}>🛵</div>
          <div style={{ flex:1 }}>
            <div className="ub" style={{ fontSize:14, fontWeight:900 }}>{courierDisplayName}</div>
            <div style={{ display:'flex', alignItems:'center', gap:5, marginTop:1 }}>
              <div style={{ width:6, height:6, borderRadius:'50%', background:status==='available'?'#1FD760':status==='busy'?'#FFB800':'#3D6645', animation:'pulse 2s infinite' }}/>
              <span style={{ fontSize:10, color:'#8FB897' }}>
                {status==='available'?'Свободен':status==='busy'?'В заказе':'Офлайн'}
                {' · '}
                {courierProfile ? `${vehicleIcon(courierProfile.vehicle)} ${courierProfile.num}` : COURIER.vehicle}
                {courierProfile && ` · до ${courierProfile.maxActiveOrders} зак.`}
              </span>
          </div>
        </div>
          <div style={{ textAlign:'right' }}>
            <div style={{ fontSize:9, color:'#3D6645' }}>Сегодня</div>
            <div className="ub" style={{ fontSize:15, fontWeight:900, color:'#1FD760' }}>{formatSm(courierStats.todayEarnings)} ЅМ</div>
        </div>
          <button
            type="button"
            onClick={logout}
            title="Выйти"
            className="btn"
            style={{ width:36, height:36, borderRadius:10, flexShrink:0, border:'1.5px solid rgba(255,69,69,.35)', background:'rgba(255,69,69,.1)', color:'#FF6969', fontSize:14, display:'flex', alignItems:'center', justifyContent:'center' }}
          >
            ⎋
          </button>
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
                  <LeafletMap key="orders-map" orders={mapOrders} selected={selected} onSelect={setSelected} TARIFF={TARIFF} roadKm={roadKm} sheetOpen={!!selected} courierPos={courierPos} onEnableLocation={enableLocation} locationLoading={locationLoading} locationError={locationError} PICKUPS={PICKUPS} pickupLocations={pickupLocations} />
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
                        <div>
                          <div className="ub" style={{ fontSize:14, fontWeight:900, color:'#3B8EF0' }}>{selected.id}</div>
                          {selected.mapStatus && selected.mapStatus !== 'ready' && (
                            <span style={{ display:'inline-block', marginTop:4, padding:'3px 8px', borderRadius:8, fontSize:10, fontWeight:700,
                              background: selected.mapStatus === 'waiting' ? 'rgba(143,184,151,.12)' : 'rgba(255,184,0,.12)',
                              color: selected.mapStatus === 'waiting' ? '#8FB897' : '#FFB800',
                              border: `1px solid ${selected.mapStatus === 'waiting' ? 'rgba(143,184,151,.35)' : 'rgba(255,184,0,.35)'}`,
                            }}>{courierMapStatusLabel(selected.mapStatus, selected.orderKind || 'market')}</span>
                          )}
                          {selected.mapStatus === 'ready' && (
                            <span style={{ display:'inline-block', marginTop:4, padding:'3px 8px', borderRadius:8, fontSize:10, fontWeight:700, background:'rgba(31,215,96,.12)', color:'#1FD760', border:'1px solid rgba(31,215,96,.35)' }}>{courierMapStatusLabel('ready', selected.orderKind || 'market')}</span>
                          )}
          </div>
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
                        {selected.mapStatus === 'waiting' && (
                          <div style={{ padding:'10px 12px', borderRadius:10, background:'rgba(143,184,151,.08)', border:'1px solid rgba(143,184,151,.3)', marginBottom:10, fontSize:12, color:'#8FB897', fontWeight:700 }}>
                            {courierWaitingBanner('waiting', selected.orderKind || 'market')}
                          </div>
                        )}
                        {selected.mapStatus === 'preparing' && !selected.pickupIds.length && (
                          <div style={{ padding:'10px 12px', borderRadius:10, background:'rgba(255,184,0,.08)', border:'1px solid rgba(255,184,0,.3)', marginBottom:10, fontSize:12, color:'#FFB800', fontWeight:700 }}>
                            {courierWaitingBanner('preparing', selected.orderKind || 'market')}
                          </div>
                        )}
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
                        {selected.pendingParts?.map((pp: { pickupId: string; label: string; status: string }, pi: number) => {
                          const pk = PICKUPS[pp.pickupId] || PICKUPS.store;
                          return (
                          <div key={`p-${pi}`} style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8, opacity:0.75 }}>
                            <div style={{ width:32, height:32, borderRadius:9, background:'rgba(255,184,0,.12)', border:'1.5px dashed rgba(255,184,0,.45)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, flexShrink:0 }}>{pk?.e || '⏳'}</div>
                            <div style={{ flex:1 }}>
                              <div style={{ fontSize:10, color:'#FFB800', fontWeight:700 }}>{pp.pickupId === 'store' ? 'Магазин' : 'Ресторан'} — {pp.status}</div>
                              <div style={{ fontSize:11, color:'#3D6645' }}>{pk?.name || pp.label} · на карте пунктиром</div>
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
                        {selected.mixed && <span style={{ padding:'4px 9px', borderRadius:8, fontSize:11, fontWeight:700, background:'rgba(255,140,0,.12)', color:'#FF8C00', border:'1px solid rgba(255,140,0,.3)' }}>🔀 Смешанный заказ</span>}
                        <span style={{ padding:'4px 9px', borderRadius:8, fontSize:11, fontWeight:700, background:'rgba(59,142,240,.1)', color:'#3B8EF0', border:'1px solid rgba(59,142,240,.25)' }}>🛣 {getOrderKm(selected, roadKm) != null ? `${formatKm(getOrderKm(selected, roadKm)!)} · забор → клиент` : '… · забор → клиент'}</span>
                        <span style={{ padding:'4px 9px', borderRadius:8, fontSize:11, fontWeight:700, background:'rgba(255,184,0,.1)', color:'#FFB800', border:'1px solid rgba(255,184,0,.25)' }}>⚖️ {selected.weight} кг</span>
                      </div>
                      {/* состав */}
                      <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:14 }}>
                        {selected.items.map((it: any,i: number)=><span key={i} style={{ padding:'4px 9px', borderRadius:8, fontSize:11, background:'#091508', border:'1px solid #162B1A', color:'#8FB897' }}>{it.e} {it.n} ×{it.q}</span>)}
                      </div>
                      {/* оплата */}
                      <div style={{ background:'rgba(31,215,96,.07)', border:'1.5px solid rgba(31,215,96,.35)', borderRadius:14, padding:'13px 15px', marginBottom:16 }}>
                        {(() => {
                          const km = getOrderKm(selected, roadKm);
                          const dlv = orderDelivery(selected, roadKm, TARIFF);
                          const isHeavy = selected.weight > TARIFF.heavyKg;
                          const extraKm = km != null && km > TARIFF.baseDist ? km - TARIFF.baseDist : 0;
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
                              <CourierPaymentFooter order={selected} dlv={dlv} />
                            </>
                          );
                        })()}
                    </div>
                      {/* кнопки */}
                      <div style={{ display:'flex', gap:8 }}>
                        <button onClick={()=>setSelected(null)} className="btn" style={{ padding:'14px 18px', borderRadius:14, background:'#162B1A', border:'none', color:'#8FB897', fontWeight:700, fontSize:14 }}>✕</button>
                        {selectedLive?.mapStatus === 'waiting' ? (
                          <div style={{ flex:1, padding:14, borderRadius:14, background:'rgba(143,184,151,.1)', border:'1px solid rgba(143,184,151,.35)', textAlign:'center', fontSize:13, fontWeight:700, color:'#8FB897' }}>
                            📦 Заказ ещё не собирается
                    </div>
                        ) : !selectedLive || selectedLive.mapStatus === 'preparing' || !selectedLive.pickupIds?.length ? (
                          <div style={{ flex:1, padding:14, borderRadius:14, background:'rgba(255,184,0,.1)', border:'1px solid rgba(255,184,0,.35)', textAlign:'center', fontSize:13, fontWeight:700, color:'#FFB800' }}>
                            ⏳ Ожидаем готовность заказа
                  </div>
                        ) : !canAcceptMore().ok ? (
                          <div style={{ flex:1, padding:14, borderRadius:14, background:'rgba(255,69,69,.1)', border:'1px solid rgba(255,69,69,.35)', textAlign:'center', fontSize:12, fontWeight:700, color:'#FF4545' }}>
                            {canAcceptMore().msg}
            </div>
          ) : (
                        <button onClick={()=>void accept(selectedLive)} disabled={!!acceptingId} className="btn" style={{ flex:1, padding:14, borderRadius:14, background:acceptingId ? '#162B1A' : 'linear-gradient(135deg,#17B34E,#1FD760)', border:'none', color:acceptingId ? '#8FB897' : '#030B05', fontWeight:800, fontSize:13, display:'flex', flexDirection:'column', alignItems:'center', gap:2, opacity:acceptingId ? 0.7 : 1 }}>
                          <span>{acceptingId ? '⏳ Принимаем…' : '✓ Принять заказ'}</span>
                          <span style={{ fontSize:11, fontWeight:700, opacity:.85 }}>{selectedLive?.paymentMethod === 'credit' ? 'наличными за доставку' : 'наличными'} {courierCashToCollect(selectedLive, orderDelivery(selectedLive, roadKm, TARIFF))}</span>
                        </button>
                        )}
                    </div>
                      {acceptErr && (
                        <div style={{ marginTop:8, padding:'9px 12px', borderRadius:10, background:'rgba(255,69,69,.1)', border:'1px solid rgba(255,69,69,.3)', fontSize:12, color:'#FF4545', textAlign:'center' }}>
                          {acceptErr}
                  </div>
                      )}
                    </div>
                    </div>
              )}

                <div style={{ padding:'18px 18px 0' }}>
                  <div className="ub" style={{ fontSize:14, fontWeight:800, marginBottom:12, display:'flex', alignItems:'center', gap:8 }}>
                    Доступные заказы
                    <span style={{ padding:'2px 8px', borderRadius:8, fontSize:11, fontWeight:800, background:'rgba(31,215,96,.12)', color:'#1FD760', border:'1px solid rgba(31,215,96,.28)' }}>{available.length}</span>
                    {kmLoading && <span style={{ fontSize:10, color:'#3D6645', fontWeight:600 }}>· считаем км…</span>}
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                    {available.length === 0 && (
                      <div style={{ textAlign:'center', padding:'28px 16px', color:'#8FB897', background:'#091508', border:'1px solid #162B1A', borderRadius:16 }}>
                        <div style={{ fontSize:32, marginBottom:8 }}>📭</div>
                        <div style={{ fontSize:13, fontWeight:700, marginBottom:4 }}>Нет доступных заказов</div>
                        <div style={{ fontSize:11, color:'#3D6645' }}>{myActiveOrders.length ? `${myActiveOrders.length} в доставке — вкладка «Доставка»` : 'Новые появятся после оформления в магазине'}</div>
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
              <div style={{ padding:'12px 18px 0', display:'flex', alignItems:'center', gap:10 }}>
                <button type="button" onClick={goToDeliveryList} className="btn" style={{ width:38, height:38, borderRadius:12, background:'#0C1C0F', border:'1px solid #162B1A', color:'#8FB897', fontSize:16 }}>←</button>
                <div style={{ flex:1 }}>
                  <div className="ub" style={{ fontSize:14, fontWeight:800 }}>Заказ {active.id}</div>
                  <div style={{ fontSize:11, color:'#3D6645' }}>Назад к списку доставок</div>
              </div>
            </div>
              <LeafletMap key="active-map" orders={[active]} selected={active} onSelect={()=>{}} height={250} pickupIdx={pickupIdx} step={step} TARIFF={TARIFF} roadKm={roadKm} courierPos={courierPos} onEnableLocation={enableLocation} locationLoading={locationLoading} locationError={locationError} PICKUPS={PICKUPS} pickupLocations={pickupLocations}/>
              <div style={{ padding:'16px 18px 110px' }}>
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

                {(() => {
                  const order = activeRaw ? normalizeOrder(activeRaw) : null
                  const picked = new Set(order?.pickedUpIds || [])
                  const readyPoints = order ? getAllPickupIds(order).filter(pid => isPickupPointReady(order, pid)) : []
                  const readyCollected = readyPoints.length > 0 && readyPoints.every(pid => picked.has(pid))
                  const canGoToClient = readyCollected && !(order && getPendingPartsForCourier(order).length)
                  return (
                    <>
                      <CourierPickupPoints orderRaw={activeRaw} PICKUPS={PICKUPS} onFocus={chooseFirstPickup} />

                      {waitingForPickup && (
                        <div style={{ padding:'12px 14px', borderRadius:12, background:'rgba(255,184,0,.08)', border:'1px solid rgba(255,184,0,.35)', marginBottom:14 }}>
                          <div style={{ fontSize:13, fontWeight:800, color:'#FFB800', marginBottom:4 }}>⏳ Ожидаем готовность</div>
                          {active.pendingParts?.map((pp: { label: string; status: string }, i: number) => (
                            <div key={i} style={{ fontSize:12, color:'#8FB897', marginTop:4 }}>
                              {pp.label}: <span style={{ color:'#FFB800', fontWeight:700 }}>{pp.status}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      <div style={{ background:'#091508', border:'1px solid #162B1A', borderRadius:16, padding:'14px 16px', marginBottom:14 }}>
                        <div style={{ fontSize:10, color:'#3D6645', fontWeight:700, marginBottom:8 }}>🛵 ДОСТАВИТЬ КЛИЕНТУ</div>
                        <div style={{ display:'flex', gap:10 }}>
                          <div style={{ flex:1 }}>
                            <div style={{ fontSize:13, fontWeight:700, color: canGoToClient ? '#EBF5ED' : '#8FB897' }}>{active.addr}</div>
                            <div style={{ fontSize:11, color:'#8FB897', marginTop:2 }}>{active.client}</div>
                          </div>
                          <a href={`tel:${active.phone}`} style={{ padding:'7px 11px', borderRadius:9, background:'rgba(59,142,240,.1)', border:'1px solid rgba(59,142,240,.3)', color:'#3B8EF0', fontSize:13, textDecoration:'none', alignSelf:'center' }}>📞</a>
                        </div>
                      </div>
                    </>
                  )
                })()}

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
                      <CourierPaymentFooter order={active} dlv={dlv} size="lg" />
                    </div>
                  );
                })()}

                {(() => {
                  const order = activeRaw ? normalizeOrder(activeRaw) : null
                  const picked = new Set(order?.pickedUpIds || [])
                  const readyPoints = order ? getAllPickupIds(order).filter(pid => isPickupPointReady(order, pid)) : []
                  const readyCollected = readyPoints.length > 0 && readyPoints.every(pid => picked.has(pid))
                  const canGoToClient = readyCollected && !(order && getPendingPartsForCourier(order).length)
                  return (
                    <>
                      {step === 'toPickup' && !waitingForPickup && !canGoToClient && (
                        <div style={{ width:'100%', padding:15, borderRadius:15, background:'rgba(59,142,240,.08)', border:'1px solid rgba(59,142,240,.25)', textAlign:'center', fontSize:12, fontWeight:700, color:'#3B8EF0', marginBottom:10 }}>
                          Выберите точку и заберите заказ — сборщик или ресторан подтвердят передачу ✓
                        </div>
                      )}
                      {canGoToClient && step === 'toPickup' && (
                        <button type="button" onClick={nextStop} className="btn" style={{ width:'100%', padding:15, borderRadius:15, background:'linear-gradient(135deg,#1E5BB5,#3B8EF0)', border:'none', color:'white', fontWeight:800, fontSize:15, marginBottom:10 }}>
                          🛵 Все точки забраны — еду к клиенту
                        </button>
                      )}
                      {step === 'toPickup' && waitingForPickup && (() => {
                        const wait = formatCourierWaitingMessage(active.pendingParts || []);
                        return (
                          <div style={{ width:'100%', padding:15, borderRadius:15, background:'rgba(255,184,0,.1)', border:'1px solid rgba(255,184,0,.35)', textAlign:'center', fontSize:13, fontWeight:700, color:'#FFB800', marginBottom:10 }}>
                            {wait.icon} {wait.text}
                          </div>
                        );
                      })()}
                      {step === 'toClient' && <button onClick={() => detailOrderId && updateStatus(detailOrderId, 'delivering', { courierAtClient: true })} className="btn" style={{ width:'100%', padding:15, borderRadius:15, background:'linear-gradient(135deg,#1E5BB5,#3B8EF0)', border:'none', color:'white', fontWeight:800, fontSize:15 }}>🏁 Я на месте у клиента</button>}
                      {step === 'done' && <button onClick={finish} className="btn" style={{ width:'100%', padding:15, borderRadius:15, background:'linear-gradient(135deg,#17B34E,#1FD760)', border:'none', color:'#030B05', fontWeight:800, fontSize:15, boxShadow:'0 8px 24px rgba(31,215,96,.4)' }}>✓ Доставлено — получить {courierCashToCollect(active, orderDelivery(active, roadKm, TARIFF))}</button>}
                    </>
                  )
                })()}
              </div>
            </div>
          ) : myActiveOrders.length ? (
            <div>
              <LeafletMap
                key="delivery-list-map"
                orders={myActiveOrders}
                selected={null}
                onSelect={(o) => openDeliveryDetail(o.id)}
                height={240}
                TARIFF={TARIFF}
                roadKm={roadKm}
                courierPos={courierPos}
                onEnableLocation={enableLocation}
                locationLoading={locationLoading}
                locationError={locationError}
                PICKUPS={PICKUPS}
                pickupLocations={pickupLocations}
                myDeliveryList
              />
              <div style={{ padding:'16px 18px 110px' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
                <div>
                  <div className="ub" style={{ fontSize:16, fontWeight:900 }}>Мои доставки</div>
                  <div style={{ fontSize:12, color:'#8FB897', marginTop:2 }}>{myActiveOrders.length} из {courierProfile.maxActiveOrders} заказов</div>
                </div>
                <div style={{ padding:'8px 12px', borderRadius:12, background:'rgba(59,142,240,.1)', border:'1px solid rgba(59,142,240,.25)' }}>
                  <span style={{ fontSize:11, fontWeight:800, color:'#3B8EF0' }}>Нажмите заказ →</span>
                </div>
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                {myActiveOrders.map((o, idx) => {
                  const raw = apiOrders.find(x => x.id === o.id)
                  const dlv = orderDelivery(o, roadKm, TARIFF)
                  const km = getOrderKm(o, roadKm)
                  const prog = raw ? deriveCourierProgress(normalizeOrder(raw)) : null
                  const statusLabel = prog?.step === 'done'
                    ? 'На месте'
                    : raw?.status === 'delivering' || prog?.step === 'toClient'
                      ? 'К клиенту'
                      : !o.pickupIds.length && o.pendingParts?.length
                        ? 'Ожидание'
                        : 'Забор'
                  const statusColor = statusLabel === 'К клиенту' ? '#3B8EF0' : statusLabel === 'На месте' ? '#1FD760' : statusLabel === 'Ожидание' ? '#FFB800' : '#FF8C00'
                  return (
                    <button key={o.id} type="button" onClick={() => openDeliveryDetail(o.id)} className="btn"
                      style={{ background:'#091508', border:'1.5px solid #162B1A', borderRadius:16, padding:'14px 15px', textAlign:'left' }}>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:8 }}>
                        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                          <div style={{ width:34, height:34, borderRadius:10, background:'linear-gradient(135deg,#1E5BB5,#3B8EF0)', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'Unbounded', fontSize:12, fontWeight:900, color:'white' }}>{idx + 1}</div>
                          <div>
                            <div className="ub" style={{ fontSize:14, fontWeight:800, color:'#3B8EF0' }}>{o.id}</div>
                            <div style={{ fontSize:11, color:'#8FB897' }}>{o.client}</div>
                          </div>
                        </div>
                        <div style={{ textAlign:'right' }}>
                          <div className="ub" style={{ fontSize:16, fontWeight:900, color:'#1FD760' }}>{dlv ?? '…'} ЅМ</div>
                          <div style={{ fontSize:9, color:'#3D6645' }}>{km != null ? formatKm(km) : '…'}</div>
                        </div>
                      </div>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8 }}>
                        <div style={{ fontSize:11, color:'#8FB897', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>📍 {o.addr}</div>
                        <span style={{ padding:'3px 9px', borderRadius:8, fontSize:10, fontWeight:800, background:`${statusColor}18`, color:statusColor, border:`1px solid ${statusColor}44`, flexShrink:0 }}>{statusLabel}</span>
                      </div>
                    </button>
                  )
                })}
              </div>
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
              <div className="ub" style={{ fontSize:40, fontWeight:900, color:'#1FD760', marginBottom:4 }}>{formatSm(courierStats.todayEarnings)} ЅМ</div>
              <div style={{ fontSize:12, color:'#3B8EF0' }}>{courierStats.todayCount} {courierStats.todayCount === 1 ? 'доставка' : courierStats.todayCount >= 2 && courierStats.todayCount <= 4 ? 'доставки' : 'доставок'} · {courierStats.rating} ★</div>
          </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:18 }}>
              {([
                ['За неделю', `${formatSm(courierStats.weekEarnings)} ЅМ`, '#1FD760'],
                ['Всего доставок', String(courierStats.totalDeliveries), '#3B8EF0'],
                ['Ср. за день', `${formatSm(courierStats.avgPerDay)} ЅМ`, '#FFB800'],
                ['Рейтинг', `${courierStats.rating} ★`, '#FFB800'],
              ] as const).map(([l,v,c],i)=>(
                <div key={i} style={{ background:'#091508', border:'1px solid #162B1A', borderRadius:14, padding:'15px', textAlign:'center' }}>
                  <div className="ub" style={{ fontSize:18, fontWeight:900, color:c, marginBottom:3 }}>{v}</div>
                  <div style={{ fontSize:10, color:'#3D6645' }}>{l}</div>
              </div>
            ))}
          </div>
            <div className="ub" style={{ fontSize:14, fontWeight:800, marginBottom:12 }}>История доставок</div>
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {courierStats.history.length === 0 ? (
                <div style={{ background:'#091508', border:'1px solid #162B1A', borderRadius:13, padding:'24px 14px', textAlign:'center', color:'#3D6645', fontSize:13 }}>
                  Доставок пока нет — завершите заказ во вкладке «Доставка»
                </div>
              ) : courierStats.history.map((h)=>(
                <div key={h.id} style={{ background:'#091508', border:'1px solid #162B1A', borderRadius:13, padding:'12px 14px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                    <div style={{ width:34, height:34, borderRadius:9, background:'rgba(31,215,96,.12)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:14 }}>✓</div>
                    <div>
                      <div style={{ fontSize:13, fontWeight:700 }}>{h.id} · {h.client}</div>
                      <div style={{ fontSize:11, color:'#3D6645' }}>{h.addr} · {'★'.repeat(h.rating)}</div>
                    </div>
                  </div>
                  <div style={{ textAlign:'right' }}>
                    <div className="ub" style={{ fontSize:12, fontWeight:800, color:'#1FD760' }}>+{formatSm(h.earning)} ЅМ</div>
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
            <button key={id} onClick={() => { if (id === 'active') setDetailOrderId(null); setTab(id); }} className="btn" style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:3, padding:'5px 18px', borderRadius:11, background:tab===id?'rgba(59,142,240,.12)':'transparent', border:`1.5px solid ${tab===id?'rgba(59,142,240,.3)':'transparent'}`, position:'relative' }}>
              <span style={{ fontSize:20 }}>{icon}</span>
              <span style={{ fontSize:10, fontWeight:tab===id?800:600, color:tab===id?'#3B8EF0':'#3D6645' }}>{label}</span>
              {id==='active' && myActiveOrders.length > 0 && (
                <div style={{ position:'absolute', top:2, right:10, minWidth:16, height:16, padding:'0 4px', borderRadius:999, background:'#FFB800', display:'flex', alignItems:'center', justifyContent:'center', fontSize:9, fontWeight:900, color:'#030B05' }}>
                  {myActiveOrders.length}
                </div>
              )}
          </button>
        ))}
      </nav>
    </div>
    </>
  );
}
