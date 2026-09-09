import { styleCatalog, styleTile } from '@/engine/tileset/styleTiles'
import '@/__tests__/helpers/installTilesetSeed' // the generator reads ALL tile data (terrain/canopy/decor) + building compositions from the loaded backend tileset fixture
import { installSeedTileset } from '@/__tests__/helpers/tilesetSeed'
import { generateStage, stagePaint, footprintEdgeClass, footprintSide, footprintRing, edgeToSide, treeSubpart, labelForCell, pickLivingTree } from '@/engine/stageGenerator'
import { buildingDepth, buildingDoorOffset } from '@/engine/buildingCatalog'
import { parseColor } from '@/engine/colors'
import { resolveGroundTile, canopyCount, resolveComposition } from '@/engine/tileset/tileset'

// The zone canopy shades now live on the loaded backend `leaf_center` tile (settings.colors[zone]) —
// the data-driven replacement for the deleted frontend TREE_CANOPY_SHADES table.
const canopyShades = (zone: string): string[] =>
  ((styleTile('ascii', 'leaf_center').settings as { colors: Record<string, string[]> }).colors[zone]) ?? []

// The small GROUND footprint cells of a placed building: cols [col, col+length) × rows
// [row-(height-1), row] (length = grid col-span, height = grid row-span — both small now).
const footprintCells = (b: { col: number; row: number; length: number; height: number }) => {
  const cells: { col: number; row: number }[] = []
  const top = b.row - (b.height - 1)
  for (let r = top; r <= b.row; r++) for (let c = b.col; c < b.col + b.length; c++) cells.push({ col: c, row: r })
  return cells
}

describe('generateStage — town vertical slice', () => {
  const stage = generateStage({ zone: 'autumn', variant: 'town' })

  it('produces a town of the requested identity', () => {
    expect(stage.zone).toBe('autumn')
    expect(stage.variant).toBe('town')
    expect(stage.cols).toBeGreaterThan(0)
    expect(stage.rows).toBeGreaterThan(0)
  })

  it('carves streets as dark-gray ROAD tiles (not brown path, not the broken cavefloor)', () => {
    const allowed = new Set(['autumn_ground', 'autumn_leaves', 'road', 'path_stone']) // roads = the dark-gray 'road' tile; plaza/driveway keep brown path_stone
    const allThemed = stage.ground.every(row => row.every(t => allowed.has(t)))
    expect(allThemed).toBe(true)
    // streets ARE carved, placed as the 'road' tile (not a hijacked ground string)
    expect(stage.ground.flat().filter(t => t === 'road').length).toBeGreaterThan(0)
    // the broken cavefloor hijack is gone
    expect(stage.ground.flat().includes('cavefloor')).toBe(false)
    // and the road tile RESOLVES dark-gray in ASCII — assert the COMPOSITION, not just the string
    const bg = parseColor(resolveGroundTile(styleCatalog('ascii'), 'road', 0, 0).bg)!
    expect(Math.max(bg.r, bg.g, bg.b) - Math.min(bg.r, bg.g, bg.b)).toBeLessThan(24) // neutral gray
    expect((bg.r + bg.g + bg.b) / 3).toBeLessThan(110) // dark
  })

  it('sits each building on a brown path_stone BASE (brown freed from roads → building bases, ticket 2b)', () => {
    expect(stage.buildings.length).toBeGreaterThan(0)
    for (const b of stage.buildings) {
      for (const cell of footprintCells(b)) {
        expect(stage.ground[cell.row]?.[cell.col]).toBe('path_stone')
      }
    }
  })

  it('never scatters nature onto road cells — nature belongs on grass, not streets (Image #12)', () => {
    const roadCells = new Set<string>()
    stage.ground.forEach((r, row) => r.forEach((t, col) => { if (t === 'road' || t === 'road_center' || t === 'road_edge') roadCells.add(`${col},${row}`) }))
    expect(roadCells.size).toBeGreaterThan(0) // there ARE roads in a town
    const nature = new Set(['ground_decor', 'flower', 'tree', 'bush'])
    const natureOnRoad = stage.props.filter(p => nature.has(p.type) && roadCells.has(`${p.col},${p.row}`))
    expect(natureOnRoad.map(p => `${p.type}@${p.col},${p.row}`)).toEqual([])
  })

  it('places at least one building — each names a backend composition + faces a road with a door', () => {
    expect(stage.buildings.length).toBeGreaterThan(0)
    for (const b of stage.buildings) {
      // A building is a COMPOSITION now: it names its kind (house_4 / store_5 / …) and its footprint DEPTH
      // matches the composition's baked depth (small ground, not a tall facade).
      // The kind names the composition this plot needs. Two spellings are legitimate now:
      //   `house_4`   — an AUTHORED composition, the shape before /api/buildings existed
      //   `house@4x4` — one COMPOSED to the footprint the plot rolled
      // Alexander, 2026-09-09: *"we randomize the footprint and house adapts to it."* The second form is
      // what a generate produces once the backend has answered; this test's generate has no backend, so it
      // gets the first. Both are asserted so neither path can drift into a name nothing can resolve.
      expect(b.kind).toMatch(/^(house|big[-_]house|store|hospital|office|temple|cathedral|castle)([_]\d+|@\d+x\d+)$/)
      expect(b.depth).toBe(buildingDepth(b.type, b.length))
      // The opening matches the composition's OWN door span (G7) — an odd facade bakes 1 door column, an
      // even one a centred 2-wide doorway — so it is read, never assumed to be 1.
      expect(b.doorCells).toHaveLength(buildingDoorOffset(b.kind)?.width ?? 0)
    }
  })

  it('blocks the whole small footprint EXCEPT the walkable road-facing door cells', () => {
    for (const b of stage.buildings) {
      expect(b.doorCells).toHaveLength(buildingDoorOffset(b.kind)?.width ?? 0)
      for (const door of b.doorCells) expect(stage.collision[door.row][door.col]).toBe(false) // the way in

      const cells = footprintCells(b)
      let blocked = 0
      let walkable = 0
      for (const { col, row } of cells) {
        if (stage.collision[row][col]) blocked++
        else walkable++
      }
      expect(blocked).toBe(b.length * b.height - b.doorCells.length) // every footprint cell blocks…
      expect(walkable).toBe(b.doorCells.length) // …except the door cells
    }
  })

  it('keeps the SMALL width×depth footprints disjoint and the spawn walkable', () => {
    const seen = new Set<string>()
    for (const b of stage.buildings) {
      for (const { col, row } of footprintCells(b)) {
        const key = `${col},${row}`
        expect(seen.has(key)).toBe(false)
        seen.add(key)
      }
    }
    expect(stage.collision[stage.spawn.row][stage.spawn.col]).toBe(false)
  })
})

