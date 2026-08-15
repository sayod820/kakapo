import type { Metadata } from 'next'
import './globals.css'
import ApiSyncProvider from '@/components/shared/ApiSyncProvider'

export const metadata: Metadata = {
  title: 'КАКАПО — Доставка продуктов · г. Яван',
  description: 'Супермаркет КАКАПО · Быстрая доставка · г. Яван, Таджикистан',
}

const tradeAndroidBundle = process.env.NEXT_PUBLIC_TRADE_ANDROID === 'true'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        {tradeAndroidBundle ? (
          <>
            <script dangerouslySetInnerHTML={{ __html: 'window.kakapoAndroid=true' }} />
            <div
              id="kakapo-boot-screen"
              style={{
                position: 'fixed',
                inset: 0,
                zIndex: 99999,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: '#F3F7F4',
                color: '#0C1A10',
                fontFamily: 'system-ui,sans-serif',
                fontWeight: 800,
                fontSize: 16,
                textAlign: 'center',
                padding: 24,
              }}
            >
              Загрузка кассы…
            </div>
            <script
              dangerouslySetInnerHTML={{
                __html: `
(function(){
  window.onerror=function(m){
    var el=document.getElementById('kakapo-boot-screen');
    if(el){el.style.display='flex';el.textContent=String(m||'Ошибка запуска');}
  };
  window.addEventListener('unhandledrejection',function(e){
    var el=document.getElementById('kakapo-boot-screen');
    var m=(e&&e.reason&&(e.reason.message||e.reason))||'Ошибка запуска';
    if(el){el.style.display='flex';el.textContent=String(m);}
  });
  window.__kakapoHideBoot=function(){
    var el=document.getElementById('kakapo-boot-screen');
    if(el) el.remove();
  };
  setTimeout(function(){
    if(document.querySelector('.k-trade,.k-login,form')){window.__kakapoHideBoot&&window.__kakapoHideBoot();return;}
    var el=document.getElementById('kakapo-boot-screen');
    if(el) el.textContent='Касса не открылась. Закройте приложение и откройте снова. Если снова белый экран — переустановите APK.';
  },15000);
})();`,
              }}
            />
          </>
        ) : null}
        <ApiSyncProvider>{children}</ApiSyncProvider>
      </body>
    </html>
  )
}
