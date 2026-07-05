/** Сессия ресторана после входа по телефону */
import { createRoleSession } from './roleSession'

export interface RestaurantSession {
  restId: string
  phone: string
  name: string
}

const session = createRoleSession<RestaurantSession>(
  'kakapo_restaurant_session',
  (s): s is RestaurantSession => !!s?.restId && !!s?.phone
)

export const loadRestaurantSession = session.load
export const saveRestaurantSession = session.save
export const clearRestaurantSession = session.clear
