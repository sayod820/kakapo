/* ══════════════════════════════════════════════════════
   КАКАПО — маршруты (OSRM) + расчёт доставки
══════════════════════════════════════════════════════ */

import { DEFAULT_PICKUPS, pickupsToLocationMap, type PickupLocationMap } from './pickups';

export const STORE_LOCATION = {
  lat: 38.3250,
  lng: 69.0250,
  name: 'КАКАПО Магазин',
  addr: 'ул. Ленина, 42',
};

/** Фиксированный вид карты — центр г. Яван, несколько кварталов (как в выборе точки) */
export const COURIER_MAP_VIEW = {
  lat: 38.3185,
  lng: 69.0320,
  zoom: 14,
} as const;

/** Координаты точек забора по умолчанию (синхрон с lib/pickups.ts) */
export const PICKUP_LOCATIONS: PickupLocationMap = pickupsToLocationMap(DEFAULT_PICKUPS);

/** Округление км из OSRM (2 знака) */
export function roundRouteKm(km: number): number {
  return Math.round(km * 100) / 100;
}

/** Формат км для UI */
export function formatKm(km: number, withUnit = true): string {
  const n = roundRouteKm(km).toFixed(2);
  return withUnit ? `${n} км` : n;
}

export type RoadKmOrderInput = {
  pickupIds?: string[];
  /** Полный маршрут забора (все точки заказа) — приоритет для OSRM */
  routePickupIds?: string[];
  lat: number;
  lng: number;
};

function resolveRoutePickupIds(order: RoadKmOrderInput): string[] {
  if (order.routePickupIds?.length) return order.routePickupIds;
  if (order.pickupIds?.length) return order.pickupIds;
  return ['store'];
}

/** Зона доставки — Яван и окрестности */
const SERVICE_BOUNDS = { latMin: 38.15, latMax: 38.55, lngMin: 68.85, lngMax: 69.25 };

/** Координаты клиента: без 0,0, без перепутанных lat/lng */
export function normalizeClientCoords(lat?: number | null, lng?: number | null): { lat: number; lng: number } {
  let la = Number(lat);
  let ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) {
    return { lat: STORE_LOCATION.lat, lng: STORE_LOCATION.lng };
  }
  if (la > 60 && la < 75 && ln > 35 && ln < 45) [la, ln] = [ln, la];
  const ok = la >= SERVICE_BOUNDS.latMin && la <= SERVICE_BOUNDS.latMax
    && ln >= SERVICE_BOUNDS.lngMin && ln <= SERVICE_BOUNDS.lngMax
    && !(Math.abs(la) < 0.01 && Math.abs(ln) < 0.01);
  if (!ok) return { lat: STORE_LOCATION.lat, lng: STORE_LOCATION.lng };
  return { lat: la, lng: ln };
}

function dedupeRoutePoints(points: { lat: number; lng: number }[]): { lat: number; lng: number }[] {
  const out: { lat: number; lng: number }[] = [];
  for (const p of points) {
    const near = out.some(q => calcDistanceKm(q.lat, q.lng, p.lat, p.lng) < 0.08);
    if (!near) out.push(p);
  }
  return out.length >= 2 ? out : points;
}

function pickupCoord(id: string, locations: PickupLocationMap): { lat: number; lng: number } {
  const fallback = locations.store ?? { lat: STORE_LOCATION.lat, lng: STORE_LOCATION.lng, name: STORE_LOCATION.name };
  const p = locations[id] ?? fallback;
  return { lat: p.lat, lng: p.lng };
}

