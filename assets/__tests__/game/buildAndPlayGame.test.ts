import { generateStage, stageToTemplate, type StageTemplatePayload } from '@/engine/stageGenerator'
import { deserializeToGrid, type TemplateData, type Connector } from '@/lib/api'
import type { IsometricGrid } from '@/engine/IsometricGrid'
import { makeEnemy, makeNpc } from '@/game/entities'
import { acceptQuest, recordEvent, isComplete, turnIn } from '@/game/quests'
import { resolveAttack } from '@/game/combat'
import { stepMover, initMover } from '@/engine/movement'
import type { Entity, Quest, MovementPattern, Stats, Weapon, Attack } from '@/game/types'

// ───────────────────────────────────────────────────────────────────────────
// FULL END-TO-END: actually BUILD a game with the system and PLAY it.
//
// Not "click the generator" — this drives the real pipeline a designer + player go
// through: create/generate each room → serialize it to a template (stageToTemplate)
// → "save" it into a world by id → wire connectors between templates → deserialize
// each template back into a live IsometricGrid → place entities with movement
// patterns → accept a quest → patrol enemies (stepMover) → fight them (resolveAttack)
// → traverse the connectors room-to-room → finish the quest → and prove the whole
// level graph is connected.
// ───────────────────────────────────────────────────────────────────────────

// deserializeToGrid wants a full TemplateData; the generator payload has everything
// it reads — wrap it with the persisted-record fields a real "save" would add.
const asTemplate = (p: StageTemplatePayload, id: string): TemplateData => ({
  id,
  name: p.name,
  description: null,
  category: 'stage',
  cols: p.cols,
  rows: p.rows,
  cellSize: p.cellSize,
  isoScale: p.isoScale,
  spawnCol: p.spawnCol,
  spawnRow: p.spawnRow,
  groundData: p.groundData,
  heightData: p.heightData,
  assetsData: p.assetsData as TemplateData['assetsData'],
  connectors: [...p.connectors],
  thumbnail: null,
  isPublic: false,
  tags: [],
  createdAt: '',
  updatedAt: '',
})

const ORTHO: ReadonlyArray<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]]

/** 4-neighbour flood of the walkable cells reachable from a start cell. */
function reachable(grid: IsometricGrid, start: { col: number; row: number }): Set<string> {
  const seen = new Set<string>([`${start.col},${start.row}`])
  const stack = [start]
  while (stack.length) {
    const { col, row } = stack.pop()!
    for (const [dc, dr] of ORTHO) {
      const c = col + dc
      const r = row + dr
      const key = `${c},${r}`
      if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) continue
      if (grid.isBlocked(c, r) || seen.has(key)) continue
      seen.add(key)
      stack.push({ col: c, row: r })
    }
  }
  return seen
}

/** `count` walkable cells reachable from spawn (spread out, excluding spawn). */
function pickReachable(
  grid: IsometricGrid,
  spawn: { col: number; row: number },
  count: number,
): Array<{ col: number; row: number }> {
  const cells = [...reachable(grid, spawn)].filter(k => k !== `${spawn.col},${spawn.row}`)
  const step = Math.max(1, Math.floor(cells.length / (count + 1)))
  const picks: Array<{ col: number; row: number }> = []
  for (let i = 0; i < count && i * step < cells.length; i++) {
    const [c, r] = cells[i * step].split(',').map(Number)
    picks.push({ col: c, row: r })
  }
  return picks
}

// A strong player + a sword, an under-leveled goblin (no dodge → deterministic combat).
const PLAYER: Stats = { strength: 16, intelligence: 8, defense: 6, maxHp: 120, dodge: 0 }
const SWORD: Weapon = { id: 'w', kind: 'sword', name: 'Sword', baseDamage: 18, baseMagic: 0, baseDefense: 0, strengthBonus: 4, intBonus: 0, school: 'physical', range: 'melee' }
const REGULAR: Attack = { school: 'physical', range: 'melee', tier: 'regular' }
const GOBLIN_STATS: Partial<Stats> = { maxHp: 24, defense: 0, dodge: 0, strength: 4, intelligence: 4 }

