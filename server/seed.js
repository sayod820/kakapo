import { loadDb, saveDb } from './db.js'

const PRODUCTS = [
  { id: 1, art: 'KAK-0001', e: '🥦', name: 'Брокколи свежая', price: 5.5, cat: 'Овощи', catId: 'veg', unit: '500 гр', stock: 8, hot: true },
  { id: 2, art: 'KAK-0002', e: '🍅', name: 'Томаты черри', price: 7.9, cat: 'Овощи', catId: 'veg', unit: '400 гр', stock: 3, hot: false },
  { id: 3, art: 'KAK-0003', e: '🍊', name: 'Апельсины Навел', price: 6.5, cat: 'Фрукты', catId: 'veg', unit: '1 кг', stock: 15, hot: true },
  { id: 4, art: 'KAK-0004', e: '🥩', name: 'Говядина вырезка', price: 38, cat: 'Мясо', catId: 'meat', unit: '500 гр', stock: 5, hot: true },
  { id: 5, art: 'KAK-0005', e: '🍗', name: 'Куриное филе', price: 16.5, cat: 'Мясо', catId: 'meat', unit: '1 kg', stock: 12, hot: true },
  { id: 6, art: 'KAK-0006', e: '🥛', name: 'Молоко 3.2%', price: 4.9, cat: 'Молочное', catId: 'dairy', unit: '1 л', stock: 0, hot: false },
  { id: 7, art: 'KAK-0007', e: '🧀', name: 'Сыр Российский', price: 18.5, cat: 'Молочное', catId: 'dairy', unit: '250 гр', stock: 7, hot: true },
  { id: 8, art: 'KAK-0008', e: '🥐', name: 'Круассан с шоколадом', price: 2.5, cat: 'Выпечка', catId: 'bread', unit: '1 шт', stock: 2, hot: true },
  { id: 9, art: 'KAK-0009', e: '🥚', name: 'Яйца С1', price: 8.9, cat: 'Молочное', catId: 'dairy', unit: '10 шт', stock: 15, hot: true },
  { id: 10, art: 'KAK-0010', e: '☕', name: 'Кофе Nescafé Gold', price: 28, cat: 'Напитки', catId: 'drinks', unit: '190 гр', stock: 7, hot: true },
  { id: 11, art: 'KAK-0011', e: '🧃', name: 'Сок апельсиновый', price: 6.8, cat: 'Напитки', catId: 'drinks', unit: '1 л', stock: 18, hot: false },
  { id: 12, art: 'KAK-0012', e: '🍫', name: 'Шоколад Milka', price: 6.5, cat: 'Сладости', catId: 'sweets', unit: '90 гр', stock: 10, hot: true },
]

const RESTAURANTS = [
  { id: 'R-01', name: 'Чайхона Оромгох', emoji: '🍖', cuisine: 'Таджикская', address: 'ул. Рудаки, 15', phone: '+992 93 111 22 33', email: 'chaihona@kakapo.tj', commission: 15, open: true, rating: 4.8, reviews: 312, ordersMonth: 187, revenueMonth: 8450, img: 'linear-gradient(135deg,#2A1506,#4A2A0C)', menu: [
    { id: 1, cat: 'Горячее', e: '🍚', name: 'Плов узбекский', price: 18, inStock: true, popular: true },
    { id: 2, cat: 'Шашлык', e: '🥩', name: 'Шашлык говяжий', price: 22, inStock: true, popular: true },
    { id: 3, cat: 'Супы', e: '🍲', name: 'Шурпо', price: 12, inStock: true, popular: true },
  ]},
  { id: 'R-02', name: 'Пицца Яван', emoji: '🍕', cuisine: 'Итальянская', address: 'ул. Ленина, 28', phone: '+992 90 222 33 44', email: 'pizza@kakapo.tj', commission: 18, open: true, rating: 4.6, reviews: 187, ordersMonth: 143, revenueMonth: 6240, img: 'linear-gradient(135deg,#1A0808,#3A1010)', menu: [
    { id: 1, cat: 'Пицца', e: '🍕', name: 'Маргарита', price: 28, inStock: true, popular: true },
    { id: 2, cat: 'Пицца', e: '🍕', name: 'Пепперони', price: 32, inStock: true, popular: true },
  ]},
  { id: 'R-03', name: 'Суши Яван', emoji: '🍣', cuisine: 'Японская', address: 'ул. Сомони, 8', phone: '+992 91 333 44 55', email: 'sushi@kakapo.tj', commission: 20, open: true, rating: 4.9, reviews: 94, ordersMonth: 98, revenueMonth: 5390, img: 'linear-gradient(135deg,#0A0A1A,#1A1A3A)', menu: [
    { id: 1, cat: 'Роллы', e: '🌯', name: 'Филадельфия', price: 32, inStock: true, popular: true },
  ]},
  { id: 'R-04', name: 'Фаст-фуд 24/7', emoji: '🍟', cuisine: 'Фаст-фуд', address: 'Центральный рынок', phone: '+992 88 444 55 66', email: 'fastfood@kakapo.tj', commission: 12, open: false, rating: 4.3, reviews: 521, ordersMonth: 312, revenueMonth: 4120, img: 'linear-gradient(135deg,#1A1000,#3A2200)', menu: [
    { id: 1, cat: 'Бургеры', e: '🍔', name: 'Двойной бургер', price: 16, inStock: true, popular: true },
  ]},
]