describe('generateStage — a building reserves a small width×depth footprint (the collision blueprint)', () => {
  // A building no longer bakes flat per-cell props; it reserves its small width×depth GROUND footprint
  // (blocked, minus the door) and is STAMPED as its composition's tiles at load. So there are no
  // `type:'building'` props — the footprint reads purely from stage.buildings + stage.collision.
  it('emits NO flat building props — the building is stamped from its composition at load', () => {
    const stage = generateStage({ zone: 'autumn', variant: 'town' })
    expect(stage.buildings.length).toBeGreaterThan(0)
    expect(stage.props.filter(p => p.type === 'building')).toHaveLength(0)
  })

  it('reserves each footprint as blocked collision, only the door walkable, DEPTH = the composition depth', () => {
    const stage = generateStage({ zone: 'autumn', variant: 'town' })
    for (const b of stage.buildings) {
      const doors = new Set(b.doorCells.map(d => `${d.col},${d.row}`))
      const horizontal = b.facing === 'south' || b.facing === 'north'
      expect(horizontal ? b.height : b.length).toBe(buildingDepth(b.type, b.length)) // small ground depth
      for (const { col, row } of footprintCells(b)) {
        const walkable = doors.has(`${col},${row}`)
        expect(stage.collision[row][col]).toBe(!walkable)
      }
    }
  })

  it('generates the temple INTERIOR as a walled dungeon with a boss altar (not a building)', () => {
    // The `temple` variant is now the temple INTERIOR dungeon (rooms/corridors/altar), so it
    // has NO overworld buildings — the temple STRUCTURE is a settlement building type instead
    // (see stageGenerator.temple.test.ts). Here we just assert the dungeon's signature content.
    const stage = generateStage({ zone: 'winter', variant: 'temple', cols: 36, rows: 30 })
    expect(stage.buildings).toHaveLength(0)
    const walls = stage.props.filter(p => p.type === 'temple_wall')
    expect(walls.length).toBeGreaterThan(0)
    expect(walls.every(w => w.blocking === true && stage.collision[w.row][w.col] === true)).toBe(true)
    expect(stage.props.some(p => p.type === 'altar')).toBe(true) // the boss chamber
    expect(stage.collision[stage.spawn.row][stage.spawn.col]).toBe(false) // walkable spawn
  })
})

