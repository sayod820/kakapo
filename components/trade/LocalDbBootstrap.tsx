'use client'

import { useEffect, useState } from 'react'
import {
  isLocalBootstrapComplete,
  pingApiForBootstrap,
  runLocalBootstrap,
  type BootstrapProgress,
} from '@/lib/offlineBootstrap'

/**
 * Экран первой установки кассы: качает все данные в локальную базу на ПК.
 * При обрыве света/интернета — можно продолжить докачку.
 */
export default function LocalDbBootstrap({
  theme = 'light',
  onDone,
}: {
  theme?: 'dark' | 'light'
  onDone: () => void
}) {
  const [checking, setChecking] = useState(true)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<BootstrapProgress | null>(null)
  const [error, setError] = useState('')
  const [online, setOnline] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const done = await isLocalBootstrapComplete()
        if (cancelled) return
        if (done) {
          onDone()
          return
        }
        const alive = await pingApiForBootstrap()
        if (cancelled) return
        setOnline(alive)
      } finally {
        if (!cancelled) setChecking(false)
      }
    })()
    return () => { cancelled = true }
  }, [onDone])

  async function startDownload() {
    setBusy(true)
    setError('')
    const alive = await pingApiForBootstrap()
    setOnline(alive)
    if (!alive) {
      setError('Нет интернета. Подключите сеть к ПК и нажмите снова.')
      setBusy(false)
      return
    }
    const res = await runLocalBootstrap(p => setProgress(p))
    setBusy(false)
    if (!res.ok) {
      setError(res.error || 'Не удалось загрузить данные')
      return
    }
    onDone()
  }

  if (checking) {
    return (
      <div className="ldb-wrap" data-theme={theme}>
        <style>{CSS}</style>
        <div className="ldb-card">
          <div className="ldb-title">Локальная база</div>
          <div className="ldb-sub">Проверка…</div>
        </div>
      </div>
    )
  }

  const pct = progress
    ? Math.round((progress.done / Math.max(1, progress.total)) * 100)
    : 0

  return (
    <div className="ldb-wrap" data-theme={theme}>
      <style>{CSS}</style>
      <div className="ldb-card">
        <div className="ldb-badge">KAKAPO Касса</div>
        <h1 className="ldb-title">Загрузка данных на ПК</h1>
        <p className="ldb-sub">
          Один раз скачиваем товары, клиентов, сотрудников и кассы в локальную базу.
          Потом касса работает шустро даже без интернета. При обрыве света или сети
          данные не пропадут — докачаем с этого же места.
        </p>

        {!online && (
          <div className="ldb-warn">
            Интернета нет. Подключите ПК к сети, чтобы загрузить базу.
          </div>
        )}

        {error ? <div className="ldb-err">{error}</div> : null}

        {busy && progress ? (
          <div className="ldb-prog">
            <div className="ldb-prog-label">{progress.label}</div>
            <div className="ldb-bar">
              <div className="ldb-bar-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="ldb-prog-meta">{progress.done} / {progress.total} · {pct}%</div>
          </div>
        ) : null}

        <button
          type="button"
          className="ldb-btn"
          disabled={busy}
          onClick={() => void startDownload()}
        >
          {busy ? 'Загрузка…' : error ? 'Продолжить загрузку' : 'Скачать всё на ПК'}
        </button>

        <p className="ldb-hint">
          Нужен интернет только для этой первой загрузки и потом для фоновой синхронизации продаж.
        </p>
      </div>
    </div>
  )
}

const CSS = `
.ldb-wrap{
  min-height:100vh;display:flex;align-items:center;justify-content:center;
  padding:24px;background:var(--bg,#F3F7F4);color:var(--text,#0C1A10);
  font-family:'Nunito',system-ui,sans-serif;
}
.ldb-wrap[data-theme="dark"]{--bg:#070C09;--text:#EBF5ED;--card:#0F1A14;--muted:#8AA094;--border:#1E2E26;--green:#1FD760;--err:#FF6B6B;--warn:#E8A317;}
.ldb-wrap[data-theme="light"]{--bg:#F3F7F4;--text:#0C1A10;--card:#FFFFFF;--muted:#5A6B60;--border:#D5E0D8;--green:#129B45;--err:#DC2626;--warn:#B45309;}
.ldb-card{
  width:min(440px,100%);background:var(--card);border:1.5px solid var(--border);
  border-radius:20px;padding:28px 26px 24px;box-shadow:0 18px 40px rgba(12,26,16,.1);
}
.ldb-badge{
  display:inline-block;font-size:11px;font-weight:800;letter-spacing:.4px;
  color:var(--green);background:rgba(31,215,96,.12);border:1px solid rgba(31,215,96,.28);
  padding:4px 10px;border-radius:999px;margin-bottom:14px;
}
.ldb-title{font-size:22px;font-weight:900;margin:0 0 10px;line-height:1.25;}
.ldb-sub{font-size:13.5px;line-height:1.5;color:var(--muted);margin:0 0 18px;}
.ldb-warn,.ldb-err{
  font-size:13px;font-weight:700;padding:10px 12px;border-radius:12px;margin-bottom:14px;
}
.ldb-warn{background:rgba(232,163,23,.12);color:var(--warn);border:1px solid rgba(232,163,23,.3);}
.ldb-err{background:rgba(220,38,38,.1);color:var(--err);border:1px solid rgba(220,38,38,.25);}
.ldb-prog{margin-bottom:16px;}
.ldb-prog-label{font-size:13px;font-weight:800;margin-bottom:8px;}
.ldb-bar{height:10px;border-radius:999px;background:var(--border);overflow:hidden;}
.ldb-bar-fill{height:100%;background:linear-gradient(90deg,var(--green),#14b24f);transition:width .25s ease;}
.ldb-prog-meta{font-size:11px;color:var(--muted);margin-top:6px;font-weight:700;}
.ldb-btn{
  width:100%;padding:14px 16px;border-radius:14px;border:none;cursor:pointer;
  background:linear-gradient(135deg,#1FD760,#14b24f);color:#05210D;
  font-size:15px;font-weight:900;font-family:inherit;
}
.ldb-btn:disabled{opacity:.7;cursor:wait;}
.ldb-hint{font-size:11.5px;color:var(--muted);margin:14px 0 0;line-height:1.4;text-align:center;}
`
