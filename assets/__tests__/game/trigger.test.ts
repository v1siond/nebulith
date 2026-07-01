import {
  fireTriggers,
  makeTrigger,
  describeTrigger,
  DEFAULT_ACTION_PARAMS,
  type Trigger,
  type TriggerEffect,
} from '@/game/runtime/trigger'
import {
  cellTriggersToAssets,
  cellTriggersFromAssets,
  isTriggerAsset,
  triggersAtCell,
  type CellTriggerGroup,
} from '@/lib/gridCodec'
import type { GridAsset } from '@/engine/IsometricGrid'

/** A win trigger on `enter` (the golden-path smoke). */
const winOnEnter: Trigger = { id: 't-win', event: 'enter', action: 'win', params: {} }
/** A spawn trigger on `enter`, no explicit at-cell (uses ctx). */
const spawnOnEnter: Trigger = {
  id: 't-spawn', event: 'enter', action: 'spawn', params: { enemyType: 'wolf', count: 3 },
}
/** A message trigger on `interact`. */
const msgOnInteract: Trigger = {
  id: 't-msg', event: 'interact', action: 'message', params: { text: 'hello' },
}
/** A goto (connector) trigger on `interact`. */
const gotoOnInteract: Trigger = {
  id: 't-goto', event: 'interact', action: 'goto', params: { templateId: 'lvl-2', spawnCol: 4, spawnRow: 9 },
}
/** A defeat trigger that wins (boss kill = win). */
const winOnDefeat: Trigger = { id: 't-boss', event: 'defeat', action: 'win', params: {} }

describe('fireTriggers — event matching', () => {
  it('fires an enter trigger only on the enter event', () => {
    expect(fireTriggers('enter', [winOnEnter])).toEqual([{ kind: 'win' }])
    expect(fireTriggers('interact', [winOnEnter])).toEqual([])
    expect(fireTriggers('defeat', [winOnEnter])).toEqual([])
  })

  it('fires an interact trigger only on interact', () => {
    expect(fireTriggers('interact', [msgOnInteract])).toEqual([{ kind: 'message', text: 'hello' }])
    expect(fireTriggers('enter', [msgOnInteract])).toEqual([])
  })

  it('fires a defeat trigger only on defeat', () => {
    expect(fireTriggers('defeat', [winOnDefeat])).toEqual([{ kind: 'win' }])
    expect(fireTriggers('enter', [winOnDefeat])).toEqual([])
  })

  it('returns [] for an empty trigger list', () => {
    expect(fireTriggers('enter', [])).toEqual([])
  })

  it('returns every matching trigger in authoring order', () => {
    const effects = fireTriggers('interact', [gotoOnInteract, msgOnInteract])
    expect(effects).toEqual([
      { kind: 'goto', templateId: 'lvl-2', spawnCol: 4, spawnRow: 9 },
      { kind: 'message', text: 'hello' },
    ])
  })
})

