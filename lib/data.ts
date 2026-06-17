import type { Order, Product, Restaurant, Courier, Assembler, Client } from './types'

// ── РЕСТОРАНЫ ────────────────────────────────────
export const RESTAURANTS: Restaurant[] = [
  { id:'R-01', name:'Чайхона Оромгох', emoji:'🍖', cuisine:'Таджикская', address:'ул. Рудаки, 15', phone:'+992 93 111 22 33', email:'chaihona@kakapo.tj', commission:15, open:true, rating:4.8, reviews:312, ordersMonth:187, revenueMonth:8450, img:'linear-gradient(135deg,#2A1506,#4A2A0C)',
    menu:[
      {id:1,cat:'Горячее',e:'🍚',name:'Плов узбекский',   desc:'Рис, мясо, морковь',price:18,inStock:true, popular:true},
      {id:2,cat:'Шашлык', e:'🥩',name:'Шашлык говяжий',  desc:'Говядина на углях',  price:22,inStock:true, popular:true},
      {id:3,cat:'Супы',   e:'🍲',name:'Шурпо',            desc:'Суп из баранины',    price:12,inStock:true, popular:true},
      {id:4,cat:'Супы',   e:'🍜',name:'Лагман',           desc:'Лапша с мясом',      price:14,inStock:false,popular:true},
      {id:5,cat:'Горячее',e:'🥟',name:'Манты',            desc:'6 шт, говядина+лук', price:16,inStock:true, popular:true},
    ]},
  { id:'R-02', name:'Пицца Яван', emoji:'🍕', cuisine:'Итальянская', address:'ул. Ленина, 28', phone:'+992 90 222 33 44', email:'pizza@kakapo.tj', commission:18, open:true, rating:4.6, reviews:187, ordersMonth:143, revenueMonth:6240, img:'linear-gradient(135deg,#1A0808,#3A1010)',
    menu:[
      {id:1,cat:'Пицца',  e:'🍕',name:'Маргарита',         desc:'Томат, моцарелла', price:28,inStock:true, popular:true},
      {id:2,cat:'Пицца',  e:'🍕',name:'Пепперони',         desc:'Томат, пепперони', price:32,inStock:true, popular:true},
      {id:3,cat:'Бургеры',e:'🍔',name:'Классик бургер',    desc:'Котлета 150г',     price:22,inStock:true, popular:false},
    ]},
  { id:'R-03', name:'Суши Яван', emoji:'🍣', cuisine:'Японская', address:'ул. Сомони, 8', phone:'+992 91 333 44 55', email:'sushi@kakapo.tj', commission:20, open:true, rating:4.9, reviews:94, ordersMonth:98, revenueMonth:5390, img:'linear-gradient(135deg,#0A0A1A,#1A1A3A)',
    menu:[
      {id:1,cat:'Роллы',e:'🌯',name:'Филадельфия',desc:'Лосось, авокадо',price:32,inStock:true,popular:true},
      {id:2,cat:'Роллы',e:'🌯',name:'Дракон',     desc:'Угорь, авокадо', price:36,inStock:true,popular:true},
    ]},
  { id:'R-04', name:'Фаст-фуд 24/7', emoji:'🍟', cuisine:'Фаст-фуд', address:'Центральный рынок', phone:'+992 88 444 55 66', email:'fastfood@kakapo.tj', commission:12, open:false, rating:4.3, reviews:521, ordersMonth:312, revenueMonth:4120, img:'linear-gradient(135deg,#1A1000,#3A2200)',
    menu:[
      {id:1,cat:'Бургеры', e:'🍔',name:'Двойной бургер',desc:'2 котлеты, сыр',price:16,inStock:true,popular:true},
      {id:2,cat:'Хот-доги',e:'🌭',name:'Хот-дог',       desc:'Сосиска, горчица',price:8,inStock:true,popular:true},
    ]},
]

