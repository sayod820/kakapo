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
  { id: 'store', type: 'store', e: '🏪', color: '#1FD760', name: 'KAKAPO Магазин', addr: 'ул. Ленина, 42', phone: '+992 11 855-97-97', lat: 38.325, lng: 69.025, active: true },
  { id: 'rest1', type: 'rest', e: '🍖', color: '#FF8C00', name: 'Чайхона Оромгох', addr: 'ул. Рудаки, 15', phone: '+992 93 111-22-33', lat: 38.332, lng: 69.015, active: true },
  { id: 'rest2', type: 'rest', e: '🍕', color: '#FF4545', name: 'Пицца Яван', addr: 'ул. Ленина, 28', phone: '+992 90 222-33-44', lat: 38.323, lng: 69.03, active: true },
  { id: 'rest3', type: 'rest', e: '🍣', color: '#3B8EF0', name: 'Суши Яван', addr: 'ул. Сомони, 8', phone: '+992 91 333-44-55', lat: 38.315, lng: 69.032, active: true },
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
  db.users = [
    { id: 1, email: 'admin@kakapo.tj', password: 'admin123', role: 'admin', name: 'Админ KAKAPO' },
    { id: 2, email: 'chaihona@kakapo.tj', password: 'rest123', role: 'restaurant', name: 'Чайхона' },
    { id: 3, email: 'pizza@kakapo.tj', password: 'rest123', role: 'restaurant', name: 'Пицца Яван' },
  ]
  db.categories = [
    { id: 1, name: 'Овощи и фрукты', slug: 'veg', parent_id: null },
    { id: 2, name: 'Мясо', slug: 'meat', parent_id: null },
  ]
  db.promos = DEFAULT_PROMOS.map(p => ({ ...p }))
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
