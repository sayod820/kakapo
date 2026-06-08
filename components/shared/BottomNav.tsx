'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Tag, Truck, Gift, User } from 'lucide-react';
import { ROUTES } from '@/lib/routes';

const NAV_ITEMS = [
  { href: ROUTES.home,       Icon: Home,  label: 'Главная' },
  { href: ROUTES.catalog,    Icon: Tag,   label: 'Каталог' },
  { href: ROUTES.orders,     Icon: Truck, label: 'Заказы'  },
  { href: ROUTES.promotions, Icon: Gift,  label: 'Акции'   },
  { href: ROUTES.profile,    Icon: User,  label: 'Профиль' },
];

export default function BottomNav() {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  return (
    <nav style={{ position:'fixed', bottom:0, left:'50%', transform:'translateX(-50%)', width:'100%', maxWidth:'480px', background:'rgba(3,11,5,.97)', backdropFilter:'blur(26px) saturate(180%)', borderTop:'1px solid var(--b1)', padding:'8px 18px', paddingBottom:'calc(14px + env(safe-area-inset-bottom, 0px))', display:'flex', justifyContent:'space-around', zIndex:80 }}>
      {NAV_ITEMS.map(({ href, Icon, label }) => {
        const active = isActive(href);
        return (
          <Link key={href} href={href} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:3, padding:'6px 12px', borderRadius:12, background:active?'rgba(31,215,96,.09)':'transparent', border:`1.5px solid ${active?'rgba(31,215,96,.22)':'transparent'}`, color:active?'var(--gr)':'var(--t3)', textDecoration:'none', minWidth:50, transition:'all .2s cubic-bezier(.16,1,.3,1)' }}>
            <Icon size={20} color={active ? 'var(--gr)' : 'var(--t3)'}/>
            <span style={{ fontSize:9, fontWeight:active?800:600, fontFamily:'Nunito, sans-serif' }}>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
