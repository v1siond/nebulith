/**
 * A ZONE'S COLLAPSE HANDLE.
 *
 * Alexander, 2026-09-08: *"all sidebards and panels should be collapsable."*
 *
 * One affordance, used by every zone, so learning it once teaches all of them. Two rules it keeps:
 *
 *  · **A collapsed zone leaves a strip carrying its name and the way back.** Removing it outright is the
 *    same "no way out" trap as a Play mode that hides its own Stop button — a prototype did exactly that
 *    and the only escape was reloading the page.
 *  · **The chevron points where the panel will GO**, not where it is. « means "fold away to the left".
 */

export interface ZoneCollapseProps {
  /** The zone's name, shown down the strip when it is shut. */
  name: string
  shut: boolean
  /** Which way the zone folds — a left-hand zone folds left. */
  side: 'left' | 'right'
  onToggle: () => void
}

export function ZoneCollapse({ name, shut, side, onToggle }: ZoneCollapseProps) {
  // Shut: the arrow points back INTO the layout (the direction it will reopen).
  // Open: it points at the edge it folds toward.
  const arrow = side === 'left' ? (shut ? '»' : '«') : shut ? '«' : '»'
  return (
    <button
      type="button"
      className="zcol"
      aria-expanded={!shut}
      title={shut ? `Show ${name}` : `Hide ${name}`}
      aria-label={shut ? `Show ${name}` : `Hide ${name}`}
      onClick={onToggle}
    >
      <span aria-hidden="true">{arrow}</span>
      <span className="zname">{name}</span>
    </button>
  )
}

/** The three collapsible zones. */
export type EditorZoneId = 'rail' | 'panel' | 'insp'

/** Which zones are currently folded away. */
export type EditorZoneShut = Record<EditorZoneId, boolean>

export const NO_ZONES_SHUT: EditorZoneShut = { rail: false, panel: false, insp: false }

/**
 * The `.ed` modifier classes for a collapse state.
 *
 * `inspAbsent` is not the same as `insp: true`: a collapsed inspector keeps its strip, an absent one gives
 * its whole column to the map. Nothing is selected, so there is nothing to reopen.
 */
export function zoneClasses(shut: EditorZoneShut, inspAbsent: boolean): string {
  const parts: string[] = []
  if (shut.rail) parts.push('rail-shut')
  if (shut.panel) parts.push('panel-shut')
  if (inspAbsent) parts.push('insp-none')
  else if (shut.insp) parts.push('insp-shut')
  return parts.join(' ')
}
