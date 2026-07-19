/* ══════════════════════════════════════════════════════
   KAKAPO — демо-заказы курьера (единый источник)
══════════════════════════════════════════════════════ */

export interface DemoCourierOrder {
  id: string;
  pickupIds: string[];
  /** Все точки маршрута для расчёта км (забор → клиент) */
  routePickupIds?: string[];
  /** Точки для карты (только готовые к забору) */
  mapPickupIds?: string[];
  /** Км из оформления заказа (fallback до OSRM) */
  distanceKm?: number;
  mixed?: boolean;
  pendingParts?: { pickupId: string; label: string; status: string }[];
  pickedUpIds?: string[];
  client: string;
  phone: string;
  addr: string;
  lat: number;
  lng: number;
  weight: number;
  pay: string;
  /** cash | card | credit */
  paymentMethod?: string;
  /** Товары в долг (VIP-кредит) */
  creditAmount?: number;
  /** Наличными у клиента (доставка или весь заказ) */
  cashDue?: number;
  time: string;
  sum: number;
  /** Стоимость доставки, зафиксированная при оформлении — не меняется по факту маршрута */
  deliveryFee?: number;
  deliveryFeeLocked?: boolean;
  items: { e: string; n: string; q: number; p: number; source?: string; photo?: string }[];
  /** waiting — ещё не собирается; preparing — готовится; ready — можно забирать */
  mapStatus?: 'waiting' | 'preparing' | 'ready';
  /** market | restaurant | mixed — для подписей и цветов на карте */
  orderKind?: 'market' | 'restaurant' | 'mixed';
}

export interface DemoAdminCourierOrder extends DemoCourierOrder {
  courier: string;
  step: 'new' | 'toPickup' | 'toClient' | 'done';
  pickupIdx: number;
}

