import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'

const ATTR = 'data-backdrop-down'

/**
 * Закрытие по клику на фон, без ложного закрытия при выделении текста в поле:
 * mousedown внутри → mouseup/click на фоне (общий предок) больше не закрывает окно.
 */
export function backdropCloseProps(onClose: () => void, enabled = true) {
  return {
    onPointerDown(e: ReactPointerEvent<HTMLElement>) {
      e.currentTarget.setAttribute(ATTR, e.target === e.currentTarget ? '1' : '0')
    },
    onClick(e: ReactMouseEvent<HTMLElement>) {
      const startedHere = e.currentTarget.getAttribute(ATTR) === '1'
      e.currentTarget.removeAttribute(ATTR)
      if (enabled && startedHere && e.target === e.currentTarget) onClose()
    },
  }
}
