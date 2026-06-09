/* ══════════════════════════════════════════════════════
   KAKAPO — точки забора (общие для всех приложений)
══════════════════════════════════════════════════════ */

export interface PickupPoint {
  id: string;
  type: 'store' | 'rest';
  e: string;
  color: string;
  name: string;
  addr: string;
  phone: string;
  lat: number;
  lng: number;
  active: boolean;
}

export type PickupLocationMap = Record<string, { lat: number; lng: number; name: string }>;

export const DEFAULT_PICKUPS: PickupPoint[] = [
  { id: 'store', type: 'store', e: '🏪', color: '#1FD760', name: 'KAKAPO Магазин', addr: 'ул. Ленина, 42', phone: '+992 11 855-97-97', lat: 38.3250, lng: 69.0250, active: true },
  { id: 'rest1', type: 'rest', e: '🍖', color: '#FF8C00', name: 'Чайхона Оромгох', addr: 'ул. Рудаки, 15', phone: '+992 93 111-22-33', lat: 38.3320, lng: 69.0150, active: true },
  { id: 'rest2', type: 'rest', e: '🍕', color: '#FF4545', name: 'Пицца Яван', addr: 'ул. Ленина, 28', phone: '+992 90 222-33-44', lat: 38.3230, lng: 69.0300, active: true },
  { id: 'rest3', type: 'rest', e: '🍣', color: '#3B8EF0', name: 'Суши Яван', addr: 'ул. Сомони, 8', phone: '+992 91 333-44-55', lat: 38.3150, lng: 69.0320, active: true },
  { id: 'rest4', type: 'rest', e: '🍟', color: '#FFB800', name: 'Фаст-фуд 24/7', addr: 'Центральный рынок', phone: '+992 88 444-55-66', lat: 38.3280, lng: 69.0200, active: false },
];

/** R-01 … R-04 → pickup id (магазин / рестораны) */
export const REST_ID_TO_PICKUP: Record<string, string> = {
  'R-01': 'rest1',
  'R-02': 'rest2',
  'R-03': 'rest3',
  'R-04': 'rest4',
};

/** ID точки забора для ресторана (R-05 → rest5) */
export function restIdToPickupId(restId: string): string {
  return REST_ID_TO_PICKUP[restId] ?? `rest${restId.replace(/^R-0?/, '')}`;
}

export interface RestaurantPickupSync {
  restId: string;
  e: string;
  name: string;
  addr: string;
  phone: string;
  lat: number;
  lng: number;
  active: boolean;
  color?: string;
}

/** Обновить или создать точку забора ресторана из карточки партнёра */
export function upsertRestaurantPickup(pickups: PickupPoint[], data: RestaurantPickupSync): PickupPoint[] {
  const id = restIdToPickupId(data.restId);
  const existing = pickups.find(p => p.id === id);
  const color = data.color ?? existing?.color ?? '#FF8C00';
  const row: PickupPoint = {
    id,
    type: 'rest',
    e: data.e,
    color,
    name: data.name,
    addr: data.addr,
    phone: data.phone,
    lat: data.lat,
    lng: data.lng,
    active: data.active,
  };
  if (existing) return pickups.map(p => (p.id === id ? row : p));
  return [...pickups, row];
}

export function removeRestaurantPickup(pickups: PickupPoint[], restId: string): PickupPoint[] {
  const id = restIdToPickupId(restId);
  return pickups.filter(p => p.id !== id);
}

export function pickupsToLocationMap(pickups: PickupPoint[]): PickupLocationMap {
  return Object.fromEntries(
    pickups.filter(p => p.active).map(p => [p.id, { lat: p.lat, lng: p.lng, name: p.name }])
  );
}

export function getPickupById(pickups: PickupPoint[], id: string): PickupPoint | undefined {
  return pickups.find(p => p.id === id);
}

/** Точки забора для корзины: магазин + рестораны из заказа */
export function resolveCheckoutPickupIds(opts: {
  hasMarketItems: boolean;
  restIds: string[];
}): string[] {
  const ids: string[] = [];
  if (opts.hasMarketItems) ids.push('store');
  for (const rid of opts.restIds) {
    const pid = restIdToPickupId(rid);
    if (pid && !ids.includes(pid)) ids.push(pid);
  }
  return ids.length ? ids : ['store'];
}