/** Км между двумя точками: по дорогам (OSRM), если нет — прямая линия */
async function legDistanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): Promise<number> {
  const coordStr = `${a.lng},${a.lat};${b.lng},${b.lat}`;
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=false&steps=false`,
      { signal: ctrl.signal },
    );
    clearTimeout(tid);
    const data = await res.json();
    if (data.code !== 'Ok' || !data.routes?.[0]) throw new Error('no route');
    return data.routes[0].distance / 1000;
  } catch {
    return calcDistanceKm(a.lat, a.lng, b.lat, b.lng);
  }
}

/** Один участок: геометрия по дорогам или прямая */
async function fetchLegRoute(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): Promise<RouteResult> {
  try {
    return await fetchOsrmRoute([a, b]);
  } catch {
    const km = calcDistanceKm(a.lat, a.lng, b.lat, b.lng);
    return {
      distanceKm: km,
      durationMin: Math.max(1, Math.round(km * 3)),
      geometry: [[a.lat, a.lng], [b.lat, b.lng]],
    };
  }
}

/** Порядок точек забора: каждый раз — ближайшая следующая по дорогам */
async function orderPickupsByNearestRoad(
  pickupIds: string[],
  locations: PickupLocationMap,
): Promise<{ lat: number; lng: number }[]> {
  if (!pickupIds.length) return [];
  if (pickupIds.length === 1) return [pickupCoord(pickupIds[0], locations)];

  const remaining = new Set(pickupIds);
  const startId = pickupIds.includes('store') ? 'store' : pickupIds[0];
  const ordered: { lat: number; lng: number }[] = [pickupCoord(startId, locations)];
  remaining.delete(startId);

  while (remaining.size) {
    const cur = ordered[ordered.length - 1];
    let bestId = '';
    let bestKm = Infinity;
    for (const id of remaining) {
      const km = await legDistanceKm(cur, pickupCoord(id, locations));
      if (km < bestKm) {
        bestKm = km;
        bestId = id;
      }
    }
    ordered.push(pickupCoord(bestId, locations));
    remaining.delete(bestId);
  }
  return ordered;
}

/** Точки маршрута: ближайшие точки забора по дорогам → клиент */
export async function buildOrderRoutePointsAsync(
  order: RoadKmOrderInput,
  locations: PickupLocationMap = PICKUP_LOCATIONS,
): Promise<{ lat: number; lng: number }[]> {
  const pickupIds = resolveRoutePickupIds(order);
  const client = normalizeClientCoords(order.lat, order.lng);
  const pickups = await orderPickupsByNearestRoad(pickupIds, locations);
  return dedupeRoutePoints([...pickups, client]);
}

/** Синхронный список точек (без оптимизации порядка) — запасной вариант */
export function buildOrderRoutePoints(
  order: RoadKmOrderInput,
  locations: PickupLocationMap = PICKUP_LOCATIONS
): { lat: number; lng: number }[] {
  const fallback = locations.store ?? { lat: STORE_LOCATION.lat, lng: STORE_LOCATION.lng, name: STORE_LOCATION.name };
  const pickupIds = resolveRoutePickupIds(order);
  const client = normalizeClientCoords(order.lat, order.lng);
  const points = pickupIds.map(id => {
    const p = locations[id] ?? fallback;
    return { lat: p.lat, lng: p.lng };
  });
  points.push(client);
  return dedupeRoutePoints(points);
}

/** Маршрут участок за участком: дорога или прямая на каждом отрезке */
async function fetchRouteByLegs(points: { lat: number; lng: number }[]): Promise<RouteResult> {
  if (points.length < 2) {
    return { distanceKm: 0, durationMin: 0, geometry: points.map(p => [p.lat, p.lng] as [number, number]) };
  }

  try {
    return await fetchOsrmRoute(points);
  } catch {
    /* по участкам: дорога, иначе прямая */
  }

  let totalKm = 0;
  let totalMin = 0;
  const geometry: [number, number][] = [];

  for (let i = 0; i < points.length - 1; i++) {
    const leg = await fetchLegRoute(points[i], points[i + 1]);
    totalKm += leg.distanceKm;
    totalMin += leg.durationMin;
    if (!geometry.length) geometry.push(...leg.geometry);
    else geometry.push(...leg.geometry.slice(1));
  }

  return {
    distanceKm: totalKm,
    durationMin: totalMin,
    geometry: geometry.length ? geometry : points.map(p => [p.lat, p.lng] as [number, number]),
  };
}

async function fetchOsrmRoute(points: { lat: number; lng: number }[]): Promise<RouteResult> {
  if (points.length < 2) {
    return { distanceKm: 0, durationMin: 0, geometry: points.map(p => [p.lat, p.lng] as [number, number]) };
  }
  const coordStr = points.map(p => `${p.lng},${p.lat}`).join(';');
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 12000);
  const res = await fetch(
    `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson&steps=false`,
    { signal: ctrl.signal },
  );
  clearTimeout(tid);
  const data = await res.json();
  if (data.code !== 'Ok' || !data.routes?.[0]) throw new Error('no route');
  const route = data.routes[0];
  return {
    distanceKm: route.distance / 1000,
    durationMin: Math.round(route.duration / 60),
    geometry: route.geometry.coordinates.map((c: [number, number]) => [c[1], c[0]] as [number, number]),
  };
}

/** Полный маршрут доставки (для карты и км) */
export async function fetchOrderDeliveryRoute(
  order: RoadKmOrderInput,
  locations?: PickupLocationMap
): Promise<RouteResult> {
  const locs = locations ?? PICKUP_LOCATIONS;
  const points = await buildOrderRoutePointsAsync(order, locs);
  return fetchRouteByLegs(points);
}

/** Точное расстояние заказа по дорогам */
export async function fetchOrderRoadKm(
  order: RoadKmOrderInput,
  locations?: PickupLocationMap
): Promise<number> {
  const route = await fetchOrderDeliveryRoute(order, locations);
  return roundRouteKm(route.distanceKm);
}

/** Пакетный расчёт км для нескольких заказов */
export async function fetchOrdersRoadKm<T extends { id: string } & RoadKmOrderInput>(
  orders: T[],
  locations: PickupLocationMap = PICKUP_LOCATIONS
): Promise<Record<string, number>> {
  const entries = await Promise.all(
    orders.map(async o => {
      try {
        const km = await fetchOrderRoadKm(o, locations);
        return [o.id, km] as const;
      } catch {
        const points = buildOrderRoutePoints(o, locations);
        let totalKm = 0;
        for (let i = 1; i < points.length; i++) {
          totalKm += calcDistanceKm(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
        }
        return [o.id, roundRouteKm(totalKm)] as const;
      }
    })
  );
  return Object.fromEntries(entries);
}

export interface PricingConfig {
  base: number;
  baseDist: number;
  perKm: number;
  heavyKg: number;
  heavyExtra: number;
  freeFrom?: number;
  /** Комиссия платформы с курьера, % от стоимости доставки */
  courierCommissionPercent?: number;
}

export const DEFAULT_PRICING: PricingConfig = {
  base: 10,
  baseDist: 2.5,
  perKm: 3,
  heavyKg: 50,
  heavyExtra: 10,
  freeFrom: 0,
  courierCommissionPercent: 15,
};

export interface RouteResult {
  distanceKm: number;
  durationMin: number;
  /** координаты для Leaflet: [lat, lng][] */
  geometry: [number, number][];
}

export interface DeliveryPriceResult {
  total: number;
  isFree: boolean;
  freeReason?: string;
  breakdown: string[];
}

/** Прямая дистанция (fallback) */
export function calcDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Маршрут по дорогам через OSRM; при ошибке — участки по прямой */
export async function fetchRoute(
  points: { lat: number; lng: number }[]
): Promise<RouteResult> {
  return fetchRouteByLegs(points);
}

/** Маршрут: точки забора → клиент */
export async function fetchDeliveryRoute(
  client: { lat: number; lng: number },
  pickupIds: string[] = ['store'],
  locations?: PickupLocationMap
): Promise<RouteResult> {
  return fetchOrderDeliveryRoute({ pickupIds, lat: client.lat, lng: client.lng }, locations);
}

export function calcDeliveryFee(distKm: number, weightKg: number, pricing: PricingConfig = DEFAULT_PRICING): number {
  let fee = pricing.base;
  if (distKm > pricing.baseDist) {
    fee += Math.ceil((distKm - pricing.baseDist) * pricing.perKm);
  }
  if (weightKg > pricing.heavyKg) fee += pricing.heavyExtra;
  return fee;
}

export function calcDeliveryPrice(opts: {
  orderAmount: number;
  distanceKm: number;
  weightKg: number;
  pricing?: PricingConfig;
}): DeliveryPriceResult {
  const pricing = opts.pricing ?? DEFAULT_PRICING;
  const breakdown: string[] = [];
  let total = calcDeliveryFee(opts.distanceKm, opts.weightKg, pricing);

  breakdown.push(`📍 Забор → клиент: ${formatKm(opts.distanceKm)}`);
  breakdown.push(`💰 База (до ${pricing.baseDist} км): ${pricing.base} ЅМ`);

  const extraKm = Math.max(0, opts.distanceKm - pricing.baseDist);
  if (extraKm > 0) {
    const extra = Math.ceil(extraKm * pricing.perKm);
    breakdown.push(`+ ${formatKm(extraKm)} × ${pricing.perKm} ЅМ = +${extra} ЅМ`);
  }
  if (opts.weightKg > pricing.heavyKg) {
    breakdown.push(`⚖️ Тяжёлый груз (${opts.weightKg} кг): +${pricing.heavyExtra} ЅМ`);
  }

  const isFree = pricing.freeFrom != null && pricing.freeFrom > 0 && opts.orderAmount >= pricing.freeFrom;
  if (isFree) {
    breakdown.push(`✅ Бесплатная доставка от ${pricing.freeFrom} ЅМ`);
    return { total: 0, isFree: true, freeReason: `Заказ от ${pricing.freeFrom} ЅМ`, breakdown };
  }

  breakdown.push(`🚚 Итого доставка: ${total} ЅМ`);
  return { total, isFree: false, breakdown };
}
