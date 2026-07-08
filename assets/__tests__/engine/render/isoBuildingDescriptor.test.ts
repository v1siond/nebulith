/**
 * Per-building render DESCRIPTOR memoization (render/iso.isoBuildingDescriptor).
 *
 * drawIsoBuildingTiles used to recompute — EVERY frame, live because of the hero-proximity fade — a
 * pile of values that are a pure function of (building, style): the per-building colours, resolved tile
 * visuals, the sorted footprint cells, floor count, window levels, facing, door count. Those are now
 * memoized in a WeakMap<building, Map<styleId, descriptor>>. This locks:
 *   1. the cache is REUSED for the same (building, style) — same reference back;
 *   2. a building EDIT REPLACES the object (moveBuilding returns a NEW object), so a fresh descriptor is
 *      built (WeakMap auto-invalidation — no staleness);
 *   3. each style gets its OWN descriptor; and
 *   4. the cached values EQUAL the direct pure-function outputs (behavior-preserving — the renderer draws
 *      from these instead of recomputing them inline).
 */
import { isoBuildingDescriptor } from '@/engine/render/iso'
import { makeBuilding, moveBuilding, buildingRect, facadeToFootprint, gridBuildingFacing } from '@/engine/buildingEditor'
import { buildingCellColor, wallMaterialTile, wallMaterialImage } from '@/engine/stageGenerator'
import { ASCII_STYLE, EMOJI_STYLE } from '@/game/artStyle'
import type { BuildingType } from '@/engine/buildingComposer'

const house = () => makeBuilding('house', 'south', 10, 10)
const sortedFootprint = (b: ReturnType<typeof house>) =>
  facadeToFootprint(b).sort((a, z) => (a.col + a.row) - (z.col + z.row))

describe('isoBuildingDescriptor — memoized per-building render descriptor', () => {
  test('returns the SAME reference for the same (building, style)', () => {
    const b = house()
    const d1 = isoBuildingDescriptor(b, ASCII_STYLE)
    const d2 = isoBuildingDescriptor(b, ASCII_STYLE)
    expect(d2).toBe(d1)
  })

  test('a building EDIT (moveBuilding → new object) yields a fresh descriptor (WeakMap auto-invalidation)', () => {
    const b = house()
    const d1 = isoBuildingDescriptor(b, ASCII_STYLE)
    const moved = moveBuilding(b, 3, 0) // returns a NEW GridBuilding object
    const d2 = isoBuildingDescriptor(moved, ASCII_STYLE)
    expect(d2).not.toBe(d1)
    // the fresh descriptor reflects the moved footprint (rect shifted by +3 cols)
    expect(d2.rect.col).toBe(buildingRect(moved).col)
    expect(d2.rect.col).toBe(d1.rect.col + 3)
  })

  test('each STYLE gets its own descriptor', () => {
    const b = house()
    const ascii = isoBuildingDescriptor(b, ASCII_STYLE)
    const emoji = isoBuildingDescriptor(b, EMOJI_STYLE)
    expect(emoji).not.toBe(ascii)
    // re-fetch is still memoized per style
    expect(isoBuildingDescriptor(b, EMOJI_STYLE)).toBe(emoji)
  })

  test('cached values EQUAL the direct pure-function outputs (behavior-preserving)', () => {
    const b = house()
    const t = b.type as BuildingType
    const d = isoBuildingDescriptor(b, ASCII_STYLE)
    expect(d.wallC).toBe(buildingCellColor(t, 'wall', b.col))
    expect(d.roofC).toBe(buildingCellColor(t, 'roof', b.col))
    expect(d.facing).toBe(gridBuildingFacing(b))
    expect(d.rect).toEqual(buildingRect(b))
    expect(d.cells).toEqual(sortedFootprint(b))
    expect(d.floors).toBe(sortedFootprint(b).reduce((m, c) => Math.max(m, c.height), 1))
    const bottomRow = b.cells[b.cells.length - 1] ?? []
    expect(d.doorCount).toBe(bottomRow.filter(k => k === 'door').length)
    expect(d.doorNear).toBe(d.facing === 'south' || d.facing === 'east')
    // ASCII passthrough: the door tile-visual carries no overlay char, its colour is the door data colour
    expect(d.doorDV.color).toBe(buildingCellColor(t, 'door', b.col))
  })

  test('ASCII carries NO wall material overlay; EMOJI rides the building material tile/image', () => {
    const b = house()
    const t = b.type as BuildingType
    const ascii = isoBuildingDescriptor(b, ASCII_STYLE)
    // ASCII (passthrough) → no material overlay: solid wall colour only, no tile char, no image
    expect(ascii.wallTileDV.char).toBe('')
    expect(ascii.wallTileDV.image).toBeUndefined()
    // EMOJI (reskin) → the SAME per-building material 2D reads (either a glyph tile or a Noto image)
    const emoji = isoBuildingDescriptor(b, EMOJI_STYLE)
    const img = wallMaterialImage(t, b.col)
    if (img) {
      expect(emoji.wallTileDV.image).toEqual({ kind: 'image', src: img })
    } else {
      expect(emoji.wallTileDV.char).toBe(wallMaterialTile(t, b.col))
    }
  })
})
