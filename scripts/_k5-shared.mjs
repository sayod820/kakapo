import fs from 'node:fs'

const FILE = 'components/store/StoreApp.tsx'
let src = fs.readFileSync(FILE, 'utf8')
const EOL = src.includes('\r\n') ? '\r\n' : '\n'
const j = (a) => a.join(EOL)
const must = (c, m) => { if (!c) throw new Error(m) }

// ---------------------------------------------------------------- 1. Плоские цвета
const bulk = [
  ['linear-gradient(135deg,var(--gr2),var(--gr))', 'var(--gr)'],
  ['linear-gradient(135deg,var(--gr3),var(--gr))', 'var(--gr)'],
  ['linear-gradient(135deg,var(--gr),var(--gr2))', 'var(--gr)'],
  ['boxShadow:"0 6px 20px rgba(7,136,61,.28)"', 'boxShadow:"var(--sh1)"'],
  ['boxShadow:"0 4px 16px rgba(7,136,61,.22)"', 'boxShadow:"none"'],
  ['boxShadow:"0 4px 16px rgba(7,136,61,.4)"', 'boxShadow:"none"'],
  ['boxShadow:"0 0 10px rgba(7,136,61,.6)"', 'boxShadow:"none"'],
  ['boxShadow:"0 0 60px rgba(7,136,61,.5)"', 'boxShadow:"none"'],
  ['boxShadow:"0 8px 28px rgba(23,37,27,.35)"', 'boxShadow:"none"'],
  ['rgba(255,255,255,.1)', 'var(--b1)'],
  ['rgba(255,255,255,.08)', 'var(--b1)'],
  ['rgba(255,255,255,.06)', 'var(--l3)'],
  ['rgba(255,255,255,.04)', 'var(--l3)'],
  ['rgba(7,136,61,.12)', 'var(--gr-soft)'],
  ['rgba(7,136,61,.1)', 'var(--gr-soft)'],
  ['rgba(7,136,61,.14)', 'var(--gr-soft)'],
]
for (const [from, to] of bulk) src = src.split(from).join(to)

