import { useState, type ReactNode } from 'react'

/**
 * THE CHARACTER PANEL, one panel, tabs down the side, WoW / Resident Evil style.
 *
 *   > readlly, inventory button is not good at all, we should have something like world of wacraft or
 *   > redisent evil, a tab panel where we can go from inventory, to map, to our character stats, status,
 *   > class, to the actual inventory to the abilities or talents, where each is a different tab
 *
 * Separately, what was wrong with the old one:
 *
 *   > the inventory also have sections that don't belong there, like the "add gear to bag", and stats
 *   > section, the keys and abilities are redundant now, since we have editable action bars
 *
 * Both are the same fix. The bag had grown a stats block, a key-rebinding block and an ability block
 * because there was nowhere else to put them; giving each its own tab is what makes the bag a bag again.
 * The keys in particular are genuinely redundant now, a key belongs to an action bar, and bars are
 * editable in Player UI.
 *
 * A TAB IS A ROUTE, not a scroll position: exactly one is open, its name says what you are looking at, and
 * every one is reachable in a single click from any other.
 */

export interface CharacterTab {
  id: string
  label: string
  glyph: string
  /** Rendered only when the tab is open, a tab nobody opened costs nothing. */
  render: () => ReactNode
  /** Shown on the tab, e.g. how many quests are active. Absent for tabs that do not count. */
  badge?: number
}

export function CharacterPanel({
  tabs,
  initial,
  title = 'Character',
  onClose,
}: {
  tabs: readonly CharacterTab[]
  /** Which tab opens first, the one the caller's button is "about". */
  initial?: string
  title?: string
  onClose: () => void
}) {
  const [active, setActive] = useState(initial ?? tabs[0]?.id)
  const open = tabs.find(t => t.id === active) ?? tabs[0]

  if (tabs.length === 0) return null

  return (
    <div className="charpanel" role="dialog" aria-label={title}>
      <nav className="chartabs" role="tablist" aria-label="Character panel">
        {tabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === open?.id}
            className={tab.id === open?.id ? 'on' : ''}
            onClick={() => setActive(tab.id)}
          >
            <span className="ic" aria-hidden="true">{tab.glyph}</span>
            <span>{tab.label}</span>
            {tab.badge !== undefined && tab.badge > 0 && <span className="ct">{tab.badge}</span>}
          </button>
        ))}
      </nav>

      <div className="charbody">
        <div className="charhead">
          <b>{open?.label}</b>
          <button type="button" onClick={onClose} aria-label="Close the character panel">✕</button>
        </div>
        <div className="charcontent">{open?.render()}</div>
      </div>
    </div>
  )
}
