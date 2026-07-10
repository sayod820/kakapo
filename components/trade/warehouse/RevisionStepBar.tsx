'use client'

function StepPill({ n, label, active, done }: { n: number; label: string; active: boolean; done?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
      <div style={{
        width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 900, fontSize: 13,
        background: active ? '#3B8EF0' : done ? 'var(--green-d)' : 'var(--card2)',
        color: active ? '#fff' : done ? 'var(--green)' : 'var(--muted)',
        border: `2px solid ${active ? '#3B8EF0' : done ? 'var(--green)' : 'var(--border)'}`,
      }}>
        {done && !active ? '✓' : n}
      </div>
      <span style={{
        fontSize: 13, fontWeight: active ? 900 : 700,
        color: active ? 'var(--text)' : done ? 'var(--green)' : 'var(--muted)',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {label}
      </span>
    </div>
  )
}

export default function RevisionStepBar({ step }: { step: 'scope' | 'count' }) {
  return (
    <div style={{
      flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10,
      padding: '12px 16px', borderBottom: '1px solid var(--border)', background: 'var(--panel)',
    }}>
      <StepPill n={1} label="Категории" active={step === 'scope'} done={step === 'count'} />
      <div style={{ flex: '0 0 24px', height: 2, background: step === 'count' ? 'var(--green)' : 'var(--border)', borderRadius: 1 }} />
      <StepPill n={2} label="Пересчёт" active={step === 'count'} />
    </div>
  )
}
