/**
 * L13 test-only chaos hooks (real API child process). Active when KAKAPO_L13_TEST_API=1.
 */
'use strict'

const state = {
  holdAt: null,
  holding: false,
  release: null,
}

export function getL13ChaosState() {
  return {
    holdAt: state.holdAt,
    holding: state.holding,
  }
}

export function setL13ChaosHoldAt(point) {
  state.holdAt = point ? String(point) : null
}

export function releaseL13ChaosHold() {
  if (typeof state.release === 'function') {
    try { state.release() } catch { /* ignore */ }
  }
  state.release = null
  state.holding = false
  // Clear hold point so later mutations are not re-held indefinitely.
  state.holdAt = null
}

function testChaosEnabled() {
  return process.env.KAKAPO_L13_TEST_API === '1' || process.env.KAKAPO_O8_TEST_API === '1'
}

export async function maybeL13Hold(point) {
  if (!testChaosEnabled()) return
  const p = String(point || '')
  if (!state.holdAt || state.holdAt !== p) return
  state.holding = true
  await new Promise((resolve) => {
    state.release = resolve
  })
  state.holding = false
  state.release = null
}
