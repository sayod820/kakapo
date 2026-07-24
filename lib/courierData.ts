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
  if (order.routePickupIds?.length) return [...new Set(order.routePickupIds)];
  if (order.pickupIds?.length) return [...new Set(order.pickupIds)];
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

const legKmCache = new Map<string, number>();

async function legDistanceKmCached(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): Promise<number> {
  const key = `${a.lat.toFixed(5)},${a.lng.toFixed(5)}|${b.lat.toFixed(5)},${b.lng.toFixed(5)}`;
  const hit = legKmCache.get(key);
  if (hit != null) return hit;
  const km = await legDistanceKm(a, b);
  legKmCache.set(key, km);
  legKmCache.set(`${b.lat.toFixed(5)},${b.lng.toFixed(5)}|${a.lat.toFixed(5)},${a.lng.toFixed(5)}`, km);
  return km;
}

async function routeTotalKm(points: { lat: number; lng: number }[]): Promise<number> {
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    total += await legDistanceKmCached(points[i], points[i + 1]);
  }
  return total;
}

function permuteIds(ids: string[]): string[][] {
  if (ids.length <= 1) return [ids];
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i++) {
    const head = ids[i];
    const tail = [...ids.slice(0, i), ...ids.slice(i + 1)];
    for (const p of permuteIds(tail)) out.push([head, ...p]);
  }
  return out;
}

/** Кратчайший порядок забора: все перестановки → клиент, минимум км по дорогам */
async function orderPickupsByShortestRoad(
  pickupIds: string[],
  client: { lat: number; lng: number },
  locations: PickupLocationMap,
): Promise<string[]> {
  const unique = [...new Set(pickupIds)];
  if (!unique.length) return [];
  if (unique.length === 1) return unique;

  const perms = permuteIds(unique);
  let best = unique;
  let bestKm = Infinity;

  for (const perm of perms) {
    const points = [...perm.map(id => pickupCoord(id, locations)), client];
    const km = await routeTotalKm(points);
    if (km < bestKm) {
      bestKm = km;
      best = perm;
    }
  }
  return best;
}

/** Прямая линия — запасной порядок точек */
function orderPickupsByShortestStraight(
  pickupIds: string[],
  client: { lat: number; lng: number },
  locations: PickupLocationMap,
): string[] {
  const unique = [...new Set(pickupIds)];
  if (unique.length <= 1) return unique;
  const perms = permuteIds(unique);
  let best = unique;
  let bestKm = Infinity;
  for (const perm of perms) {
    const points = [...perm.map(id => pickupCoord(id, locations)), client];
    let km = 0;
    for (let i = 0; i < points.length - 1; i++) {
      km += calcDistanceKm(points[i].lat, points[i].lng, points[i + 1].lat, points[i + 1].lng);
    }
    if (km < bestKm) {
      bestKm = km;
      best = perm;
    }
  }
  return best;
}

/** Точки маршрута: кратчайший порядок забора по дорогам → клиент */
export async function buildOrderRoutePointsAsync(
  order: RoadKmOrderInput,
  locations: PickupLocationMap = PICKUP_LOCATIONS,
): Promise<{ points: { lat: number; lng: number }[]; orderedPickupIds: string[] }> {
  const pickupIds = resolveRoutePickupIds(order);
  const client = normalizeClientCoords(order.lat, order.lng);
  const orderedPickupIds = await orderPickupsByShortestRoad(pickupIds, client, locations);
  const pickups = orderedPickupIds.map(id => pickupCoord(id, locations));
  return {
    orderedPickupIds,
    points: dedupeRoutePoints([...pickups, client]),
  };
}

/** Синхронный список точек — кратчайший порядок по прямой (запасной вариант) */
export function buildOrderRoutePoints(
  order: RoadKmOrderInput,
  locations: PickupLocationMap = PICKUP_LOCATIONS
): { lat: number; lng: number }[] {
  const pickupIds = resolveRoutePickupIds(order);
  const client = normalizeClientCoords(order.lat, order.lng);
  const ordered = orderPickupsByShortestStraight(pickupIds, client, locations);
  const pickups = ordered.map(id => pickupCoord(id, locations));
  return dedupeRoutePoints([...pickups, client]);
}

