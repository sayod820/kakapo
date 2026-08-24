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

export default function RevisionStepBar({ step }: { step: 'scope' | 'walk' | 'devices' }) {
  const walkDone = step === 'walk' || step === 'devices'
  const devicesActive = step === 'devices'
  return (
    <div className="k-rev-steps">
      <StepPill n={1} label="Фильтр" active={step === 'scope'} done={walkDone} />
      <div className={`k-rev-step-line${walkDone ? ' on' : ''}`} />
      <StepPill n={2} label="Обход" active={step === 'walk'} done={devicesActive} />
      <div className={`k-rev-step-line${devicesActive ? ' on' : ''}`} />
      <StepPill n={3} label="Устройства" active={devicesActive} />
    </div>
  )
}
