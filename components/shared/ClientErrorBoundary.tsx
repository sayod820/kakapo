'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = {
  children: ReactNode
  title?: string
}

type State = {
  hasError: boolean
  message: string
}

export default class ClientErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' }

  static getDerivedStateFromError(error: unknown): State {
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка'
    return { hasError: true, message }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('[kakapo] UI error:', error, info.componentStack)
  }

  private retry = () => {
    this.setState({ hasError: false, message: '' })
  }

  render() {
    if (!this.state.hasError) return this.props.children

    const title = this.props.title || 'Не удалось открыть раздел'

    return (
      <div style={{
        minHeight: '60vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: '#030B05',
        color: '#EBF5ED',
        fontFamily: 'Nunito, sans-serif',
      }}>
        <div style={{
          maxWidth: 420,
          width: '100%',
          padding: '28px 24px',
          borderRadius: 18,
          background: '#0C1C0F',
          border: '1px solid #162B1A',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
          <div style={{ fontFamily: 'Unbounded, sans-serif', fontSize: 18, fontWeight: 800, marginBottom: 10 }}>
            {title}
          </div>
          <div style={{ fontSize: 13, color: '#8FB897', lineHeight: 1.55, marginBottom: 18 }}>
            {this.state.message || 'Проверьте, что сервер API запущен, и обновите страницу.'}
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={this.retry}
              style={{
                padding: '10px 16px',
                borderRadius: 12,
                border: 'none',
                background: 'linear-gradient(135deg,#17B34E,#1FD760)',
                color: '#030B05',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              Повторить
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                padding: '10px 16px',
                borderRadius: 12,
                border: '1px solid #162B1A',
                background: '#091508',
                color: '#8FB897',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Обновить страницу
            </button>
          </div>
        </div>
      </div>
    )
  }
}
