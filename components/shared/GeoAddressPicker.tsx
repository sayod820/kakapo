'use client';
import { useState, useCallback } from 'react';
import { calcDeliveryPrice, calcDistanceKm } from '@/lib/courierData';
import { usePricing } from '@/lib/courierStore';

/* ── Координаты магазина KAKAPO г. Яван ── */
const STORE_LAT = 38.5500;
const STORE_LNG = 69.1400;

interface AddressResult {
  address:    string;
  lat:        number;
  lng:        number;
  distanceKm: number;
}

interface Props {
  value:      string;
  onChange:   (val: string) => void;
  weightKg?:  number;
  orderAmount?:number;
  onPriceChange?: (price: ReturnType<typeof calcDeliveryPrice>, dist: number) => void;
}

/* ── Reverse geocode через Nominatim (OpenStreetMap, бесплатно) ── */
async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=ru`,
      { headers: { 'User-Agent': 'KAKAPO.TJ/1.0' } }
    );
    const data = await res.json();
    const a = data.address ?? {};
    const parts = [
      a.road || a.pedestrian || a.street,
      a.house_number,
      a.suburb || a.neighbourhood || a.city_district,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : data.display_name?.split(',').slice(0,3).join(',') ?? '';
  } catch {
    return '';
  }
}

/* ── Forward geocode — поиск адреса по тексту ── */
async function forwardGeocode(query: string): Promise<{ lat:number; lng:number; display:string }[]> {
  try {
    const q = encodeURIComponent(`${query}, Яван, Таджикистан`);
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=4&accept-language=ru`,
      { headers: { 'User-Agent': 'KAKAPO.TJ/1.0' } }
    );
    const data = await res.json();
    return data.map((d: any) => ({
      lat:     parseFloat(d.lat),
      lng:     parseFloat(d.lon),
      display: d.display_name,
    }));
  } catch {
    return [];
  }
}