// ---------------------------------------------------------------- 2. Типы общих компонентов
const typeFixes = [
  ['const Header = ({ title, back, go, cart, user: userProp, hideSearch = false }) => {',
   'const Header = ({ title, back, go, cart, user: userProp, hideSearch = false }: any) => {'],
  ['const Nav = ({ page, go, user: userProp }) => {',
   'const Nav = ({ page, go, user: userProp }: any) => {'],
  ['const FloatingCartBtn = ({ count, onClick, label = "В корзину", isVip: isVipProp }) => {',
   'const FloatingCartBtn = ({ count, onClick, label = "В корзину", isVip: isVipProp }: any) => {'],
  ['const PCard = ({ p, cart, onAdd, onRm, onWish, wished, go }) => {',
   'const PCard = ({ p, cart, onAdd, onRm, onWish, wished, go }: any) => {'],
  ['const HomePage = ({ go, cart, onAdd, onRm, onWish, wished, user }) => {',
   'const HomePage = ({ go, cart, onAdd, onRm, onWish, wished, user }: any) => {'],
  ['const CatalogPage = ({ go, cart, user }) => {',
   'const CatalogPage = ({ go, cart, user }: any) => {'],
  ['const PListPage = ({ go, params, cart, onAdd, onRm, onWish, wished, user }) => {',
   'const PListPage = ({ go, params, cart, onAdd, onRm, onWish, wished, user }: any) => {'],
  ['const ProductPage = ({ go, params, cart, onAdd, onRm, onWish, wished }) => {',
   'const ProductPage = ({ go, params, cart, onAdd, onRm, onWish, wished }: any) => {'],
  ['const CartPage = ({ go, cart, cartMeta = {}, onAdd, onRm, onDel, cartSyncReady = true, user }) => {',
   'const CartPage = ({ go, cart, cartMeta = {}, onAdd, onRm, onDel, cartSyncReady = true, user }: any) => {'],
  ['const SearchPage = ({ go, cart, onAdd, onRm, user }) => {',
   'const SearchPage = ({ go, cart, onAdd, onRm, user }: any) => {'],
  ['const WishlistPage = ({ go, cart, onAdd, onRm, onWish, wished, user }) => {',
   'const WishlistPage = ({ go, cart, onAdd, onRm, onWish, wished, user }: any) => {'],
  ['const PromosPage = ({ go, cart, onAdd, onRm, onWish, wished = {}, user }) => {',
   'const PromosPage = ({ go, cart, onAdd, onRm, onWish, wished = {}, user }: any) => {'],
  ['const OrdersPage = ({ go, user, onAdd, onClearCart, showToast, params }) => {',
   'const OrdersPage = ({ go, user, onAdd, onClearCart, showToast, params }: any) => {'],
  ['const ProfilePage = ({ go, user, setUser, onLogout, wished, showToast, sessionReady }) => {',
   'const ProfilePage = ({ go, user, setUser, onLogout, wished, showToast, sessionReady }: any) => {'],
  ['const VIPPage = ({ go, user, setUser }) => {',
   'const VIPPage = ({ go, user, setUser }: any) => {'],
  ['const AddressesPage = ({ go, user }) => {',
   'const AddressesPage = ({ go, user }: any) => {'],
  ['const NotifPage = ({go, user}) => {',
   'const NotifPage = ({ go, user }: any) => {'],
  ['const DebtsPage = ({ go, user }) => {',
   'const DebtsPage = ({ go, user }: any) => {'],
  ['const FAQPage = ({ go }) => {',
   'const FAQPage = ({ go }: any) => {'],
  ['const AboutPage = ({ go, user }) => {',
   'const AboutPage = ({ go, user }: any) => {'],
  ['const ReferralPage = ({ go, user }) => {',
   'const ReferralPage = ({ go, user }: any) => {'],
  ['const ChatPage = ({ go, user }) => {',
   'const ChatPage = ({ go, user }: any) => {'],
  ['const RestaurantsPage = ({go, cart, onAdd}) => {',
   'const RestaurantsPage = ({ go, cart, onAdd }: any) => {'],
  ['const RestaurantPage = ({go, params, cart, onAdd, onRm}) => {',
   'const RestaurantPage = ({ go, params, cart, onAdd, onRm }: any) => {'],
  ['const ClientReviewsPage = ({ go, user, sessionReady, params }) => {',
   'const ClientReviewsPage = ({ go, user, sessionReady, params }: any) => {'],
  ['const CheckoutPage = ({ go, cart, cartMeta = {}, onClearCart, user, setUser }) => {',
   'const CheckoutPage = ({ go, cart, cartMeta = {}, onClearCart, user, setUser }: any) => {'],
]
for (const [from, to] of typeFixes) {
  if (src.includes(from)) src = src.replace(from, to)
  else if (!src.includes(to)) throw new Error('type fix anchor missing: ' + from)
}

// ---------------------------------------------------------------- 3. Старый QtyStepper -> QtyStepperBar (светлый)
const oldStepperHead = 'const QtyStepper = ({ qty, onAdd, onRm, size = "md", label }) => {'
must(src.includes(oldStepperHead), 'old QtyStepper head')
src = src.replace(oldStepperHead, 'const QtyStepperBar = ({ qty, onAdd, onRm, size = "md", label, disabled = false }: any) => {')
src = src.replace(j([
  '    background: "rgba(255,255,255,.04)",',
  '    border: "1px solid var(--b1)",',
]), j([
  '    background: "var(--l1)",',
  '    border: "1.5px solid var(--b1)",',
]))
src = src.replace(j([
  '    background: "var(--gr-soft)",',
  '    border: "1px solid rgba(7,136,61,.22)",',
]), j([
  '    background: "var(--gr-soft)",',
  '    border: "1.5px solid rgba(7,136,61,.28)",',
]))
src = src.replace('<QtyStepper qty={qty} label={qtyLabel} onAdd={add} onRm={rm}/>', '<QtyStepperBar qty={qty} label={qtyLabel} onAdd={add} onRm={rm}/>')
src = src.replace('<QtyStepper qty={qty} label={qtyLabel} onAdd={add} onRm={rm} size="sm"/>', '<QtyStepperBar qty={qty} label={qtyLabel} onAdd={add} onRm={rm} size="sm"/>')

