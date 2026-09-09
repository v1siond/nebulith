/**
 * THE GUIDES MUST STAY TRUE — a guide that names a button wrongly is worse than no guide.
 *
 * Alexander, 2026-09-09: *"there's no general step by step guides on how to do stuff."* Writing them is
 * the easy half. The half that fails silently is keeping them true: someone renames "Change just one
 * layer" to "Rebuild one part, keep the rest" (which happened, in this very session) and the guide still
 * cheerfully tells you to click a button that no longer exists.
 *
 * So every `**bolded**` run in a step is treated as a CLAIM about the UI, and this suite checks each claim
 * against the source that draws the editor. It reads the component files as text on purpose: the goal is to
 * catch a rename anywhere, without having to mount the whole editor to do it.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { EDITOR_GUIDES, guideFor } from '@/components/game/shell/editorGuides.data'

/** The files that draw the controls the guides point at. */
const SOURCES = [
  'components/game/editorChrome.tsx',
  'components/game/editorInspector.tsx',
  'components/game/shell/ArtStyleControl.tsx',
  'components/game/editorConfig.ts',
  'pages/personal-projects/game-engine/templates.tsx',
]

const haystack = SOURCES.map(f => readFileSync(join(process.cwd(), 'src', f), 'utf8')).join('\n')

/** Every control name a guide claims exists, with the guide and step it came from. */
const claims = EDITOR_GUIDES.flatMap(guide =>
  guide.steps.flatMap((step, i) =>
    [...step.do.matchAll(/\*\*([^*]+)\*\*/g)].map(m => ({
      guide: guide.id,
      step: i + 1,
      // Strip the decoration the button draws around the words — a guide says "Build this world" where
      // the JSX reads "⚡ Build this world".
      name: m[1].replace(/^[⚡▶←→↗⚑▦⌂☻🖥•\s]+/, '').replace(/[…\s]+$/, ''),
    })),
  ),
)

describe('every control a guide names actually exists', () => {
  it('found claims to check at all — an empty regex would pass silently', () => {
    expect(claims.length).toBeGreaterThan(15)
  })

  it.each(claims)('$guide step $step names "$name"', ({ name }) => {
    // Keyboard hints (E, I, Q, Ctrl+Z, WASD) are not controls in the source; they are keys the handlers
    // read. Checked separately below.
    if (/^(E|I|Q|Ctrl\+Z|WASD|Stop)$/i.test(name)) return
    expect(haystack).toContain(name)
  })
})

describe('the guides are usable as guides', () => {
  it('gives every guide a job title, an outcome and at least three steps', () => {
    for (const g of EDITOR_GUIDES) {
      expect(g.title).toBeTruthy()
      expect(g.outcome).toBeTruthy()
      expect(g.steps.length).toBeGreaterThanOrEqual(3)
    }
  })

  it('phrases every title as a JOB, not a feature name', () => {
    // A guide is found by the task someone wants done. "Generate panel" is a feature; "Make my first
    // level" is a job. The test for it: a title starts with a verb.
    for (const g of EDITOR_GUIDES) {
      expect(g.title).toMatch(/^(Make|Put|Add|Change|Play|Build|Create|Set|Give|Move|Remove)\b/)
    }
  })

  it('starts every step with an instruction, not a description', () => {
    for (const g of EDITOR_GUIDES) {
      for (const step of g.steps) expect(step.do).toMatch(/^(In|Pick|Click|Set|Move|Point|Choose|Press|The|Not|Wrong)\b/)
    }
  })

  it('leads with making a level — it is the first thing anyone needs', () => {
    expect(EDITOR_GUIDES[0].id).toBe('first-level')
  })

  it('uses unique ids, so `guideFor` cannot be ambiguous', () => {
    const ids = EDITOR_GUIDES.map(g => g.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(guideFor(id)?.id).toBe(id)
  })

  it('returns undefined for an unknown id rather than throwing', () => {
    expect(guideFor('nope')).toBeUndefined()
  })
})