describe('Nebulith — build a multi-room game with the system, then play it end-to-end', () => {
  const ORDER = ['room-forest', 'room-temple', 'room-cave', 'room-boss'] as const
  const SPECS = [
    { id: 'room-forest', zone: 'spring', variant: 'forest' },
    { id: 'room-temple', zone: 'autumn', variant: 'temple' },
    { id: 'room-cave', zone: 'lava', variant: 'cave' },
    { id: 'room-boss', zone: 'lava', variant: 'boss-stage' },
  ] as const

  // ── 1) CREATE + GENERATE + "SAVE" each room as a real template ──────────────
  const world = new Map<string, TemplateData>()
  for (const s of SPECS) {
    const stage = generateStage({ zone: s.zone, variant: s.variant, cols: 40, rows: 40 })
    world.set(s.id, asTemplate(stageToTemplate(stage, s.id), s.id))
  }

  // ── 2) WIRE CONNECTORS: a chain forest → temple → cave → boss. Each connector
  //       sits on a cell REACHABLE from its room's spawn and lands the player on
  //       the next room's (walkable) spawn. ─────────────────────────────────────
  for (let i = 0; i < ORDER.length - 1; i++) {
    const src = world.get(ORDER[i])!
    const dst = world.get(ORDER[i + 1])!
    const grid = deserializeToGrid(src)
    const [gate] = pickReachable(grid, { col: src.spawnCol, row: src.spawnRow }, 1)
    src.connectors.push({
      cells: [{ col: gate.col, row: gate.row }],
      targetTemplateId: dst.id,
      targetTemplateName: dst.name,
      interaction: 'walk',
      spawnCol: dst.spawnCol,
      spawnRow: dst.spawnRow,
    })
  }

  // ── 3) POPULATE: enemies (with patrol patterns) per room + a quest-giver NPC ──
  const entitiesByRoom = new Map<string, Entity[]>()
  for (const id of ORDER) {
    const t = world.get(id)!
    const grid = deserializeToGrid(t)
    const cells = pickReachable(grid, { col: t.spawnCol, row: t.spawnRow }, 4)
    const enemies: Entity[] = cells.slice(0, 3).map((c, i) => {
      const e = makeEnemy(`${id}-gob-${i}`, c.col, c.row, 'goblin', { stats: GOBLIN_STATS, respawnMs: 8000 })
      // a 2-waypoint sequential patrol between this cell and a neighbour-ish cell
      const back = cells[(i + 1) % cells.length]
      const movement: MovementPattern = { mode: 'sequential', waypoints: [{ col: c.col, row: c.row }, { col: back.col, row: back.row }] }
      return { ...e, movement, hittable: true }
    })
    const giver = id === 'room-forest' ? [makeNpc(`${id}-elder`, cells[3].col, cells[3].row, { name: 'Elder', questId: 'q-cull' })] : []
    entitiesByRoom.set(id, [...giver, ...enemies])
  }

  // ── 4) AUTHOR the kill quest on the forest NPC ──────────────────────────────
  const baseQuest: Quest = {
    id: 'q-cull',
    giverId: 'room-forest-elder',
    title: 'Cull the goblins',
    description: 'Slay 3 goblins across the dungeon.',
    objectives: [{ kind: 'kill', target: 'goblin', required: 3, current: 0, done: false, label: 'Slay goblin' }],
    rewards: [{ kind: 'xp', amount: 50 }],
    state: 'available',
  }

  // ── assertions: the system actually produced a playable, connected game ──────

  it('serializes + deserializes every room into a playable grid (walkable spawn)', () => {
    for (const id of ORDER) {
      const grid = deserializeToGrid(world.get(id)!)
      expect(grid.isBlocked(world.get(id)!.spawnCol, world.get(id)!.spawnRow)).toBe(false)
      const walkable = reachable(grid, { col: world.get(id)!.spawnCol, row: world.get(id)!.spawnRow })
      expect(walkable.size).toBeGreaterThan(20) // a real, roomy playable area
    }
  })

  it('links the rooms: every connector targets a real room and lands on walkable ground REACHABLE from spawn', () => {
    for (const id of ORDER) {
      const t = world.get(id)!
      const grid = deserializeToGrid(t)
      const fromSpawn = reachable(grid, { col: t.spawnCol, row: t.spawnRow })
      for (const c of t.connectors) {
        // every gate cell the player walks into is reachable from where they spawn
        for (const cell of c.cells) {
          expect(grid.isBlocked(cell.col, cell.row)).toBe(false)
          expect(fromSpawn.has(`${cell.col},${cell.row}`)).toBe(true)
        }
        // the target exists, and the player lands on walkable ground there
        const target = world.get(c.targetTemplateId)
        expect(target).toBeDefined()
        const targetGrid = deserializeToGrid(target!)
        expect(targetGrid.isBlocked(c.spawnCol, c.spawnRow)).toBe(false)
      }
    }
  })

  it('the whole level graph is connected — all rooms reachable from the start via connectors', () => {
    const adj = new Map<string, string[]>()
    for (const id of ORDER) adj.set(id, world.get(id)!.connectors.map(c => c.targetTemplateId))
    const seen = new Set<string>(['room-forest'])
    const stack = ['room-forest']
    while (stack.length) {
      for (const next of adj.get(stack.pop()!) ?? []) {
        if (!seen.has(next)) { seen.add(next); stack.push(next) }
      }
    }
    expect([...seen].sort()).toEqual([...ORDER].sort())
  })

  it('enemies patrol — stepMover walks them along their waypoints (and never into a wall)', () => {
    const grid = deserializeToGrid(world.get('room-forest')!)
    const isBlocked = (c: number, r: number) => grid.isBlocked(c, r)
    const enemy = entitiesByRoom.get('room-forest')!.find(e => e.kind === 'enemy')!
    let pos = { col: enemy.col, row: enemy.row }
    let state = initMover()
    const visited = new Set<string>([`${pos.col},${pos.row}`])
    for (let i = 0; i < 8; i++) {
      const out = stepMover(pos, enemy.movement!, state, isBlocked)
      pos = out.pos
      state = out.state
      expect(isBlocked(pos.col, pos.row)).toBe(false) // never steps into a wall
      visited.add(`${pos.col},${pos.row}`)
    }
    expect(visited.size).toBeGreaterThan(1) // it actually moved
  })

  it('the player fights through with real combat and the kill-quest completes + turns in', () => {
    let quest = acceptQuest(baseQuest)
    expect(quest.state).toBe('active')

    // hunt 3 goblins (across rooms) with the actual combat resolver
    const goblins = ORDER.flatMap(id => entitiesByRoom.get(id)!.filter(e => e.enemyType === 'goblin')).slice(0, 3)
    expect(goblins).toHaveLength(3)

    for (const goblin of goblins) {
      let hp = goblin.baseStats.maxHp
      let hits = 0
      while (hp > 0 && hits < 50) {
        const r = resolveAttack({
          attacker: PLAYER,
          defender: goblin.baseStats,
          attack: REGULAR,
          attackerWeapon: SWORD,
          defenderHp: hp,
          roll: () => 0.99, // no dodge — deterministic
        })
        expect(r.damage).toBeGreaterThan(0)
        hp = r.defenderHpAfter
        hits++
      }
      expect(hp).toBeLessThanOrEqual(0) // it actually died
      quest = recordEvent(quest, { kind: 'kill', enemyType: 'goblin' })
    }

    expect(quest.objectives[0].current).toBe(3)
    expect(isComplete(quest)).toBe(true)
    const turned = turnIn(quest)
    expect(turned).not.toBeNull()
    expect(turned!.quest.state).toBe('turned_in')
    expect(turned!.rewards).toEqual([{ kind: 'xp', amount: 50 }])
  })

  it('a full play-through traverses every room in order through the connectors', () => {
    const visited: string[] = ['room-forest']
    let currentId: string = 'room-forest'
    let grid = deserializeToGrid(world.get(currentId)!)

    for (let hop = 0; hop < ORDER.length; hop++) {
      // the chain connector out of this room (teleport-style: no typed action)
      const conn: Connector | undefined = world.get(currentId)!.connectors.find(c => !c.action)
      if (!conn) break
      // the player can WALK to the gate from where they currently stand
      expect(reachable(grid, { col: world.get(currentId)!.spawnCol, row: world.get(currentId)!.spawnRow }).has(`${conn.cells[0].col},${conn.cells[0].row}`)).toBe(true)
      // traverse → load the target room, respawn on walkable ground
      currentId = conn.targetTemplateId
      grid = deserializeToGrid(world.get(currentId)!)
      expect(grid.isBlocked(conn.spawnCol, conn.spawnRow)).toBe(false)
      visited.push(currentId)
    }

    expect(visited).toEqual([...ORDER]) // forest → temple → cave → boss
  })
})