// ---------------------------------------------------------------- 4. Реальная ошибка: remoteAddresses
src = src.replace(j([
  "        const remoteWish = wishBundleFromClient(remoteClient);",
  '',
  '        const localCartBundle = {',
]), j([
  "        const remoteWish = wishBundleFromClient(remoteClient);",
  '        const remoteAddresses = addressBundleFromClient(remoteClient);',
  '',
  '        const localCartBundle = {',
]))

// ---------------------------------------------------------------- 5. Общие компоненты: пустое состояние + скелетоны
const helperAnchor = 'const HomePage = ({ go, cart, onAdd, onRm, onWish, wished, user }: any) => {'
must(src.includes(helperAnchor), 'HomePage anchor')
src = src.replace(helperAnchor, j([
  '/** Пустое состояние раздела магазина. */',
  'const EmptyState = ({ icon = "🔍", title, text, actionLabel, onAction, extra }: any) => (',
  '  <div className="store-empty">',
  '    <div className="store-empty-icon" aria-hidden="true">{icon}</div>',
  '    <div className="store-empty-title">{title}</div>',
  '    {text ? <div className="store-empty-text">{text}</div> : null}',
  '    {actionLabel ? (',
  '      <button type="button" className="btn store-btn store-btn-primary" onClick={onAction} style={{ marginTop:14 }}>{actionLabel}</button>',
  '    ) : null}',
  '    {extra}',
  '  </div>',
  ');',
  '',
  '/** Скелетон-карточка товара: те же размеры, что у настоящей карточки. */',
  'const ProductSkeleton = () => (',
  '  <div className="store-skel-card" aria-hidden="true">',
  '    <div className="skel-line store-skel-media"/>',
  '    <div style={{ padding:"10px 12px 12px", display:"flex", flexDirection:"column", gap:6 }}>',
  '      <div className="skel-line" style={{ height:12 }}/>',
  '      <div className="skel-line" style={{ height:12, width:"60%" }}/>',
  '      <div className="skel-line" style={{ height:20, width:"45%", marginTop:4 }}/>',
  '    </div>',
  '  </div>',
  ');',
  '',
  '/** Светлая сетка скелетонов под товарную сетку. */',
  'const ProductSkeletonGrid = ({ count = 6 }: any) => (',
  '  <div className="store-prod-grid">',
  '    {Array.from({ length: count }).map((_, i) => <ProductSkeleton key={i}/>)}',
  '  </div>',
  ');',
  '',
  helperAnchor,
]))

