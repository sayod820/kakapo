/**
 * Отдать кадр UI во время фонового sync (без смены бизнес-логики).
 * Не worker — но event loop не залипает на длинном flush.
 */
export function yieldToUi(): Promise<void> {
  return new Promise(resolve => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        setTimeout(resolve, 0)
      })
    } else {
      setTimeout(resolve, 0)
    }
  })
}

/** Пока кассир пробивает/оплачивает — ждём, очередь не теряем */
export async function waitWhilePaymentCritical(pollMs = 120): Promise<void> {
  const { isCashierPaymentCritical } = await import('./cashierUiGate')
  while (isCashierPaymentCritical()) {
    await new Promise<void>(r => setTimeout(r, pollMs))
  }
}

/** Между операциями: пауза оплаты + отдать UI */
export async function syncBreath(): Promise<void> {
  await waitWhilePaymentCritical()
  await yieldToUi()
}
