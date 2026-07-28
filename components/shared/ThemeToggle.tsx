'use client'

import type { CSSProperties } from 'react'
import type { AppTheme } from '@/lib/appTheme'

type Props = {
  theme: AppTheme
  onChange: (theme: AppTheme) => void
  /** compact — только иконки; row — с подписью для профиля/настроек */
  variant?: 'compact' | 'row'
  className?: string
  style?: CSSProperties
}

const TOGGLE_CSS = `
  .kakapo-theme-toggle{display:inline-flex;align-items:center;gap:2px;padding:3px;border-radius:12px;background:var(--l3,var(--card2,#0C1C0F));border:1.5px solid var(--b1,var(--border,#162B1A));flex-shrink:0;}
  .kakapo-theme-toggle button{width:34px;height:30px;border-radius:9px;display:flex;align-items:center;justify-content:center;color:var(--t3,var(--muted,#3D6645));border:none;background:transparent;cursor:pointer;transition:background .15s,color .15s;font-size:15px;line-height:1;padding:0;}
  .kakapo-theme-toggle button:hover{color:var(--t1,var(--text,#EBF5ED));}
  .kakapo-theme-toggle button.on{background:var(--l1,var(--card,#06100A));color:var(--gr,var(--green,#1FD760));box-shadow:0 1px 4px rgba(0,0,0,.12);}
  html[data-theme="light"] .kakapo-theme-toggle button.on{box-shadow:0 1px 4px rgba(12,26,16,.12);}
  .kakapo-theme-row{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;padding:12px 14px;border-radius:14px;background:var(--l2,var(--card,#091508));border:1px solid var(--b1,var(--border,#162B1A));cursor:default;}
  .kakapo-theme-row .lbl{font-size:13px;font-weight:700;color:var(--t1,var(--text,#EBF5ED));}
  .kakapo-theme-row .sub{font-size:11px;color:var(--t2,var(--muted,#8FB897));margin-top:2px;}
`

export default function ThemeToggle({ theme, onChange, variant = 'compact', className, style }: Props) {
  const toggle = (
    <div className={`kakapo-theme-toggle${className ? ` ${className}` : ''}`} role="group" aria-label="Тема" style={variant === 'compact' ? style : undefined}>
      <button
        type="button"
        className={theme === 'dark' ? 'on' : ''}
        aria-label="Тёмная тема"
        aria-pressed={theme === 'dark'}
        onClick={() => onChange('dark')}
        title="Тёмная"
      >
        🌙
      </button>
      <button
        type="button"
        className={theme === 'light' ? 'on' : ''}
        aria-label="Светлая тема"
        aria-pressed={theme === 'light'}
        onClick={() => onChange('light')}
        title="Светлая"
      >
        ☀️
      </button>
    </div>
  )

  return (
    <>
      <style>{TOGGLE_CSS}</style>
      {variant === 'row' ? (
        <div className="kakapo-theme-row" style={style}>
          <div>
            <div className="lbl">Оформление</div>
            <div className="sub">{theme === 'light' ? 'Светлая тема' : 'Тёмная тема'}</div>
          </div>
          {toggle}
        </div>
      ) : (
        toggle
      )}
    </>
  )
}
