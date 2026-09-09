/**
 * SWAP THIS TILE — the answer to a question that had no answer in the UI.
 *
 * Alexander, 2026-09-08: *"what happens when I click replace tile?"*
 *
 * It swaps the tile in THAT slot of the stack (`game/editor/tileBrush.ts:138` — `replaceTileInPlace`): same
 * cell, same level, the tiles above and below untouched, and the slot adopts the new tile's art, colour,
 * height, thickness and settings. Nothing in the old UI said any of that; the button simply read "Replace
 * tile" and the library opened.
 *
 * So this panel shows the BEFORE and the AFTER, spells out exactly what carries over, names the one
 * exception, and is cancellable. The carry-over list is not prose — each row is a field
 * `replaceTileInPlace` actually assigns, so it cannot drift from what the code does.
 */
import { useMemo, useState } from 'react'

import { CATEGORY_LABELS, type TileCategory, type TileDef, tilesForStyle } from '@/game/artStyle'
import { filterTiles } from '@/game/editor/tileSearch'
import { tileSlug } from '@/game/editor/tilePlacement'
import { tileFacts } from '@/engine/tilePreview'

import { SubHeading } from './InfoButton'
import { TilePicture } from './Previews'

/** What the swap carries over — every row is a field `replaceTileInPlace` assigns. */
const CARRIES: readonly (readonly [string, string])[] = [
  ['Its picture', 'yes'],
  ['Its colour', 'yes'],
  ['Its height', 'yes — replaces the old one'],
  ['Its thickness', 'yes — cleared if it has none'],
  ['Its settings', 'yes'],
  ['Its position in the stack', 'unchanged'],
  ['The cell’s other tiles', 'untouched'],
]

export interface SwapTilePanelProps {
  styleId: string
  /** The label currently in the slot, for the BEFORE picture. */
  fromLabel: string | null
  /** Where in the stack this is — "cell 12, 8 · tile 2 of 3". */
  where: string
  /** True when the selection is a character: it keeps everything and only the picture changes. */
  isCharacter: boolean
  /** Do the swap with the picked tile. */
  onSwap: (tile: TileDef) => void
  onCancel: () => void
}

export function SwapTilePanel({ styleId, fromLabel, where, isCharacter, onSwap, onCancel }: SwapTilePanelProps) {
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<TileDef | null>(null)

  const pool = useMemo(() => {
    const groups = tilesForStyle(styleId)
    // A character swaps for another CHARACTER; a tile swaps for another tile. Offering the wrong pool is how
    // you end up with a villager replaced by a roof.
    const categories = (Object.keys(groups) as TileCategory[]).filter((c) => (isCharacter ? c === 'units' : c !== 'units'))
    return categories.flatMap((c) => groups[c]).sort((a, b) => a.label.localeCompare(b.label))
  }, [styleId, isCharacter])

  const rows = filterTiles(pool, query)
  const toLabel = picked ? tileSlug(picked.id) : null

  return (
    <div>
      <div className="swaprow">
        <div className="swapc">
          <div className="swk">Now</div>
          {fromLabel ? (
            <TilePicture styleId={styleId} label={fromLabel} size={86} animate />
          ) : (
            <div className="swempty">this slot is empty</div>
          )}
          <div className="swn">{fromLabel ? (tileFacts(styleId, fromLabel)?.name ?? fromLabel) : '—'}</div>
        </div>
        <div className="swarrow" aria-hidden="true">→</div>
        <div className="swapc to">
          <div className="swk">After</div>
          {toLabel ? (
            <TilePicture styleId={styleId} label={toLabel} size={86} animate />
          ) : (
            <div className="swempty">pick one below</div>
          )}
          <div className="swn">{picked ? picked.label : '—'}</div>
        </div>
      </div>

      <div className="hint">
        {isCharacter
          ? 'The character keeps its name, stats, items, powers, quests and position. Only the picture changes.'
          : `It goes in this exact slot — ${where}. The tiles above and below stay where they are.`}
      </div>

      {!isCharacter && (
        <>
          <SubHeading>What the new tile brings with it</SubHeading>
          <div className="carry">
            {CARRIES.map(([what, answer]) => (
              <i key={what}>
                <b>{what}</b>
                <span>{answer}</span>
              </i>
            ))}
          </div>
          <div className="hint">
            One exception: a standing block cannot become the ground slab, so picking a wall for the ground
            layer stacks it on instead of replacing it.
          </div>
        </>
      )}

      <SubHeading helpId="swap">Pick the replacement</SubHeading>
      <input
        className="srch"
        type="search"
        value={query}
        placeholder={`search ${pool.length} ${isCharacter ? 'characters' : 'tiles'}…`}
        aria-label="Search for a replacement"
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="grid swapg">
        {rows.slice(0, 60).map((tile) => {
          const label = tileSlug(tile.id)
          return (
            <button
              key={tile.id}
              type="button"
              className={`sw${picked?.id === tile.id ? ' on' : ''}`}
              title={`${tile.label} · ${CATEGORY_LABELS[tile.category]}`}
              aria-pressed={picked?.id === tile.id}
              onClick={() => setPicked(tile)}
            >
              <TilePicture styleId={styleId} label={label} size={40} />
              <span className="n">{tile.label}</span>
            </button>
          )
        })}
        {rows.length === 0 && <div className="hint">{`Nothing matches “${query}”.`}</div>}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button
          type="button"
          className="b pri"
          style={{ flex: 1, justifyContent: 'center' }}
          disabled={!picked}
          onClick={() => picked && onSwap(picked)}
        >
          {isCharacter ? 'Change the figure' : 'Swap it'}
        </button>
        <button type="button" className="b sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
