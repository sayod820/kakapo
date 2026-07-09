'use client'

/** Касса (POS) — отдельный раздел внутри «Торговля», не само приложение */
export default function CashierModule() {
  return (
    <div>
      <div className="k-page-h">
        <div>
          <h1>🛒 Касса</h1>
          <div className="sub">
            Точка продажи: сетка товаров, чек, оплата наличными / картой / в долг.
            Работает на тех же товарах и остатках, что разделы «Товары» и «Склад».
          </div>
        </div>
        <span className="k-badge" style={{ background: '#2a2414', color: 'var(--gold)', padding: '6px 12px' }}>Следующий этап</span>
      </div>

      <div className="k-kpis">
        <div className="k-kpi"><div className="kl">Этап 1</div><div className="kv" style={{ fontSize: 16, color: 'var(--green)' }}>Товары ✓</div></div>
        <div className="k-kpi"><div className="kl">Этап 2</div><div className="kv" style={{ fontSize: 16 }}>Склад</div></div>
        <div className="k-kpi"><div className="kl">Этап 3</div><div className="kv" style={{ fontSize: 16, color: 'var(--gold)' }}>Касса</div></div>
        <div className="k-kpi"><div className="kl">Далее</div><div className="kv" style={{ fontSize: 14, color: 'var(--muted)' }}>Клиенты · Долги</div></div>
      </div>

      <section className="k-card">
        <div className="k-card-b" style={{ padding: 36, textAlign: 'center' }}>
          <div style={{ fontSize: 56, marginBottom: 12 }}>🛒</div>
          <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 8 }}>Касса подключается после склада</div>
          <p style={{ color: 'var(--muted)', maxWidth: 480, margin: '0 auto', lineHeight: 1.65 }}>
            Здесь будет интерфейс кассира: категории товаров, корзина, клиент и бонусы,
            способы оплаты. Каждая продажа будет списывать остаток из общего склада.
          </p>
          <div style={{ marginTop: 20, display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            <span className="k-badge" style={{ background: 'var(--green-d)', color: 'var(--green)' }}>Сетка товаров</span>
            <span className="k-badge" style={{ background: '#1a2430', color: 'var(--blue)' }}>Чек и оплата</span>
            <span className="k-badge" style={{ background: '#2a1420', color: 'var(--purple)' }}>QR / карта</span>
            <span className="k-badge" style={{ background: '#2a1414', color: 'var(--red)' }}>Продажа в долг</span>
          </div>
        </div>
      </section>
    </div>
  )
}