describe('generateStage — forest archetype (Viridian-Forest style)', () => {
  // Seeded so the density assertions are deterministic — the forest path now honours the injected rng
  // (ticket 8: it used to draw from Math.random, so these thresholds were flaky only in full runs).
  const stage = generateStage({ zone: 'summer', variant: 'forest', cols: 30, rows: 24, seeds: { layout: 42, buildings: 42, nature: 42, decor: 42 } })

  it('fills the forest with trees and walkable flowers', () => {
    const flowers = stage.props.filter(p => p.type === 'flower')
    expect(stage.trees.length).toBeGreaterThan(20) // trees are recorded as anchors, stamped as compositions at load
    expect(flowers.length).toBeGreaterThan(0)
    expect(flowers.every(f => f.blocking === false)).toBe(true)
  })

  it('carves walkable paths through the trees and spawns on open ground', () => {
    expect(stage.collision[stage.spawn.row][stage.spawn.col]).toBe(false)
    const walkable = stage.collision.flat().filter(c => !c).length
    expect(walkable).toBeGreaterThan(stage.cols) // at least the carved corridors
  })
})

// 4-neighbour flood fill over walkable cells — proves the open floor is one region.
function reachableCount(collision: boolean[][], start: { col: number; row: number }): number {
  const cols = collision[0].length
  const rows = collision.length
  const seen = new Set<string>()
  const stack = [start]
  seen.add(`${start.col},${start.row}`)
  while (stack.length > 0) {
    const { col, row } = stack.pop()!
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const c = col + dc
      const r = row + dr
      const key = `${c},${r}`
      if (c < 0 || c >= cols || r < 0 || r >= rows) continue
      if (collision[r][c]) continue
      if (seen.has(key)) continue
      seen.add(key)
      stack.push({ col: c, row: r })
    }
  }
  return seen.size
}

describe('generateStage — cave archetype (cellular automata)', () => {
  const stage = generateStage({ zone: 'autumn', variant: 'cave', cols: 40, rows: 30 })

  it('carves rock walls as blocking props', () => {
    const rocks = stage.props.filter(p => p.type === 'rock')
    expect(rocks.length).toBeGreaterThan(0)
    expect(rocks.every(r => r.blocking === true)).toBe(true)
  })

  it('spawns on walkable ground inside one connected cavern', () => {
    expect(stage.collision[stage.spawn.row][stage.spawn.col]).toBe(false)
    const walkable = stage.collision.flat().filter(c => !c).length
    const reachable = reachableCount(stage.collision, stage.spawn)
    // every walkable cell is reachable from spawn → the floor is a single region
    expect(reachable).toBe(walkable)
  })
})

describe('generateStage — boss-stage archetype (arena)', () => {
  const stage = generateStage({ zone: 'winter', variant: 'boss-stage', cols: 36, rows: 30 })

  it('opens a large connected arena reachable from spawn', () => {
    expect(stage.collision[stage.spawn.row][stage.spawn.col]).toBe(false)
    const reachable = reachableCount(stage.collision, stage.spawn)
    expect(reachable).toBeGreaterThan(100) // a large central room, not a tunnel
  })

  it('anchors exactly one boss prop at the far side of the arena', () => {
    const bosses = stage.props.filter(p => p.type === 'boss')
    expect(bosses).toHaveLength(1)
    expect(bosses[0].row).toBeLessThan(stage.rows / 2) // north / far side
  })
})

