/**
 * REALISTIC SAMPLE COMPOSITIONS — the window-grid / storefront / flat-roof / fountain / tree-trunk rules
 * asserted END-TO-END on the loaded backend tileset (the captured `/api/tilesets` fixture = the nebulith
 * source of truth). These prove the DATA the app renders from, not pixels: THE realism rule is that windows
 * form a SPACED GRID (window, wall, window …), vertically aligned across floors — never a solid band.
 */
import '@/__tests__/helpers/installTilesetSeed'
import { resolveComposition } from '@/engine/tileset/tileset'
import { ASCII_TILESET } from '@/engine/tileset/asciiTileset'
import { EMOJI_TILESET } from '@/engine/tileset/emojiTileset'
import { assetKind } from '@/game/artStyle'

type Cell = { dx: number; dy: number; level: number; label: string; settings?: { scaleY?: number } }
const comp = (name: string) => resolveComposition(ASCII_TILESET, name)!

// A minimal-cell (#30) building authors a same-tile vertical RUN as ONE cell sized settings.scaleY = span,
// so a cell at `level` with scaleY = n covers levels level..level+n-1. Expand so a per-level read still works.
function levelsOf(c: Cell): number[] {
  const span = Math.max(1, Math.trunc(c.settings?.scaleY ?? 1))
  return Array.from({ length: span }, (_, i) => c.level + i)
}
// The building's OWN cells — its footprint rows only. The backend also authors the entrance APRON (the `path`
// doorstep, `entrance_cells/2`) on the row IN FRONT of the facade (dy = h) so the doorstep joins the road it
// meets. That apron is GROUND, not facade: leaving it in makes a "front face" read at the door column return
// the doorstep instead of the door.
const facadeCells = (c: { cells: unknown; footprint: { h: number } }): Cell[] =>
  (c.cells as Cell[]).filter(x => x.dy < c.footprint.h)

// The label on a FACE (front = max-dy, back = min-dy) at (dx, level), scaleY-span aware, or null.
function faceLabel(cells: Cell[], face: 'front' | 'back', dx: number, level: number): string | null {
  const at = cells.filter(c => c.dx === dx && levelsOf(c).includes(level))
  if (at.length === 0) return null
  return at.reduce((a, b) => ((face === 'front' ? b.dy > a.dy : b.dy < a.dy) ? b : a)).label
}
// The FRONT face label — what the 2D front elevation reads (kept for the storefront/roof assertions below).
const frontLabel = (cells: Cell[], dx: number, level: number) => faceLabel(cells, 'front', dx, level)
const isWindow = (l: string | null) => l != null && l.startsWith('window')
const isWall = (l: string | null) => l != null && l.startsWith('wall')
// A window shows at (dx, level) if EITHER face carries one — some buildings window the front only, others
// front+back; the centred door only ever suppresses the middle columns, so the union stays symmetric.
const windowAt = (cells: Cell[], dx: number, level: number) =>
  isWindow(faceLabel(cells, 'front', dx, level)) || isWindow(faceLabel(cells, 'back', dx, level))

