'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'

type QuickPrompt = { id: string; label: string; icon: string; shortcut: string }

const FALLBACK_QUICK: QuickPrompt[] = [
  { id: 'overview', label: 'Полный анализ', icon: '🧠', shortcut: '1' },
  { id: 'bad', label: 'Что плохо сейчас', icon: '⚠️', shortcut: '2' },
  { id: 'top', label: 'Что продаётся', icon: '📈', shortcut: '3' },
  { id: 'unsold', label: 'Что не продаётся', icon: '📉', shortcut: '4' },
  { id: 'suppliers', label: 'Поставщики +/−', icon: '🚚', shortcut: '5' },
  { id: 'debts', label: 'Долги клиентов', icon: '💳', shortcut: '6' },
  { id: 'till', label: 'Касса и смены', icon: '⚖️', shortcut: '7' },
  { id: 'couriers', label: 'Курьеры', icon: '🛵', shortcut: '8' },
  { id: 'assemblers', label: 'Сборщики', icon: '🛒', shortcut: '9' },
  { id: 'restaurants', label: 'Рестораны', icon: '🍽', shortcut: '0' },
]

type HistItem = { id: string; title: string; answer: string; at: string }

function isLocalDevHost(): boolean {
  if (typeof window === 'undefined') return false
  const h = window.location.hostname
  return h === 'localhost' || h === '127.0.0.1'
}