/** Маршрут участок за участком: каждый отрезок — дорога или прямая (без объездов OSRM) */
async function fetchRouteByLegs(points: { lat: number; lng: number }[]): Promise<RouteResult> {
  if (points.length < 2) {
    return { distanceKm: 0, durationMin: 0, geometry: points.map(p => [p.lat, p.lng] as [number, number]) };
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
  const { points, orderedPickupIds } = await buildOrderRoutePointsAsync(order, locs);
  const route = await fetchRouteByLegs(points);
  return { ...route, orderedPickupIds };
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
  /**
   * Шаг веса для надбавки, кг.
   * Пример: 30 → первые 30 кг = weightFirstExtra, каждые следующие 30 кг = weightNextExtra.
   */
  weightStepKg: number;
  /** Надбавка за первый шаг веса (напр. первые 30 кг → 10 ЅМ) */
  weightFirstExtra: number;
  /** Надбавка за каждый следующий шаг веса (напр. +5 ЅМ) */
  weightNextExtra: number;
  /** @deprecated старый порог — мигрируется в weightStepKg при нормализации */
  heavyKg?: number;
  /** @deprecated старая разовая надбавка */
  heavyExtra?: number;
  freeFrom?: number;
  /** Комиссия платформы с курьера, % от стоимости доставки */
  courierCommissionPercent?: number;
}

export const DEFAULT_PRICING: PricingConfig = {
  base: 10,
  baseDist: 2.5,
  perKm: 3,
  weightStepKg: 30,
  weightFirstExtra: 10,
  weightNextExtra: 5,
  freeFrom: 0,
  courierCommissionPercent: 15,
};

/** Надбавка за вес: первый полный шаг — weightFirstExtra, каждый следующий полный — weightNextExtra.
 *  Считаем по полным блокам (floor), недобор до следующей ступени не тарифицируется.
 *  Пример (шаг 30, первые 10, далее 5): 120–149 кг → 10+5+5+5 = 25; 150 кг → 30.
 */
export function calcWeightSurcharge(weightKg: number, pricing: PricingConfig = DEFAULT_PRICING): number {
  let w = Math.max(0, Number(weightKg) || 0)
  if (w > 5000) w = w / 1000
  w = Math.round(w * 10) / 10
  if (w <= 0) return 0

  const step = Math.max(1, Number(pricing.weightStepKg) || DEFAULT_PRICING.weightStepKg)
  const first = Math.max(0, Number(pricing.weightFirstExtra ?? DEFAULT_PRICING.weightFirstExtra) || 0)
  const next = Math.max(0, Number(pricing.weightNextExtra ?? DEFAULT_PRICING.weightNextExtra) || 0)

  // Полные ступени: 30→1, 60→2, …, 120→4, 121→4, 150→5
  let blocks = Math.floor(w / step + 1e-9)
  if (blocks < 1) blocks = 1 // вес до первого полного шага — всё равно первая ступень
  return Math.round((first + Math.max(0, blocks - 1) * next) * 100) / 100
}

export function weightSurchargeLabel(weightKg: number, pricing: PricingConfig = DEFAULT_PRICING): string {
  const extra = calcWeightSurcharge(weightKg, pricing)
  if (extra <= 0) return ''
  const step = Math.max(1, Number(pricing.weightStepKg) || 30)
  const first = Math.max(0, Number(pricing.weightFirstExtra ?? 10) || 0)
  const next = Math.max(0, Number(pricing.weightNextExtra ?? 5) || 0)
  let w = Math.max(0, Number(weightKg) || 0)
  if (w > 5000) w = w / 1000
  w = Math.round(w * 10) / 10
  let blocks = Math.floor(w / step + 1e-9)
  if (blocks < 1) blocks = 1
  const bands = Array.from({ length: blocks }, (_, i) => (i === 0 ? first : next))
  return `⚖️ Вес ${w} кг (${blocks}×${step} кг): ${bands.join('+')} = +${extra} ЅМ`
}

export interface RouteResult {
  distanceKm: number;
  durationMin: number;
  /** координаты для Leaflet: [lat, lng][] */
  geometry: [number, number][];
  /** Оптимальный порядок точек забора (ближайший маршрут → клиент) */
  orderedPickupIds?: string[];
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
  fee += calcWeightSurcharge(weightKg, pricing);
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
  const weightExtra = calcWeightSurcharge(opts.weightKg, pricing);
  if (weightExtra > 0) {
    breakdown.push(weightSurchargeLabel(opts.weightKg, pricing));
  }

  const isFree = pricing.freeFrom != null && pricing.freeFrom > 0 && opts.orderAmount >= pricing.freeFrom;
  if (isFree) {
    breakdown.push(`✅ Бесплатная доставка от ${pricing.freeFrom} ЅМ`);
    return { total: 0, isFree: true, freeReason: `Заказ от ${pricing.freeFrom} ЅМ`, breakdown };
  }

  breakdown.push(`🚚 Итого доставка: ${total} ЅМ`);
  return { total, isFree: false, breakdown };
}
