import fs from 'node:fs'

const FILE = 'components/store/StoreApp.tsx'
let src = fs.readFileSync(FILE, 'utf8')
const EOL = src.includes('\r\n') ? '\r\n' : '\n'
const j = (arr) => arr.join(EOL)

// ---------- 1. Toast -> светлая карточка ----------
const toastRe = /const Toast = \(\{ msg, isVip = false \}\)[\s\S]*?\n\);\r?\n/
if (!toastRe.test(src)) throw new Error('Toast not found')
src = src.replace(toastRe, j([
  'const Toast = ({ msg, isVip = false }) => !msg ? null : (',
  '  <div',
  '    role="status"',
  '    aria-live="polite"',
  '    style={{',
  '      position:"fixed", top:16, left:"50%", zIndex:999,',
  '      animation:"notif .24s cubic-bezier(.16,1,.3,1)",',
  '      background:"var(--l1)",',
  '      border:`1.5px solid ${isVip ? "rgba(233,174,0,.45)" : "var(--b1)"}`,',
  '      borderRadius:14, padding:"10px 16px",',
  '      display:"flex", alignItems:"center", gap:10,',
  '      boxShadow:"0 12px 30px rgba(23,37,27,.16)",',
  '      transform:"translateX(-50%)", maxWidth:"min(92vw, 460px)",',
  '    }}',
  '  >',
  '    <div style={{ width:22, height:22, borderRadius:"50%", background: isVip ? "rgba(233,174,0,.16)" : "var(--gr-soft)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>',
  '      <Ic n="check" s={12} c={isVip ? "#8A6400" : "var(--gr3)"} w={2.5}/>',
  '    </div>',
  '    <span style={{ fontSize:13, fontWeight:700, color:"var(--t1)" }}>{msg}</span>',
  '  </div>',
  ');',
]) + EOL)

// ---------- 2. Нижняя навигация -> белая панель ----------
const navRe = /const Nav = \(\{ page, go, user: userProp \}\)[\s\S]*?\n\}\r?\n/
if (!navRe.test(src)) throw new Error('Nav not found')
src = src.replace(navRe, j([
  'const Nav = ({ page, go, user: userProp }) => {',
  '  const syncedUser = userProp ?? loadStoreUser()',
  '  const { isVip } = resolveUserVip(syncedUser)',
  '  return (',
  '  <nav className="store-nav" style={{',
  '    background:"var(--l1)",',
  '    borderTop:"1px solid var(--b1)",',
  '    boxShadow:"0 -2px 14px rgba(23,37,27,.05)",',
  '    padding:"6px 8px calc(6px + env(safe-area-inset-bottom, 0px))",',
  '    display:"flex", justifyContent:"space-around", alignItems:"stretch",',
  '  }}>',
  '    {[{id:"home",icon:"home",label:"Главная"},{id:"catalog",icon:"tag",label:"Каталог"},{id:"orders",icon:"truck",label:"Заказы"},{id:"promos",icon:"gift",label:"Акции"},{id:"profile",icon:"user",label:"Профиль"}].map(item => {',
  '      const on = page === item.id',
  '      const activeColor = on ? (isVip ? "#8A6400" : "var(--gr3)") : "var(--t3)"',
  '      const isProfile = item.id === "profile"',
  '      return (',
  '      <button key={item.id} type="button" onClick={() => go(item.id)} className="btn store-nav-item"',
  '        aria-current={on ? "page" : undefined}',
  '        style={{ background:on ? (isVip ? "rgba(233,174,0,.12)" : "var(--gr-soft)") : "transparent", color:activeColor, position:"relative" }}>',
  '        {isVip && isProfile && (',
  '          <div style={{ position:"absolute", top:0, right:10, fontSize:10, lineHeight:1 }} aria-hidden="true">👑</div>',
  '        )}',
  '        <Ic n={item.icon} s={22} c={activeColor}/>',
  '        <span style={{ fontSize:11, fontWeight:on?800:600 }}>{isProfile && isVip ? "VIP" : item.label}</span>',
  '      </button>',
  '    )})}',
  '  </nav>',
  '  )',
  '}',
]) + EOL)