export default function AdminAiAssistantPage() {
  const [quick, setQuick] = useState<QuickPrompt[]>(FALLBACK_QUICK)
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [statusError, setStatusError] = useState('')
  const [model, setModel] = useState('gemini-2.5-flash')
  const [prompt, setPrompt] = useState('')
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [hist, setHist] = useState<HistItem[]>([])
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const refreshStatus = useCallback(async () => {
    setStatusError('')
    try {
      const st = await api.getAdminAiStatus()
      setConfigured(!!st.configured)
      setModel(st.model || 'gemini-2.5-flash')
      if (st.quickPrompts?.length) setQuick(st.quickPrompts)
    } catch (e) {
      setConfigured(null)
      setStatusError(e instanceof Error ? e.message : 'Не удалось связаться с API')
    }
  }, [])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  const ask = useCallback(async (opts: { prompt?: string; quickId?: string; title?: string }) => {
    const text = String(opts.prompt || '').trim()
    if (!opts.quickId && !text) {
      setErr('Введите вопрос или нажмите быстрый запрос')
      return
    }
    setBusy(true)
    setErr('')
    setAnswer('')
    try {
      const res = await api.askAdminAi({
        prompt: text || undefined,
        quickId: opts.quickId,
      })
      setAnswer(res.answer)
      setPrompt(res.prompt)
      const title = opts.title || (text.slice(0, 48) || 'Запрос')
      setHist(h => [{
        id: `${Date.now()}`,
        title,
        answer: res.answer,
        at: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
      }, ...h].slice(0, 12))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка ИИ')
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.altKey || e.metaKey)) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
        if (!(e.altKey && e.key === 'Enter')) return
      }
      if (e.altKey && e.key === 'Enter') {
        e.preventDefault()
        void ask({ prompt })
        return
      }
      const key = e.key
      const hit = quick.find(q => q.shortcut === key)
      if (!hit) return
      e.preventDefault()
      void ask({ quickId: hit.id, title: hit.label })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ask, prompt, quick])

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12,
        marginBottom: 16, flexWrap: 'wrap',
      }}>
        <div>
          <div style={{ fontSize: 12, color: '#8FB897', fontWeight: 700, lineHeight: 1.5 }}>
            Только для владельца в админке. ИИ смотрит сводку по кассе, товарам, долгам, курьерам, сборщикам и ресторанам.
          </div>
          <div style={{ fontSize: 11, color: '#3D6645', marginTop: 6 }}>
            Быстрые клавиши: <b style={{ color: '#8FB897' }}>Alt + 0…9</b> · отправить: <b style={{ color: '#8FB897' }}>Alt + Enter</b>
            {configured != null && (
              <> · Gemini: <b style={{ color: configured ? '#1FD760' : '#FF4545' }}>{configured ? `готов (${model})` : 'нет ключа'}</b></>
            )}
            {configured == null && statusError && (
              <> · API: <b style={{ color: '#FF4545' }}>нет связи</b></>
            )}
          </div>
        </div>
        <button
          type="button"
          className="ab"
          onClick={() => void refreshStatus()}
          style={{ padding: '8px 12px', background: '#0C1C0F', border: '1px solid #162B1A', color: '#8FB897', flexShrink: 0 }}
        >
          Обновить
        </button>
      </div>

      {statusError && (
        <div style={{
          marginBottom: 14, padding: '12px 14px', borderRadius: 12,
          background: 'rgba(255,69,69,.08)', border: '1px solid rgba(255,69,69,.3)',
          fontSize: 12, color: '#FF8080', fontWeight: 700, lineHeight: 1.5,
        }}>
          Не удалось связаться с backend API: {statusError}
          <div style={{ marginTop: 6, color: '#EBF5ED', fontWeight: 600 }}>
            Запустите API: <code>npm run dev --prefix server/kakapo-api</code> или <code>npm run dev:all</code>
          </div>
        </div>
      )}

      {configured === false && !statusError && (
        <div style={{
          marginBottom: 14, padding: '12px 14px', borderRadius: 12,
          background: 'rgba(255,184,0,.08)', border: '1px solid rgba(255,184,0,.3)',
          fontSize: 12, color: '#FFB800', fontWeight: 700, lineHeight: 1.5,
        }}>
          {isLocalDevHost() ? (
            <>
              Локально (ПК): добавьте ключ в <code style={{ color: '#EBF5ED' }}>server/kakapo-api/.env</code>:
              <div style={{ marginTop: 6, fontFamily: 'monospace', color: '#EBF5ED' }}>GEMINI_API_KEY=ваш_ключ</div>
              Затем перезапустите API: <code style={{ color: '#EBF5ED' }}>npm run dev --prefix server/kakapo-api</code>
            </>
          ) : (
            <>
              На сервере: ключ в <code style={{ color: '#EBF5ED' }}>deploy/hetzner/.env</code> (не в .env на ПК).
              <div style={{ marginTop: 6, fontFamily: 'monospace', color: '#EBF5ED' }}>GEMINI_API_KEY=AIzaSy...</div>
              <div style={{ marginTop: 6, color: '#EBF5ED', fontWeight: 600 }}>
                SSH на сервер → <code style={{ color: '#EBF5ED' }}>cd /opt/kakapo && git pull && bash deploy/hetzner/set-gemini-key.sh</code>
              </div>
            </>
          )}
          <div style={{ marginTop: 6 }}>Ключ: <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" style={{ color: '#1FD760' }}>Google AI Studio</a> (бесплатно, формат AIzaSy...)</div>
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <div className="ub" style={{ fontSize: 12, fontWeight: 800, color: '#8FB897', marginBottom: 8 }}>
          Быстрые запросы
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
          {quick.map(q => (
            <button
              key={q.id}
              type="button"
              disabled={busy}
              onClick={() => void ask({ quickId: q.id, title: q.label })}
              className="btn"
              style={{
                padding: '12px 12px', borderRadius: 12, textAlign: 'left',
                background: '#091508', border: '1px solid #162B1A',
                color: '#EBF5ED', cursor: busy ? 'wait' : 'pointer',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: 18 }}>{q.icon}</span>
                <span style={{
                  fontSize: 10, fontWeight: 800, color: '#3D6645',
                  padding: '2px 6px', borderRadius: 6, background: '#0C1C0F', border: '1px solid #162B1A',
                }}>
                  Alt+{q.shortcut}
                </span>
              </div>
              <div style={{ fontSize: 12, fontWeight: 800 }}>{q.label}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="ac" style={{ padding: 16, marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: '#8FB897', fontWeight: 700, marginBottom: 8 }}>Свой вопрос</div>
        <textarea
          ref={inputRef}
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder="Например: какие товары заказать на неделю и кого из должников проверить?"
          rows={3}
          style={{
            width: '100%', resize: 'vertical', minHeight: 80,
            background: '#0C1C0F', border: '1.5px solid #162B1A', borderRadius: 12,
            color: '#EBF5ED', padding: '12px 14px', fontFamily: 'Nunito, sans-serif',
            fontSize: 13, outline: 'none', boxSizing: 'border-box',
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.altKey || e.metaKey)) {
              e.preventDefault()
              void ask({ prompt })
            }
          }}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="ab abg"
            disabled={busy || !prompt.trim()}
            onClick={() => void ask({ prompt })}
            style={{ padding: '10px 16px', opacity: busy || !prompt.trim() ? .6 : 1 }}
          >
            {busy ? 'Думаю…' : 'Спросить ИИ'}
          </button>
          <button
            type="button"
            className="ab"
            disabled={busy}
            onClick={() => { setPrompt(''); setAnswer(''); setErr(''); inputRef.current?.focus() }}
            style={{ padding: '10px 14px', background: '#0C1C0F', border: '1px solid #162B1A', color: '#8FB897' }}
          >
            Очистить
          </button>
        </div>
        {err && (
          <div style={{ marginTop: 10, fontSize: 12, color: '#FF4545', fontWeight: 700 }}>{err}</div>
        )}
      </div>

      {(busy || answer) && (
        <div className="ac" style={{ padding: 18, marginBottom: 14 }}>
          <div className="ub" style={{ fontSize: 13, fontWeight: 800, marginBottom: 10, color: '#1FD760' }}>
            {busy ? 'Анализ…' : 'Ответ ИИ'}
          </div>
          {busy ? (
            <div style={{ fontSize: 13, color: '#8FB897' }}>Собираю данные приложения и спрашиваю Gemini…</div>
          ) : (
            <div style={{
              whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.55, color: '#EBF5ED', fontWeight: 600,
            }}>
              {answer}
            </div>
          )}
        </div>
      )}

      {!!hist.length && (
        <div>
          <div className="ub" style={{ fontSize: 12, fontWeight: 800, color: '#8FB897', marginBottom: 8 }}>
            Недавние ответы
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {hist.map(h => (
              <button
                key={h.id}
                type="button"
                className="btn"
                onClick={() => { setAnswer(h.answer); setPrompt(h.title) }}
                style={{
                  textAlign: 'left', padding: '12px 14px', borderRadius: 12,
                  background: '#091508', border: '1px solid #162B1A', color: '#EBF5ED',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <b style={{ fontSize: 12 }}>{h.title}</b>
                  <span style={{ fontSize: 10, color: '#3D6645' }}>{h.at}</span>
                </div>
                <div style={{ fontSize: 11, color: '#8FB897', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {h.answer.replace(/\s+/g, ' ').slice(0, 120)}…
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