describe('generateStage — temple archetype (INTERIOR dungeon)', () => {
  // The `temple` variant is a room-and-corridor DUNGEON now (see stageGenerator.temple.test.ts
  // for the full suite). It has no overworld buildings — the temple STRUCTURE is a settlement
  // building type. These two smoke tests live alongside the other archetype slices.
  const stage = generateStage({ zone: 'autumn', variant: 'temple', cols: 36, rows: 30 })

  it('is a walled dungeon (no overworld buildings)', () => {
    expect(stage.buildings).toHaveLength(0)
    expect(stage.props.some(p => p.type === 'temple_wall' && p.blocking)).toBe(true)
  })

  it('builds a pillared hall + a boss altar, and keeps the spawn walkable', () => {
    expect(stage.props.some(p => p.type === 'pillar')).toBe(true)
    expect(stage.props.some(p => p.type === 'altar')).toBe(true)
    expect(stage.collision[stage.spawn.row][stage.spawn.col]).toBe(false)
  })
})

describe('generateStage — zone-tinted trees (varied canopy tones per zone)', () => {
  // The generator records a per-tree canopy VARIANT (an index into the zone palette); a forest uses many
  // variants so it reads in multiple tones, and a single anchor carries ONE variant → one tone per tree. The
  // variant→colour RESOLUTION (trunk one tone, distinct canopy shades, glyph+colour loaded from the DB tile) is
  // covered against the real tileset by treeComposition.test.ts — colour no longer lives on the generated props.
  const variantsFor = (zone: 'summer' | 'winter' | 'autumn'): Set<number> =>
    new Set(generateStage({ zone, variant: 'forest', cols: 40, rows: 30 }).trees.map(t => t.variant))

  it('uses MULTIPLE canopy variants per zone (varied tones, not one flat shade)', () => {
    for (const zone of ['summer', 'winter', 'autumn'] as const) {
      expect(variantsFor(zone).size).toBeGreaterThanOrEqual(2)
    }
  })

  it('keeps every anchor variant in range of its zone canopy count (from the loaded tile)', () => {
    const zone = 'summer'
    for (const v of variantsFor(zone)) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(canopyCount(styleCatalog('ascii'), zone))
    }
  })

  it('keeps EVERY zone canopy palette disjoint (no shared tone across all 7 zones)', () => {
    const all = ['spring', 'summer', 'autumn', 'winter', 'desert', 'beach', 'lava'].flatMap(canopyShades)
    expect(all.length).toBeGreaterThan(0)
    expect(new Set(all).size).toBe(all.length) // every tone unique → biomes never blur together
  })

  it('keeps the verdant forest classic — a green canopy shade in the summer palette', () => {
    expect(canopyShades('summer')).toContain('#2e8b2e')
  })
})

describe('generateStage — bare/dead trees (snags)', () => {
  it('scatters dead-tree anchors in a harsh-zone forest (burnt/frost-killed stems), all blocking', () => {
    // dead trees are a small random fraction of the meadow's border scatter — sample several harsh-zone
    // (winter) maps until at least one snag appears, and assert each blocks like a living tree.
    let snags = 0
    for (let i = 0; i < 30 && snags === 0; i++) {
      const stage = generateStage({ zone: 'winter', variant: 'forest', cols: 40, rows: 30, seeds: { layout: i, buildings: i, nature: i, decor: i } })
      const dead = stage.trees.filter(t => t.kind === 'tree_dead')
      if (dead.length > 0) {
        snags += dead.length
        // a dead tree is solid — its trunk-base cell blocks, same as a living one
        expect(dead.every(d => stage.collision[d.row][d.col] === true)).toBe(true)
      }
    }
    expect(snags).toBeGreaterThan(0)
  })
})

describe('generateStage — trees are recorded as stacked-composition anchors (the keystone)', () => {
  // Trees are no longer baked as flat per-cell props; the generator RECORDS anchors and applyStageToGrid
  // stamps each as a composition (per-cell heightLevel-stacked DB tiles) — the same model buildings use, so
  // every tile is selectable. The stacked-block shape + glyph/colour are covered by treeComposition.test.ts.
  const stage = generateStage({ zone: 'summer', variant: 'forest', cols: 30, rows: 24 })

  const TREE_KINDS = new Set(['tree', 'tree_tall', 'tree_stub', 'tree_round', 'bush', 'bush_round', 'tree_dead'])

  it('records tree ANCHORS (not flat props) — each names a living-tree composition kind + canopy variant', () => {
    expect(stage.trees.length).toBeGreaterThan(0)
    expect(stage.props.filter(p => p.type === 'tree')).toHaveLength(0) // trees no longer bake flat props
    expect(stage.trees.every(t => TREE_KINDS.has(t.kind))).toBe(true)
    expect(stage.trees.every(t => Number.isInteger(t.variant) && t.variant >= 0)).toBe(true)
  })

  it('RANDOMIZES the tree shapes — a forest shows MULTIPLE variants, not one repeated shape', () => {
    const kinds = new Set(stage.trees.map(t => t.kind))
    expect(kinds.size).toBeGreaterThanOrEqual(3) // standard + several of tall/small/round/bush appear
  })

  it('blocks EVERY tree anchor cell — trees are fully solid (no passable cell to step into)', () => {
    expect(stage.trees.length).toBeGreaterThan(0)
    for (const t of stage.trees) expect(stage.collision[t.row][t.col]).toBe(true)
  })

  it('keeps the forest FLOOR connected — every non-blocking cell reachable from spawn', () => {
    // Trees are fully solid now, so the floor is simply every non-blocking cell.
    const floor = stage.collision.flat().filter(b => !b).length
    const reachable = reachableCount(stage.collision, stage.spawn)
    expect(reachable).toBe(floor)
  })
})