// ---------- 3. Шапка ----------
const hdrRe = /const Header = \(\{ title, back, go, cart, user: userProp \}\)[\s\S]*?\n\};\r?\n/
if (!hdrRe.test(src)) throw new Error('Header not found')
src = src.replace(hdrRe, j([
  '/** Короткая строка адреса для шапки: реальные данные клиента, иначе приглашение. */',
  'function useClientAddressLine(user?: StoreUser | null) {',
  '  const phone = (user?.phone || getActiveClientPhone(user) || undefined) as string | undefined',
  '  const [line, setLine] = useState("")',
  '  useEffect(() => {',
  '    if (typeof window === "undefined") return',
  '    const read = () => {',
  '      try {',
  '        const list = loadClientAddresses(phone) || []',
  '        const def = list.find((a: any) => a.def) || list[0]',
  '        const full = def ? formatClientAddressLine(def) : ""',
  '        setLine(full ? full.split(",").slice(0, 2).join(",").trim() : "")',
  '      } catch { setLine("") }',
  '    }',
  '    read()',
  '    const onFocus = () => read()',
  '    window.addEventListener("focus", onFocus)',
  '    const t = setInterval(read, 20000)',
  '    return () => { window.removeEventListener("focus", onFocus); clearInterval(t) }',
  '  }, [phone])',
  '  return line ? `Яван · ${line}` : "Яван · Укажите адрес"',
  '}',
  '',
  'const Header = ({ title, back, go, cart, user: userProp }) => {',
  '  const { prods } = useLiveCatalog();',
  '  const user = userProp ?? loadStoreUser()',
  '  const { isVip } = resolveUserVip(user)',
  '  const qty = formatCartBadgeCount(sumCartUnits(cart || {}, prods));',
  '  const qtyNum = sumCartUnits(cart || {}, prods);',
  '  const address = useClientAddressLine(user)',
  '  return (',
  '    <header data-store-header style={{',
  '      position:"sticky", top:0, zIndex:100,',
  '      background:"var(--header-bg)", backdropFilter:"blur(20px)",',
  '      borderBottom:"1px solid var(--b1)",',
  '    }}>',
  '      <div style={{ padding:"10px 16px", display:"flex", alignItems:"center", gap:10 }}>',
  '        {back ? (',
  '          <button onClick={() => storeBack(back, go)} className="btn hdr-icon" aria-label="Назад">',
  '            <Ic n="arrL" s={18} c="var(--t1)"/>',
  '          </button>',
  '        ) : (',
  '          <span className="store-brand-mark" aria-hidden="true">K</span>',
  '        )}',
  '        <div style={{ flex:1, minWidth:0 }}>',
  '          {title ? (',
  '            <div className="ub" style={{ fontSize:18, fontWeight:800, color:"var(--t1)" }}>{title}</div>',
  '          ) : (',
  '            <>',
  '              <div className="ub" style={{ fontSize:17, fontWeight:900, color:"var(--t1)", letterSpacing:"-.01em" }}>КАКАПО{isVip ? " VIP" : ""}</div>',
  '              <button type="button" className="btn hdr-addr" onClick={() => go("addresses")} aria-label="Изменить адрес доставки">',
  '                <Ic n="map" s={12} c={isVip ? "#8A6400" : "var(--gr3)"} w={2}/>',
  '                <span>{address}</span>',
  '                <Ic n="arr" s={11} c="var(--t3)"/>',
  '              </button>',
  '            </>',
  '          )}',
  '        </div>',
  '        <button onClick={() => go("search")} className="btn hdr-icon" aria-label="Поиск">',
  '          <Ic n="search" s={18} c="var(--t1)"/>',
  '        </button>',
  '        <CartHeaderButton count={qty} qtyNum={qtyNum} onClick={() => go("cart")} isVip={isVip} />',
  '      </div>',
  '    </header>',
  '  );',
  '};',
]) + EOL)

// ---------- 4. Кнопки шапки: 44px ----------
src = src.replace(/width: 38, height: 38, borderRadius: 12,/g, 'width: 44, height: 44, borderRadius: 12,')
// ---------- 5. UserStatusBadge: базовый статус на светлом ----------
src = src.replace(/isBasic \? 'rgba\(143,184,151,\.1\)'/g, "isBasic ? 'var(--l3)'")
src = src.replace(/isBasic \? '#8FB897'/g, "isBasic ? 'var(--t2)'")
src = src.replace(/isBasic \? '1px solid rgba\(143,184,151,\.28\)'/g, "isBasic ? '1px solid var(--b1)'")

// ---------- 6. CSS: элементы шапки и меню ----------
const anchor = '.p-name{min-height:36px;}'
if (!src.includes(anchor)) throw new Error('CSS anchor not found')
src = src.replace(anchor, j([
  anchor,
  '.hdr-icon{width:44px;height:44px;border-radius:12px;background:var(--l3);border:1px solid var(--b1);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;}',
  '.hdr-icon:hover{background:var(--l4);}',
  '.hdr-addr{display:inline-flex;align-items:center;gap:4px;padding:2px 0;margin-top:1px;max-width:100%;font-size:12px;font-weight:600;color:var(--t2);background:transparent;}',
  '.hdr-addr span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:46vw;}',
  '.hdr-addr:hover span{color:var(--gr3);}',
  '.store-nav-item{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;padding:7px 10px;border-radius:12px;min-width:56px;min-height:52px;}',
  '.store-nav-item:hover{background:var(--l3);}',
]))

fs.writeFileSync(FILE, src)
console.log('Toast / Nav / Header rewritten')
