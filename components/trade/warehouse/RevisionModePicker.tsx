'use client'

export default function RevisionModePicker({
  onPickCategories,
  onPickWalk,
  onCancel,
}: {
  onPickCategories: () => void
  onPickWalk: () => void
  onCancel?: () => void
}) {
  return (
    <div className="k-rev-mode">
      <div className="k-rev-mode-lbl">Как считать?</div>
      <button type="button" className="k-rev-mode-card" onClick={onPickCategories}>
        <span className="k-rev-mode-ic" style={{ background: 'rgba(59,142,240,.15)', color: '#3B8EF0' }}>📂</span>
        <span className="k-rev-mode-txt">
          <b>По категориям</b>
          <small>Выбрать отделы → большой список пересчёта</small>
        </span>
        <span className="k-rev-mode-go">→</span>
      </button>
      <button type="button" className="k-rev-mode-card" onClick={onPickWalk}>
        <span className="k-rev-mode-ic" style={{ background: 'rgba(31,215,96,.12)', color: 'var(--green)' }}>🚶</span>
        <span className="k-rev-mode-txt">
          <b>Обход</b>
          <small>Товар за товаром · поиск и сканер · «не сделано / сделано»</small>
        </span>
        <span className="k-rev-mode-go">→</span>
      </button>
      {onCancel && (
        <button type="button" className="k-btn k-btn-s k-rev-mode-cancel" onClick={onCancel}>
          Отмена
        </button>
      )}
    </div>
  )
}
