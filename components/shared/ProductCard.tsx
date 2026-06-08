'use client';
import { useState } from 'react';
import { useRouter }  from 'next/navigation';
import { Heart, Plus, Star } from 'lucide-react';
import { useCart, useWish, useToast } from '@/lib/store';
import type { Product } from '@/lib/types';
import { ROUTES } from '@/lib/routes';

interface Props {
  product:   Product;
  variant?:  'grid' | 'list';
  animDelay?: number;
}

export default function ProductCard({ product: p, variant = 'grid', animDelay = 0 }: Props) {
  const router          = useRouter();
  const { items, addItem, rmItem } = useCart();
  const { toggleWish, isWished }   = useWish();
  const { show }        = useToast();
  const [popped, setPop] = useState(false);

  const qty    = items[p.id] || 0;
  const wished = isWished(p.id);
  const disc   = p.oldPrice ? Math.round((1 - p.price / p.oldPrice) * 100) : 0;

  const handleAdd = (e: React.MouseEvent) => {
    e.stopPropagation();
    setPop(true);
    setTimeout(() => setPop(false), 320);
    addItem(p.id);
    show(`${p.emoji}  ${p.name} в корзине`);
  };

  const handleWish = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleWish(p.id);
    if (!wished) show(`❤️  ${p.name} в избранном`);
  };

  const Stars = ({ r }: { r: number }) => (
    <div style={{ display:'flex', gap:1.5 }}>
      {[1,2,3,4,5].map(i => (
        <svg key={i} width={9} height={9} viewBox="0 0 24 24">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
            fill={i <= Math.round(r) ? '#FFB800' : 'rgba(255,184,0,.15)'} stroke="none"/>
        </svg>
      ))}
    </div>
  );

  const QtyControl = () => (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', background:'rgba(31,215,96,.1)', border:'1.5px solid rgba(31,215,96,.28)', borderRadius:13, padding:'5px 8px' }}>
      <button onClick={e=>{e.stopPropagation();rmItem(p.id);}} style={{ width:28, height:28, borderRadius:8, background:'rgba(31,215,96,.18)', display:'flex', alignItems:'center', justifyContent:'center', border:'none', cursor:'pointer', color:'var(--gr)', fontSize:17 }}>−</button>
      <span style={{ fontFamily:'Unbounded, sans-serif', fontSize:14, fontWeight:800, color:'var(--gr)' }}>{qty}</span>
      <button onClick={handleAdd} style={{ width:28, height:28, borderRadius:8, background:'rgba(31,215,96,.18)', display:'flex', alignItems:'center', justifyContent:'center', border:'none', cursor:'pointer', color:'var(--gr)', fontSize:17 }}>+</button>
    </div>
  );

  if (variant === 'list') {
    return (
      <div className="kakapo-card" onClick={() => router.push(ROUTES.product(p.id))}
        style={{ display:'flex', alignItems:'center', gap:12, padding:'12px', cursor:'pointer',
          animation: animDelay ? `fadeUp .45s cubic-bezier(.16,1,.3,1) ${animDelay}s both` : undefined }}>
        <div style={{ width:62, height:62, borderRadius:16, background:(p as any).gradient ?? '#0C1C0F', display:'flex', alignItems:'center', justifyContent:'center', fontSize:30, flexShrink:0, position:'relative', overflow:'hidden' }}>
          {(p as any).photo
            ? <img src={(p as any).photo} alt={p.name} style={{ width:'100%', height:'100%', objectFit:'cover', borderRadius:16, display:'block' }}/>
            : ((p as any).emoji ?? p.e)
          }
          {disc>0 && <div style={{ position:'absolute', top:-4, left:-4, borderRadius:8, background:'var(--red)', padding:'1px 5px', fontSize:9, fontWeight:800, color:'white', zIndex:2 }}>-{disc}%</div>}
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:13, fontWeight:700, marginBottom:1 }}>{p.name}</div>
          <div style={{ fontSize:10, color:'var(--t3)', marginBottom:3 }}>{p.unit}</div>
          <Stars r={p.rating}/>
          <div style={{ display:'flex', alignItems:'baseline', gap:5, marginTop:4 }}>
            <span style={{ fontFamily:'Unbounded, sans-serif', fontSize:14, fontWeight:800 }}>{p.price.toFixed(2)}<span style={{ fontSize:9, color:'var(--gd)', marginLeft:2 }}>ЅМ</span></span>
            {p.oldPrice && <span style={{ fontSize:10, color:'var(--t3)', textDecoration:'line-through' }}>{p.oldPrice.toFixed(2)}</span>}
          </div>
        </div>
        <div style={{ flexShrink:0 }}>
          {qty === 0 ? (
            <button onClick={handleAdd} style={{ width:36, height:36, borderRadius:10, background:'linear-gradient(135deg,var(--gr2),var(--gr))', border:'none', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', animation:popped?'cartPop .32s ease':undefined }}>
              <Plus size={16} color="white" strokeWidth={2.5}/>
            </button>
          ) : <QtyControl/>}
        </div>
      </div>
    );
  }

  /* Grid */
  return (
    <div className="kakapo-card" onClick={() => router.push(ROUTES.product(p.id))}
      style={{ display:'flex', flexDirection:'column', cursor:'pointer', position:'relative',
        animation: animDelay ? `fadeUp .45s cubic-bezier(.16,1,.3,1) ${animDelay}s both` : undefined }}>
      {/* Wish */}
      <button onClick={handleWish} style={{ position:'absolute', top:8, right:8, zIndex:3, width:28, height:28, borderRadius:'50%', background:'rgba(0,0,0,.5)', display:'flex', alignItems:'center', justifyContent:'center', border:'none', cursor:'pointer' }}>
        <Heart size={13} color={wished?'#FF4545':'rgba(255,255,255,.5)'} fill={wished?'#FF4545':'none'} strokeWidth={2}/>
      </button>
      {/* Badges */}
      <div style={{ position:'absolute', top:8, left:8, display:'flex', flexDirection:'column', gap:3, zIndex:3 }}>
        {disc>0   && <span className="badge badge-red">−{disc}%</span>}
        {p.isNew  && <span className="badge badge-green">NEW</span>}
        {p.isOrganic && <span className="badge" style={{ background:'rgba(52,211,153,.12)', color:'#34D399', border:'1px solid rgba(52,211,153,.28)' }}>🌿</span>}
      </div>
      {/* Image */}
      <div style={{ height:110, background:(p as any).gradient ?? '#0C1C0F', display:'flex', alignItems:'center', justifyContent:'center', fontSize:48, animation:(p as any).isHot?'float 3s ease-in-out infinite':undefined, overflow:'hidden', position:'relative' }}>
        {(p as any).photo
          ? <img src={(p as any).photo} alt={p.name} style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }}/>
          : ((p as any).emoji ?? p.e)
        }
      </div>
      {/* Info */}
      <div style={{ padding:'10px 10px 8px', flex:1, display:'flex', flexDirection:'column', gap:3 }}>
        <div style={{ fontSize:12, fontWeight:700, lineHeight:1.35, minHeight:30 }}>{p.name}</div>
        <div style={{ fontSize:10, color:'var(--t3)' }}>{p.unit}</div>
        <Stars r={p.rating}/>
        <div style={{ display:'flex', alignItems:'baseline', gap:5, marginTop:2 }}>
          <span style={{ fontFamily:'Unbounded, sans-serif', fontSize:15, fontWeight:800 }}>{p.price.toFixed(2)}<span style={{ fontSize:9, color:'var(--gd)', marginLeft:2 }}>ЅМ</span></span>
          {p.oldPrice && <span style={{ fontSize:10, color:'var(--t3)', textDecoration:'line-through' }}>{p.oldPrice.toFixed(2)}</span>}
        </div>
        <div style={{ fontSize:9, color:'var(--gd)', fontWeight:700 }}>⭐+{p.bonus}</div>
      </div>
      {/* CTA */}
      <div style={{ padding:'0 10px 10px' }}>
        {qty === 0 ? (
          <button onClick={handleAdd} style={{ width:'100%', padding:'9px', fontSize:12, borderRadius:12, background:'linear-gradient(135deg,var(--gr2),var(--gr))', border:'none', color:'white', display:'flex', alignItems:'center', justifyContent:'center', gap:4, cursor:'pointer', fontFamily:'Nunito, sans-serif', fontWeight:700, animation:popped?'cartPop .32s ease':undefined }}>
            <Plus size={12} color="white" strokeWidth={2.5}/>В корзину
          </button>
        ) : <QtyControl/>}
      </div>
    </div>
  );
}
