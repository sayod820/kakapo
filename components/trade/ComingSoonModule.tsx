'use client'

/** Заглушка для разделов, которые ещё в разработке */
export default function ComingSoonModule({
  icon,
  title,
  description,
}: {
  icon: string
  title: string
  description: string
}) {
  return (
    <div>
      <div className="k-page-h">
        <div>
          <h1>{icon} {title}</h1>
          <div className="sub">{description}</div>
        </div>
        <span className="k-badge" style={{ background: '#2a2414', color: 'var(--gold)', padding: '6px 12px' }}>Скоро</span>
      </div>
      <section className="k-card">
        <div className="k-card-b" style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 52, marginBottom: 12 }}>{icon}</div>
          <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 8 }}>Раздел «{title}» в разработке</div>
          <p style={{ color: 'var(--muted)', maxWidth: 440, margin: '0 auto', lineHeight: 1.6 }}>
            Сначала настраиваем товары и склад. Этот раздел подключим на следующем этапе —
            данные будут общими со всеми приложениями KAKAPO.
          </p>
        </div>
      </section>
    </div>
  )
}
