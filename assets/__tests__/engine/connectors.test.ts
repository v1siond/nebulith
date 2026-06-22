import { findTriggeredConnector } from '@/engine/connectors'
import type { Connector } from '@/lib/api'

/** Build a Connector with sensible defaults; override what the test cares about. */
function makeConnector(over: Partial<Connector> = {}): Connector {
  return {
    col: 5,
    row: 5,
    targetTemplateId: 'target-1',
    targetTemplateName: 'Target',
    interaction: 'walk',
    spawnCol: 10,
    spawnRow: 12,
    ...over,
  }
}

describe('findTriggeredConnector', () => {
  it("fires a 'walk' connector when the player enters its cell", () => {
    const c = makeConnector({ col: 3, row: 4, interaction: 'walk' })
    expect(findTriggeredConnector(3, 4, [c], 'enter')).toBe(c)
  })

  it("fires an 'auto' connector on enter", () => {
    const c = makeConnector({ col: 3, row: 4, interaction: 'auto' })
    expect(findTriggeredConnector(3, 4, [c], 'enter')).toBe(c)
  })

  it("does NOT fire a 'walk' connector on an interact event", () => {
    const c = makeConnector({ col: 3, row: 4, interaction: 'walk' })
    expect(findTriggeredConnector(3, 4, [c], 'interact')).toBeNull()
  })

  it("fires an 'interact' connector only when the player presses interact on its cell", () => {
    const c = makeConnector({ col: 3, row: 4, interaction: 'interact' })
    expect(findTriggeredConnector(3, 4, [c], 'interact')).toBe(c)
  })

  it("does NOT fire an 'interact' connector merely by entering its cell", () => {
    const c = makeConnector({ col: 3, row: 4, interaction: 'interact' })
    expect(findTriggeredConnector(3, 4, [c], 'enter')).toBeNull()
  })

  it('returns null when no connector sits on the player cell', () => {
    const c = makeConnector({ col: 3, row: 4 })
    expect(findTriggeredConnector(0, 0, [c], 'enter')).toBeNull()
  })

  it('returns null for an empty connector list', () => {
    expect(findTriggeredConnector(3, 4, [], 'enter')).toBeNull()
  })

  it('picks the connector matching the player cell out of several', () => {
    const a = makeConnector({ col: 1, row: 1 })
    const b = makeConnector({ col: 8, row: 9, interaction: 'walk' })
    const cc = makeConnector({ col: 2, row: 2 })
    expect(findTriggeredConnector(8, 9, [a, b, cc], 'enter')).toBe(b)
  })
})
