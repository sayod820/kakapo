/** Сессия кассира после входа по PIN */
import { createRoleSession } from './roleSession'

export interface CashierSession {
  cashierId: string
  name: string
}

const session = createRoleSession<CashierSession>(
  'kakapo_cashier_session',
  (s): s is CashierSession => !!s?.cashierId && !!s?.name
)

export const loadCashierSession = session.load
export const saveCashierSession = session.save
export const clearCashierSession = session.clear
