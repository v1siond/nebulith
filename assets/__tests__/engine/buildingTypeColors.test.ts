/**
 * PER-TYPE BUILDING MATERIALS/COLOURS + APEX NAME BADGE — DATA (Alexander's model). Each building type gets
 * its own wall MATERIAL tile (house_3 brick, house_4 wood, house_5/office/civic stone, hospital plaster) +
 * roof (red gable, grey slate for stone, blue store sign, green hospital) — each carrying its colour in
 * settings.colors — and the building NAME is composition DATA (`title`) the stamp badges the roof apex with.
 * These assert the resolved COLOUR + LABEL + TITLE end-to-end through the DB tileset + stamp — never a
 * hardcoded glyph.
 */
import '@/__tests__/helpers/installTilesetSeed' // type tiles + building compositions come from the loaded backend tileset fixture
import { IsometricGrid } from '@/engine/IsometricGrid'
import { stampBuildingComposition } from '@/game/runtime/composition'
import { resolveComposition, resolveTile } from '@/engine/tileset/tileset'
import { ASCII_TILESET } from '@/engine/tileset/asciiTileset'

const mkGrid = () => new IsometricGrid({ cols: 32, rows: 32, cellSize: 16, isoScale: 1.4 })
const roofOf = (grid: IsometricGrid, type: string) =>
  grid.assets.find(a => (a.label ?? '').startsWith('roof') && !(a.label ?? '').startsWith('roof_top') && a.type === type)!

describe('per-type building colours come from the type-specific DB tile (not one shared roof)', () => {
  test('the DB tileset resolves a store roof to BLUE and a hospital roof to GREEN — its own tile', () => {
    const store = resolveTile(ASCII_TILESET, 'summer', 'roof_store')
    const hospital = resolveTile(ASCII_TILESET, 'summer', 'roof_hospital')
    expect(store.color).toBe('#235a96') // recovered store blue (old BUILDING_PALETTES.store.roof)
    expect(hospital.color).toBe('#2f7e50') // recovered hospital green
    // and DISTINCT from the shared default roof (which every building used to share)
    expect(store.color).not.toBe(resolveTile(ASCII_TILESET, 'summer', 'roof').color)
    expect(store.color).not.toBe(hospital.color)
  })

  test('type colours are ZONE-INDEPENDENT — a store roof reads blue in every season (old fixed palette)', () => {
    for (const zone of ['spring', 'summer', 'autumn', 'winter', 'desert', 'beach', 'lava']) {
      expect(resolveTile(ASCII_TILESET, zone, 'roof_store').color).toBe('#235a96')
    }
    // the shared default roof, by contrast, DOES vary by zone (summer vs winter differ)
    expect(resolveTile(ASCII_TILESET, 'summer', 'roof').color).not.toBe(resolveTile(ASCII_TILESET, 'winter', 'roof').color)
  })

  test('a stamped STORE reads its own tiles — cream walls + a blue Store sign over a flat roof', () => {
    const grid = mkGrid()
    stampBuildingComposition(grid, 'store', 5, 12, 12, 'summer', 'south')
    const labels = new Set(grid.assets.map(a => a.label))
    // The store now has a FLAT roof (grey parapet + deck), so its blue moved to the roof-top SIGN — the
    // realistic-store redesign (storefront + awning + flat roof), not a blue gable.
    expect(labels.has('parapet')).toBe(true)
    const sign = grid.assets.find(a => (a.label ?? '').startsWith('roof_top'))!
    expect(sign.label).toBe('roof_top_store') // the store's OWN sign tile
    expect(sign.color).toBe(resolveTile(ASCII_TILESET, 'summer', 'roof_top_store').color)
    expect(sign.color).toBe('#235a96') // recovered store blue, now carried by the sign
    // The store's walls are the BRICK material tile (a distinct tile, its brick tone in settings.colors).
    const wall = grid.assets.find(a => (a.label ?? '').startsWith('wall') && a.type === 'store_5')!
    expect(wall.label!.startsWith('wall_brick')).toBe(true)
    expect(wall.color).toBe('#9e4b3b')
  })

  test('a stamped HOSPITAL paints its roof green and its walls plaster-white — its own tiles', () => {
    const grid = mkGrid()
    stampBuildingComposition(grid, 'hospital', 6, 12, 12, 'summer', 'south')
    expect(roofOf(grid, 'hospital_6').color).toBe('#2f7e50')
    const wall = grid.assets.find(a => (a.label ?? '').startsWith('wall') && a.type === 'hospital_6')!
    expect(wall.label).toBe('wall_plaster_c') // the plaster MATERIAL center piece
    expect(wall.color).toBe('#f0f0ea') // white clinic walls
  })

  test('houses VARY BY MATERIAL — house_3/4/5 stamp visibly different WALL tiles (brick/wood/stone)', () => {
    const wallOf = (grid: IsometricGrid, type: string) =>
      grid.assets.find(a => (a.label ?? '').startsWith('wall') && a.type === type)!
    const walls = [3, 4, 5].map(len => {
      const grid = mkGrid()
      stampBuildingComposition(grid, 'house', len, 12, 12, 'summer', 'south')
      return wallOf(grid, `house_${len}`).color
    })
    expect(new Set(walls).size).toBe(3) // three distinct wall MATERIALS — a street reads with variety
    expect(walls).toEqual(['#9e4b3b', '#8a5a2b', '#8f8b82']) // brick / wood / stone material tones
  })

  test('a temple uses STONE walls + a SLATE gable — its masonry materials', () => {
    const grid = mkGrid()
    stampBuildingComposition(grid, 'temple', 8, 12, 12, 'summer', 'south')
    const roof = roofOf(grid, 'temple_8')
    expect(roof.label).toBe('roof_slate') // stone/masonry buildings take the grey slate gable
    expect(roof.color).toBe('#4a4f57')
    const wall = grid.assets.find(a => (a.label ?? '').startsWith('wall') && a.type === 'temple_8')!
    expect(wall.label).toBe('wall_stone_c') // the stone MATERIAL center piece
    expect(wall.color).toBe('#8f8b82')
  })
})