const PICKUPS = [
  { id: 'store', type: 'store', e: '🏪', color: '#1FD760', name: 'КАКАПО Магазин', addr: 'ул. Ленина, 42', phone: '+992 11 855-97-97', lat: 38.325, lng: 69.025, active: true },
  { id: 'rest1', type: 'rest', e: '🍖', color: '#FF8C00', name: 'Чайхона Оромгох', addr: 'ул. Рудаки, 15', phone: '+992 93 111-22-33', lat: 38.332, lng: 69.015, active: true },
  { id: 'rest2', type: 'rest', e: '🍕', color: '#FF4545', name: 'Пицца Яван', addr: 'ул. Ленина, 28', phone: '+992 90 222-33-44', lat: 38.323, lng: 69.03, active: true },
  { id: 'rest3', type: 'rest', e: '🍣', color: '#3B8EF0', name: 'Суши Яван', addr: 'ул. Сомони, 8', phone: '+992 91 333-44-55', lat: 38.315, lng: 69.032, active: true },
]

export const COURIERS = [
  { id: 'C-01', name: 'Фирдавс Назаров', phone: '+992 93 111 22 33', vehicle: 'moto', num: 'TJ 1234 AA', status: 'busy', rating: 4.9, orders: 342, today: 42, week: 310, maxActiveOrders: 1, blocked: false, otp: '1234' },
  { id: 'C-02', name: 'Баходур Кодиров', phone: '+992 90 222 33 44', vehicle: 'bike', num: '—', status: 'available', rating: 4.7, orders: 187, today: 28, week: 195, maxActiveOrders: 1, blocked: false, otp: '1234' },
  { id: 'C-03', name: 'Рустам Холов', phone: '+992 91 333 44 55', vehicle: 'car', num: 'TJ 5678 BB', status: 'available', rating: 4.8, orders: 521, today: 56, week: 420, maxActiveOrders: 2, blocked: false, otp: '1234' },
  { id: 'C-04', name: 'Зубайр Рахимов', phone: '+992 88 444 55 66', vehicle: 'moto', num: 'TJ 9012 CC', status: 'offline', rating: 4.6, orders: 98, today: 0, week: 145, maxActiveOrders: 1, blocked: false, otp: '1234' },
]

export const ASSEMBLERS = [
  { id: 'A-01', name: 'Камола Юсупова', phone: '+992 93 500 11 22', status: 'working', ordersToday: 12, ordersTotal: 840, week: 56, avgTimeMin: 7, rating: 4.9, blocked: false, otp: '5678' },
  { id: 'A-02', name: 'Шахло Рахимова', phone: '+992 93 500 33 44', status: 'available', ordersToday: 8, ordersTotal: 612, week: 41, avgTimeMin: 9, rating: 4.7, blocked: false, otp: '5678' },
  { id: 'A-03', name: 'Зарина Холова', phone: '+992 93 500 55 66', status: 'offline', ordersToday: 0, ordersTotal: 290, week: 0, avgTimeMin: 8, rating: 4.5, blocked: false, otp: '5678' },
]

