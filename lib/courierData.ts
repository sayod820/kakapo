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

/** Точки маршрута ДОСТАВКИ: магазин → ресторан(ы) → клиент по дорогам (OSRM). Без курьера. */
export function buildOrderRoutePoints(
  order: RoadKmOrderInput,
  locations: PickupLocationMap = PICKUP_LOCATIONS
): { lat: number; lng: number }[] {
  const fallback = locations.store ?? { lat: STORE_LOCATION.lat, lng: STORE_LOCATION.lng, name: STORE_LOCATION.name };
  const pickupIds = resolveRoutePickupIds(order);
  const points = pickupIds.map(id => {
    const p = locations[id] ?? fallback;
    return { lat: p.lat, lng: p.lng };
  });
  points.push({ lat: order.lat, lng: order.lng });
  return points;
}

/** Полный маршрут доставки по дорогам (для карты и км) */
export async function fetchOrderDeliveryRoute(
  order: RoadKmOrderInput,
  locations?: PickupLocationMap
): Promise<RouteResult> {
  return fetchRoute(buildOrderRoutePoints(order, locations));
}

/** Точное расстояние заказа по дорогам (OSRM) */
export async function fetchOrderRoadKm(
  order: RoadKmOrderInput,
  locations?: PickupLocationMap
): Promise<number> {
  const route = await fetchRoute(buildOrderRoutePoints(order, locations));
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
        const pids = resolveRoutePickupIds(o);
        const points = buildOrderRoutePoints({ ...o, routePickupIds: pids }, locations);
        let totalKm = 0;
        for (let i = 1; i < points.length; i++) {
          totalKm += calcDistanceKm(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
        }
        return [o.id, roundRouteKm(totalKm * 1.25)] as const;
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

/** Маршрут по дорогам через OSRM (OpenStreetMap, бесплатно) */
export async function fetchRoute(
  points: { lat: number; lng: number }[]
): Promise<RouteResult> {
  if (points.length < 2) {
    return { distanceKm: 0, durationMin: 0, geometry: points.map(p => [p.lat, p.lng]) };
  }
  const coordStr = points.map(p => `${p.lng},${p.lat}`).join(';');
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson&steps=false`,
      { signal: ctrl.signal }
    );
    clearTimeout(tid);
    const data = await res.json();
    if (data.code !== 'Ok' || !data.routes?.[0]) throw new Error('no route');
    const route = data.routes[0];
    const geometry: [number, number][] = route.geometry.coordinates.map(
      (c: [number, number]) => [c[1], c[0]]
    );
    return {
      distanceKm: route.distance / 1000,
      durationMin: Math.round(route.duration / 60),
      geometry,
    };
  } catch {
    /* fallback: прямая линия между точками */
    let totalKm = 0;
    const geometry: [number, number][] = [];
    for (let i = 0; i < points.length; i++) {
      geometry.push([points[i].lat, points[i].lng]);
      if (i > 0) {
        totalKm += calcDistanceKm(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
      }
    }
    return {
      distanceKm: totalKm * 1.25,
      durationMin: Math.round(totalKm * 3),
      geometry,
    };
  }
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
