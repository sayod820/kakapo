/**
 * ONLINE-O11D — StoreApp customer auth gates while SMS OTP is deferred.
 *
 * Demo customer login (local 1234) is NEVER enabled in production builds.
 * Dev/test may opt in only via NEXT_PUBLIC_KAKAPO_DEMO_CUSTOMER_OTP=1.
 */
'use strict'

/** Explicit opt-in for local demo OTP — ignored when NODE_ENV=production. */
export function isDemoCustomerOtpAllowed(): boolean {
  if (process.env.NODE_ENV === 'production') return false
  return String(process.env.NEXT_PUBLIC_KAKAPO_DEMO_CUSTOMER_OTP || '') === '1'
}

/** True when StoreApp must refuse customer SMS login (deferred provider). */
export function isCustomerSmsLoginDeferred(): boolean {
  return !isDemoCustomerOtpAllowed()
}

export const CUSTOMER_SMS_DEFERRED_MESSAGE = 'Вход по SMS временно недоступен.'
