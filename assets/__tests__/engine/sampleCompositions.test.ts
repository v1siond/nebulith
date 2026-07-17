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

type Cell = { dx: number; dy: number; level: number; label: string }
const comp = (name: string) => resolveComposition(ASCII_TILESET, name)!

// The FRONT face (max-dy row wins) label at each (dx, level) — what the 2D front elevation reads.
function frontLabel(cells: Cell[], dx: number, level: number): string | null {
  const at = cells.filter(c => c.dx === dx && c.level === level)
  if (at.length === 0) return null
  return at.reduce((a, b) => (b.dy > a.dy ? b : a)).label
}
const isWindow = (l: string | null) => l != null && l.startsWith('window')
const isWall = (l: string | null) => l != null && l.startsWith('wall')

describe('sample compositions — realistic building/fountain/tree DATA from the backend', () => {
  describe('THE window-grid rule: windows are SPACED + vertically aligned, never a solid band', () => {
    for (const name of ['house_3', 'house_4', 'house_5', 'office_5']) {
      test(`${name}: window columns are spaced (no two adjacent) and aligned across floors`, () => {
        const c = comp(name)
        const w = c.footprint.w
        const cells = c.cells as Cell[]
        const levels = [...new Set(cells.map(x => x.level))].sort((a, b) => a - b)

        // The window LEVELS (floors that carry any front window).
        const windowLevels = levels.filter(lv => Array.from({ length: w }, (_, dx) => frontLabel(cells, dx, lv)).some(isWindow))
        expect(windowLevels.length).toBeGreaterThanOrEqual(2) // multiple floors have windows

        const windowColsAt = (lv: number) =>
          Array.from({ length: w }, (_, dx) => dx).filter(dx => isWindow(frontLabel(cells, dx, lv)))

        for (const lv of windowLevels) {
          const cols = windowColsAt(lv)
          // NOT a solid band — at least one non-window column sits between windows on this floor.
          expect(cols.length).toBeLessThan(w)
          // SPACED — no two window columns are adjacent (a wall pier separates them).
          for (let i = 1; i < cols.length; i++) expect(cols[i] - cols[i - 1]).toBeGreaterThanOrEqual(2)
        }

        // ALIGNED — every window sits in the SAME vertical columns (a window above a window). The
        // topmost floor carries the full set; lower floors are a subset (the ground floor's centred
        // door replaces the window in the door column), never a window in a NEW/wandering column.
        const topCols = windowColsAt(windowLevels[windowLevels.length - 1])
        expect(topCols.length).toBeGreaterThanOrEqual(1)
        for (const lv of windowLevels) expect(windowColsAt(lv).every(dx => topCols.includes(dx))).toBe(true)

        // WALL BETWEEN FLOORS — between two window floors there is a level with walls in those columns.
        for (let i = 1; i < windowLevels.length; i++) {
          const between = windowLevels[i - 1] + 1
          expect(topCols.every(dx => isWall(frontLabel(cells, dx, between)))).toBe(true)
        }
      })
    }
  })

  test('store: a storefront — wide display window + centred door + a striped awning above, flat roof', () => {
    const c = comp('store_5')
    const cells = c.cells as Cell[]
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
    const cells = c.cells as Cell[]
    const maxLevel = Math.max(...cells.map(x => x.level))
    expect(maxLevel).toBeGreaterThan(Math.max(...comp('house_4').cells.map(x => x.level))) // taller than a house
    const labels = new Set(cells.map(x => x.label))
    expect(labels.has('flat_roof')).toBe(true)
    expect(labels.has('parapet')).toBe(true)
    expect(labels.has('rooftop_unit')).toBe(true)
    expect(labels.has('roof')).toBe(false) // flat, not gable
  })

  test('fountain: assembled from AUTOTILE PIECES — water CENTER, rim EDGES + CORNERS, raised jets (not one fill)', () => {
    const c = comp('fountain')
    const cells = c.cells as Cell[]
    const { w, h } = c.footprint
    expect([w, h]).toEqual([5, 4])
    const edge = (dx: number, dy: number) => dx === 0 || dx === w - 1 || dy === 0 || dy === h - 1
    const labels = new Set(cells.map(x => x.label))
    const groundAt = (dx: number, dy: number) => cells.find(x => x.level === 0 && x.dx === dx && x.dy === dy)!.label

    // CENTER — every interior floor cell is the water CENTER piece.
    for (const cell of cells.filter(x => x.level === 0 && !edge(x.dx, x.dy))) expect(cell.label).toBe('water_c')
    // CORNERS — the four corner pieces sit at the four corners.
    expect(groundAt(0, 0)).toBe('fountain_tl')
    expect(groundAt(w - 1, 0)).toBe('fountain_tr')
    expect(groundAt(0, h - 1)).toBe('fountain_bl')
    expect(groundAt(w - 1, h - 1)).toBe('fountain_br')
    // EDGES — all four side pieces present. This is a RIM of pieces, NOT a single stone_rim fill.
    for (const e of ['fountain_t', 'fountain_b', 'fountain_l', 'fountain_r']) expect(labels.has(e)).toBe(true)
    expect([...labels].filter(l => l.startsWith('fountain_')).length).toBeGreaterThanOrEqual(8) // 4 edges + 4 corners
    expect(labels.has('stone_rim')).toBe(false) // the old single-fill rim is gone
    // JETS raised above the water floor.
    const jets = cells.filter(x => x.label === 'water_jet')
    expect(jets.length).toBeGreaterThanOrEqual(1)
    expect(jets.every(j => j.level >= 1)).toBe(true)
  })

  test('stone_building: a wall_stone MATERIAL box, front face autotiled from center/edge/corner pieces + spaced windows + door + gable roof', () => {
    const c = comp('stone_building')
    const cells = c.cells as Cell[]
    expect(c.footprint.w).toBe(5)
    const labels = new Set(cells.map(x => x.label))
    // MATERIAL variety — the wall field is `wall_stone` (a DISTINCT tile from brick), never plain `wall`/brick reskins.
    expect(labels.has('wall_stone_c')).toBe(true)
    expect([...labels].some(l => l === 'wall' || l.startsWith('wall_house') || l === 'wall_store' || l === 'wall_hospital')).toBe(false)
    // PIECES — all four edges + all four corners present (autotiled front face, not one fill).
    for (const p of ['wall_stone_t', 'wall_stone_b', 'wall_stone_l', 'wall_stone_r', 'wall_stone_tl', 'wall_stone_tr', 'wall_stone_bl', 'wall_stone_br'])
      expect(labels.has(p)).toBe(true)
    // A spaced window GRID (never a solid band), a door, and a GABLE roof (ridge/apex piece).
    const front = (dx: number, level: number) => frontLabel(cells, dx, level)
    const winLevels = [...new Set(cells.map(x => x.level))].filter(lv => Array.from({ length: 5 }, (_, dx) => front(dx, lv)).some(isWindow))
    expect(winLevels.length).toBeGreaterThanOrEqual(1)
    for (const lv of winLevels) {
      const cols = Array.from({ length: 5 }, (_, dx) => dx).filter(dx => isWindow(front(dx, lv)))
      for (let i = 1; i < cols.length; i++) expect(cols[i] - cols[i - 1]).toBeGreaterThanOrEqual(2) // spaced
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

  test('autotile PIECE cells route to their OWN per-cell tile (not the coarse wall/fountain emoji) in ISO', () => {
    // The stone-wall + fountain piece labels must classify as the unmapped `ground` kind, so the emoji ISO
    // renderer paints each cell's own tile (⬜ stone / 🟦 water / 💧 jet) instead of the base 🧱/⛲. A plain
    // brick `wall` and a lone `fountain` tile still map to their coarse kind (unchanged).
    for (const label of ['wall_stone_c', 'wall_stone_tl', 'fountain_t', 'fountain_br', 'water_c', 'water_jet'])
      expect(assetKind({ type: 'fountain', label })).toBe('ground')
    expect(assetKind({ type: 'building', label: 'wall' })).toBe('wall')
    expect(assetKind({ type: 'fountain', label: 'fountain' })).toBe('fountain')
  })

  test('tree: a 3-segment brown trunk (L0–2) with a 9-slice leaf canopy stacked above', () => {
    const cells = comp('tree').cells as Cell[]
    const base = cells.filter(x => x.level === 0)
    expect(base.length).toBeGreaterThanOrEqual(1)
    expect(base.every(x => x.label.startsWith('trunk'))).toBe(true) // the base is a TRUNK, not a leaf
    // a 3-SEGMENT trunk climbs the centre column (levels 0/1/2, single column)
    const trunk = cells.filter(x => x.label.startsWith('trunk'))
    expect(trunk.map(x => x.level).sort((a, b) => a - b)).toEqual([0, 1, 2])
    expect(trunk.every(x => x.dx === 0 && x.dy === 0)).toBe(true)
    // a 9-SLICE leaf canopy sits ABOVE the trunk — autotiled centre + 4 edges + 4 corners
    const trunkTop = Math.max(...trunk.map(x => x.level))
    const canopy = cells.filter(x => x.label.startsWith('canopy'))
    expect(canopy.length).toBe(9)
    expect(canopy.every(x => x.level > trunkTop)).toBe(true) // leaves stack ABOVE the trunk
    expect(new Set(canopy.map(x => x.label.replace('canopy_', '')))).toEqual(
      new Set(['c', 't', 'b', 'l', 'r', 'tl', 'tr', 'bl', 'br']),
    )
    // The bush, by contrast, is trunkless (a low leaf mound) — trunks are a TREE thing.
    expect((comp('bush').cells as Cell[]).some(x => x.label.startsWith('trunk'))).toBe(false)
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

  test('tree: brown trunk (🟫) + 9-slice leaf canopy (🍃) resolve in BOTH styles — never a whole 🌲', () => {
    const labels = [...labelsOf('tree')]
    const trunk = labels.filter(l => l.startsWith('trunk'))
    const canopy = labels.filter(l => l.startsWith('canopy'))
    expect(trunk.length).toBeGreaterThanOrEqual(1)
    expect(canopy.length).toBeGreaterThanOrEqual(1)
    // both parts carry an ascii glyph AND an emoji char
    for (const l of [...trunk, ...canopy]) {
      expect(ASCII_TILESET.tiles[l]?.glyph).toBeTruthy()
      expect(EMOJI_TILESET[l]?.char).toBeTruthy()
    }
    for (const l of trunk) expect(EMOJI_TILESET[l].char).toBe('🟫') // brown trunk block
    for (const l of canopy) expect(EMOJI_TILESET[l].char).toBe('🍃') // leaf — not a whole tree, not an herb
    expect(labels.some(l => EMOJI_TILESET[l]?.char === '🌲')).toBe(false) // never the whole-object tree
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
