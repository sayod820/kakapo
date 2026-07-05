/** Сессия курьера после входа по телефону */
import { createRoleSession } from './roleSession'

export interface CourierSession {
  phone: string
  courierId: string
  name: string
}

const session = createRoleSession<CourierSession>(
  'kakapo_courier_session',
  (s): s is CourierSession => !!s?.phone && !!s?.courierId
)

export const loadCourierSession = session.load
export const saveCourierSession = session.save
export const clearCourierSession = session.clear
