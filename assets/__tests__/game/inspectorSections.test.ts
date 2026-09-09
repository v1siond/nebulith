/**
 * THE INSPECTOR'S SECTION MODEL (§4.7, Week 5) — now a set of MOVABLE PANELS.
 *
 * §3.10's complaint was that the inspector is one flat wall of controls. §4.7 answered with six sections
 * named after the questions people ask, three of them open by default, remembered per section in the
 * backend's `/api/editor_settings` store.
 *
 * Two of those facts changed, and this suite is re-pointed at the new contract rather than deleted, because
 * each change was a decision. Alexander, 2026-09-09: *"the right sidebar is still too full of stuff, we
 * should have movable modals for each section/group of actions."*
 *
 *  · **Nothing opens by default.** A section is a movable panel now, so "open" means a panel appears over
 *    the map. Three of them doing that on every cell click is worse than the accordion ever was. Each row
 *    keeps a summary badge, so a closed section still answers its own question.
 *  · **The settings key is a new namespace.** The old `inspector.section.*` values recorded which
 *    ACCORDIONS were expanded; reusing them would turn a row someone once expanded into a panel opening
 *    unbidden. New meaning, new key.
 *
 * The three-state read is unchanged and still the subtle part: a section never touched takes the default,
 * one explicitly closed stays closed, one explicitly opened stays open.
 */
import {
  INSPECTOR_SECTIONS,
  sectionIsOpen,
  sectionSettingKey,
  sectionTitle,
  type InspectorSectionId,
} from '@/game/editor/inspectorSections'

describe('the sections §4.7 draws', () => {
  it('carries all six, in the design\'s order', () => {
    expect(INSPECTOR_SECTIONS.map(s => s.id)).toEqual([
      'identity', 'looks', 'size', 'behaviour', 'animation', 'rules',
    ])
  })

  it('opens NONE of them by default — each one is a panel over the map now', () => {
    const open = INSPECTOR_SECTIONS.filter(s => s.defaultOpen).map(s => s.id)
    expect(open).toEqual([])
  })

  it('titles every section SHORT, naming the feature — not as a question', () => {
    // Alexander, 2026-09-09: *"labels aren't clearly descriptive, they're either too descriptive to the
    // point where they dn't make sense … we need clear concise labeling that clearly points at the
    // action/feature."* A label is scanned, not read. Three rules, each one a way these went wrong:
    for (const { title } of INSPECTOR_SECTIONS) {
      // no jargon that names the STORE rather than the feature
      expect(title).not.toMatch(/^(pose|transform|scale|settings|misc)$/i)
      // no question form — "How it will be placed" became "What it does when you drop it", longer and no clearer
      expect(title).not.toMatch(/^(what|how|who|where|why|when)\b/i)
      // scannable: three words at most
      expect(title.split(/\s+/).length).toBeLessThanOrEqual(3)
    }
    expect(INSPECTOR_SECTIONS.find(s => s.id === 'identity')?.title).toBe('Tile')
    expect(INSPECTOR_SECTIONS.find(s => s.id === 'behaviour')?.title).toBe('Behaviour')
  })
})

describe('a unit is a CHARACTER, a cell holds a TILE', () => {
  it('names a unit a Character', () => {
    expect(sectionTitle('identity', true)).toBe('Character')
  })

  it('names a cell\'s contents a Tile', () => {
    expect(sectionTitle('identity', false)).toBe('Tile')
  })

  it('relabels ONLY identity — the rest read the same for both', () => {
    for (const { id, title } of INSPECTOR_SECTIONS) {
      if (id === 'identity') continue
      expect(sectionTitle(id, true)).toBe(title)
      expect(sectionTitle(id, false)).toBe(title)
    }
  })
})

describe('remembering open/closed (§4.7 — persisted via /api/editor_settings)', () => {
  it('starts every section closed when the user has never touched it', () => {
    for (const { id } of INSPECTOR_SECTIONS) expect(sectionIsOpen(id, undefined)).toBe(false)
  })

  it('honours an explicit close', () => {
    expect(sectionIsOpen('identity', false)).toBe(false)
  })

  it('honours an explicit open, and remembers it across selections', () => {
    expect(sectionIsOpen('size', true)).toBe(true)
    expect(sectionIsOpen('identity', true)).toBe(true)
  })

  it('namespaces the key so it cannot collide with a floating panel\'s geometry', () => {
    const keys = INSPECTOR_SECTIONS.map(s => sectionSettingKey(s.id))
    for (const key of keys) expect(key).toMatch(/^inspector\.panelOpen\./)
    // The OLD namespace must not be reused: those values mean "this accordion was expanded", and reading
    // them as "open this panel" pops panels over the map for anyone with saved settings.
    for (const key of keys) expect(key).not.toMatch(/^inspector\.section\./)
    // The store is ONE flat map shared with the modals — "settings" is already a panel geometry key.
    expect(keys).not.toContain('settings')
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('gives every declared section a key and a title', () => {
    for (const { id } of INSPECTOR_SECTIONS) {
      expect(sectionSettingKey(id)).toBeTruthy()
      expect(sectionTitle(id, false)).toBeTruthy()
    }
  })

  it('does not throw on an id outside the model', () => {
    expect(sectionIsOpen('nope' as InspectorSectionId, undefined)).toBe(false)
    expect(sectionTitle('nope' as InspectorSectionId, false)).toBe('nope')
  })
})
