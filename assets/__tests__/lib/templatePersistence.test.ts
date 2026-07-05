import { withTemplateDefaults, type CreateTemplateInput, type TemplateData } from '@/lib/api'
import type { Entity, Quest } from '@/game/types'

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

const baseInput = (over: Partial<CreateTemplateInput> = {}): CreateTemplateInput => ({
  name: 'Forest', cols: 40, rows: 40, cellSize: 16, isoScale: 1.4, spawnCol: 20, spawnRow: 20,
  groundData: [['grass']], heightData: [[0]], assetsData: [], ...over,
})

describe('template persistence — entities + quests round-trip', () => {
  it('preserves entities + quests through withTemplateDefaults', () => {
    const body = withTemplateDefaults(baseInput({ entities: [enemy, npc], quests: [quest] }))
    expect(body.entities).toEqual([enemy, npc])
    expect(body.quests).toEqual([quest])
    expect(body.connectors).toEqual([])
  })

  it('defaults entities/quests/connectors to [] when omitted', () => {
    const body = withTemplateDefaults(baseInput())
    expect(body.entities).toEqual([])
    expect(body.quests).toEqual([])
    expect(body.connectors).toEqual([])
  })

  it('survives a JSON round-trip (what a JSON column does on save/load)', () => {
    const body = withTemplateDefaults(baseInput({ entities: [enemy, npc], quests: [quest] }))
    const loaded = JSON.parse(JSON.stringify(body)) as unknown as TemplateData
    expect(loaded.entities).toHaveLength(2)
    expect(loaded.entities[0].movement?.waypoints).toHaveLength(2)
    expect(loaded.quests[0].objectives[0].required).toBe(3)
    expect(loaded.entities[1].questId).toBe('q1')
  })
})