describe('sample compositions — realistic building/fountain/tree DATA from the backend', () => {
  describe('THE window-grid rule (#31): windows are BILATERALLY SYMMETRIC, edge-walled, aligned across floors', () => {
    for (const name of ['house_3', 'house_4', 'house_5', 'office_5', 'hospital_6', 'big_house_6', 'temple_8', 'cathedral_7', 'castle_12', 'stone_building']) {
      test(`${name}: windows mirror across the centreline, never at the bare edge, aligned across floors`, () => {
        const c = comp(name)
        const w = c.footprint.w
        const cells = facadeCells(c)
        const maxLevel = Math.max(...cells.flatMap(levelsOf))
        const windowColsAt = (lv: number) => Array.from({ length: w }, (_, dx) => dx).filter(dx => windowAt(cells, dx, lv))
        const windowLevels = Array.from({ length: maxLevel + 1 }, (_, lv) => lv).filter(lv => windowColsAt(lv).length > 0)
        expect(windowLevels.length).toBeGreaterThanOrEqual(2) // multiple floors have windows

        const topCols = windowColsAt(windowLevels[windowLevels.length - 1])
        expect(topCols.length).toBeGreaterThanOrEqual(1)

        for (const lv of windowLevels) {
          const cols = windowColsAt(lv)
          // BILATERAL SYMMETRY — every window column is mirrored by w-1-dx across the centreline.
          for (const dx of cols) expect(cols).toContain(w - 1 - dx)
          // EDGES ARE WALLS — a window is never at the bare edge (min unit is wall·window·wall).
          expect(cols).not.toContain(0)
          expect(cols).not.toContain(w - 1)
          expect(isWall(faceLabel(cells, 'back', 0, lv))).toBe(true)
          expect(isWall(faceLabel(cells, 'back', w - 1, lv))).toBe(true)
          // ALIGNED — every window column stacks (subset of the top floor's set), never a wandering column.
          expect(cols.every(dx => topCols.includes(dx))).toBe(true)
        }

        // WALL COURSE BETWEEN FLOORS — between two window floors there is a level with walls in those columns.
        for (let i = 1; i < windowLevels.length; i++) {
          const between = windowLevels[i - 1] + 1
          if (between < windowLevels[i]) expect(topCols.every(dx => isWall(faceLabel(cells, 'back', dx, between)))).toBe(true)
        }
      })
    }
  })

  test('store: a storefront — wide display window + centred door + a striped awning above, flat roof', () => {
    const c = comp('store_5')
    const cells = facadeCells(c)
    const w = c.footprint.w
    const doorCol = Math.floor(w / 2)
    // Ground front (level 0): display windows flanking a centred door.
    expect(frontLabel(cells, doorCol, 0)).toBe('door')
    const groundGlass = Array.from({ length: w }, (_, dx) => dx).filter(dx => dx !== doorCol && frontLabel(cells, dx, 0) === 'display_window')
    expect(groundGlass.length).toBeGreaterThanOrEqual(2) // a WIDE storefront (≥2 display-window cells)
    // Awning band directly ABOVE the storefront (level 1), over the display windows.
    expect(groundGlass.every(dx => frontLabel(cells, dx, 1) === 'awning')).toBe(true)
    // FLAT roof (parapet), not a gable, and a blue "Store" sign (roof_top_store) as the badge anchor.
    const labels = new Set(cells.map(x => x.label))
    expect(labels.has('parapet')).toBe(true)
    expect(labels.has('roof_top_store')).toBe(true)
    expect([...labels].some(l => l === 'roof' || l === 'roof_store')).toBe(false) // no gable roof
  })

  test('office: taller than a house, flat roof + a rooftop unit, regular window grid every floor', () => {
    const c = comp('office_5')
    const cells = facadeCells(c)
    const maxLevel = Math.max(...cells.map(x => x.level))
    expect(maxLevel).toBeGreaterThan(Math.max(...comp('house_4').cells.map(x => x.level))) // taller than a house
    const labels = new Set(cells.map(x => x.label))
    expect(labels.has('flat_roof')).toBe(true)
    expect(labels.has('parapet')).toBe(true)
    expect(labels.has('rooftop_unit')).toBe(true)
    expect(labels.has('roof')).toBe(false) // flat, not gable
  })

  // A water cell as the backend serves it — the interior `water_c`, with the optional default grow animation.
  type WaterCell = Cell & {
    scale?: number
    zIndex?: number
    animations?: Array<{ id: string; yoyo?: boolean; loop?: boolean; ease?: string; durationMs: number; startDelayMs: number; tracks: Array<{ setting: string; from: number; to: number }> }>
  }

  // EXACTLY 3 water columns animate in BOTH variants (Alexander: "in all cases only 3 blocks are animated"),
  // each the SAME 1→4 sine-yoyo grow but with a DISTINCT durationMs + startDelayMs so they pulse OUT of sync
  // (Alexander: "different duration and delays … realistic fountain water"). This is the desync evidence at the
  // DATA level — it would fail if the three shared one timing.
  function assertDesyncedGrow(animated: WaterCell[]): void {
    expect(animated).toHaveLength(3)
    for (const cell of animated) {
      expect(cell.animations?.length).toBe(1)
      const grow = cell.animations![0]
      expect(grow.id).toBe('fountain_water_grow')
      expect(grow.yoyo).toBe(true)
      expect(grow.loop).toBe(true)
      expect(grow.ease).toBe('sine')
      expect(grow.tracks).toEqual([{ setting: 'height', from: 1, to: 4 }]) // grow the HEIGHT 1→4, no y-lift/opacity
      expect(grow.durationMs).toBeGreaterThanOrEqual(1000)
      expect(grow.durationMs).toBeLessThanOrEqual(1800)
      expect(grow.startDelayMs).toBeGreaterThanOrEqual(0)
      expect(grow.startDelayMs).toBeLessThanOrEqual(800)
    }
    // DESYNCED — the three durations are all distinct AND the three start delays are all distinct, so no two
    // columns share a yoyo period/phase (distinct durations ⇒ distinct periods ⇒ they drift permanently apart).
    const durations = animated.map(c => c.animations![0].durationMs)
    const delays = animated.map(c => c.animations![0].startDelayMs)
    expect(new Set(durations).size).toBe(3)
    expect(new Set(delays).size).toBe(3)
  }

  // Shared basin checks: a rim of the correct EDGE/CORNER pieces around an all-`water_c` interior (scale 1.15),
  // no single-fill rim, no `water_jet` drops. Returns the interior water cells + the subset that animate.
  function assertBasin(name: string, fw: number, fh: number): { interior: WaterCell[]; animated: WaterCell[] } {
    const c = comp(name)
    const cells = c.cells as WaterCell[]
    const { w, h } = c.footprint
    expect([w, h]).toEqual([fw, fh])
    const edge = (dx: number, dy: number) => dx === 0 || dx === w - 1 || dy === 0 || dy === h - 1
    const labels = new Set(cells.map(x => x.label))
    const groundAt = (dx: number, dy: number) => cells.find(x => x.level === 0 && x.dx === dx && x.dy === dy)!.label

    // CENTER — every interior floor cell is the water CENTER piece (blue water), a bit bigger (scale 1.15).
    const interior = cells.filter(x => x.level === 0 && !edge(x.dx, x.dy))
    for (const cell of interior) {
      expect(cell.label).toBe('water_c')
      expect(cell.scale).toBeCloseTo(1.15)
    }
    // CORNERS + EDGES — the rim is autotile pieces, NOT a single stone_rim fill; no `water_jet` drops.
    expect(groundAt(0, 0)).toBe('fountain_tl')
    expect(groundAt(w - 1, 0)).toBe('fountain_tr')
    expect(groundAt(0, h - 1)).toBe('fountain_bl')
    expect(groundAt(w - 1, h - 1)).toBe('fountain_br')
    for (const e of ['fountain_t', 'fountain_b', 'fountain_l', 'fountain_r']) expect(labels.has(e)).toBe(true)
    expect([...labels].filter(l => l.startsWith('fountain_')).length).toBeGreaterThanOrEqual(8) // 4 edges + 4 corners
    expect(labels.has('stone_rim')).toBe(false)
    expect(labels.has('water_jet')).toBe(false)
    return { interior, animated: interior.filter(cell => cell.animations && cell.animations.length > 0) }
  }

  test('well (SMALL variant): a 5×3 basin with a 1×3 water LINE, all 3 columns animated + DESYNCED', () => {
    const { interior, animated } = assertBasin('well', 5, 3)
    expect(interior).toHaveLength(3) // a 1×3 line of water
    assertDesyncedGrow(animated) // all 3 animate, out of sync
  })

  test('fountain (LARGE variant): a 5×5 basin with a 3×3 water GRID, only the CENTER ROW of 3 animated + DESYNCED', () => {
    const { interior, animated } = assertBasin('fountain', 5, 5)
    expect(interior).toHaveLength(9) // a 3×3 grid of water (Alexander: "9 blocks of water")
    // Only the 3 CENTRE cells animate; the other 6 are STATIC blue water (no animations at all).
    const staticCells = interior.filter(cell => !cell.animations || cell.animations.length === 0)
    expect(staticCells).toHaveLength(6)
    // The animated cells are the central LINE of 3 (all share one dy — the middle row through the centre).
    expect(new Set(animated.map(c => c.dy)).size).toBe(1)
    assertDesyncedGrow(animated)
  })

  test('the fountain/well basin rim and water default to zIndex 0 (draw priority is a capability, not a default)', () => {
    // Reverted: nothing carries a non-zero draw priority by DEFAULT (Alexander: "just leave everything on 0 by
    // default for now … we'll only need specific z-index once we start working composition optimization"). The
    // zIndex CAPABILITY stays wired — isoDepthCompare still honours it (isoDepthZIndex.test.ts) — but the served
    // fountain/well data is 0 for both the water and its rim. Pure DATA, from the API.
    for (const name of ['fountain', 'well']) {
      const cells = comp(name).cells as Array<Cell & { zIndex?: number }>
      const water = cells.filter(c => c.label === 'water_c')
      const rim = cells.filter(c => c.label.startsWith('fountain_'))
      expect(water.length).toBeGreaterThanOrEqual(3)
      expect(rim.length).toBeGreaterThanOrEqual(8)
      expect(water.every(c => (c.zIndex ?? 0) === 0)).toBe(true)
      expect(rim.every(c => (c.zIndex ?? 0) === 0)).toBe(true)
    }
  })

  test('every composition cell keeps the default zIndex 0 — nothing carries a non-zero draw priority', () => {
    // Guards the "default 0 → no regression" contract at the DATA level: across every seeded composition
    // (trees, bushes, all buildings, AND the fountain/well basin) NO cell carries a non-zero zIndex.
    const names = ['tree', 'bush', 'fountain', 'well', 'house_3', 'house_4', 'house_5', 'store_5', 'office_5', 'stone_building', 'hospital_6', 'big_house_6', 'temple_8', 'cathedral_7', 'castle_12']
    for (const name of names) {
      const c = resolveComposition(ASCII_TILESET, name)
      if (!c) continue
      const cells = c.cells as Array<Cell & { zIndex?: number }>
      expect(cells.every(cell => (cell.zIndex ?? 0) === 0)).toBe(true)
    }
  })

  test('stone_building: a wall_stone MATERIAL box, front face autotiled from center/edge/corner pieces + spaced windows + door + gable roof', () => {
    const c = comp('stone_building')
    const cells = facadeCells(c)
    expect(c.footprint.w).toBe(5)
    const labels = new Set(cells.map(x => x.label))
    // MATERIAL variety — the wall field is `wall_stone` (a DISTINCT tile from brick), never plain `wall`/brick reskins.
    expect(labels.has('wall_stone_c')).toBe(true)
    expect([...labels].some(l => l === 'wall' || l.startsWith('wall_house') || l === 'wall_store' || l === 'wall_hospital')).toBe(false)
    // PIECES — all four edges + all four corners present (autotiled front face, not one fill).
    for (const p of ['wall_stone_t', 'wall_stone_b', 'wall_stone_l', 'wall_stone_r', 'wall_stone_tl', 'wall_stone_tr', 'wall_stone_bl', 'wall_stone_br'])
      expect(labels.has(p)).toBe(true)
    // A SYMMETRIC window GRID (#31 — mirror across the centreline, edges walls), a door, and a GABLE roof.
    const maxLevel = Math.max(...cells.flatMap(levelsOf))
    const winLevels = Array.from({ length: maxLevel + 1 }, (_, lv) => lv).filter(lv => Array.from({ length: 5 }, (_, dx) => dx).some(dx => windowAt(cells, dx, lv)))
    expect(winLevels.length).toBeGreaterThanOrEqual(1)
    for (const lv of winLevels) {
      const cols = Array.from({ length: 5 }, (_, dx) => dx).filter(dx => windowAt(cells, dx, lv))
      for (const dx of cols) expect(cols).toContain(5 - 1 - dx) // bilaterally symmetric
      expect(cols).not.toContain(0) // edge is a wall
      expect(cols).not.toContain(4)
    }
    expect(labels.has('door')).toBe(true)
    expect(labels.has('roof')).toBe(true)
    expect(labels.has('roof_top')).toBe(true) // gable ridge/apex
  })

  test('every AUTOTILE PIECE label (fountain rim/water/jet + stone-wall material) resolves in BOTH styles — no gaps', () => {
    // The NEW piece labels the sample authors — each must carry an ascii glyph AND an emoji char so both
    // styles paint the piece per-cell. (roof/roof_top/window/door are pre-existing labels that resolve via
    // their own emoji or the coarse roof kind — out of scope here.)
    const isPiece = (l: string) => /^(wall_stone|fountain_|water_c$|water_jet$)/.test(l)
    const pieces = new Set<string>()
    for (const name of ['fountain', 'stone_building']) for (const cell of comp(name).cells as Cell[]) if (isPiece(cell.label)) pieces.add(cell.label)
    expect(pieces.size).toBeGreaterThanOrEqual(18) // water_c + water_jet + 8 fountain rim + 9 wall_stone pieces used
    expect([...pieces].filter(l => !ASCII_TILESET.tiles[l]?.glyph)).toEqual([]) // ascii glyph gaps
    expect([...pieces].filter(l => !EMOJI_TILESET[l]?.char)).toEqual([]) // emoji char gaps
  })

  test('the LIGHT POST is a post+lamp composition — identical structure in both styles, each piece a real tile in both', () => {
    // BUG #4 (Images #43/#44): a light post is a COMPOSITION (a `post` base at level 0 + the `lamp` on top at
    // level 1), NOT a single lamp tile. The composition is style-agnostic (stamped for both styles); only the
    // ART differs per style. Both pieces must resolve to a real per-cell tile in BOTH tilesets, so emoji renders
    // a post + 💡 (not a lonely 💡) and ascii a pole + lamp.
    const lp = comp('lamp_post')
    expect(lp.footprint).toEqual({ w: 1, h: 1 })
    const byLevel = (lp.cells as Cell[]).slice().sort((a, b) => a.level - b.level)
    expect(byLevel.map(c => [c.label, c.level])).toEqual([['post', 0], ['lamp', 1]])
    // no single-tile collapse: each piece carries its OWN ascii glyph AND emoji char
    for (const label of ['post', 'lamp']) {
      expect(ASCII_TILESET.tiles[label]?.glyph).toBeTruthy()
      expect(EMOJI_TILESET[label]?.char).toBeTruthy()
    }
  })

  test('autotile PIECE cells route to their OWN per-cell tile (not the coarse wall/fountain emoji) in ISO', () => {
    // The stone-wall + fountain piece labels must classify as the unmapped `ground` kind, so the emoji ISO
    // renderer paints each cell's own tile (⬜ stone / 🟦 water / 💧 jet) instead of the base 🧱/⛲. A plain
    // brick `wall` and a lone `fountain` tile still map to their coarse kind (unchanged).
    for (const label of ['wall_stone_c', 'wall_stone_tl', 'fountain_t', 'fountain_br', 'water_c', 'water_jet'])
      expect(assetKind({ type: 'fountain', label })).toBe('ground')
    expect(assetKind({ type: 'building', label: 'wall' })).toBe('wall')
    expect(assetKind({ type: 'fountain', label: 'fountain' })).toBe('fountain')
  })

  test('tree: EXACTLY 2 tiles — one thin tall trunk (L0) + one bigger leaf cube lifted onto its top', () => {
    const c = comp('tree')
    const cells = c.cells as Array<Cell & { scale?: number; settings?: { scaleX?: number; scaleY?: number } }>
    expect(cells.length).toBe(2) // the optimized model — one trunk, one leaf (Alexander: "just two tiles")
    expect(c.footprint).toEqual({ w: 1, h: 1 }) // a single column, not a canopy footprint
    // ONE trunk cell on the ground (L0): a thin tall post — Zoom(scale) 0.6, Height(settings.scaleY) 3.15.
    const trunk = cells.filter(x => x.label.startsWith('trunk'))
    expect(trunk.length).toBe(1)
    expect([trunk[0].dx, trunk[0].dy, trunk[0].level]).toEqual([0, 0, 0]) // base is a TRUNK on the ground
    expect(trunk[0].scale).toBe(0.6)
    expect(trunk[0].settings?.scaleY).toBe(3.15)
    // ONE leaf cell tops the trunk (level 2), same column, zoomed UP into a bigger cube (Zoom 1.35, Height 2).
    const leaves = cells.filter(x => x.label.startsWith('leaf'))
    expect(leaves.length).toBe(1)
    const leaf = leaves[0]
    expect(leaf.label).toBe('leaf_center')
    expect([leaf.dx, leaf.dy, leaf.level]).toEqual([0, 0, 2])
    expect(leaf.level).toBeGreaterThan(trunk[0].level) // the leaf sits ABOVE the trunk
    expect(leaf.scale).toBe(1.35)
    expect(leaf.settings?.scaleY).toBe(2)
    // DIMENSION SANITY: the trunk is thinner + less zoomed than the leaves (never a top-heavy-inverted tree).
    expect((trunk[0].scale ?? 1)).toBeLessThan(leaf.scale ?? 1)
    // the retired 9-slice canopy is gone
    expect(cells.some(x => x.label.startsWith('canopy'))).toBe(false)
    // The bush, by contrast, is trunkless — a SINGLE leaf tile, no trunk.
    const bush = comp('bush').cells as Cell[]
    expect(bush.length).toBe(1)
    expect(bush.some(x => x.label.startsWith('trunk'))).toBe(false)
  })
})

