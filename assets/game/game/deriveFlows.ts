/**
 * Derive GAMES from the template connector graph. A game = a set of CONNECTED templates (a flow), i.e. a
 * connected component of the graph whose nodes are templates and whose edges are connectors
 * (`connector.targetTemplateId`, treated as undirected). A connected cluster of ≥2 templates is one game;
 * a lone, unconnected template is not a flow. Pure — the page derives this from the loaded templates.
 */
export interface DerivableTemplate {
  id: string
  name: string
  connectors?: { targetTemplateId: string }[]
}

export interface DerivedFlow {
  /** Stable id for the flow = its member template ids, sorted + joined. */
  id: string
  /** Display name: the entry (level 1) template's name. */
  name: string
  /** Member template ids, ordered from the entry (BFS) so index 0 = level 1. */
  templateIds: string[]
  /** The play START — a source (no incoming connector) if one exists, else the smallest id. */
  entryId: string
}

export function deriveFlows(templates: readonly DerivableTemplate[]): DerivedFlow[] {
  const ids = new Set(templates.map((t) => t.id))
  const byId = new Map(templates.map((t) => [t.id, t]))
  const adj = new Map<string, Set<string>>()
  const indeg = new Map<string, number>()
  for (const t of templates) {
    adj.set(t.id, new Set())
    indeg.set(t.id, 0)
  }
  for (const t of templates) {
    for (const c of t.connectors ?? []) {
      const tgt = c.targetTemplateId
      if (!ids.has(tgt) || tgt === t.id) continue // skip dangling + self-loops
      adj.get(t.id)!.add(tgt)
      adj.get(tgt)!.add(t.id) // undirected
      indeg.set(tgt, (indeg.get(tgt) ?? 0) + 1)
    }
  }

  const seen = new Set<string>()
  const flows: DerivedFlow[] = []
  for (const t of templates) {
    if (seen.has(t.id)) continue
    // 1) gather the connected component (undirected BFS)
    const comp: string[] = []
    const q = [t.id]
    seen.add(t.id)
    while (q.length) {
      const id = q.shift()!
      comp.push(id)
      for (const n of [...adj.get(id)!].sort()) {
        if (!seen.has(n)) {
          seen.add(n)
          q.push(n)
        }
      }
    }
    if (comp.length < 2) continue // a lone template isn't a flow/game

    // 2) entry (level 1) = a source (in-degree 0) in the component, else the smallest id
    const sources = comp.filter((id) => (indeg.get(id) ?? 0) === 0).sort()
    const entry = sources[0] ?? comp.slice().sort()[0]

    // 3) order members from the entry so index 0 = level 1
    const inComp = new Set(comp)
    const ordered: string[] = []
    const ovisit = new Set([entry])
    const oq = [entry]
    while (oq.length) {
      const id = oq.shift()!
      ordered.push(id)
      for (const n of [...adj.get(id)!].sort()) {
        if (inComp.has(n) && !ovisit.has(n)) {
          ovisit.add(n)
          oq.push(n)
        }
      }
    }

    flows.push({
      id: comp.slice().sort().join('|'),
      name: byId.get(entry)?.name ?? '(flow)',
      templateIds: ordered,
      entryId: entry,
    })
  }
  return flows
}
