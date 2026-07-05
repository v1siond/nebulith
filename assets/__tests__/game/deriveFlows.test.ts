import { deriveFlows } from '@/game/deriveFlows'

const conn = (targetTemplateId: string) => ({ targetTemplateId })

describe('deriveFlows — a game is a connected component of the template connector graph', () => {
  it('groups connected templates into ONE flow; a lone template is not a flow', () => {
    const flows = deriveFlows([
      { id: 'a', name: 'Village', connectors: [conn('b')] },
      { id: 'b', name: 'Cave', connectors: [conn('c')] },
      { id: 'c', name: 'Boss' },
      { id: 'lone', name: 'Solo' },
    ])
    expect(flows).toHaveLength(1)
    expect([...flows[0].templateIds].sort()).toEqual(['a', 'b', 'c'])
    expect(flows[0].entryId).toBe('a') // 'a' has no incoming connector → the source/entry
    expect(flows[0].templateIds[0]).toBe('a') // level 1 = entry
    expect(flows[0].name).toBe('Village')
  })

  it('treats connectors as undirected + collapses a bidirectional pair into one component', () => {
    const flows = deriveFlows([
      { id: 'x', name: 'X', connectors: [conn('y')] },
      { id: 'y', name: 'Y', connectors: [conn('x')] },
    ])
    expect(flows).toHaveLength(1)
    expect([...flows[0].templateIds].sort()).toEqual(['x', 'y'])
  })

  it('ignores connectors pointing at missing templates + self-loops (no valid edge → not a flow)', () => {
    expect(deriveFlows([{ id: 'a', name: 'A', connectors: [conn('gone'), conn('a')] }])).toHaveLength(0)
  })

  it('returns a separate flow per disconnected cluster', () => {
    const flows = deriveFlows([
      { id: 'a', name: 'A', connectors: [conn('b')] },
      { id: 'b', name: 'B' },
      { id: 'c', name: 'C', connectors: [conn('d')] },
      { id: 'd', name: 'D' },
    ])
    expect(flows).toHaveLength(2)
    expect(flows.every((f) => f.templateIds.length === 2)).toBe(true)
  })

  it('handles an empty template list', () => {
    expect(deriveFlows([])).toEqual([])
  })
})