// ── ТОВАРЫ ───────────────────────────────────────
export const PRODUCTS: Product[] = [
  {id:1, art:'KAK-0001',e:'🥦',name:'Брокколи свежая',    price:5.50, old:7.20, cat:'Овощи',   catId:'veg',   unit:'500 гр',stock:8, hot:true, organic:true, discount:24},
  {id:2, art:'KAK-0002',e:'🍅',name:'Томаты черри',        price:7.90, old:null, cat:'Овощи',   catId:'veg',   unit:'400 гр',stock:3, hot:false,organic:false,discount:0},
  {id:3, art:'KAK-0003',e:'🍊',name:'Апельсины Навел',     price:6.50, old:8.90, cat:'Фрукты',  catId:'veg',   unit:'1 кг',  stock:15,hot:true, organic:false,discount:27},
  {id:4, art:'KAK-0004',e:'🥩',name:'Говядина вырезка',    price:38.0, old:47.0, cat:'Мясо',    catId:'meat',  unit:'500 гр',stock:5, hot:true, organic:false,discount:19},
  {id:5, art:'KAK-0005',e:'🍗',name:'Куриное филе',        price:16.5, old:null, cat:'Мясо',    catId:'meat',  unit:'1 кг',  stock:12,hot:true, organic:false,discount:0},
  {id:6, art:'KAK-0006',e:'🥛',name:'Молоко 3.2%',         price:4.90, old:null, cat:'Молочное',catId:'dairy', unit:'1 л',   stock:0, hot:false,organic:false,discount:0},
  {id:7, art:'KAK-0007',e:'🧀',name:'Сыр Российский',      price:18.5, old:null, cat:'Молочное',catId:'dairy', unit:'250 гр',stock:7, hot:true, organic:false,discount:0},
  {id:8, art:'KAK-0008',e:'🥐',name:'Круассан с шоколадом',price:2.50, old:null, cat:'Выпечка', catId:'bread', unit:'1 шт',  stock:2, hot:true, organic:false,discount:0},
  {id:9, art:'KAK-0009',e:'🥚',name:'Яйца С1',             price:8.90, old:null, cat:'Молочное',catId:'dairy', unit:'10 шт', stock:15,hot:true, organic:false,discount:0},
  {id:10,art:'KAK-0010',e:'☕',name:'Кофе Nescafé Gold',   price:28.0, old:34.0, cat:'Напитки', catId:'drinks',unit:'190 гр',stock:7, hot:true, organic:false,discount:18},
  {id:11,art:'KAK-0011',e:'🧃',name:'Сок апельсиновый',    price:6.80, old:null, cat:'Напитки', catId:'drinks',unit:'1 л',   stock:18,hot:false,organic:false,discount:0},
  {id:12,art:'KAK-0012',e:'🍫',name:'Шоколад Milka',       price:6.50, old:8.0,  cat:'Сладости',catId:'sweets',unit:'90 гр', stock:10,hot:true, organic:false,discount:19},
]

// ── НАЧАЛЬНЫЕ ЗАКАЗЫ ────────────────────────────
export const INITIAL_ORDERS: Order[] = [
  {
    id:'K-4832', type:'market', status:'assembling', createdAt:'14:23', priority:'urgent',
    client:{name:'Диловар Рахимов',phone:'+992 93 456 78 90',addr:'ул. Ленина, 42, кв. 15'},
    courier:{name:'Фирдавс Назаров',phone:'+992 93 111 22 33'},
    assembler:{name:'Камола Юсупова'},
    total:64.30, comment:'Побыстрее пожалуйста',
    items:[
      {id:1,art:'KAK-0001',e:'🥦',name:'Брокколи свежая',  qty:2,unit:'500 гр',price:5.50,done:false},
      {id:2,art:'KAK-0006',e:'🥛',name:'Молоко 3.2%',       qty:3,unit:'1 л',   price:4.90,done:false},
      {id:3,art:'KAK-0007',e:'🧀',name:'Сыр Российский',    qty:1,unit:'250 гр',price:18.5,done:false},
    ]
  },
  {
    id:'K-4831', type:'restaurant', status:'cooking', createdAt:'14:10',
    restId:'R-01', restName:'Чайхона Оромгох',
    client:{name:'Нилуфар Хасанова',phone:'+992 90 123 45 67',addr:'ул. Сомони, 12'},
    courier:{name:'Рустам Холов',phone:'+992 91 333 44 55'},
    total:22, comment:'',
    items:[
      {id:1,e:'🍜',name:'Лагман',qty:1,unit:'порция',price:14},
      {id:2,e:'🥗',name:'Ачик-чучук',qty:1,unit:'порция',price:8},
    ]
  },
  {
    id:'K-4829', type:'market', status:'new', createdAt:'13:55',
    client:{name:'Мадина Олимова',phone:'+992 93 321 65 43',addr:'ул. Ленина, 18'},
    courier:null, assembler:null,
    total:47.80, comment:'',
    items:[
      {id:1,art:'KAK-0009',e:'🥚',name:'Яйца С1',       qty:1,unit:'10 шт',price:8.90,done:false},
      {id:2,art:'KAK-0008',e:'🥐',name:'Круассан',      qty:4,unit:'1 шт', price:2.50,done:false},
      {id:3,art:'KAK-0011',e:'🧃',name:'Сок апельс.',   qty:2,unit:'1 л',  price:6.80,done:false},
      {id:4,art:'KAK-0012',e:'🍫',name:'Шоколад Milka', qty:3,unit:'90 гр',price:6.50,done:false},
    ]
  },
  {
    id:'K-4820', type:'market', status:'delivered', createdAt:'13:20',
    client:{name:'Рустам Давлатов',phone:'+992 91 445 23 11',addr:'ул. Сомони, 5'},
    courier:{name:'Баходур Кодиров',phone:'+992 90 222 33 44'},
    assembler:{name:'Шахло Рахимова'},
    total:66, comment:'',
    items:[
      {id:1,art:'KAK-0004',e:'🥩',name:'Говядина',qty:1,unit:'500 гр',price:38.0,done:true},
      {id:2,art:'KAK-0003',e:'🍊',name:'Апельсины',qty:2,unit:'1 кг', price:6.50,done:true},
    ]
  },
]

