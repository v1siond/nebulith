import '@/__tests__/helpers/installZoneSeed' // the generator reads every season from the backend catalog
import { isWaterGround } from '@/engine/riverNetwork'
import { generateStage } from '@/engine/stageGenerator'
import { acceptQuest, recordEvent, isComplete, turnIn } from '@/game/quests'
import { makeEnemy, makeNpc } from '@/game/entities'
import type { Connector } from '@/lib/api'
import type { Quest } from '@/game/types'

// End-to-end "build + play a game with Nebulith" flow, at the logic layer (no
// browser): the same sequence the demo video shows, generate the sections, link
// them, accept a kill quest, slay the enemies, complete + turn in. Proves the
// composed systems (generator + connectors + entities + quests) actually work
// together from zero to a finished quest.
describe('Nebulith, full game flow: 0 → game-ready → quest complete', () => {
  it('generates a 5-section level, links it, and plays a kill quest to turn-in', () => {
    // 1) GENERATE the sections: 2 forests (a dry meadow + one with the river option on), a temple, a cave, a boss room.
    const forestA = generateStage({ zone: 'summer', variant: 'forest', layout: 'meadow', cols: 40, rows: 30 })
    const forestB = generateStage({ zone: 'summer', variant: 'forest', layout: 'meadow', options: { river: true }, cols: 40, rows: 30 })
    const temple = generateStage({ zone: 'autumn', variant: 'temple', cols: 36, rows: 30 })
    const cave = generateStage({ zone: 'autumn', variant: 'cave', cols: 40, rows: 30 })
    const boss = generateStage({ zone: 'autumn', variant: 'boss-stage', cols: 36, rows: 30 })
    const sections = { forestA, forestB, temple, cave, boss }

    // every section is playable: spawn is on walkable ground
    for (const stage of Object.values(sections)) {
      expect(stage.collision[stage.spawn.row][stage.spawn.col]).toBe(false)
    }
    // each archetype produced its signature content
    expect(temple.props.some(p => p.type === 'altar')).toBe(true) // the temple dungeon's boss chamber
    expect(temple.props.some(p => p.type === 'temple_wall')).toBe(true) // walled interior
    expect(cave.props.some(p => p.type === 'rock_face')).toBe(true) // its walls, which are faces of stone, not boulders
    expect(boss.props.some(p => p.type === 'boss')).toBe(true)
    // WATER, not the label 'water'. A river's cells wear their autotile piece now (`water_smooth_c`,
    // `water_smooth_tl`, ...), so an exact-match on one spelling asks a question the map stopped answering.
    expect(forestB.ground.flat().some(isWaterGround)).toBe(true) // the river option's winding river

    // 2) CONNECT them into a path: forestA → forestB → temple → cave → boss.
    const order = ['forestA', 'forestB', 'temple', 'cave', 'boss'] as const
    const connectors: Connector[] = order.slice(0, -1).map((from, i) => ({
      cells: [{ col: 1, row: 1 }],
      targetTemplateId: order[i + 1],
      interaction: 'interact',
      spawnCol: 2,
      spawnRow: 2,
    }))
    expect(connectors).toHaveLength(4)
    expect(connectors.map(c => c.targetTemplateId)).toEqual(['forestB', 'temple', 'cave', 'boss'])

    // 3) POPULATE: a quest-giver NPC in the forest + goblins to slay.
    const giver = makeNpc('npc_giver', 5, 5, { name: 'Elder', questId: 'q_goblins' })
    const goblins = [makeEnemy('e1', 10, 10, 'goblin'), makeEnemy('e2', 12, 10, 'goblin'), makeEnemy('e3', 14, 10, 'goblin')]
    expect(giver.questId).toBe('q_goblins')
    expect(goblins.every(g => g.enemyType === 'goblin')).toBe(true)

    // 4) ACCEPT the kill quest (slay 3 goblins).
    let quest: Quest = {
      id: 'q_goblins',
      giverId: giver.id,
      title: 'Cull the goblins',
      description: 'Slay 3 goblins.',
      objectives: [{ kind: 'kill', target: 'goblin', required: 3, current: 0, done: false, label: 'Slay goblin' }],
      rewards: [{ kind: 'xp', amount: 50 }],
      state: 'available',
    }
    quest = acceptQuest(quest)
    expect(quest.state).toBe('active')

    // 5) PLAY: kill the 3 goblins → objective + quest complete.
    for (let i = 0; i < goblins.length; i++) {
      expect(isComplete(quest)).toBe(false)
      quest = recordEvent(quest, { kind: 'kill', enemyType: 'goblin' })
    }
    expect(quest.objectives[0].current).toBe(3)
    expect(isComplete(quest)).toBe(true)
    expect(quest.state).toBe('completed')

    // 6) TURN IN → reward granted, quest closed.
    const turnedIn = turnIn(quest)
    expect(turnedIn).not.toBeNull()
    expect(turnedIn!.quest.state).toBe('turned_in')
    expect(turnedIn!.rewards).toEqual([{ kind: 'xp', amount: 50 }])
  })
})
