'use client'
import Link from 'next/link'

const APPS = [
  { href:'/store',      icon:'🛒', title:'Магазин',            desc:'Клиентское приложение',       sub:'Товары · Рестораны · Бонусы · Корзина',  color:'#1FD760', bg:'linear-gradient(135deg,#061A0C,#0F3020)', border:'rgba(31,215,96,.3)' },
  { href:'/restaurant', icon:'🍽', title:'Кабинет ресторана',  desc:'Для партнёров-ресторанов',    sub:'Заказы · Меню · Статистика · Стоп-лист', color:'#FF8C00', bg:'linear-gradient(135deg,#1A0800,#2A1400)', border:'rgba(255,140,0,.3)' },
  { href:'/assembler',  icon:'📦', title:'Сборщик',            desc:'Сборка заказов',              sub:'Список товаров · История · Статистика',  color:'#9B6DFF', bg:'linear-gradient(135deg,#0D0619,#1A0A30)', border:'rgba(155,109,255,.3)' },
  { href:'/courier',    icon:'🛵', title:'Курьер',             desc:'Приложение курьера',          sub:'Заказы · GPS · Заработок',               color:'#3B8EF0', bg:'linear-gradient(135deg,#050A18,#0A1430)', border:'rgba(59,142,240,.3)' },
  { href:'/admin',      icon:'⚙️',  title:'Админ панель',       desc:'Управление всей экосистемой', sub:'Товары · Категории · Рестораны · Финансы · Команда', color:'#FFB800', bg:'linear-gradient(135deg,#1A1000,#2A1C00)', border:'rgba(255,184,0,.3)', full:true },
]

export default function PortalPage() {
  return (
    <div style={{ minHeight:'100vh', background:'#030B05', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'24px', fontFamily:'Nunito, sans-serif' }}>
      {/* Logo */}
      <div style={{ textAlign:'center', marginBottom:40 }}>
        <div style={{ width:72, height:72, borderRadius:22, background:'linear-gradient(135deg,#0F8A3A,#1FD760)', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'Unbounded, sans-serif', fontSize:30, fontWeight:900, color:'#030B05', margin:'0 auto 16px', boxShadow:'0 8px 32px rgba(31,215,96,.4)' }}>K</div>
        <div style={{ fontFamily:'Unbounded, sans-serif', fontSize:26, fontWeight:900, background:'linear-gradient(135deg,#1FD760,#FFB800)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', backgroundClip:'text', marginBottom:6 }}>KAKAPO</div>
        <div style={{ fontSize:13, color:'#8FB897' }}>Супермаркет + Маркетплейс · г. Яван, Таджикистан</div>
      </div>

      {/* Apps grid */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:14, width:'100%', maxWidth:520 }}>
        {APPS.map((app,i) => (
          <Link key={i} href={app.href} style={{ textDecoration:'none', gridColumn:app.full?'span 2':undefined }}>
            <div style={{ padding:'20px', borderRadius:20, background:app.bg, border:`1.5px solid ${app.border}`, cursor:'pointer', display:'flex', gap:app.full?16:undefined, alignItems:app.full?'center':undefined, transition:'transform .2s, box-shadow .2s' }}>
              <div style={{ fontSize:app.full?36:42, marginBottom:app.full?0:12 }}>{app.icon}</div>
              <div style={{ flex:app.full?1:undefined }}>
                <div style={{ fontFamily:'Unbounded, sans-serif', fontSize:15, fontWeight:900, color:app.color, marginBottom:4 }}>{app.title}</div>
                <div style={{ fontSize:11, color:'rgba(255,255,255,.6)', marginBottom:4 }}>{app.desc}</div>
                <div style={{ fontSize:10, color:'rgba(255,255,255,.35)' }}>{app.sub}</div>
              </div>
              {app.full&&<div style={{ fontSize:20, color:app.color, opacity:.7 }}>→</div>}
            </div>
          </Link>
        ))}
      </div>

      {/* Info */}
      <div style={{ marginTop:32, padding:'16px 20px', borderRadius:14, background:'rgba(31,215,96,.04)', border:'1px solid rgba(31,215,96,.12)', maxWidth:520, width:'100%' }}>
        <div style={{ fontFamily:'Unbounded, sans-serif', fontSize:11, fontWeight:800, color:'#1FD760', marginBottom:10 }}>ДЕМО-ДОСТУПЫ</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
          {[
            ['🛒 Клиент OTP','1234'],
            ['🛵 Курьер OTP','1234'],
            ['📦 Сборщик PIN','5678'],
            ['🍽 Ресторан','chaihona@kakapo.tj / rest123'],
            ['⚙️ Админ','admin@kakapo.tj / admin123'],
          ].map(([l,v],i)=>(
            <div key={i} style={{ fontSize:11, color:'#3D6645' }}>
              {l}: <span style={{ color:'#FFB800', fontWeight:700 }}>{v}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop:20, fontSize:10, color:'#1D3822', textAlign:'center', lineHeight:1.8 }}>
        KAKAPO v2.0 · Next.js 14 · TypeScript · Zustand<br/>
        kakapo.tj · г. Яван, Таджикистан
      </div>
    </div>
  )
}