// ── MATERIAL + ROOF ROLLOUT — the blessed autotile-piece sample rolled out to every building ──────────
const SUFFIXES = ['c', 't', 'b', 'l', 'r', 'tl', 'tr', 'bl', 'br']
const WALL_MATERIALS = ['wall_stone', 'wall_brick', 'wall_wood', 'wall_plaster']
// Each building type → the wall MATERIAL its facade must emit (spec mapping table).
const TYPE_MATERIAL: Record<string, string> = {
  house_3: 'wall_brick', house_4: 'wall_wood', house_5: 'wall_stone',
  store_5: 'wall_brick', office_5: 'wall_stone', stone_building: 'wall_stone',
}
const labelsOf = (name: string) => new Set((comp(name).cells as Cell[]).map(c => c.label))

describe('material + roof rollout — every material/piece resolves and every building emits its mapped material', () => {
  test('each wall MATERIAL set (center + 8 edge/corner) + the slate roof resolve in BOTH styles — no gaps', () => {
    const need: string[] = []
    for (const base of WALL_MATERIALS) for (const s of SUFFIXES) need.push(`${base}_${s}`)
    need.push('roof_slate', 'roof_top_slate')
    // every new label carries an ascii glyph AND an emoji char (both tilesets paint it per-cell).
    expect(need.filter(l => !ASCII_TILESET.tiles[l]?.glyph)).toEqual([])
    expect(need.filter(l => !EMOJI_TILESET[l]?.char)).toEqual([])
  })

  test('each material carries its OWN distinct emoji block (stone 🪨 ≠ brick 🧱 ≠ wood 🟫 ≠ plaster ⬜, slate ⬛)', () => {
    expect(EMOJI_TILESET['wall_stone_c'].char).toBe('🪨') // distinct from the ⬜ fountain rim (spec style call #3)
    expect(EMOJI_TILESET['wall_brick_c'].char).toBe('🧱')
    expect(EMOJI_TILESET['wall_wood_c'].char).toBe('🟫')
    expect(EMOJI_TILESET['wall_plaster_c'].char).toBe('⬜')
    expect(EMOJI_TILESET['roof_slate'].char).toBe('⬛')
    expect(EMOJI_TILESET['roof_top_slate'].char).toBe('⬛')
  })

  describe('each BOX building facade emits its mapped material — center + autotiled edge/corner pieces', () => {
    for (const [name, mat] of Object.entries(TYPE_MATERIAL)) {
      test(`${name} → ${mat} (autotiled front + center field, no other material leaks in)`, () => {
        const labels = labelsOf(name)
        expect(labels.has(`${mat}_c`)).toBe(true) // the material center field
        // the FRONT face is autotiled → at least one edge/corner piece of this material is present
        expect([...labels].some(l => l.startsWith(`${mat}_`) && l !== `${mat}_c`)).toBe(true)
        // no OTHER wall material bleeds into the facade
        for (const other of WALL_MATERIALS) {
          if (other === mat) continue
          expect([...labels].some(l => l.startsWith(`${other}`))).toBe(false)
        }
        // and never a plain generic `wall` fill
        expect(labels.has('wall')).toBe(false)
      })
    }
  })

  test('hand-authored civic buildings SWAP only their wall to a material CENTER piece (shape untouched)', () => {
    expect(labelsOf('big_house_6').has('wall_brick_c')).toBe(true) // brick
    expect(labelsOf('hospital_6').has('wall_plaster_c')).toBe(true) // plaster
    for (const name of ['temple_8', 'cathedral_7', 'castle_12']) expect(labelsOf(name).has('wall_stone_c')).toBe(true) // stone
    // no autotiled edge pieces (they keep the plain center field), and no generic `wall`
    for (const name of ['big_house_6', 'hospital_6', 'temple_8', 'cathedral_7', 'castle_12'])
      expect(labelsOf(name).has('wall')).toBe(false)
  })

  test('stone/masonry GABLE buildings take the SLATE roof; brick/wood houses keep the RED gable', () => {
    for (const name of ['house_5', 'temple_8', 'cathedral_7', 'castle_12']) {
      const labels = labelsOf(name)
      expect(labels.has('roof_slate')).toBe(true)
      expect(labels.has('roof')).toBe(false) // no red gable body
      expect(labels.has('roof_top')).toBe(false) // no red gable apex
    }
    for (const name of ['house_3', 'house_4']) {
      const labels = labelsOf(name)
      expect(labels.has('roof')).toBe(true) // red gable stays for brick/wood
      expect(labels.has('roof_slate')).toBe(false)
    }
  })

  test('hospital keeps its GREEN roof + store keeps its BLUE badge (identity survives the material swap)', () => {
    expect(labelsOf('hospital_6').has('roof_hospital')).toBe(true)
    expect(labelsOf('store_5').has('roof_top_store')).toBe(true)
    expect(labelsOf('store_5').has('parapet')).toBe(true) // still a flat storefront roof
  })

  test('tree: brown trunk (🟫) + ONE leaf canopy (🍃) resolve — with a BAKED image in BOTH styles — never a whole 🌲', () => {
    const labels = [...labelsOf('tree')]
    const trunk = labels.filter(l => l.startsWith('trunk'))
    const leaf = labels.filter(l => l.startsWith('leaf'))
    expect(trunk.length).toBeGreaterThanOrEqual(1)
    expect(leaf).toEqual(['leaf_center']) // ONE leaf tile IS the whole (2×) canopy now
    // both parts carry an ascii glyph AND an emoji char
    for (const l of [...trunk, ...leaf]) {
      expect(ASCII_TILESET.tiles[l]?.glyph).toBeTruthy()
      expect(EMOJI_TILESET[l]?.char).toBeTruthy()
    }
    for (const l of trunk) expect(EMOJI_TILESET[l].char).toBe('🟫') // brown trunk block
    for (const l of leaf) expect(EMOJI_TILESET[l].char).toBe('🍃') // leaf — not a whole tree, not an herb
    expect(labels.some(l => EMOJI_TILESET[l]?.char === '🌲')).toBe(false) // never the whole-object tree
    // the leaf tile carries a NON-null baked image in BOTH styles (no more image_url:null → the tint composites
    // onto a real PNG, so emoji leaves take the per-tree pink/brown canopy shade instead of staying green)
    expect(ASCII_TILESET.tiles['leaf_center']?.image).toBeTruthy()
    expect(EMOJI_TILESET['leaf_center']?.image).toBeTruthy()
  })

  test('classifier routes the new wall materials + slate roof to the `ground` kind (per-label emoji)', () => {
    for (const label of ['wall_brick_c', 'wall_wood_t', 'wall_plaster_bl', 'wall_stone_c', 'roof_slate', 'roof_top_slate'])
      expect(assetKind({ type: 'building', label })).toBe('ground')
    // a plain brick `wall` (no material) still maps to the coarse wall kind (unchanged)
    expect(assetKind({ type: 'building', label: 'wall' })).toBe('wall')
    // a plain `roof` still maps to the coarse roof kind
    expect(assetKind({ type: 'building', label: 'roof' })).toBe('roof')
  })
})
