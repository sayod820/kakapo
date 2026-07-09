'use client'

import type { Product } from '@/lib/types'

function money(n: number | undefined | null) {
  return `${(Number(n) || 0).toFixed(2)} сом`
}

/** Раздел «Склад» — следующий этап после «Товары» */
export default function WarehouseModule({ products }: { products: Product[] }) {
  const totalStock = products.reduce((s, p) => s + (Number(p.stock) || 0), 0)
  const low = products.filter(p => Number(p.stock) > 0 && Number(p.stock) <= 5).length
  const out = products.filter(p => Number(p.stock) <= 0).length

  return (
    <div>
      <div className="k-page-h">
        <div>
          <h1>🏬 Склад</h1>
          <div className="sub">Следующий раздел — приход, списание, ревизия и сроки годности</div>
        </div>
      </div>

      <div className="k-kpis">
        <div className="k-kpi"><div className="kl">Позиций в каталоге</div><div className="kv">{products.length}</div></div>
        <div className="k-kpi"><div className="kl">Суммарный остаток</div><div className="kv">{totalStock}</div></div>
        <div className="k-kpi"><div className="kl">Мало на складе</div><div className="kv" style={{ color: 'var(--gold)' }}>{low}</div></div>
        <div className="k-kpi"><div className="kl">Нет в наличии</div><div className="kv" style={{ color: 'var(--red)' }}>{out}</div></div>
      </div>

      <section className="k-card">
        <div className="k-card-b" style={{ padding: 28 }}>
          <div style={{ maxWidth: 520, margin: '0 auto', textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🏬</div>
            <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 8 }}>Склад подключается к разделу «Товары»</div>
            <p style={{ color: 'var(--muted)', lineHeight: 1.6, margin: 0 }}>
              Сначала настраиваем каталог товаров. Затем здесь появятся приход от поставщиков, списание,
              инвентаризация и контроль сроков — все операции будут менять общий остаток <code style={{ color: 'var(--green)' }}>product.stock</code>.
            </p>
            <div style={{ marginTop: 20, display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <span className="k-badge" style={{ background: 'var(--green-d)', color: 'var(--green)' }}>Приход</span>
              <span className="k-badge" style={{ background: '#1a2430', color: 'var(--blue)' }}>Списание</span>
              <span className="k-badge" style={{ background: '#2a2414', color: 'var(--gold)' }}>Ревизия</span>
              <span className="k-badge" style={{ background: '#2a1420', color: 'var(--purple)' }}>Сроки</span>
            </div>
          </div>
        </div>
      </section>

      {out > 0 && (
        <section className="k-card" style={{ marginTop: 16 }}>
          <div className="k-card-h"><b>Товары без остатка ({out})</b></div>
          <div className="k-card-b" style={{ padding: 0 }}>
            <table className="k-tbl">
              <thead><tr><th>Товар</th><th className="num">Цена</th><th className="num">Остаток</th></tr></thead>
              <tbody>
                {products.filter(p => Number(p.stock) <= 0).slice(0, 12).map(p => (
                  <tr key={p.id}>
                    <td>{p.e || '📦'} {p.name}</td>
                    <td className="num">{money(p.price)}</td>
                    <td className="num" style={{ color: 'var(--red)' }}>0</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