describe('generateStage — spring flower variety (a meadow in bloom)', () => {
  it('scatters MANY distinct walkable flower types across spring forests', () => {
    // sample a few maps so we see the full palette, not one unlucky draw
    const flowers = [0, 1, 2].flatMap(seed =>
      generateStage({ zone: 'spring', variant: 'forest', cols: 40, rows: 30, seeds: { layout: seed, buildings: seed, nature: seed, decor: seed } }).props.filter(
        p => p.type === 'flower',
      ),
    )
    expect(flowers.length).toBeGreaterThan(0)
    expect(flowers.every(f => f.blocking === false)).toBe(true) // flowers never block
    const distinctGlyphs = new Set(flowers.map(f => f.char))
    expect(distinctGlyphs.size).toBeGreaterThanOrEqual(4) // several flower shapes, not one '*'
  })
})


// Tree GROUNDING (a shadow under the trunk base so a tree never looks floaty) now lives on the stamped
// composition — the level-0 tile carries baseShadow — not on generated props. It is covered against the grid
// by treeComposition.test.ts ('the grounded trunk base casts a shadow').

describe('generateStage — buildings are backend COMPOSITIONS (store + hospital guaranteed, cells labeled)', () => {
  beforeAll(() => installSeedTileset()) // re-assert the fixture so resolveComposition is never seen empty (cross-file safety)

  it('a settlement guarantees a store + a hospital, and bakes NO flat building props', () => {
    const stage = generateStage({ zone: 'summer', variant: 'town' })
    expect(stage.buildings.some(b => b.type === 'store')).toBe(true) // the settlement guarantees a store…
    expect(stage.buildings.some(b => b.type === 'hospital')).toBe(true) // …and a hospital
    expect(stage.props.filter(p => p.type === 'building')).toHaveLength(0) // a building IS its composition
  })

  it("each building's composition (from the loaded tileset) carries wall + door + roof cells that stack", () => {
    const stage = generateStage({ zone: 'summer', variant: 'town', cols: 50, rows: 40 })
    expect(stage.buildings.length).toBeGreaterThan(0)
    for (const b of stage.buildings) {
      const comp = resolveComposition(styleCatalog('ascii'), b.kind)
      expect(comp).not.toBeNull()
      const cellLabels = comp!.cells.map(c => c.label)
      // Each building has wall + door cells + a ROOF CAP — matched by FAMILY since store/hospital/houses
      // use type-specific tiles (roof_store / wall_house_b …) while big_house/temple/… keep the base
      // labels. The cap is a gable `roof`/`roof_top` OR a flat `parapet`/`flat_roof` (store/office).
      for (const part of ['wall', 'door']) expect(cellLabels.some(l => l.startsWith(part))).toBe(true)
      const roofish = (l: string): boolean => l.startsWith('roof') || l.startsWith('parapet') || l.startsWith('flat_roof')
      expect(cellLabels.some(roofish)).toBe(true)
      // Walls rise MULTIPLE stack levels (the iso box is built from stacked wall blocks + a roof cap).
      expect(Math.max(...comp!.cells.map(c => c.level ?? 0))).toBeGreaterThan(0)
    }
  })

  it('a store composition has WINDOW cells (a glassy facade) and exactly ONE walkable door', () => {
    const comp = resolveComposition(styleCatalog('ascii'), 'store_5')
    expect(comp).not.toBeNull()
    expect(comp!.cells.some(c => c.label === 'window')).toBe(true)
    expect(comp!.cells.filter(c => (c.level ?? 0) === 0 && c.label === 'door')).toHaveLength(1)
  })
})