describe('the apex NAME badge comes from composition DATA (title), not a hardcoded per-type lookup', () => {
  test('store/hospital compositions carry their human title; houses/others carry none', () => {
    expect(resolveComposition(ASCII_TILESET, 'store_5')!.title).toBe('Store')
    expect(resolveComposition(ASCII_TILESET, 'hospital_6')!.title).toBe('Hospital')
    // houses/others carry no title (served as null) → falsy, so the badge guard skips them
    expect(resolveComposition(ASCII_TILESET, 'house_4')!.title).toBeFalsy()
    expect(resolveComposition(ASCII_TILESET, 'temple_8')!.title).toBeFalsy()
  })

  test('a stamped STORE badges its ONE roof apex with the composition title', () => {
    const grid = mkGrid()
    stampBuildingComposition(grid, 'store', 5, 12, 12, 'summer', 'south')
    const badged = grid.assets.filter(a => a.settings?.badge != null)
    expect(badged).toHaveLength(1) // exactly the apex cell
    expect((badged[0].label ?? '').startsWith('roof_top')).toBe(true) // the roof apex carries it
    expect(badged[0].settings!.badge!.text).toBe('Store') // the badge renders the NAME from data
  })

  test('a stamped HOUSE shows NO badge (no title in its composition data)', () => {
    const grid = mkGrid()
    stampBuildingComposition(grid, 'house', 4, 12, 12, 'summer', 'south')
    expect(grid.assets.some(a => a.settings?.badge != null)).toBe(false)
  })
})

