'use client'

function StepPill({ n, label, active, done }: { n: number; label: string; active: boolean; done?: boolean }) {
  return (
    <div className="k-rev-step-pill">
      <div className={`k-rev-step-n${active ? ' on' : ''}${done && !active ? ' done' : ''}`}>
        {done && !active ? '✓' : n}
      </div>
      <span className={`k-rev-step-lbl${active ? ' on' : ''}${done && !active ? ' done' : ''}`}>
        {label}
      </span>
    </div>
  )
}

export default function RevisionStepBar({ step }: { step: 'scope' | 'count' }) {
  return (
    <div className="k-rev-steps">
      <StepPill n={1} label="Категории" active={step === 'scope'} done={step === 'count'} />
      <div className={`k-rev-step-line${step === 'count' ? ' on' : ''}`} />
      <StepPill n={2} label="Пересчёт" active={step === 'count'} />
    </div>
  )
}
