import { entityQuestMarker } from '../../engine/entityQuestMarker'

const giver = { id: 'n1', kind: 'npc', col: 0, row: 0, questId: 'q1', baseStats: {} as any }
const goblin = { id: 'e1', kind: 'enemy', col: 1, row: 1, enemyType: 'goblin', baseStats: {} as any }
const q = (state: string, target = 'goblin') => ({
  id: 'q1', giverId: 'n1', title: 'T', description: 'D',
  objectives: [{ kind: 'kill', target, count: 3, progress: 0 }], rewards: [], state,
}) as any

test('NPC giver with an existing quest → giver', () => {
  expect(entityQuestMarker(giver as any, [q('available')])).toBe('giver')
})
test('enemy matching an ACTIVE kill objective → target', () => {
  expect(entityQuestMarker(goblin as any, [q('active')])).toBe('target')
})
test('enemy linked but quest not active → null', () => {
  expect(entityQuestMarker(goblin as any, [q('available')])).toBeNull()
})
test('enemy not matching any objective → null', () => {
  expect(entityQuestMarker(goblin as any, [q('active', 'orc')])).toBeNull()
})
test('plain NPC without questId → null', () => {
  expect(entityQuestMarker({ ...giver, questId: undefined } as any, [q('available')])).toBeNull()
})
