'use client'

/** Brand pieces from KAKAPO_NextJS_Design_Kit_v1 */

export function KakapoLogo() {
  return (
    <span className="brand" aria-label="КАКАПО">
      <span className="brand-stars" aria-hidden="true">
        ✦ ✦ ✦ ✦ ✦ ✦ ✦
      </span>
      <span className="brand-text">КАКАПО</span>
    </span>
  )
}

export function NationalEmblem({ className = 'emblem' }: { className?: string }) {
  return (
    <img className={className} src="/assets/emblem.svg" alt="" aria-hidden />
  )
}

export function TierBadge({ name, vip = false }: { name: string; vip?: boolean }) {
  return (
    <span className="tier-badge">
      {vip ? '♛ ' : ''}
      {name}
    </span>
  )
}
