/** Сессия сотрудника «Торговля» после входа по паролю */
import { createRoleSession } from './roleSession'
import type { TradePageId } from './tradeAccess'

export interface TradeEmployeeSession {
  employeeId: string
  name: string
  role: string
  permissions: TradePageId[]
}

const session = createRoleSession<TradeEmployeeSession>(
  'kakapo_trade_employee_session',
  (s): s is TradeEmployeeSession =>
    !!s?.employeeId && !!s?.name && Array.isArray(s.permissions),
)

export const loadTradeEmployeeSession = session.load
export const saveTradeEmployeeSession = session.save
export const clearTradeEmployeeSession = session.clear
