/**
 * Pure platform mutation contract (no Zustand / isTradeLocalFirst).
 * Browser: await apiCall only. Local-first: localFirstOp(localApply).
 * API failure must never call localApply.
 */
export async function racePlatformOpCore(apiCall, localApply, deps) {
  if (deps.isLocalFirst()) {
    return deps.localFirstOp(localApply)
  }
  const data = await apiCall()
  return { offline: false, data }
}