describe('generateStage — town & city both build legal stages', () => {
  it('generates legal buildings + streets for town and city', () => {
    for (const variant of ['town', 'city'] as const) {
      const stage = generateStage({ zone: 'summer', variant, cols: 50, rows: 44 })
      expect(stage.buildings.length).toBeGreaterThan(0)
      expect(stage.ground.flat().filter(t => t === 'path_stone').length).toBeGreaterThan(0)
      expect(stage.collision[stage.spawn.row][stage.spawn.col]).toBe(false)
    }
  })

  it('cities have more buildings + less nature than towns', () => {
    let tBuild = 0, cBuild = 0, tTrees = 0, cTrees = 0
    for (let i = 0; i < 5; i++) {
      const t = generateStage({ zone: 'summer', variant: 'town', cols: 50, rows: 44 })
      const c = generateStage({ zone: 'summer', variant: 'city', cols: 50, rows: 44 })
      tBuild += t.buildings.length; cBuild += c.buildings.length
      tTrees += t.trees.length
      cTrees += c.trees.length
    }
    expect(cBuild).toBeGreaterThan(tBuild) // cities have more buildings
    expect(tTrees).toBeGreaterThan(cTrees) // leafier towns have more nature
  })
})

// Door + its driveway sit one step toward the road (mirrors stageGenerator.FACING_STEP).
const FACING_STEP: Record<string, [number, number]> = {
  south: [0, 1],
  north: [0, -1],
  east: [1, 0],
  west: [-1, 0],
}

describe('generateStage — a settlement guarantees a store + a hospital', () => {
  it('places at least one store building and one hospital building', () => {
    const stage = generateStage({ zone: 'summer', variant: 'town' })
    expect(stage.buildings.some(b => b.type === 'store')).toBe(true)
    expect(stage.buildings.some(b => b.type === 'hospital')).toBe(true)
  })
})

describe('generateStage — a driveway crosses the setback from every door to its street', () => {
  it('paints ≥1 path_stone cell toward the road for every building', () => {
    const stage = generateStage({ zone: 'summer', variant: 'town' })
    const paved = new Set(
      stagePaint(stage).ground.filter(g => g.type === 'path_stone').map(g => `${g.col},${g.row}`),
    )
    expect(stage.buildings.length).toBeGreaterThan(0)
    for (const b of stage.buildings) {
      const door = b.doorCells[0]
      const [dc, dr] = FACING_STEP[b.facing]
      expect(paved.has(`${door.col + dc},${door.row + dr}`)).toBe(true) // driveway between door + street
    }
  })
})

describe('generateStage — lamps never block a door or its driveway', () => {
  it('places no lamp prop on a building door cell or its driveway cell', () => {
    for (let i = 0; i < 6; i++) {
      const stage = generateStage({ zone: 'summer', variant: 'town' })
      const lamps = new Set(stage.props.filter(p => p.type === 'lamp').map(p => `${p.col},${p.row}`))
      for (const b of stage.buildings) {
        const door = b.doorCells[0]
        const [dc, dr] = FACING_STEP[b.facing]
        expect(lamps.has(`${door.col},${door.row}`)).toBe(false) // never on the door
        expect(lamps.has(`${door.col + dc},${door.row + dr}`)).toBe(false) // never on the driveway
      }
    }
  })
})

