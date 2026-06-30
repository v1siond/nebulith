import {
  entitiesToAssets,
  entitiesFromAssets,
  questsToAssets,
  questsFromAssets,
  buildingsToAssets,
  buildingsFromAssets,
} from '@/lib/gridCodec'
import type { Entity, Quest } from '@/game/types'
import type { GridAsset, GridBuilding } from '@/engine/IsometricGrid'

// One marked record per type rides inside assetsData and must round-trip byte-for-byte
// through create/updateTemplate. These guard the shared makeAssetCodec factory.

const enemy: Entity = {
  id: 'e1', kind: 'enemy', col: 5, row: 5, enemyType: 'goblin',
  baseStats: { strength: 8, intelligence: 4, defense: 2, maxHp: 24 },
  movement: { mode: 'sequential', waypoints: [{ col: 5, row: 5 }, { col: 7, row: 5 }] },
}
const npc: Entity = {
  id: 'n1', kind: 'npc', col: 3, row: 3, name: 'Elder', questId: 'q1',
  baseStats: { strength: 1, intelligence: 1, defense: 1, maxHp: 10 },
}
const quest: Quest = {
  id: 'q1', giverId: 'n1', title: 'Cull the goblins', description: 'Slay 3 goblins',
  objectives: [{ kind: 'kill', target: 'goblin', required: 3, current: 0, done: false, label: 'Slay goblin' }],
  rewards: [{ kind: 'xp', amount: 50 }], state: 'available',
}
const building: GridBuilding = {
  col: 4, row: 9, length: 3, height: 2, depth: 2, type: 'store',
  cells: [['roof', 'roof', 'roof'], ['wall', 'door', 'wall']],
  facing: 1, facadeOnBack: true,
}

describe('asset codec round-trips (entity / quest / building)', () => {
  it('entities serialize → deserialize back to the input', () => {
    expect(entitiesFromAssets(entitiesToAssets([enemy, npc]))).toEqual([enemy, npc])
  })
  it('quests serialize → deserialize back to the input', () => {
    expect(questsFromAssets(questsToAssets([quest]))).toEqual([quest])
  })
  it('buildings serialize → deserialize back to the input', () => {
    expect(buildingsFromAssets(buildingsToAssets([building]))).toEqual([building])
  })

  it('survives a JSON round-trip (what the Prisma Json column does on save/load)', () => {
    const assets = [
      ...entitiesToAssets([enemy, npc]),
      ...questsToAssets([quest]),
      ...buildingsToAssets([building]),
    ]
    const reloaded = JSON.parse(JSON.stringify(assets)) as GridAsset[]
    expect(entitiesFromAssets(reloaded)).toEqual([enemy, npc])
    expect(questsFromAssets(reloaded)).toEqual([quest])
    expect(buildingsFromAssets(reloaded)).toEqual([building])
  })

  it('each codec only picks up its own marker, ignoring the others + real assets', () => {
    const mixed: GridAsset[] = [
      ...entitiesToAssets([enemy]),
      ...questsToAssets([quest]),
      ...buildingsToAssets([building]),
      { art: ['#'], col: 0, row: 0, type: 'building' }, // a real on-grid asset, NOT a marker
    ]
    expect(entitiesFromAssets(mixed)).toEqual([enemy])
    expect(questsFromAssets(mixed)).toEqual([quest])
    expect(buildingsFromAssets(mixed)).toEqual([building])
  })

  it('drops malformed marker payloads instead of throwing', () => {
    const broken: GridAsset[] = [
      { art: [' '], col: -1, row: -1, type: 'nebulith:quest', label: '{not json' },
      { art: [' '], col: -1, row: -1, type: 'nebulith:quest', label: JSON.stringify({ id: 'q', objectives: 'nope' }) },
      { art: [' '], col: -1, row: -1, type: 'nebulith:quest' }, // no label at all
    ]
    expect(questsFromAssets(broken)).toEqual([])
  })

  it('encodes entities ON-GRID and quests/buildings OFF-GRID (marker shape)', () => {
    const [eAsset] = entitiesToAssets([enemy])
    expect(eAsset).toMatchObject({ type: 'nebulith:entity', col: 5, row: 5, blocking: false })
    expect(eAsset.label).toBe(JSON.stringify(enemy))

    const [qAsset] = questsToAssets([quest])
    expect(qAsset).toMatchObject({ type: 'nebulith:quest', col: -1, row: -1, art: [' '], color: '#000000' })
    expect(qAsset.label).toBe(JSON.stringify(quest))

    const [bAsset] = buildingsToAssets([building])
    expect(bAsset).toMatchObject({ type: 'nebulith:building', col: -1, row: -1, art: [' '], color: '#000000' })
    expect(bAsset.label).toBe(JSON.stringify(building))
  })
})