describe('fireTriggers — effect resolution', () => {
  it('resolves goto carrying templateId + spawn', () => {
    expect(fireTriggers('interact', [gotoOnInteract])).toEqual([
      { kind: 'goto', templateId: 'lvl-2', spawnCol: 4, spawnRow: 9 },
    ])
  })

  it('resolves spawn to the context cell when no explicit at is set', () => {
    const effects = fireTriggers('enter', [spawnOnEnter], { at: { col: 12, row: 8 } })
    expect(effects).toEqual([{ kind: 'spawn', enemyType: 'wolf', count: 3, col: 12, row: 8 }])
  })

  it('resolves spawn to its explicit at-cell over the context', () => {
    const explicit: Trigger = {
      id: 's2', event: 'enter', action: 'spawn',
      params: { enemyType: 'bandit', count: 1, atCol: 2, atRow: 3 },
    }
    const effects = fireTriggers('enter', [explicit], { at: { col: 99, row: 99 } })
    expect(effects).toEqual([{ kind: 'spawn', enemyType: 'bandit', count: 1, col: 2, row: 3 }])
  })

  it('clamps spawn count to at least 1', () => {
    const zero: Trigger = { id: 'z', event: 'enter', action: 'spawn', params: { enemyType: 'goblin', count: 0 } }
    const [effect] = fireTriggers('enter', [zero], { at: { col: 0, row: 0 } })
    expect((effect as Extract<TriggerEffect, { kind: 'spawn' }>).count).toBe(1)
  })

  it('resolves give / message / win / lose', () => {
    const give: Trigger = { id: 'g', event: 'enter', action: 'give', params: { itemId: 'sword' } }
    const lose: Trigger = { id: 'l', event: 'enter', action: 'lose', params: {} }
    expect(fireTriggers('enter', [give])).toEqual([{ kind: 'give', itemId: 'sword' }])
    expect(fireTriggers('enter', [lose])).toEqual([{ kind: 'lose' }])
  })

  it('skips a malformed action type instead of throwing (defensive)', () => {
    const rogue = { id: 'x', event: 'enter', action: 'self_destruct', params: {} } as unknown as Trigger
    expect(fireTriggers('enter', [rogue])).toEqual([])
  })
})

describe('trigger authoring helpers', () => {
  it('mints a trigger with default params per action', () => {
    const t = makeTrigger('enter', 'spawn')
    expect(t.event).toBe('enter')
    expect(t.action).toBe('spawn')
    expect(t.params).toEqual({ enemyType: 'goblin', count: 2 })
    expect(t.id).toMatch(/^trg_/)
  })

  it('has fresh default params for every action', () => {
    expect(DEFAULT_ACTION_PARAMS.goto()).toEqual({ templateId: '', spawnCol: 0, spawnRow: 0 })
    expect(DEFAULT_ACTION_PARAMS.message()).toEqual({ text: '' })
    expect(DEFAULT_ACTION_PARAMS.win()).toEqual({})
  })

  it('describes a trigger as one readable sentence', () => {
    expect(describeTrigger(winOnEnter)).toBe('when enter → win')
    expect(describeTrigger(spawnOnEnter)).toBe('when enter → spawn 3 wolf')
    expect(describeTrigger(msgOnInteract)).toBe('when interact → show "hello"')
  })
})

describe('cell-trigger persistence codec (round-trip)', () => {
  const groups: CellTriggerGroup[] = [
    { col: 5, row: 7, triggers: [winOnEnter, msgOnInteract] },
    { col: 10, row: 2, triggers: [spawnOnEnter] },
  ]

  it('round-trips cell-trigger groups through the asset marker channel', () => {
    const assets = cellTriggersToAssets(groups)
    expect(assets.every(isTriggerAsset)).toBe(true)
    const back = cellTriggersFromAssets(assets as GridAsset[])
    expect(back).toEqual(groups)
  })

  it('preserves every trigger field byte-for-byte', () => {
    const assets = cellTriggersToAssets(groups)
    const back = cellTriggersFromAssets(assets as GridAsset[])
    expect(back[0].triggers[0]).toEqual(winOnEnter)
    expect(back[1].triggers[0].params).toEqual({ enemyType: 'wolf', count: 3 })
  })

  it('markers are placed off-grid so the tile/asset renderers never draw them', () => {
    const assets = cellTriggersToAssets(groups)
    expect(assets.every(a => a.col === -1 && a.row === -1)).toBe(true)
  })

  it('drops a malformed marker instead of throwing', () => {
    const bad: GridAsset = { art: [' '], col: -1, row: -1, type: 'nebulith:trigger', label: '{not json' } as unknown as GridAsset
    expect(cellTriggersFromAssets([bad])).toEqual([])
  })

  it('finds the triggers at a given cell (empty when none)', () => {
    expect(triggersAtCell(groups, 5, 7)).toEqual([winOnEnter, msgOnInteract])
    expect(triggersAtCell(groups, 0, 0)).toEqual([])
  })
})
