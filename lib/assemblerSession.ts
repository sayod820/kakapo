/** Сессия сборщика после входа по PIN */
import { createRoleSession } from './roleSession'

export interface AssemblerSession {
  assemblerId: string
  name: string
}

const session = createRoleSession<AssemblerSession>(
  'kakapo_assembler_session',
  (s): s is AssemblerSession => !!s?.assemblerId && !!s?.name
)

export const loadAssemblerSession = session.load
export const saveAssemblerSession = session.save
export const clearAssemblerSession = session.clear