// ── КУРЬЕРЫ ──────────────────────────────────────
export const COURIERS: Courier[] = [
  {id:'C-01',name:'Фирдавс Назаров', phone:'+992 93 111 22 33',vehicle:'🏍 Мото',status:'busy',     rating:4.9,orders:342,today:42},
  {id:'C-02',name:'Баходур Кодиров', phone:'+992 90 222 33 44',vehicle:'🚲 Вело',status:'available',rating:4.7,orders:187,today:28},
  {id:'C-03',name:'Рустам Холов',    phone:'+992 91 333 44 55',vehicle:'🚗 Авто',status:'available',rating:4.8,orders:521,today:56},
  {id:'C-04',name:'Зубайр Рахимов',  phone:'+992 88 444 55 66',vehicle:'🏍 Мото',status:'offline',  rating:4.6,orders:98, today:0},
]

// ── СБОРЩИКИ ─────────────────────────────────────
export const ASSEMBLERS: Assembler[] = [
  {id:'A-01',name:'Камола Юсупова', phone:'+992 93 500 11 22',status:'working',  ordersToday:12,rating:4.9},
  {id:'A-02',name:'Шахло Рахимова', phone:'+992 93 500 33 44',status:'available',ordersToday:8, rating:4.7},
  {id:'A-03',name:'Зарина Холова',  phone:'+992 93 500 55 66',status:'offline',  ordersToday:0, rating:4.5},
]

// ── КЛИЕНТЫ ──────────────────────────────────────
export const CLIENTS: Client[] = [
  {id:'U-01',name:'Диловар Рахимов',  phone:'+992 93 456 78 90',card:'КАКАПО-0001',level:'platinum',orders:87,spent:3420,debt:1200,bonus:4850},
  {id:'U-02',name:'Нилуфар Хасанова', phone:'+992 90 123 45 67',card:'КАКАПО-0042',level:'gold',    orders:43,spent:1890,debt:0,   bonus:1240},
  {id:'U-03',name:'Бахром Каримов',   phone:'+992 88 789 01 23',card:'КАКАПО-0118',level:'silver',  orders:28,spent:980, debt:0,   bonus:560},
  {id:'U-04',name:'Зафар Мирзоев',    phone:'+992 91 654 32 10',card:'КАКАПО-0234',level:'gold',    orders:56,spent:2340,debt:4500,bonus:2100},
]

// ── КАРТЫ ────────────────────────────────────────
export const DEMO_CARDS = [
  {num:'КАКАПО-0001',client:'Диловар Рахимов',  status:'active', level:'platinum',bonus:4850,debtLimit:3000,debt:1200},
  {num:'КАКАПО-0042',client:'Нилуфар Хасанова', status:'active', level:'gold',    bonus:1240,debtLimit:1000,debt:0},
  {num:'КАКАПО-0118',client:'Бахром Каримов',   status:'active', level:'silver',  bonus:560, debtLimit:0,   debt:0},
  {num:'КАКАПО-0099',client:'',                  status:'unlinked',level:'',       bonus:0,   debtLimit:0,   debt:0},
  {num:'КАКАПО-0234',client:'Зафар Мирзоев',    status:'active', level:'gold',    bonus:2100,debtLimit:2000,debt:4500},
]

// ── CREDENTIALS ──────────────────────────────────
export const ADMIN_CREDS = { email: 'admin@kakapo.tj', password: 'admin123' }
export const COURIER_OTP  = '1234'
export const ASSEMBLER_PIN = '5678'
export const RESTAURANT_PASS = 'rest123'
