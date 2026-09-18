import { findTriggeredConnector, normalizeConnector } from '../../engine/connectors'

const base = { targetTemplateId: 't1', spawnCol: 5, spawnRow: 6 }

describe('normalizeConnector (legacy migration)', () => {
  test('legacy single-cell {col,row} becomes cells:[{col,row}]', () => {
    const c = normalizeConnector({ ...base, col: 3, row: 4, interaction: 'walk' })
    expect(c.cells).toEqual([{ col: 3, row: 4 }])
    expect(c.targetTemplateId).toBe('t1')
  })
  test('new multi-cell shape passes through unchanged', () => {
    const c = normalizeConnector({ ...base, cells: [{ col: 1, row: 1 }, { col: 2, row: 1 }], interaction: 'walk' })
    expect(c.cells).toHaveLength(2)
  })
})

describe('findTriggeredConnector (multi-cell membership)', () => {
  const conn = { ...base, cells: [{ col: 1, row: 1 }, { col: 2, row: 1 }], interaction: 'walk' as const }
  test('fires on enter for ANY member cell of a walk connector', () => {
    expect(findTriggeredConnector(1, 1, [conn], 'enter')).toBe(conn)
    expect(findTriggeredConnector(2, 1, [conn], 'enter')).toBe(conn)
  })
  test('does not fire on a non-member cell', () => {
    expect(findTriggeredConnector(9, 9, [conn], 'enter')).toBeUndefined()
  })
  test('walk connector does NOT fire on interact event', () => {
    expect(findTriggeredConnector(1, 1, [conn], 'interact')).toBeUndefined()
  })
  test('interact connector fires only on interact event', () => {
    const ic = { ...conn, interaction: 'interact' as const }
    expect(findTriggeredConnector(1, 1, [ic], 'interact')).toBe(ic)
    expect(findTriggeredConnector(1, 1, [ic], 'enter')).toBeUndefined()
  })
})
