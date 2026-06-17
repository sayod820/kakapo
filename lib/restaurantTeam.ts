export interface RestaurantLoginProfile {
  id: string
  name: string
  phone: string
  emoji: string
  blocked?: boolean
  otp?: string
}

export const DEFAULT_RESTAURANT_OTP = '1234'

export function findRestaurantByPhone(
  restaurants: RestaurantLoginProfile[],
  phone: string,
): RestaurantLoginProfile | undefined {
  const digits = phone.replace(/\D/g, '')
  const tail = digits.slice(-9)
  if (tail.length < 9) return undefined
  return restaurants.find(r => {
    const rd = r.phone.replace(/\D/g, '')
    return rd === digits || rd.endsWith(tail) || rd.slice(-9) === tail
  })
}

export function verifyRestaurantOtp(
  restaurants: RestaurantLoginProfile[],
  phone: string,
  code: string,
): { ok: true; restaurant: RestaurantLoginProfile } | { ok: false; error: string } {
  const restaurant = findRestaurantByPhone(restaurants, phone)
  if (!restaurant) {
    return { ok: false, error: 'Номер не найден · проверьте данные партнёра в админке' }
  }
  if (restaurant.blocked) {
    return { ok: false, error: 'Доступ заблокирован администратором' }
  }
  const expected = restaurant.otp || DEFAULT_RESTAURANT_OTP
  if (String(code) !== expected) {
    return { ok: false, error: `Неверный код · Демо: ${expected}` }
  }
  return { ok: true, restaurant }
}