export default function GeoAddressPicker({ value, onChange, weightKg = 2, orderAmount = 0, onPriceChange }: Props) {
  const { pricing }    = usePricing();
  const [gpsLoading,   setGpsLoading]   = useState(false);
  const [gpsError,     setGpsError]     = useState('');
  const [suggestions,  setSuggestions]  = useState<{ lat:number; lng:number; display:string }[]>([]);
  const [searchLoading,setSearchLoading]= useState(false);
  const [resolved,     setResolved]     = useState<AddressResult | null>(null);
  const [showMap,      setShowMap]      = useState(false);

  /* Вычислить и сообщить цену */
  const computePrice = useCallback((distKm: number) => {
    const result = calcDeliveryPrice({ orderAmount, distanceKm:distKm, weightKg, pricing });
    onPriceChange?.(result, distKm);
    return result;
  }, [orderAmount, weightKg, pricing, onPriceChange]);

  /* GPS — получить текущее местоположение */
  const useGPS = () => {
    if (!navigator.geolocation) {
      setGpsError('GPS недоступен в вашем браузере');
      return;
    }
    setGpsLoading(true);
    setGpsError('');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        const distKm = calcDistanceKm(STORE_LAT, STORE_LNG, lat, lng);
        const addr   = await reverseGeocode(lat, lng);
        const price  = computePrice(distKm);
        const result: AddressResult = { address: addr || `${lat.toFixed(5)}, ${lng.toFixed(5)}`, lat, lng, distanceKm: distKm };
        setResolved(result);
        setShowMap(true);
        onChange(addr || `${lat.toFixed(5)}, ${lng.toFixed(5)}`);
        setGpsLoading(false);
      },
      (err) => {
        setGpsError(
          err.code === 1 ? 'Доступ к GPS запрещён. Разреши в настройках браузера.' :
          err.code === 2 ? 'GPS сигнал недоступен. Попробуй ещё раз.' :
          'Время ожидания GPS истекло. Попробуй ещё раз.'
        );
        setGpsLoading(false);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  };

  /* Поиск адреса по тексту */
  let searchTimer: ReturnType<typeof setTimeout>;
  const handleInput = (val: string) => {
    onChange(val);
    setResolved(null);
    clearTimeout(searchTimer);
    if (val.length < 3) { setSuggestions([]); return; }
    setSearchLoading(true);
    searchTimer = setTimeout(async () => {
      const results = await forwardGeocode(val);
      setSuggestions(results);
      setSearchLoading(false);
    }, 600);
  };

  /* Выбрать из подсказок */
  const pickSuggestion = (s: { lat:number; lng:number; display:string }) => {
    const distKm = calcDistanceKm(STORE_LAT, STORE_LNG, s.lat, s.lng);
    const result: AddressResult = { address: s.display.split(',').slice(0,3).join(','), lat:s.lat, lng:s.lng, distanceKm:distKm };
    setResolved(result);
    setShowMap(true);
    onChange(result.address);
    setSuggestions([]);
    computePrice(distKm);
  };

  const price = resolved ? computePrice(resolved.distanceKm) : null;

  return (
    <div style={{ position:'relative' }}>

      {/* Input + GPS button */}
      <div style={{ position:'relative', display:'flex', gap:8 }}>
        <div style={{ flex:1, position:'relative' }}>
          <div style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', pointerEvents:'none', fontSize:16, zIndex:2 }}>📍</div>
          <input
            className="kakapo-input"
            value={value}
            onChange={e => handleInput(e.target.value)}
            placeholder="Улица, дом или нажми 📡 GPS"
            style={{ paddingLeft:38, paddingRight:searchLoading?36:14 }}
          />
          {searchLoading && (
            <div style={{ position:'absolute', right:12, top:'50%', transform:'translateY(-50%)', width:16, height:16, borderRadius:'50%', border:'2px solid rgba(31,215,96,.3)', borderTopColor:'var(--gr)', animation:'spin 1s linear infinite' }}/>
          )}
        </div>

        {/* GPS кнопка */}
        <button
          type="button"
          onClick={useGPS}
          disabled={gpsLoading}
          style={{ flexShrink:0, width:48, height:48, borderRadius:13, background:resolved?'rgba(31,215,96,.12)':'var(--l3)', border:`1.5px solid ${resolved?'rgba(31,215,96,.4)':'var(--b1)'}`, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', fontSize:20, transition:'all .2s', boxShadow:resolved?'0 4px 14px rgba(31,215,96,.2)':undefined }}
          title="Определить мой адрес по GPS"
        >
          {gpsLoading
            ? <div style={{ width:18, height:18, borderRadius:'50%', border:'2.5px solid rgba(31,215,96,.3)', borderTopColor:'var(--gr)', animation:'spin 1s linear infinite' }}/>
            : resolved ? '✅' : '📡'
          }
        </button>
      </div>

      {/* GPS error */}
      {gpsError && (
        <div style={{ marginTop:8, padding:'9px 12px', borderRadius:10, background:'rgba(255,69,69,.08)', border:'1px solid rgba(255,69,69,.25)', fontSize:12, color:'var(--red)', display:'flex', alignItems:'center', gap:7 }}>
          ⚠️ {gpsError}
        </div>
      )}

      {/* Autocomplete suggestions */}
      {suggestions.length > 0 && (
        <div style={{ position:'absolute', top:'calc(100% + 6px)', left:0, right:0, zIndex:50, background:'var(--l1)', border:'1px solid var(--b1)', borderRadius:14, overflow:'hidden', boxShadow:'0 12px 40px rgba(0,0,0,.6)' }}>
          {suggestions.map((s, i) => (
            <div key={i} onClick={() => pickSuggestion(s)}
              style={{ padding:'11px 14px', cursor:'pointer', borderBottom:i<suggestions.length-1?'1px solid var(--b1)':'none', transition:'background .15s', display:'flex', alignItems:'center', gap:10 }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(31,215,96,.06)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
              <span style={{ fontSize:16, flexShrink:0 }}>📍</span>
              <span style={{ fontSize:12, lineHeight:1.4, color:'var(--t1)' }}>{s.display.split(',').slice(0,4).join(', ')}</span>
            </div>
          ))}
        </div>
      )}

      {/* GPS resolved — map + price breakdown */}
      {resolved && showMap && price && (
        <div style={{ marginTop:10, borderRadius:16, overflow:'hidden', border:'1px solid rgba(31,215,96,.25)' }}>

          {/* Mini map */}
          <div style={{ height:130, background:'linear-gradient(135deg,#050F08,#091814)', position:'relative', overflow:'hidden' }}>
            <div style={{ position:'absolute', inset:0, opacity:.06, background:'repeating-linear-gradient(0deg,transparent,transparent 16px,rgba(31,215,96,1) 16px,rgba(31,215,96,1) 17px),repeating-linear-gradient(90deg,transparent,transparent 16px,rgba(31,215,96,1) 16px,rgba(31,215,96,1) 17px)' }}/>

            {/* Store marker */}
            <div style={{ position:'absolute', left:'35%', top:'40%', display:'flex', flexDirection:'column', alignItems:'center', gap:2 }}>
              <div style={{ width:28, height:28, borderRadius:'50%', background:'linear-gradient(135deg,var(--gr3),var(--gr))', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'Unbounded', fontSize:11, fontWeight:900, color:'var(--bg)', boxShadow:'0 0 12px rgba(31,215,96,.6)' }}>K</div>
              <span style={{ fontSize:9, color:'rgba(255,255,255,.6)', whiteSpace:'nowrap', background:'rgba(0,0,0,.5)', padding:'1px 5px', borderRadius:4 }}>Магазин</span>
            </div>

            {/* Client marker */}
            <div style={{ position:'absolute', right:'25%', top:'30%', display:'flex', flexDirection:'column', alignItems:'center', gap:2 }}>
              <div style={{ width:28, height:28, borderRadius:'50%', background:'var(--blue)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, boxShadow:'0 0 12px rgba(59,142,240,.6)', position:'relative' }}>
                🏠
                <div style={{ position:'absolute', inset:-3, borderRadius:'50%', border:'2px solid var(--blue)', animation:'ping 2s ease-out infinite', opacity:.4 }}/>
              </div>
              <span style={{ fontSize:9, color:'rgba(255,255,255,.6)', whiteSpace:'nowrap', background:'rgba(0,0,0,.5)', padding:'1px 5px', borderRadius:4 }}>Вы</span>
            </div>

            {/* Dotted line */}
            <svg style={{ position:'absolute', inset:0, width:'100%', height:'100%', pointerEvents:'none' }}>
              <line x1="37%" y1="45%" x2="75%" y2="37%" stroke="rgba(31,215,96,.4)" strokeWidth={1.5} strokeDasharray="5,4"/>
            </svg>

            {/* Distance badge */}
            <div style={{ position:'absolute', bottom:8, left:'50%', transform:'translateX(-50%)', padding:'4px 12px', borderRadius:20, background:'rgba(3,11,5,.85)', border:'1px solid rgba(31,215,96,.3)', fontSize:11, fontWeight:700, color:'var(--gr)', whiteSpace:'nowrap' }}>
              📏 {resolved.distanceKm.toFixed(1)} км от магазина
            </div>
          </div>

          {/* Price breakdown */}
          <div style={{ background:'rgba(9,21,8,.95)', padding:'14px 16px' }}>
            <div style={{ fontSize:11, color:'var(--t3)', fontWeight:700, textTransform:'uppercase', letterSpacing:'.5px', marginBottom:10 }}>
              Расчёт стоимости доставки
            </div>

            <div style={{ display:'flex', flexDirection:'column', gap:5, marginBottom:12 }}>
              {price.breakdown.map((line, i) => (
                <div key={i} style={{ display:'flex', alignItems:'center', gap:7, fontSize:12, color:line.startsWith('✅')?'var(--gr)':'var(--t2)' }}>
                  <span>{line}</span>
                </div>
              ))}
            </div>

            {/* Total */}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 12px', borderRadius:12, background:price.isFree?'rgba(31,215,96,.1)':'rgba(255,184,0,.08)', border:`1px solid ${price.isFree?'rgba(31,215,96,.3)':'rgba(255,184,0,.25)'}` }}>
              <div>
                <div style={{ fontSize:13, fontWeight:700, color:price.isFree?'var(--gr)':'var(--t1)' }}>
                  {price.isFree ? '🎉 Доставка бесплатна!' : 'Стоимость доставки'}
                </div>
                {price.freeReason && <div style={{ fontSize:11, color:'var(--t2)', marginTop:2 }}>{price.freeReason}</div>}
              </div>
              <div style={{ textAlign:'right', flexShrink:0 }}>
                {price.isFree
                  ? <span style={{ fontFamily:'Unbounded', fontSize:16, fontWeight:900, color:'var(--gr)' }}>0 ЅМ</span>
                  : <span style={{ fontFamily:'Unbounded', fontSize:16, fontWeight:900, color:'var(--gd)' }}>{price.total.toFixed(2)} ЅМ</span>
                }
              </div>
            </div>

            {/* Reset */}
            <button type="button" onClick={() => { setResolved(null); setShowMap(false); onChange(''); }}
              style={{ marginTop:10, fontSize:11, color:'var(--t3)', background:'transparent', border:'none', cursor:'pointer', fontFamily:'Nunito', fontWeight:600, display:'flex', alignItems:'center', gap:4 }}>
              ✕ Изменить адрес
            </button>
          </div>
        </div>
      )}

      {/* Hint when no address yet */}
      {!resolved && !value && (
        <div style={{ marginTop:8, display:'flex', alignItems:'center', gap:8, fontSize:12, color:'var(--t3)' }}>
          <span>💡</span>
          <span>Нажми <span style={{ color:'var(--gr)', fontWeight:700 }}>📡</span> чтобы автоматически определить адрес и цену доставки</span>
        </div>
      )}
    </div>
  );
}
