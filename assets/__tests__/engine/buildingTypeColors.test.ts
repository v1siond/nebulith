/**
 * PER-TYPE BUILDING COLOURS + APEX NAME BADGE — restored as DATA (Alexander's model). When buildings
 * became generic compositions every building shared one per-zone wall/roof colour and the STORE/HOSPITAL
 * signage was lost. The restore: each type's distinctive colour is its OWN tile (a store's `roof_store`
 * is blue, a hospital's `roof_hospital` green, houses vary a/b/c) carrying the colour in settings.colors,
 * and the building NAME is composition DATA (`title`) the stamp badges the roof apex with. These assert
 * the resolved COLOUR + LABEL + TITLE end-to-end through the DB tileset + stamp — never a hardcoded glyph.
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
    // Cream store walls come from the store's own wall tile.
    const wall = grid.assets.find(a => (a.label ?? '').startsWith('wall') && a.type === 'store_5')!
    expect(wall.label).toBe('wall_store')
    expect(wall.color).toBe('#e2dcc8')
  })

  test('a stamped HOSPITAL paints its roof green and its walls white — its own tiles', () => {
    const grid = mkGrid()
    stampBuildingComposition(grid, 'hospital', 6, 12, 12, 'summer', 'south')
    expect(roofOf(grid, 'hospital_6').color).toBe('#2f7e50')
    const wall = grid.assets.find(a => (a.label ?? '').startsWith('wall') && a.type === 'hospital_6')!
    expect(wall.label).toBe('wall_hospital')
    expect(wall.color).toBe('#f0f0ea') // recovered white clinic walls
  })

  test('houses VARY — house_3/4/5 stamp visibly different roof colours (per-type variety tiles)', () => {
    const colours = [3, 4, 5].map(len => {
      const grid = mkGrid()
      stampBuildingComposition(grid, 'house', len, 12, 12, 'summer', 'south')
      return roofOf(grid, `house_${len}`).color
    })
    expect(new Set(colours).size).toBe(3) // three distinct roof tones — a street reads with variety
    expect(colours).toEqual(['#6e2820', '#33383f', '#2f4233']) // the recovered HOUSE_ROOFS shades
  })

  test('other buildings are UNCHANGED — a temple still uses the shared default roof/wall tiles', () => {
    const grid = mkGrid()
    stampBuildingComposition(grid, 'temple', 8, 12, 12, 'summer', 'south')
    const roof = roofOf(grid, 'temple_8')
    expect(roof.label).toBe('roof') // still the shared tile → shared per-zone colour, no per-type override
    expect(roof.color).toBe(resolveTile(ASCII_TILESET, 'summer', 'roof').color)
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