/** Все доступные заказы для курьера — км и доставка считаются через OSRM + тариф */
export const DEMO_COURIER_ORDERS: DemoCourierOrder[] = [
  { id: 'K-4831', mapStatus: 'ready', pickupIds: ['store'], client: 'Нилуфар Хасанова', phone: '+992 90 123-45-67', addr: 'ул. Сомони, 12', lat: 38.3160, lng: 69.0340, weight: 8.5, pay: 'Наличными', time: '14:23', sum: 46.40, items: [{ e: '🥛', n: 'Молоко', q: 2, p: 4.90 }, { e: '🧀', n: 'Сыр', q: 1, p: 18.5 }, { e: '☕', n: 'Кофе', q: 1, p: 18.0 }] },
  { id: 'K-4835', mapStatus: 'ready', pickupIds: ['store'], client: 'Рустам Давлатов', phone: '+992 91 445-23-11', addr: 'мкр. Мирный, 5', lat: 38.3350, lng: 69.0220, weight: 2.0, pay: 'Наличными', time: '14:10', sum: 18.90, items: [{ e: '🥦', n: 'Брокколи', q: 2, p: 5.50 }, { e: '🍅', n: 'Томаты', q: 1, p: 7.90 }] },
  { id: 'K-4837', mapStatus: 'ready', pickupIds: ['rest1'], client: 'Мадина Олимова', phone: '+992 93 321-65-43', addr: 'ул. Ленина, 18', lat: 38.3260, lng: 69.0280, weight: 1.2, pay: 'Картой', time: '14:05', sum: 58.00, items: [{ e: '🍚', n: 'Плов', q: 2, p: 18.0 }, { e: '🥩', n: 'Шашлык', q: 1, p: 22.0 }] },
  { id: 'K-4838', mapStatus: 'ready', pickupIds: ['rest2', 'store'], routePickupIds: ['store', 'rest2'], client: 'Зафар Мирзоев', phone: '+992 88 789-01-23', addr: 'ул. Рудаки, 8', lat: 38.3300, lng: 69.0180, weight: 1.2, pay: 'Наличными', time: '13:58', sum: 70.00, items: [{ e: '🍕', n: 'Пепперони', q: 1, p: 32.0 }, { e: '🍕', n: 'Маргарита', q: 1, p: 28.0 }, { e: '🥤', n: 'Сок', q: 2, p: 5.0 }] },
  { id: 'K-4840', mapStatus: 'ready', pickupIds: ['rest3'], client: 'Бахром Камолов', phone: '+992 93 555-12-34', addr: 'ул. Навои, 3', lat: 38.3200, lng: 69.0280, weight: 0.6, pay: 'Картой', time: '13:45', sum: 68.00, items: [{ e: '🌯', n: 'Филадельфия', q: 2, p: 32.0 }, { e: '🌯', n: 'Дракон', q: 1, p: 36.0 }] },
  { id: 'K-4841', mapStatus: 'ready', pickupIds: ['rest4', 'store'], routePickupIds: ['store', 'rest4'], client: 'Гулнора Садиева', phone: '+992 90 888-44-21', addr: 'мкр. Садовый, 7', lat: 38.3380, lng: 69.0240, weight: 0.9, pay: 'Наличными', time: '13:40', sum: 34.00, items: [{ e: '🍔', n: 'Бургер', q: 1, p: 16.0 }, { e: '🌭', n: 'Хот-дог', q: 1, p: 8.0 }, { e: '🥤', n: 'Напиток', q: 2, p: 5.0 }] },
  { id: 'K-4843', mapStatus: 'ready', pickupIds: ['rest1', 'rest2', 'store'], routePickupIds: ['store', 'rest1', 'rest2'], client: 'Нозим Тошматов', phone: '+992 92 777-11-22', addr: 'ул. Навои, 14', lat: 38.3190, lng: 69.0260, weight: 2.4, pay: 'Картой', time: '13:30', sum: 112.00, items: [{ e: '🍖', n: 'Плов большой', q: 1, p: 28.0 }, { e: '🍕', n: 'Пицца', q: 1, p: 32.0 }, { e: '🥛', n: 'Молоко', q: 2, p: 4.9 }, { e: '🧃', n: 'Сок', q: 3, p: 14.0 }] },
  { id: 'K-4845', mapStatus: 'waiting', pickupIds: [], routePickupIds: ['rest1'], client: 'Дилovar Р.', phone: '+992 93 456-78-90', addr: 'ул. Ленина, 42', lat: 38.3280, lng: 69.0310, weight: 1.5, pay: 'Наличными', time: '14:30', sum: 42.00, items: [{ e: '🍚', n: 'Плов', q: 2, p: 18.0 }] },
  { id: 'K-4846', mapStatus: 'waiting', pickupIds: [], routePickupIds: ['store'], client: 'Сабина К.', phone: '+992 90 111-22-33', addr: 'ул. Сомони, 5', lat: 38.3220, lng: 69.0190, weight: 3.2, pay: 'Наличными', time: '14:28', sum: 28.50, items: [{ e: '🥦', n: 'Брокколи', q: 1, p: 5.5 }, { e: '🥩', n: 'Говядина', q: 1, p: 38.0 }] },
];

/** Активные заказы для админки — те же координаты и pickupIds */
export const DEMO_ADMIN_COURIER_ORDERS: DemoAdminCourierOrder[] = [
  { ...DEMO_COURIER_ORDERS[0], courier: 'Фирдавс Н.', step: 'toPickup', pickupIdx: 0 },
  { ...DEMO_COURIER_ORDERS[3], courier: 'Рустам Х.', step: 'toPickup', pickupIdx: 1 },
  { ...DEMO_COURIER_ORDERS[4], courier: 'Баходур К.', step: 'toClient', pickupIdx: 0 },
  { ...DEMO_COURIER_ORDERS[6], courier: '—', step: 'new', pickupIdx: 0 },
];

export const DEMO_COURIER_HISTORY = [
  { id: 'K-4820', client: 'Лола М.', addr: 'ул. Ленина 5', time: '13:20', rating: 5 },
  { id: 'K-4815', client: 'Бахром К.', addr: 'мкр. Мирный 12', time: '12:45', rating: 5 },
  { id: 'K-4810', client: 'Зубайр Р.', addr: 'ул. Сомони 8', time: '12:10', rating: 4 },
  { id: 'K-4805', client: 'Сабрина Н.', addr: 'ул. Рудаки 22', time: '11:30', rating: 5 },
];