export const DEFAULT_CLIENTS = [
  { id: 'U-01', name: 'Диловар Рахимов', phone: '+992 93 456 78 90', email: '', addr: 'ул. Ленина, 42', card: 'КАКАПО-0001', level: 'platinum', orders: 87, spent: 3420, debt: 1200, bonus: 4850, debtLimit: 3000, blocked: false, createdAt: '2024-01-12' },
  { id: 'U-02', name: 'Нилуфар Хасанова', phone: '+992 90 123 45 67', email: '', addr: 'ул. Сомони, 12', card: 'КАКАПО-0042', level: 'gold', orders: 43, spent: 1890, debt: 0, bonus: 1240, debtLimit: 1000, blocked: false, createdAt: '2024-03-05' },
  { id: 'U-03', name: 'Бахром Каримов', phone: '+992 88 789 01 23', email: '', addr: 'мкр. Мирный, 5', card: 'КАКАПО-0118', level: 'silver', orders: 28, spent: 980, debt: 0, bonus: 560, debtLimit: 0, blocked: false, createdAt: '2024-06-18' },
  { id: 'U-04', name: 'Зафар Мирзоев', phone: '+992 91 654 32 10', email: '', addr: 'ул. Рудаки, 8', card: 'КАКАПО-0234', level: 'gold', orders: 56, spent: 2340, debt: 4500, bonus: 2100, debtLimit: 2000, blocked: false, createdAt: '2023-11-02' },
  { id: 'U-05', name: 'Мадина Оразова', phone: '+992 93 321 65 43', email: '', addr: 'ул. Ленина, 18', card: '', level: 'silver', orders: 12, spent: 640, debt: 0, bonus: 120, debtLimit: 0, blocked: false, createdAt: '2025-01-20' },
  { id: 'U-06', name: 'Рустам Давлатов', phone: '+992 90 445 23 11', email: '', addr: 'ул. Сомони, 5', card: 'КАКАПО-0055', level: 'gold', orders: 34, spent: 1560, debt: 0, bonus: 890, debtLimit: 0, blocked: true, createdAt: '2024-08-09', note: 'Злоупотребление возвратами' },
  { id: 'U-07', name: 'Сайёд Гафуров', phone: '+992 50 190 31 41', email: '', addr: '', card: 'KAKAPO-0236', level: 'silver', orders: 0, spent: 0, debt: 0, bonus: 100, debtLimit: 0, blocked: false, createdAt: '2025-06-01' },
]

export const DEFAULT_CARDS = [
  { num: 'КАКАПО-0001', client: 'Диловар Рахимов', phone: '+992 93 456 78 90', status: 'active', level: 'platinum', bonus: 4850, debtLimit: 3000, debt: 1200 },
  { num: 'КАКАПО-0042', client: 'Нилуфар Хасанова', phone: '+992 90 123 45 67', status: 'active', level: 'gold', bonus: 1240, debtLimit: 1000, debt: 0 },
  { num: 'КАКАПО-0118', client: 'Бахром Каримов', phone: '+992 88 789 01 23', status: 'active', level: 'silver', bonus: 560, debtLimit: 0, debt: 0 },
  { num: 'КАКАПО-0099', client: '', phone: '', status: 'unlinked', level: '', bonus: 0, debtLimit: 0, debt: 0 },
  { num: 'КАКАПО-0234', client: 'Зафар Мирзоев', phone: '+992 91 654 32 10', status: 'active', level: 'gold', bonus: 2100, debtLimit: 2000, debt: 4500 },
  { num: 'КАКАПО-0055', client: 'Рустам Давлатов', phone: '+992 90 445 23 11', status: 'blocked', level: 'gold', bonus: 890, debtLimit: 0, debt: 0 },
  { num: 'KAKAPO-0236', client: 'Сайёд Гафуров', phone: '+992 50 190 31 41', status: 'active', level: 'silver', bonus: 100, debtLimit: 0, debt: 0, clientId: 'U-07' },
]

export const DEFAULT_REVIEWS = [
  { id: 1, restId: 'R-01', restName: 'Чайхона Оромгох', client: 'Зафар М.', rating: 2, text: 'Долго ждали, еда была холодная', date: '16 мая', status: 'new', restSeen: false, restNotified: true, urgent: true, orderId: '' },
  { id: 2, restId: 'R-02', restName: 'Пицца Яван', client: 'Лола К.', rating: 5, text: 'Отличная пицца! Быстро доставили', date: '15 мая', status: 'read', restSeen: true, restNotified: true, urgent: false, orderId: '' },
  { id: 3, restId: 'R-01', restName: 'Чайхона Оромгох', client: 'Нилуфар С.', rating: 1, text: 'Неправильный заказ привезли', date: '14 мая', status: 'new', restSeen: false, restNotified: true, urgent: true, orderId: '' },
  { id: 4, restId: 'R-03', restName: 'Суши Яван', client: 'Бахром Т.', rating: 4, text: 'Вкусные роллы, но немного дорого', date: '13 мая', status: 'read', restSeen: true, restNotified: true, urgent: false, orderId: '' },
]

