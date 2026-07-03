/**
 * Wall MATERIALS — "not all houses are made of wood". A building's walls are a real material (wood /
 * brick / stone / plaster), each a tile + a colour range. Houses roll a material PER building (seeded,
 * so a street mixes them); every other type has a fixed identity material. buildingCellColor's wall
 * colour must come from that material, so colour and texture always agree.
 */
import fs from 'fs'
import path from 'path'
import { buildingWallMaterial, wallMaterialTile, wallMaterialImage, WALL_MATERIALS, buildingCellColor } from '@/engine/stageGenerator'
import type { BuildingType } from '@/engine/buildingComposer'

describe('buildingWallMaterial — identity per civic type, variety per house', () => {
  test('civic types map to a fixed identity material (deterministic, seed-independent)', () => {
    for (const seed of [0, 1, 2.5, 7, 42, 100]) {
      expect(buildingWallMaterial('store', seed)).toBe('brick')
      expect(buildingWallMaterial('hospital', seed)).toBe('plaster')
      expect(buildingWallMaterial('castle', seed)).toBe('stone')
      expect(buildingWallMaterial('temple', seed)).toBe('stone')
      expect(buildingWallMaterial('cathedral', seed)).toBe('stone')
      expect(buildingWallMaterial('big-house', seed)).toBe('brick')
    }
  })

  test('houses are deterministic per seed but VARY across a street (more than one material appears)', () => {
    const seeds = Array.from({ length: 40 }, (_, i) => i)
    const materials = new Set(seeds.map(s => buildingWallMaterial('house', s)))
    expect(materials.size).toBeGreaterThan(1) // a street is not monotone "all wood"
    // every rolled material is a real one, and the roll is stable (same seed → same material)
    for (const s of seeds) {
      expect(['wood', 'brick', 'stone', 'plaster']).toContain(buildingWallMaterial('house', s))
      expect(buildingWallMaterial('house', s)).toBe(buildingWallMaterial('house', s))
    }
  })
})

describe('wallMaterialTile — the emoji ridden on the wall faces (or "" for plaster)', () => {
  test('each material yields its tile; plaster is empty (colour reads flat, no texture)', () => {
    expect(wallMaterialTile('store', 3)).toBe('🧱') // brick
    expect(wallMaterialTile('castle', 3)).toBe('🪨') // stone
    expect(wallMaterialTile('hospital', 3)).toBe('') // plaster → no texture tile
    expect(WALL_MATERIALS.wood.emoji).toBe('🟫')
  })
})

describe('wallMaterialImage — Noto image for the tofu materials (wood/stone), none for brick/plaster', () => {
  test('wood + stone carry a Noto image (their 🪵/🪨 glyphs tofu on Segoe); brick + plaster do not', () => {
    expect(WALL_MATERIALS.wood.image).toMatch(/emoji_u1f7eb\.png$/)
    expect(WALL_MATERIALS.stone.image).toMatch(/emoji_u1faa8\.png$/)
    expect(WALL_MATERIALS.brick.image).toBeUndefined() // 🧱 renders fine on Segoe → stays a glyph
    expect(WALL_MATERIALS.plaster.image).toBeUndefined() // colour only, no texture
  })

  test('wallMaterialImage resolves a building to its material image (or undefined)', () => {
    expect(wallMaterialImage('castle', 3)).toMatch(/emoji_u1faa8\.png$/) // castle = stone → stone image
    expect(wallMaterialImage('store', 3)).toBeUndefined() // brick → glyph, no image
    expect(wallMaterialImage('hospital', 3)).toBeUndefined() // plaster → colour only
  })

  test('every wall-material image ref points to a bundled asset that exists on disk', () => {
    const pub = path.join(__dirname, '../../../public')
    for (const m of Object.values(WALL_MATERIALS)) {
      if (!m.image) continue
      expect(fs.existsSync(path.join(pub, m.image.replace(/^\//, '')))).toBe(true)
    }
  })
})

describe('buildingCellColor — a house wall colour comes from ITS material (colour ↔ texture agree)', () => {
  test('every house wall colour is drawn from its own material palette', () => {
    for (let seed = 0; seed < 30; seed++) {
      const mat = buildingWallMaterial('house', seed)
      const color = buildingCellColor('house', 'wall', seed)
      expect(WALL_MATERIALS[mat].walls).toContain(color) // never a foreign-material colour
    }
  })

  test('civic types keep their identity wall tone (unchanged)', () => {
    const t: BuildingType = 'hospital'
    // hospital is plaster → its identity wall stays the white palette tone (deterministic)
    expect(buildingCellColor(t, 'wall', 1)).toBe(buildingCellColor(t, 'wall', 999))
  })
})
