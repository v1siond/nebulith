/**
 * ART STYLE — in the top nav, before the game selector.
 *
 * Alexander, 2026-09-08: *"I think art style should be on top nav before game selector."*
 *
 * It belongs there and not in the rail: it is not a step in building a level, it is the skin the whole
 * product is wearing, and it is one of the first two things anyone touches.
 *
 * The control PREVIEWS rather than names. The same four labels are drawn in each style, so the choice is
 * made by looking — "ascii" and "emoji" mean nothing to someone who has just arrived. That is also the
 * clearest possible statement of the engine's central rule: one label, one set of facts, a different
 * picture per style.
 */
import { useEffect, useRef, useState } from 'react'

import { availableStyles } from '@/game/artStyle'
import { styleTile } from '@/engine/tileset/styleTiles'

import { TilePicture } from './Previews'

/**
 * The labels the switcher previews. Four everyday things, one from each corner of the catalog, so the
 * difference between styles is visible at a glance. A label the loaded catalog lacks simply does not draw —
 * no stand-in.
 */
const SAMPLE_LABELS = ['dragon', 'wall_brick_c', 'tree', 'water'] as const

/** What each style is, in one line, for someone who has never seen either. */
const STYLE_BLURB: Record<string, string> = {
  ascii: 'figures composed from characters, baked to pictures',
  emoji: 'one pictograph per tile',
}

export interface ArtStyleControlProps {
  activeStyleId: string
  onPick: (styleId: string) => void
}

export function ArtStyleControl({ activeStyleId, onPick }: ArtStyleControlProps) {
  const styles = availableStyles()
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const anchor = useRef<HTMLButtonElement>(null)
  const popover = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (popover.current?.contains(target) || anchor.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const active = styles.find((s) => s.id === activeStyleId)

  const toggle = () => {
    if (open) {
      setOpen(false)
      return
    }
    const rect = anchor.current?.getBoundingClientRect()
    if (rect) setPos({ left: Math.max(12, rect.left), top: rect.bottom + 8 })
    setOpen(true)
  }

  return (
    <div className="stc">
      <button
        ref={anchor}
        type="button"
        className="b styleb"
        title="The pictures every tile uses. Same labels, same sizes, same behaviour — only the art changes."
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={toggle}
      >
        <span className="stk">Art</span>
        <span className="stt">
          {SAMPLE_LABELS.slice(0, 3).map((label) => (
            <TilePicture key={label} styleId={activeStyleId} label={label} size={19} />
          ))}
        </span>
        <span className="stn">{active?.name ?? activeStyleId}</span>
        <span className="cv" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && pos && (
        <div ref={popover} className="pop stylepop atpoint" role="dialog" aria-label="Art style" style={pos}>
          <div className="ph2">Art style</div>
          <div className="hint">
            One engine, many looks. Every tile keeps its name, size, height and collision — only the picture
            is swapped, everywhere at once.
          </div>
          {styles.map((style) => (
            <button
              key={style.id}
              type="button"
              className={`pcard row${style.id === activeStyleId ? ' on' : ''}`}
              aria-pressed={style.id === activeStyleId}
              onClick={() => {
                onPick(style.id)
                setOpen(false)
              }}
            >
              <span className="ssample">
                {SAMPLE_LABELS.map((label) => {
                  const tile = styleTile(style.id, label)
                  if (!tile?.image) return null
                  return (
                    <img
                      key={label}
                      src={tile.image}
                      width={40}
                      height={40}
                      alt=""
                      style={{ imageRendering: 'pixelated' }}
                      draggable={false}
                    />
                  )
                })}
              </span>
              {/* DIVs, matching the design — `.pd`'s `margin-top` needs a block box. */}
              <div>
                <div className="pn">{style.name}</div>
                <div className="pd">{STYLE_BLURB[style.id] ?? `the ${style.name} pictures`}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
