import { useEffect, useState } from 'react'

import { NumberField } from '@/components/game/gridPanel'
import { type UiBar, type UiBarSlot, saveBars, uiActions, uiProfile } from '@/game/uiProfile'

/**
 * THE BARS TAB — add a bar, shape it, say when it shows.
 *
 * and *"we can configure the player and units bars, their size, their font size, if we want to show the text or
 * not"*.
 *
 * Each of those is a control here, and each is a column on `ui_bars`:
 *
 * - **add / remove / reorder** — `+ Add a bar` and the per-bar buttons; the whole list is saved at once. - **rows and
 * columns** — his *"new rows, new columns to each row"*. - **size, font size, show the text** — per bar, in its
 * settings. - **conditionals** — WHEN a bar is up: always, or once something is in it, or on an event / quest /
 * ability. Null condition IS "always", which is why the select's first option writes null rather than a sentinel
 * string.
 *
 * Spec: `2026-09-06-ui-system-spec-and-plan.md` §2.7, tab 3.
 */

/** The ways a bar can be gated, in his words. `null` = always up. */
const WHEN_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'always', label: 'Always' },
  { value: 'filled', label: 'Once something is in it' },
  { value: 'event', label: 'On an event' },
  { value: 'quest', label: 'On a quest action' },
  { value: 'ability', label: 'When an ability is active' },
  { value: 'vehicle', label: 'While in a vehicle' },
  { value: 'object', label: 'While using an object' },
]

const blankBar = (position: number): UiBar => ({
  name: `Bar ${position + 1}`,
  position,
  rows: 1,
  cols: 6,
  settings: { buttonPx: 44, gapPx: 6, fontPx: 12, showKeys: true, showText: false, showCooldown: true, showEmpty: true },
  condition: null,
  slots: [],
})

/** Keep a bar's slots matching its shape: growing adds blanks, shrinking drops the tail. */
function fitSlots(bar: UiBar): UiBarSlot[] {
  const want = Math.max(0, bar.rows * bar.cols)
  const slots = bar.slots.slice(0, want)
  while (slots.length < want) slots.push({ slot: slots.length, refKind: null, refKey: null })
  return slots.map((s, i) => ({ ...s, slot: i }))
}

export function BarsTab({ gameId }: { gameId?: string }) {
  const profile = uiProfile()
  const [bars, setBars] = useState<UiBar[]>(profile?.bars ?? [])
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  // Follow the profile when it loads or is replaced by a save elsewhere.
  useEffect(() => {
    setBars(uiProfile()?.bars ?? [])
  }, [profile])

  const commit = async (next: UiBar[]) => {
    const shaped = next.map((b, i) => ({ ...b, position: i, slots: fitSlots(b) }))
    setBars(shaped)
    setSaving(true)
    const ok = await saveBars(gameId, shaped)
    setSaving(false)
    setProblem(ok ? null : 'That did not save. The backend said no.')
  }

  const patch = (index: number, change: Partial<UiBar>) =>
    void commit(bars.map((b, i) => (i === index ? { ...b, ...change } : b)))

  const move = (index: number, by: number) => {
    const to = index + by
    if (to < 0 || to >= bars.length) return
    const next = bars.slice()
    ;[next[index], next[to]] = [next[to], next[index]]
    void commit(next)
  }

  if (!profile) {
    return <div className="hint">The player-UI profile has not loaded, so there are no bars to show yet.</div>
  }

  return (
    <section>
      <div className="sub">Bars</div>
      <div className="hint">
        As many as you need, never paged. Each one says when it shows, and drag-free: a bar you add is saved
        the moment you add it.
      </div>

      {bars.length === 0 && <div className="hint">No bars yet. Add one and it appears on the player&rsquo;s screen.</div>}

      {bars.map((bar, i) => (
        <div key={`${bar.name ?? 'bar'}-${i}`} className="barcard">
          <div className="ctl">
            <span className="l">Name</span>
            <input
              type="text"
              value={bar.name ?? ''}
              aria-label={`Bar ${i + 1} name`}
              onChange={e => patch(i, { name: e.target.value })}
            />
          </div>

          <NumberField label="Rows" value={bar.rows} min={1} ariaLabel={`Bar ${i + 1} rows`}
            onCommit={rows => patch(i, { rows })} />
          <NumberField label="Columns" value={bar.cols} min={1} ariaLabel={`Bar ${i + 1} columns`}
            onCommit={cols => patch(i, { cols })} />
          <div className="hint">{`${bar.rows} × ${bar.cols} = ${bar.rows * bar.cols} slots.`}</div>

          <div className="ctl">
            <span className="l">Shows</span>
            <select
              aria-label={`Bar ${i + 1} shows when`}
              value={(bar.condition?.when as string) ?? 'always'}
              onChange={e => patch(i, { condition: e.target.value === 'always' ? null : { when: e.target.value } })}
            >
              {WHEN_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          <NumberField label="Button size" value={Number(bar.settings.buttonPx ?? 44)} min={16}
            ariaLabel={`Bar ${i + 1} button size in pixels`}
            onCommit={buttonPx => patch(i, { settings: { ...bar.settings, buttonPx } })} />
          <NumberField label="Font size" value={Number(bar.settings.fontPx ?? 12)} min={6}
            ariaLabel={`Bar ${i + 1} font size in pixels`}
            onCommit={fontPx => patch(i, { settings: { ...bar.settings, fontPx } })} />

          <label className="ctl">
            <span className="l">Show the text</span>
            <input
              type="checkbox"
              checked={bar.settings.showText === true}
              aria-label={`Bar ${i + 1} shows text`}
              onChange={e => patch(i, { settings: { ...bar.settings, showText: e.target.checked } })}
            />
          </label>
          <label className="ctl">
            <span className="l">Show the keys</span>
            <input
              type="checkbox"
              checked={bar.settings.showKeys !== false}
              aria-label={`Bar ${i + 1} shows keys`}
              onChange={e => patch(i, { settings: { ...bar.settings, showKeys: e.target.checked } })}
            />
          </label>

          <div className="seg" role="group" aria-label={`Bar ${i + 1} order`}>
            <button type="button" onClick={() => move(i, -1)} disabled={i === 0} title="Move this bar up">↑</button>
            <button type="button" onClick={() => move(i, 1)} disabled={i === bars.length - 1} title="Move this bar down">↓</button>
            <button type="button" className="b dan" onClick={() => void commit(bars.filter((_, x) => x !== i))}>
              Remove
            </button>
          </div>
        </div>
      ))}

      <button
        type="button"
        className="b pri"
        style={{ width: '100%', marginTop: 8, justifyContent: 'center' }}
        onClick={() => void commit([...bars, blankBar(bars.length)])}
      >
        + Add a bar
      </button>

      {saving && <div className="hint">Saving…</div>}
      {problem && <div className="hint" style={{ color: 'var(--warn)' }}>{problem}</div>}
      <div className="hint">
        {`${uiActions().length} actions can go on a bar.`}
      </div>
    </section>
  )
}