describe('a COLOUR override FILTERS just a building\'s roof + wall cells — colour is a per-tile setting', () => {
  // Mirrors composition.ts isRoofLabel/isWallLabel: a roof cell is the whole roof volume (gable `roof*` +
  // office `rooftop_unit`, plus the flat-roof `flat_roof` deck and its `parapet` lip); a wall cell is any
  // `wall_*` material piece. Windows / doors / awnings keep their own colour.
  const isRoof = (l = ''): boolean => l.startsWith('roof') || l === 'flat_roof' || l === 'parapet'
  const isWall = (l = ''): boolean => l.startsWith('wall_')

  test('roofColor + wallColor recolour ONLY roof + wall cells; a door keeps its OWN tile colour', () => {
    const grid = mkGrid()
    // house_4 authors wood walls + a red gable; override to a terracotta roof + sandstone walls.
    stampBuildingComposition(grid, 'house', 4, 12, 12, 'summer', 'south', 'wall_wood', '#b5533a', '#c9a66b')
    const roofs = grid.assets.filter(a => isRoof(a.label))
    const walls = grid.assets.filter(a => isWall(a.label))
    expect(roofs.length).toBeGreaterThan(0)
    expect(walls.length).toBeGreaterThan(0)
    expect(roofs.every(a => a.color === '#b5533a')).toBe(true) // every roof cell filters to the roof colour
    expect(walls.every(a => a.color === '#c9a66b')).toBe(true) // every wall cell filters to the wall colour
    // the door is NEITHER roof nor wall → the override never touches it; it keeps the tile's authored colour
    const door = grid.assets.find(a => a.label === 'door')!
    expect(door.color).toBe(resolveTile(ASCII_TILESET, 'summer', 'door').color)
    expect(door.color).not.toBe('#b5533a')
    expect(door.color).not.toBe('#c9a66b')
  })

  test('the wall override is INDEPENDENT of the material — a re-materialed wall still filters to wallColor', () => {
    const grid = mkGrid()
    // material rewrites house_4's wood walls to STONE tiles; the colour setting still recolours them.
    stampBuildingComposition(grid, 'house', 4, 12, 12, 'summer', 'south', 'wall_stone', '#5a636b', '#e8dcc0')
    const walls = grid.assets.filter(a => isWall(a.label))
    expect(walls.length).toBeGreaterThan(0)
    expect(walls.every(a => a.label!.startsWith('wall_stone'))).toBe(true) // the MATERIAL (tile) is stone
    expect(walls.every(a => a.color === '#e8dcc0')).toBe(true) // the COLOUR (setting) is cream — independent
  })

  test('an ABSENT override leaves every cell on its authored tile colour (backward compatible)', () => {
    const grid = mkGrid()
    stampBuildingComposition(grid, 'house', 4, 12, 12, 'summer', 'south', 'wall_wood') // no roof/wall colour
    const wall = grid.assets.find(a => isWall(a.label))!
    expect(wall.color).toBe(resolveTile(ASCII_TILESET, 'summer', wall.label!).color) // unchanged from the tile
  })

  test('STORE fixed identity — a BLUE roof over the WHOLE flat-roof deck + WHITE walls', () => {
    const grid = mkGrid()
    stampBuildingComposition(grid, 'store', 5, 12, 12, 'summer', 'south', undefined, '#235a96', '#f0f0ea')
    const roofs = grid.assets.filter(a => isRoof(a.label))
    // the deck (flat_roof), its parapet lip, AND the roof-top sign ALL read the store blue now (not grey deck)
    expect(roofs.map(a => a.label)).toEqual(expect.arrayContaining(['flat_roof', 'parapet', 'roof_top_store']))
    expect(roofs.every(a => a.color === '#235a96')).toBe(true)
    const walls = grid.assets.filter(a => isWall(a.label))
    expect(walls.length).toBeGreaterThan(0)
    expect(walls.every(a => a.color === '#f0f0ea')).toBe(true) // white walls, filtered from the brick tile
  })

  test('HOSPITAL fixed identity — a GREEN gable roof + WHITE walls', () => {
    const grid = mkGrid()
    stampBuildingComposition(grid, 'hospital', 6, 12, 12, 'summer', 'south', undefined, '#2f7e50', '#f0f0ea')
    const roofs = grid.assets.filter(a => isRoof(a.label))
    expect(roofs.length).toBeGreaterThan(0)
    expect(roofs.every(a => a.color === '#2f7e50')).toBe(true) // whole gable filters green
    const walls = grid.assets.filter(a => isWall(a.label))
    expect(walls.length).toBeGreaterThan(0)
    expect(walls.every(a => a.color === '#f0f0ea')).toBe(true)
  })
})
