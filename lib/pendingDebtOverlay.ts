/**
 * Phase D5 — durable pending debt overlay (TS façade + runtime cache).
 */
import type { PendingOp } from './offline'
import type { AdminCard } from './cardCrm'
import type { AdminClient } from './clientCrm'
import {
  DEBT_OVERLAY_UNPARSEABLE,
  OVERLAY_INCLUDED_QUEUE_STATES,
  OVERLAY_EXCLUDED_QUEUE_STATES,
  extractDebtOpFromQueueRow,
  buildPendingDebtOverlay,
  clientDebtDelta,
  cardDebtDelta,
  cardVersionHint,
  applyDebtOverlayToProjection,
  round2,
  overlayCardKey,
} from './pendingDebtOverlayCore.mjs'

export type DebtOverlayMaps = ReturnType<typeof buildPendingDebtOverlay>

export {
  DEBT_OVERLAY_UNPARSEABLE,
  OVERLAY_INCLUDED_QUEUE_STATES,
  OVERLAY_EXCLUDED_QUEUE_STATES,
  extractDebtOpFromQueueRow,
  buildPendingDebtOverlay,
  clientDebtDelta,
  cardDebtDelta,
  cardVersionHint,
  applyDebtOverlayToProjection,
  round2,
  overlayCardKey,
}

let activeOverlay: DebtOverlayMaps | null = null

/** Replace active overlay from durable queue snapshot (call after getPending). */
export function refreshDebtOverlayFromPending(list: PendingOp[] | null | undefined, now = Date.now()): DebtOverlayMaps {
  activeOverlay = buildPendingDebtOverlay(list || [], { now })
  return activeOverlay
}

export function getActiveDebtOverlay(): DebtOverlayMaps | null {
  return activeOverlay
}

export function clearActiveDebtOverlay(): void {
  activeOverlay = null
}

/** Ensure overlay exists; optionally rebuild from list. */
export function ensureDebtOverlay(list?: PendingOp[] | null): DebtOverlayMaps {
  if (list) return refreshDebtOverlayFromPending(list)
  if (activeOverlay) return activeOverlay
  activeOverlay = buildPendingDebtOverlay([], {})
  return activeOverlay
}

/** Async refresh from durable getPending() — call before CRM inbound merges. */
export async function refreshDebtOverlayFromQueue(): Promise<DebtOverlayMaps> {
  try {
    const { getPending } = await import('./offline')
    const list = await getPending()
    return refreshDebtOverlayFromPending(list)
  } catch {
    return ensureDebtOverlay([])
  }
}

export function applyPendingDebtOverlayToClient(
  serverClient: AdminClient,
  localClient?: AdminClient | null,
  overlay?: DebtOverlayMaps | null,
): AdminClient {
  const ov = overlay ?? activeOverlay
  if (!ov || ov.empty) return serverClient
  const r = applyDebtOverlayToProjection(Number(serverClient.debt) || 0, {
    overlay: ov,
    clientId: serverClient.id,
    mode: 'client',
    localDebt: localClient != null ? Number(localClient.debt) : null,
  })
  if (!r.usedOverlay && !r.failSafeLocal) return serverClient
  if (Math.abs(r.debt - (Number(serverClient.debt) || 0)) < 0.0005) return serverClient
  return { ...serverClient, debt: r.debt }
}

export function applyPendingDebtOverlayToCard(
  serverCard: AdminCard,
  localCard?: AdminCard | null,
  overlay?: DebtOverlayMaps | null,
): AdminCard {
  const ov = overlay ?? activeOverlay
  if (!ov || ov.empty) return serverCard
  const cardClientId = String((serverCard as any).clientId || localCard && (localCard as any).clientId || '').trim()
  const r = applyDebtOverlayToProjection(Number(serverCard.debt) || 0, {
    overlay: ov,
    cardNum: serverCard.num,
    cardClientId,
    mode: 'card',
    localDebt: localCard != null ? Number(localCard.debt) : null,
    localDebtPayVersion: localCard != null ? Number(localCard.debtPayVersion) || 0 : null,
    serverDebtPayVersion: Number(serverCard.debtPayVersion) || 0,
  })
  if (!r.usedOverlay && !r.failSafeLocal) {
    // Still raise version hint if ops exist without amount delta edge case
    const hint = cardVersionHint(ov, serverCard.num)
    if (hint > 0) {
      const ver = Math.max(Number(serverCard.debtPayVersion) || 0, Number(localCard?.debtPayVersion) || 0, hint)
      if (ver !== (Number(serverCard.debtPayVersion) || 0)) {
        return { ...serverCard, debtPayVersion: ver }
      }
    }
    return serverCard
  }
  const next: AdminCard = { ...serverCard, debt: r.debt }
  if (r.debtPayVersion != null) {
    next.debtPayVersion = r.debtPayVersion
  }
  return next
}

export function applyPendingDebtOverlayToClients(
  clients: AdminClient[],
  localById?: Map<string, AdminClient>,
  overlay?: DebtOverlayMaps | null,
): AdminClient[] {
  const ov = overlay ?? activeOverlay
  if (!ov || ov.empty || !clients?.length) return clients
  return clients.map(c => applyPendingDebtOverlayToClient(c, localById?.get(String(c.id)), ov))
}

export function applyPendingDebtOverlayToCards(
  cards: AdminCard[],
  localByNum?: Map<string, AdminCard>,
  overlay?: DebtOverlayMaps | null,
): AdminCard[] {
  const ov = overlay ?? activeOverlay
  if (!ov || ov.empty || !cards?.length) return cards
  return cards.map(c => {
    const local = localByNum?.get(overlayCardKey(c.num))
      || [...(localByNum?.values() || [])].find(x => overlayCardKey(x.num) === overlayCardKey(c.num))
    return applyPendingDebtOverlayToCard(c, local, ov)
  })
}