export const DEFAULT_PROMOS = [
  { id: 1, e: '🥛', title: 'Молочная среда', sub: 'Скидка 30% на молочное', disc: 30, on: true, cat: 'Магазин', type: 'pct', from: '08:00', to: '22:00', till: 'Среда' },
  { id: 2, e: '🥩', title: 'Мясные выходные', sub: 'Скидка 25% на мясо и птицу', disc: 25, on: true, cat: 'Магазин', type: 'pct', from: '08:00', to: '22:00', till: 'Сб–Вс' },
  { id: 3, e: '🥦', title: 'Органик-день', sub: 'Скидка 20% на органик продукты', disc: 20, on: false, cat: 'Магазин', type: 'pct', from: '08:00', to: '22:00', till: 'Пятница' },
  { id: 4, e: '⚡', title: 'Флэш-распродажа', sub: 'Только до 20:00 сегодня', disc: 40, on: true, cat: 'Магазин', type: 'pct', from: '08:00', to: '20:00', till: 'Сегодня' },
  { id: 5, e: '🚀', title: 'Бесплатная доставка', sub: 'При заказе от 30 ЅМ', disc: 0, on: true, cat: 'Магазин', type: 'free', from: '08:00', to: '22:00', till: 'Всегда' },
  { id: 6, e: '🍽', title: 'Скидка в ресторанах', sub: '10% в Чайхоне и Суши', disc: 10, on: false, cat: 'Рестораны', type: 'pct', from: '10:00', to: '23:00', till: 'Всегда' },
  { id: 7, e: '🎁', title: 'Первый заказ', sub: '15% скидка на первый заказ', disc: 15, on: true, cat: 'Магазин', type: 'first', from: '00:00', to: '23:59', till: 'Всегда' },
]

export function seedIfEmpty() {
  const db = loadDb()
  if (db.products.length) return db

  db.products = PRODUCTS
  db.restaurants = RESTAURANTS
  db.pickups = PICKUPS
  db.couriers = COURIERS.map(c => ({ ...c }))
  db.assemblers = ASSEMBLERS.map(a => ({ ...a }))
  db.clients = DEFAULT_CLIENTS.map(c => ({ ...c }))
  db.cards = DEFAULT_CARDS.map(c => ({ ...c }))
  db.users = [
    { id: 1, email: 'admin@kakapo.tj', password: 'admin123', role: 'admin', name: 'Админ КАКАПО' },
    { id: 2, email: 'chaihona@kakapo.tj', password: 'rest123', role: 'restaurant', name: 'Чайхона' },
    { id: 3, email: 'pizza@kakapo.tj', password: 'rest123', role: 'restaurant', name: 'Пицца Яван' },
  ]
  db.categories = [
    { id: 1, name: 'Овощи и фрукты', slug: 'veg', parent_id: null },
    { id: 2, name: 'Мясо', slug: 'meat', parent_id: null },
  ]
  db.promos = DEFAULT_PROMOS.map(p => ({ ...p }))
  db.reviews = DEFAULT_REVIEWS.map(r => ({ ...r }))
  db._seq.review = DEFAULT_REVIEWS.length
  db.orders = [{
    id: 'K-4832', type: 'market', status: 'assembling', createdAt: '14:23', total: 64.3, deliveryFee: 0, comment: '',
    client: { name: 'Диловар', phone: '+992 93 456 78 90', addr: 'ул. Ленина, 42' },
    items: [{ id: 1, art: 'KAK-0001', e: '🥦', name: 'Брокколи', qty: 2, unit: '500 гр', price: 5.5, source: 'market' }],
    priority: 'normal',
  }]
  db._seq.order = 4832
  db._seq.promo = 7
  saveDb()
  return db
}

export function nextOrderId(db) {
  db._seq.order += 1
  return `K-${db._seq.order}`
}
