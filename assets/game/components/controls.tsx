// Editor-UI primitives for the game-engine editor: palette swatches, the sidebar
// Card wrapper, view/tool toggle buttons, and the animation frame stepper.
// Module-level, props-driven presentational components moved out of the page (stage 4).
import { useEffect, useRef, useState } from 'react'
import { TILES } from '@/engine/Tileset'

// Tile swatch component for palette
export function TileSwatch({
  char,
  name,
  bg,
  fg,
  onClick,
  selected,
  zoom = 1.0
}: {
  char: string
  name: string
  bg: string
  fg: string
  onClick?: () => void
  selected?: boolean
  zoom?: number
}) {
  const baseSize = 56
  const size = baseSize * zoom
  const fontSize = 20 * zoom
  const labelSize = 9 * zoom

  return (
    <button
      onClick={onClick}
      className={`rounded flex flex-col items-center justify-center transition-all flex-shrink-0 ${
        selected ? 'ring-2 ring-yellow-400' : 'hover:ring-2 hover:ring-yellow-400/50'
      }`}
      style={{
        backgroundColor: bg,
        width: size,
        height: size,
        minWidth: size,
      }}
      title={name}
    >
      <span style={{ color: fg, fontSize }} className="font-bold leading-none">{char}</span>
      <span style={{ fontSize: labelSize }} className="text-gray-300 leading-none mt-1">{name}</span>
    </button>
  )
}

/**
 * Editor sidebar card — a labelled, accent-bordered panel grouping one tool.
 * Pure presentational wrapper so every panel in the two sidebars looks the same
 * and stays readable for non-devs. Accent maps to a Tailwind border/title colour.
 */
export type CardAccent = 'yellow' | 'purple' | 'orange' | 'blue' | 'cyan'

export const CARD_TITLE_COLOR: Record<CardAccent, string> = {
  yellow: 'text-yellow-400',
  purple: 'text-purple-400',
  orange: 'text-orange-400',
  blue: 'text-blue-400',
  cyan: 'text-cyan-400',
}

export function Card({
  title,
  accent = 'yellow',
  action,
  children,
  defaultOpen = true,
  sectionId,
  focus,
}: {
  title: string
  accent?: CardAccent
  action?: React.ReactNode
  children: React.ReactNode
  /** start collapsed by passing false — collapsible to cut sidebar scrolling. */
  defaultOpen?: boolean
  /** stable id so the on-canvas quick-actions can target this section. */
  sectionId?: string
  /** bumped `{ id, n }` from a quick-action: when `id` matches `sectionId` the card
   *  opens itself + scrolls into view. The `n` nonce lets a repeat click re-focus. */
  focus?: { id: string; n: number } | null
}) {
  const [open, setOpen] = useState(defaultOpen)
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!focus || !sectionId || focus.id !== sectionId) return
    setOpen(true)
    // wait a frame so the just-expanded body has laid out before we scroll to it.
    const raf = requestAnimationFrame(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
    return () => cancelAnimationFrame(raf)
  }, [focus, sectionId])
  return (
    <section ref={ref} data-section={sectionId} className="rounded-lg border border-white/10 bg-black/60 p-3 shadow-lg shadow-black/40">
      <header className={`flex items-center justify-between gap-2 ${open ? 'mb-3' : ''}`}>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          className={`flex flex-1 items-center gap-1.5 text-left text-sm font-bold uppercase tracking-wide ${CARD_TITLE_COLOR[accent]}`}
        >
          <span aria-hidden className="text-[10px]">{open ? '▾' : '▸'}</span>
          <h3>{title}</h3>
        </button>
        {action}
      </header>
      {open && children}
    </section>
  )
}

/** A −/value/+ stepper for one transform field of an animation frame (x / y / rot). */
export function FrameStepper({
  label,
  value,
  step,
  onChange,
}: {
  label: string
  value: number
  step: number
  onChange: (v: number) => void
}) {
  const round2 = (v: number) => Math.round(v * 100) / 100
  return (
    <div className="flex flex-col items-center rounded bg-gray-800 p-0.5">
      <span className="text-[8px] uppercase text-gray-500">{label}</span>
      <div className="flex items-center gap-0.5">
        <button onClick={() => onChange(round2(value - step))} className="px-1 text-fuchsia-300 hover:text-white" aria-label={`${label} minus`}>−</button>
        <span className="w-8 text-center text-[9px] text-gray-200">{value > 0 ? '+' : ''}{round2(value)}</span>
        <button onClick={() => onChange(round2(value + step))} className="px-1 text-fuchsia-300 hover:text-white" aria-label={`${label} plus`}>+</button>
      </div>
    </div>
  )
}

/** A single view-mode button in the Views card. */
export function ViewButton({
  label,
  active,
  activeClass,
  onClick,
}: {
  label: string
  active: boolean
  activeClass: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`rounded px-2 py-1 text-xs font-bold transition-colors ${
        active ? activeClass : 'bg-gray-700 hover:bg-gray-600'
      }`}
    >
      {label}
    </button>
  )
}

/** A collapsible labelled group of palette swatches inside the Assets card.
 *  Each section is its own dropdown — collapsed by default so the Assets card
 *  stays expanded but isn't a wall of swatches. */
export function PaletteGroup({
  label,
  color,
  children,
  defaultOpen = false,
}: {
  label: string
  color: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className={`mb-1 flex w-full items-center gap-1 text-xs font-bold ${color} hover:opacity-80`}
      >
        <span className="inline-block w-3 text-[10px] text-gray-400" aria-hidden>{open ? '▾' : '▸'}</span>
        {label}
      </button>
      {open && <div className="flex flex-wrap gap-1">{children}</div>}
    </div>
  )
}

/** A tool toggle in the Entities card (Player / Enemy / NPC / Erase). */
export function EntityToolButton({
  label,
  glyph,
  active,
  activeClass,
  onClick,
}: {
  label: string
  glyph: string
  active: boolean
  activeClass: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`flex flex-col items-center gap-0.5 rounded px-2 py-1.5 text-xs font-bold transition-colors ${
        active ? activeClass : 'bg-gray-700 hover:bg-gray-600'
      }`}
    >
      <span className="text-base leading-none" aria-hidden>{glyph}</span>
      <span>{label}</span>
    </button>
  )
}

export type PlaceTileInfo = { char: string; type: 'ground' | 'asset'; groundType?: string; tileKey?: string }

/** Swatch for a single-tile asset, resolving its glyph/colours from the tileset by key. */
export function AssetTileSwatch({
  tileKey,
  selectedTile,
  onPlace,
}: {
  tileKey: string
  selectedTile: PlaceTileInfo | null
  onPlace: (info: PlaceTileInfo) => void
}) {
  const tile = TILES[tileKey]
  if (!tile) return null
  return (
    <TileSwatch
      char={tile.char}
      name={tile.name ?? tileKey}
      bg={tile.bg}
      fg={tile.fg}
      onClick={() => onPlace({ char: tile.char, type: 'asset', tileKey })}
      selected={selectedTile?.type === 'asset' && selectedTile?.tileKey === tileKey}
    />
  )
}