describe('footprintEdgeClass — corner/edge/interior tileset classification (#41)', () => {
  // A 4-wide × 3-deep footprint rect at (10,5): cols 10..13, rows 5..7.
  const rect = { col: 10, row: 5, w: 4, h: 3 }

  it('classifies the four corners', () => {
    expect(footprintEdgeClass(10, 5, rect)).toBe('nw') // top-left
    expect(footprintEdgeClass(13, 5, rect)).toBe('ne') // top-right
    expect(footprintEdgeClass(10, 7, rect)).toBe('sw') // bottom-left
    expect(footprintEdgeClass(13, 7, rect)).toBe('se') // bottom-right
  })

  it('classifies the four edges (non-corner border cells)', () => {
    expect(footprintEdgeClass(11, 5, rect)).toBe('n') // top edge
    expect(footprintEdgeClass(12, 7, rect)).toBe('s') // bottom edge
    expect(footprintEdgeClass(10, 6, rect)).toBe('w') // left edge
    expect(footprintEdgeClass(13, 6, rect)).toBe('e') // right edge
  })

  it('classifies an interior cell', () => {
    expect(footprintEdgeClass(11, 6, rect)).toBe('interior')
    expect(footprintEdgeClass(12, 6, rect)).toBe('interior')
  })

  it('collapses degenerate footprints (thin strips and a single cell)', () => {
    const strip1xN = { col: 4, row: 4, w: 1, h: 3 } // 1-wide column → nw/w/sw
    expect(footprintEdgeClass(4, 4, strip1xN)).toBe('nw')
    expect(footprintEdgeClass(4, 5, strip1xN)).toBe('w')
    expect(footprintEdgeClass(4, 6, strip1xN)).toBe('sw')

    const stripNx1 = { col: 4, row: 4, w: 3, h: 1 } // 1-deep row → nw/n/ne
    expect(footprintEdgeClass(4, 4, stripNx1)).toBe('nw')
    expect(footprintEdgeClass(5, 4, stripNx1)).toBe('n')
    expect(footprintEdgeClass(6, 4, stripNx1)).toBe('ne')

    expect(footprintEdgeClass(0, 0, { col: 0, row: 0, w: 1, h: 1 })).toBe('nw') // 1×1 → nw
  })

})