// ---------------------------------------------------------------- 6. CSS общих элементов
const cssAnchor = '@media (hover:hover) and (min-width:900px){'
must(src.includes(cssAnchor), 'css hover anchor')
src = src.replace(cssAnchor, j([
  '/* Кнопки магазина: единая система */',
  '.store-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:0 18px;border-radius:var(--r-field);font-family:\'Nunito\',sans-serif;font-size:15px;font-weight:800;border:1.5px solid transparent;cursor:pointer;transition:background-color .18s,border-color .18s,color .18s,transform .18s;}',
  '.store-btn:active{transform:scale(.985);}',
  '.store-btn:disabled{opacity:.5;cursor:not-allowed;transform:none;}',
  '.store-btn-primary{background:var(--gr);color:#fff;}',
  '.store-btn-primary:hover{background:var(--gr2);}',
  '.store-btn-primary:active{background:var(--gr3);}',
  '.store-btn-sec{background:var(--l1);border-color:var(--b1);color:var(--t1);}',
  '.store-btn-sec:hover{background:var(--l3);border-color:var(--b2);}',
  '.store-btn-ghost{background:transparent;color:var(--gr3);min-height:44px;padding:0 12px;}',
  '.store-btn-ghost:hover{background:var(--gr-soft);}',
  '.store-btn-sm{min-height:40px;font-size:13px;padding:0 14px;border-radius:12px;}',
  '.store-btn-block{width:100%;}',
  '/* Подпись поля: постоянная, placeholder её не заменяет */',
  '.store-label{display:block;font-size:12px;font-weight:700;color:var(--t2);margin-bottom:6px;}',
  '.store-field{margin-bottom:16px;}',
  '.store-hint{font-size:12px;color:var(--t2);line-height:1.5;}',
  '.store-err{font-size:12px;color:var(--red);margin-top:6px;font-weight:700;}',
  '/* Скелетоны товарной сетки */',
  '.store-skel-card{background:var(--l1);border:1px solid var(--b1);border-radius:var(--r-card);overflow:hidden;}',
  '.store-skel-media{width:100%;aspect-ratio:1 / 1;border-radius:0;}',
  '/* Пустые состояния */',
  '.store-empty{display:flex;flex-direction:column;align-items:center;text-align:center;padding:44px 20px;}',
  '.store-empty-icon{width:72px;height:72px;border-radius:22px;background:var(--l3);display:flex;align-items:center;justify-content:center;font-size:34px;margin-bottom:12px;}',
  '.store-empty-title{font-size:17px;font-weight:800;color:var(--t1);}',
  '.store-empty-text{font-size:13px;color:var(--t2);line-height:1.5;max-width:280px;margin-top:6px;}',
  '/* Модальные окна и нижние панели-шторки */',
  '.store-sheet-backdrop{position:fixed;inset:0;z-index:600;background:var(--overlay);display:flex;align-items:flex-end;justify-content:center;animation:fadeIn .18s ease;}',
  '.store-sheet{width:100%;max-width:var(--store-w);background:var(--l1);border:1px solid var(--b1);border-bottom:none;border-radius:22px 22px 0 0;box-shadow:0 -12px 40px rgba(23,37,27,.16);max-height:88vh;overflow-y:auto;animation:slideUp .22s cubic-bezier(.16,1,.3,1);padding-bottom:env(safe-area-inset-bottom,0px);}',
  '.store-sheet-head{position:sticky;top:0;z-index:2;background:var(--l1);display:flex;align-items:center;gap:10px;padding:14px 16px 12px;border-bottom:1px solid var(--b1);}',
  '.store-sheet-title{flex:1;min-width:0;font-size:16px;font-weight:800;color:var(--t1);}',
  '.store-sheet-x{width:36px;height:36px;border-radius:11px;background:var(--l3);border:1px solid var(--b1);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;}',
  '.store-sheet-body{padding:16px;}',
  '/* Строка товара в списке (корзина, избранное, заказ) */',
  '.store-row{display:flex;align-items:center;gap:12px;padding:12px;background:var(--l1);border:1px solid var(--b1);border-radius:var(--r-card);}',
  '.store-row-media{width:64px;height:64px;border-radius:14px;background:#fff;border:1px solid var(--b1);flex-shrink:0;overflow:hidden;display:flex;align-items:center;justify-content:center;}',
  '/* Закреплённая панель действия: не накладывается на нижнее меню */',
  '.store-sticky-bar{position:fixed;left:50%;transform:translateX(-50%);width:100%;max-width:var(--store-w);z-index:190;bottom:0;background:var(--header-bg);backdrop-filter:blur(24px);border-top:1px solid var(--b1);box-shadow:0 -2px 14px rgba(23,37,27,.05);padding:12px 16px calc(12px + env(safe-area-inset-bottom,0px));}',
  '@media (max-width:899px){.store-sticky-bar{bottom:calc(var(--nav-h) + env(safe-area-inset-bottom,0px));}}',
  '.store-page-pad-lg{padding-bottom:calc(180px + env(safe-area-inset-bottom,0px));}',
  '/* Верхняя навигация для компьютера */',
  '.store-desktop-tabs{padding:10px 20px;background:var(--l1);border-bottom:1px solid var(--b1);}',
  '/* Более плотная сетка на очень узких экранах */',
  '@media (max-width:359px){.store-shell{--sp4:12px;} .store-page-pad-lg{padding-bottom:calc(196px + env(safe-area-inset-bottom,0px));}}',
  cssAnchor,
]))

fs.writeFileSync(FILE, src)
console.log('shared components + CSS written')
