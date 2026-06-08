'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search, ShoppingCart, Bell, ArrowLeft } from 'lucide-react';
import { useCart, useAuth } from '@/lib/store';
import { PRODUCTS } from '@/lib/data';
import { ROUTES } from '@/lib/routes';

interface HeaderProps {
  title?:       string;
  showBack?:    boolean;
  backHref?:    string;
  showSearch?:  boolean;
  showCart?:    boolean;
}

export default function Header({
  title,
  showBack   = false,
  backHref,
  showSearch = true,
  showCart   = true,
}: HeaderProps) {
  const router              = useRouter();
  const { items }           = useCart();
  const { user }            = useAuth();
  const totalQty            = Object.values(items).reduce((a, b) => a + b, 0);

  const handleBack = () => {
    if (backHref) router.push(backHref);
    else router.back();
  };

  return (
    <header className="sticky top-0 z-50" style={{
      background:     'rgba(3,11,5,.96)',
      backdropFilter: 'blur(24px) saturate(180%)',
      borderBottom:   '1px solid var(--b1)',
    }}>
      <div style={{ padding:'13px 18px 12px', display:'flex', alignItems:'center', gap:10 }}>

        {/* Back OR Logo */}
        {showBack ? (
          <button onClick={handleBack} style={{ width:38, height:38, borderRadius:12, background:'var(--l3)', border:'1px solid var(--b1)', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', flexShrink:0 }}>
            <ArrowLeft size={17} color="var(--t2)"/>
          </button>
        ) : (
          <Link href={ROUTES.home} style={{ display:'flex', alignItems:'center', gap:10, textDecoration:'none', flexShrink:0 }}>
            <div style={{ width:40, height:40, borderRadius:12, background:'linear-gradient(135deg,var(--gr3),var(--gr))', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'Unbounded, sans-serif', fontSize:17, fontWeight:900, color:'var(--bg)', animation:'glow 3s ease-in-out infinite', boxShadow:'0 4px 16px rgba(31,215,96,.4)' }}>K</div>
            <div>
              <div style={{ fontFamily:'Unbounded, sans-serif', fontSize:16, fontWeight:900, background:'linear-gradient(135deg,var(--gr),var(--gd))', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', backgroundClip:'text' }}>KAKAPO</div>
              <div style={{ display:'flex', alignItems:'center', gap:4, marginTop:1 }}>
                <div style={{ width:5, height:5, borderRadius:'50%', background:'var(--gr)', animation:'pulse 2s infinite' }}/>
                <span style={{ fontSize:10, color:'var(--t2)' }}>г. Яван · Доставка 45 мин</span>
              </div>
            </div>
          </Link>
        )}

        {/* Title */}
        {showBack && title && (
          <div style={{ fontFamily:'Unbounded, sans-serif', fontSize:16, fontWeight:900, flex:1 }}>{title}</div>
        )}
        {!showBack && <div style={{ flex:1 }}/>}

        {/* Bonus chip */}
        {user && (
          <div style={{ borderRadius:10, padding:'5px 10px', background:'rgba(255,184,0,.07)', border:'1px solid rgba(255,184,0,.22)', display:'flex', alignItems:'center', gap:5 }}>
            <span style={{ fontSize:13 }}>⭐</span>
            <span style={{ fontFamily:'Unbounded, sans-serif', fontSize:11, fontWeight:800, color:'var(--gd)' }}>
              {(user.bonus ?? 0).toLocaleString()}
            </span>
          </div>
        )}

        {/* Search */}
        {showSearch && (
          <Link href={ROUTES.search()} style={{ width:38, height:38, borderRadius:12, background:'var(--l3)', border:'1px solid var(--b1)', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <Search size={17} color="var(--t2)"/>
          </Link>
        )}

        {/* Notifications */}
        <button style={{ width:38, height:38, borderRadius:12, background:'var(--l3)', border:'1px solid var(--b1)', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', position:'relative', flexShrink:0 }}>
          <Bell size={17} color="var(--t2)"/>
          <div style={{ position:'absolute', top:8, right:8, width:7, height:7, borderRadius:'50%', background:'var(--gr)', border:'1.5px solid var(--bg)' }}/>
        </button>

        {/* Cart */}
        {showCart && (
          <Link href={ROUTES.cart} style={{ width:38, height:38, borderRadius:12, background:totalQty>0?'linear-gradient(135deg,var(--gr2),var(--gr))':'var(--l3)', border:`1px solid ${totalQty>0?'transparent':'var(--b1)'}`, display:'flex', alignItems:'center', justifyContent:'center', position:'relative', boxShadow:totalQty>0?'0 4px 14px rgba(31,215,96,.4)':'none', flexShrink:0 }}>
            <ShoppingCart size={17} color={totalQty > 0 ? 'white' : 'var(--t2)'}/>
            {totalQty > 0 && (
              <div style={{ position:'absolute', top:-7, right:-7, width:17, height:17, borderRadius:'50%', background:'var(--red)', border:'2px solid var(--bg)', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'Unbounded, sans-serif', fontSize:9, fontWeight:900, color:'white' }}>{totalQty}</div>
            )}
          </Link>
        )}
      </div>
    </header>
  );
}