describe('labelForCell — ONE consistent debug-label standard across every element', () => {
  // A 3×3 footprint at (10,5): cols 10..12, rows 5..7 — the canonical multi-cell element.
  const rect = { col: 10, row: 5, w: 3, h: 3 }

  it('footprintSide yields the 4 corners + 4 edges + INTERIOR centre of a 3×3', () => {
    // corners
    expect(footprintSide(10, 5, rect)).toBe('TOP-LEFT')
    expect(footprintSide(12, 5, rect)).toBe('TOP-RIGHT')
    expect(footprintSide(10, 7, rect)).toBe('BOTTOM-LEFT')
    expect(footprintSide(12, 7, rect)).toBe('BOTTOM-RIGHT')
    // edges
    expect(footprintSide(11, 5, rect)).toBe('TOP')
    expect(footprintSide(11, 7, rect)).toBe('BOTTOM')
    expect(footprintSide(10, 6, rect)).toBe('LEFT')
    expect(footprintSide(12, 6, rect)).toBe('RIGHT')
    // centre
    expect(footprintSide(11, 6, rect)).toBe('INTERIOR')
  })

  it('edgeToSide maps a BuildingEdge class to the shared TOP/BOTTOM/LEFT/RIGHT caption token', () => {
    expect(edgeToSide('nw')).toBe('TOP-LEFT')
    expect(edgeToSide('s')).toBe('BOTTOM')
    expect(edgeToSide('interior')).toBe('INTERIOR')
  })

  it('labels a building footprint cell as "<TYPE> <SIDE>" (the existing scheme, via the shared helper)', () => {
    expect(labelForCell('building', footprintSide(10, 5, rect))).toBe('BUILDING TOP-LEFT')
    expect(labelForCell('building', footprintSide(11, 5, rect))).toBe('BUILDING TOP')
    expect(labelForCell('building', footprintSide(11, 6, rect))).toBe('BUILDING INTERIOR')
  })

  it('labels a tree by TRUNK vs CANOPY-side (column stems + autotiled canopy + apex)', () => {
    // vertical column tree: stems are the trunk, the cap is the canopy top
    expect(treeSubpart('tree_stem_bottom')).toBe('TRUNK')
    expect(treeSubpart('tree_stem')).toBe('TRUNK')
    expect(treeSubpart('tree_snag')).toBe('TRUNK')
    expect(treeSubpart('tree_crown')).toBe('CANOPY TOP')
    expect(treeSubpart('tree_leaf_top')).toBe('CANOPY TOP')
    expect(treeSubpart('tree_leaf')).toBe('CANOPY')
    // autotiled forest mass: the canopy gets corner/edge sides, mirroring a building footprint
    expect(treeSubpart('tree_top_left')).toBe('CANOPY TOP-LEFT')
    expect(treeSubpart('tree_top')).toBe('CANOPY TOP')
    expect(treeSubpart('tree_edge_right')).toBe('CANOPY RIGHT')
    expect(treeSubpart('tree_interior')).toBe('CANOPY INTERIOR')
    expect(treeSubpart('tree_bottom_right')).toBe('CANOPY BOTTOM-RIGHT')
    // assembled captions read "TREE TRUNK" / "TREE CANOPY TOP-LEFT"
    expect(labelForCell('tree', treeSubpart('tree_stem'))).toBe('TREE TRUNK')
    expect(labelForCell('tree', treeSubpart('tree_top_left'))).toBe('TREE CANOPY TOP-LEFT')
  })

  it('labels a single-cell element as just its TYPE (no spurious position)', () => {
    expect(labelForCell('lamp')).toBe('LAMP')
    expect(labelForCell('lamp', treeSubpart(undefined))).toBe('LAMP') // unknown sub-part → bare type
    expect(labelForCell('flower')).toBe('FLOWER')
    expect(labelForCell('ground_decor')).toBe('GROUND_DECOR')
  })

  it('labels a fountain basin like a building footprint: rim sides + WATER ring + CENTER', () => {
    // 3×3 fountain → rim ring (corners/edges) + a single CENTER cell, no water ring.
    const f3 = { col: 0, row: 0, w: 3, h: 3 }
    const fountainPos = (col: number, row: number, r: typeof f3): string => {
      const side = footprintSide(col, row, r)
      if (side !== 'INTERIOR') return side
      const maxRing = Math.floor((Math.min(r.w, r.h) - 1) / 2)
      return footprintRing(col, row, r) >= maxRing ? 'CENTER' : 'WATER'
    }
    expect(labelForCell('fountain', fountainPos(0, 0, f3))).toBe('FOUNTAIN TOP-LEFT') // rim corner
    expect(labelForCell('fountain', fountainPos(1, 0, f3))).toBe('FOUNTAIN TOP')  // rim edge
    expect(labelForCell('fountain', fountainPos(1, 1, f3))).toBe('FOUNTAIN CENTER')
    // 5×5 fountain → rim, then a WATER ring, then the CENTER cell.
    const f5 = { col: 0, row: 0, w: 5, h: 5 }
    expect(labelForCell('fountain', fountainPos(0, 0, f5))).toBe('FOUNTAIN TOP-LEFT') // rim corner
    expect(labelForCell('fountain', fountainPos(1, 1, f5))).toBe('FOUNTAIN WATER') // inner ring
    expect(labelForCell('fountain', fountainPos(2, 2, f5))).toBe('FOUNTAIN CENTER')
    expect(footprintRing(0, 0, f5)).toBe(0) // rim
    expect(footprintRing(2, 2, f5)).toBe(2) // centre
  })

  it('produces the SAME caption string regardless of which view asks (no drift)', () => {
    // The label is a pure function of (type, resolved position) — identical inputs, identical output.
    const inputs: Array<[string, string]> = [
      ['building', footprintSide(12, 7, rect)],
      ['tree', treeSubpart('tree_top_right')],
      ['fountain', footprintSide(10, 5, { col: 10, row: 5, w: 3, h: 3 })],
      ['lamp', ''],
    ]
    for (const [type, pos] of inputs) {
      expect(labelForCell(type, pos)).toBe(labelForCell(type, pos)) // deterministic, view-agnostic
    }
    expect(labelForCell('building', 'TOP-RIGHT')).toBe('BUILDING TOP-RIGHT')
    expect(labelForCell('tree', 'CANOPY TOP-RIGHT')).toBe('TREE CANOPY TOP-RIGHT')
  })
})

describe('pickLivingTree — weighted random tree-shape variety', () => {
  it('spans the FULL variant set across the [0,1) roll range (no shape is unreachable)', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 1000; i++) seen.add(pickLivingTree(i / 1000))
    expect(seen).toEqual(new Set(['tree', 'tree_tall', 'tree_round', 'tree_stub', 'bush', 'bush_round']))
  })

  it('is deterministic for a given roll and stays in-bounds at the edges', () => {
    expect(pickLivingTree(0)).toBe('tree') // the dominant standard tree leads the table
    expect(pickLivingTree(0)).toBe(pickLivingTree(0)) // pure
    expect(pickLivingTree(0.9999)).toBe('bush_round') // last slice → the final variant, never out of range
  })
})
