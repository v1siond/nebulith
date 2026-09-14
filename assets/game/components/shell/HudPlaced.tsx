import type { ReactNode } from 'react'

import { hudStyle } from '@/engine/hudLayout'
import type { HudPlacement } from '@/components/game/shell/playerUi.data'
import { layoutFor } from '@/game/uiProfile'

/**
 * Put a piece of the HUD where the PROFILE says, not where a Tailwind literal says.
 *
 * They could not be moved because their position was `fixed bottom-16 left-1/2` written into
 * the markup — there was nothing to move. Wrapping a piece in this makes its position DATA: the profile's
 * placement for that element, in the form factor being played.
 *
 * The placement model is anchor + offset (see `hudLayout`), so "16 up from the bottom-left" still means the
 * bottom-left on a phone, a laptop and a 4K monitor.
 *
 * No placement, no render — and it says why. The seeded default carries one for every element in the
 * inventory, so a missing placement means the profile did not load, and drawing the piece at a position
 * this file invented is exactly the hardcoded fallback the migration exists to remove.
 */
export function HudPlaced({
  element,
  form = 'Desktop',
  children,
}: {
  element: string
  form?: 'Desktop' | 'Mobile'
  children: ReactNode
}) {
  const placement = layoutFor(form)[element] as unknown as HudPlacement | undefined
  if (!placement) return null
  if (placement.on === false) return null // the author turned this piece off

  return (
    <div className="fixed" style={hudStyle(placement)}>
      {children}
    </div>
  )
}
