/**
 * THE PLAYER'S UI — the panel, and the hybrid layout mode that goes with it.
 *
 * Alexander, 2026-09-08: *"there's no preview for the HUD either, we should kind of like a hybrid mode
 * between game mode and editor where we can place and see our HUD updates in realtime, like we'd do on wow
 * bartender."*
 *
 * So the game keeps running and the real HUD becomes draggable on top of it. The panel and the overlay share
 * ONE piece of state (`useHudLayout`), which is what makes dragging and typing the same surface instead of
 * two views that drift.
 *
 * WHAT THIS DOES NOT DO: persist. Configuring the HUD has never existed in the product — there is no
 * `ui_profiles` table, no endpoint, nothing (T-115 is a spec). The defaults are transcribed from the
 * Tailwind classes each element is hardcoded with today, so this is a faithful, editable view of the real
 * layout; it simply has nowhere to save to. The panel says so rather than implying otherwise.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  HUD_ANCHOR_ORDER,
  hudCollisions,
  hudStyle,
  nudged,
  stageScale,
} from '@/engine/hudLayout'
import {
  HUD_ANCHOR_NAMES,
  HUD_DEFAULTS,
  HUD_ELEMENTS,
  HUD_STAGE,
  type HudAnchor,
  type HudForm,
  type HudLayout,
} from './playerUi.data'

import { Hint, NumberField, Segmented, Slider, WideButton } from './Controls'
import { InfoButton } from './InfoButton'

/** The shared, editable layout. One hook, so the panel and the overlay can never disagree. */
export function useHudLayout() {
  const [form, setForm] = useState<HudForm>('Desktop')
  const [selected, setSelected] = useState<string>('vitals')
  const [snap, setSnap] = useState(true)
  const [guides, setGuides] = useState(true)
  const [zoom, setZoom] = useState<'fit' | 'full'>('fit')
  const [layouts, setLayouts] = useState<Record<HudForm, HudLayout>>(() => ({
    Desktop: structuredClone(HUD_DEFAULTS.Desktop),
    Mobile: structuredClone(HUD_DEFAULTS.Mobile),
  }))
  /** How much the stage is shrunk to fit its pane. The drag divides by it. */
  const scale = useRef(1)

  const layout = layouts[form]
  const patch = useCallback(
    (key: string, next: Partial<HudLayout[string]>) => {
      setLayouts((all) => ({ ...all, [form]: { ...all[form], [key]: { ...all[form][key], ...next } } }))
    },
    [form],
  )
  const reset = useCallback(
    (key: string) => {
      setLayouts((all) => ({ ...all, [form]: { ...all[form], [key]: structuredClone(HUD_DEFAULTS[form][key]) } }))
    },
    [form],
  )
  const resetAll = useCallback(() => {
    setLayouts((all) => ({ ...all, [form]: structuredClone(HUD_DEFAULTS[form]) }))
  }, [form])

  return {
    form, setForm,
    selected, setSelected,
    snap, setSnap,
    guides, setGuides,
    zoom, setZoom,
    layout, patch, reset, resetAll,
    scale,
  }
}

export type HudLayoutState = ReturnType<typeof useHudLayout>

/** What each element actually LOOKS like. A dispatch map, so adding one is an entry and never a branch. */
const CONTENT: Record<string, () => React.ReactNode> = {
  vitals: () => (
    <>
      <div className="hb hp"><i style={{ width: '72%' }} /><u>124 / 170</u></div>
      <div className="hb rage"><i style={{ width: '40%' }} /></div>
      <div className="hb mana"><i style={{ width: '55%' }} /></div>
    </>
  ),
  action_bar: () => (
    <div className="hslots">{[1, 2, 3, 4].map((n) => <b key={n}><s>{n}</s></b>)}</div>
  ),
  quest_tracker: () => (
    <div className="hq"><b>Clear the cellar</b><i>Rats defeated — 2 of 5</i><i>Talk to the elder</i></div>
  ),
  fps: () => <span className="hfps">60 fps · 5.8 ms</span>,
  exit: () => <span className="hbtn">■ Exit game</span>,
  select_hint: () => <span className="hpill">Click anything to edit it</span>,
  trigger_msg: () => <span className="hmsg">The gate grinds open.</span>,
  win_lose: () => <div className="hwin"><b>You win</b><i>Play again · Back to the editor</i></div>,
  bag_btn: () => <span className="hbtn">🎒 Bag</span>,
  journal_btn: () => <span className="hbtn">📖 Journal</span>,
  bag_panel: () => (
    <div className="hpanel"><b>Bag</b><div className="hslotgrid">{Array.from({ length: 12 }, (_, i) => <i key={i} />)}</div></div>
  ),
  journal_panel: () => (
    <div className="hpanel"><b>Journal</b><i>Clear the cellar — 2 of 5</i><i>Find the lost goat</i></div>
  ),
  debug_legend: () => (
    <div className="hdbg"><i className="d1">blocked</i><i className="d2">walkable</i><i className="d3">has a rule</i></div>
  ),
  nameplate: () => <div className="hplate">Wanderer 1<i><s style={{ width: '80%' }} /></i></div>,
}

const NAME_BY_KEY = Object.fromEntries(HUD_ELEMENTS.map((e) => [e.k, e.n]))

/**
 * The draggable HUD, over the running game.
 *
 * The stage is a REAL game window drawn at 1:1 and scaled as a whole, so what you arrange is what a player
 * on that screen size sees. Sizing it from the pane instead would make a 256px health bar look like it
 * swamps the screen purely because the editor's pane is narrow — the preview would lie about the one thing
 * it exists to show.
 */
export function HudOverlay({ state }: { state: HudLayoutState }) {
  const { form, layout, selected, setSelected, snap, guides, zoom, patch, scale } = state
  const box = useRef<HTMLDivElement>(null)
  const [stageW, stageH] = HUD_STAGE[form]
  const [fit, setFit] = useState(1)

  useEffect(() => {
    const node = box.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const rect = node.getBoundingClientRect()
      const next = zoom === 'full' ? 1 : stageScale(rect.width, rect.height, stageW, stageH)
      scale.current = next
      setFit(next)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [zoom, stageW, stageH, scale])

  const startDrag = (key: string) => (event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setSelected(key)
    const startX = event.clientX
    const startY = event.clientY
    const from = layout[key]
    const move = (ev: MouseEvent) => {
      // Shift nudges freely; otherwise it snaps to a 4px grid.
      const step = snap && !ev.shiftKey ? 4 : 1
      patch(key, nudged(from, ev.clientX - startX, ev.clientY - startY, scale.current, step))
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const startResize = (key: string) => (event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setSelected(key)
    const startX = event.clientX
    const startY = event.clientY
    const from = layout[key]
    const move = (ev: MouseEvent) => {
      const factor = scale.current || 1
      patch(key, {
        w: Math.max(40, Math.round(from.w + (ev.clientX - startX) / factor)),
        h: Math.max(20, Math.round(from.h + (ev.clientY - startY) / factor)),
      })
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return (
    <div ref={box} className={`hudlayer${form === 'Mobile' ? ' phone' : ''}${zoom === 'full' ? ' zoomed' : ''}`}>
      {guides && <div className="hgrid" />}
      <div
        className="hframe"
        style={{
          width: stageW,
          height: stageH,
          left: zoom === 'full' ? 0 : '50%',
          top: zoom === 'full' ? 0 : '50%',
          transform: zoom === 'full' ? 'none' : `translate(-50%,-50%) scale(${fit})`,
        }}
      >
        {Object.entries(layout).map(([key, placement]) => {
          if (!placement.on && key !== selected) return null
          const render = CONTENT[key]
          return (
            <div
              key={key}
              data-k={key}
              className={`hel${selected === key ? ' sel' : ''}${placement.on ? '' : ' off'}`}
              style={hudStyle(placement)}
              onMouseDown={startDrag(key)}
            >
              <div className="hbody">{render ? render() : <span className="hn">{NAME_BY_KEY[key] ?? key}</span>}</div>
              <span className="htag">
                <b>{NAME_BY_KEY[key] ?? key}</b>
                <i>{HUD_ANCHOR_NAMES[placement.a]}</i>
                {!placement.on && <u>hidden in play</u>}
              </span>
              <div className="hrz" onMouseDown={startResize(key)} aria-hidden="true" />
            </div>
          )
        })}
      </div>
      <div className="hscale">
        {`${stageW} × ${stageH} game window · ${zoom === 'full' ? 'true size — scroll to move around' : `shown at ${Math.round(fit * 100)}%`}`}
      </div>
    </div>
  )
}

/** Extra controls a particular element deserves. A map, so a new one is an entry rather than a branch. */
const EXTRAS: Record<string, () => React.ReactNode> = {
  vitals: () => (
    <Hint>
      The keybind footer currently reads the literal string &ldquo;F attack · G special&rdquo;. Under a
      profile it would be generated from the real bindings, so it could never go stale.
    </Hint>
  ),
  quest_tracker: () => (
    <Hint>
      This one currently leaks into the editor: its gate is <code>!flowView &amp;&amp; !topView</code> rather
      than &ldquo;while playing&rdquo;.
    </Hint>
  ),
  nameplate: () => <Hint>Drawn on the canvas above each character, so it has no anchor of its own — it follows whoever it belongs to.</Hint>,
}

/** The panel beside the running game. */
export function PlayerUiPanel({ state, onDone }: { state: HudLayoutState; onDone: () => void }) {
  const { form, setForm, layout, selected, setSelected, snap, setSnap, guides, setGuides, patch, reset, resetAll } = state
  const [stageW, stageH] = HUD_STAGE[form]
  const collisions = hudCollisions(layout, stageW, stageH)
  const element = HUD_ELEMENTS.find((e) => e.k === selected)
  const placement = layout[selected]

  return (
    <>
      <div className="lhead">
        <div className="lt"><span>The player&rsquo;s UI</span></div>
        <div className="ls">the HUD, the keys and the bars your players get</div>
      </div>

      <div className="pfix">
        <Hint>
          The game is running to the right. Drag any piece of the HUD on it — what you see is what your
          players get.
        </Hint>
        {/* Said plainly, because the alternative is implying a save that does not exist. */}
        <div className="warn">
          <b>Nothing here is saved yet</b>
          <u>
            Configuring the HUD has never existed in the product: there is no profile to write to. These are
            the real positions, read off the classes each piece is hardcoded with today, so you can see and
            rearrange them — but the arrangement is lost on reload until the backend for it is built.
          </u>
        </div>
        <div className="ctl">
          <span className="l"><span>Designing for</span><InfoButton helpId="hudform" /></span>
          <div className="seg" role="group" aria-label="Designing for">
            {(['Desktop', 'Mobile'] as HudForm[]).map((f) => (
              <button key={f} type="button" className={form === f ? 'on' : ''} aria-pressed={form === f} onClick={() => setForm(f)}>
                {f}
              </button>
            ))}
          </div>
        </div>
        <Hint>Two separate layouts, not one scaled down — a thumb needs a bigger action bar and no FPS readout.</Hint>
        <div className="ctl">
          <span className="l"><span>While dragging</span></span>
          <div className="seg" role="group" aria-label="While dragging">
            <button type="button" className={snap ? 'on' : ''} aria-pressed={snap} title="Snap to a 4px grid — hold Shift to nudge freely" onClick={() => setSnap(!snap)}>
              Snap
            </button>
            <button type="button" className={guides ? 'on' : ''} aria-pressed={guides} title="Show the alignment grid" onClick={() => setGuides(!guides)}>
              Guides
            </button>
          </div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr', gap: 1, padding: 10 }}>
        <div className="sub">Pieces of the HUD</div>
        <div className="flist">
          {HUD_ELEMENTS.map((el) => {
            const p = layout[el.k]
            return (
              <button
                key={el.k}
                type="button"
                className={`frow${selected === el.k ? ' on' : ''}`}
                aria-pressed={selected === el.k}
                onClick={() => setSelected(el.k)}
              >
                <span>{el.n}</span>
                <span className="ct">{!p ? 'follows the character' : p.on ? HUD_ANCHOR_NAMES[p.a] : 'hidden'}</span>
              </button>
            )
          })}
        </div>

        {element && (
          <>
            <div className="sub">{element.n}</div>
            <div className="hint">Today: <code>{element.now}</code> · shows {element.vis}</div>
          </>
        )}

        {placement && (
          <>
            <Segmented
              label="Show it"
              options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]}
              value={placement.on ? 'yes' : 'no'}
              onChange={(v) => patch(selected, { on: v === 'yes' })}
            />
            <div className="ctl">
              <span className="l"><span>Pinned to</span><InfoButton helpId="anchor" /></span>
              <div className="apad">
                {HUD_ANCHOR_ORDER.map((a) => (
                  <button
                    key={a}
                    type="button"
                    className={placement.a === a ? 'on' : ''}
                    title={HUD_ANCHOR_NAMES[a]}
                    aria-label={HUD_ANCHOR_NAMES[a]}
                    aria-pressed={placement.a === a}
                    onClick={() => patch(selected, { a: a as HudAnchor })}
                  />
                ))}
              </div>
            </div>
            <Hint>Pinned, not placed. &ldquo;16 up from the bottom-left&rdquo; survives a resized window; &ldquo;y = 812&rdquo; does not.</Hint>
            <NumberField label="Across" value={placement.x} unit="px" onChange={(v) => patch(selected, { x: v })} />
            <NumberField label="In from the edge" value={placement.y} unit="px" onChange={(v) => patch(selected, { y: v })} />
            <NumberField label="Width" value={placement.w} unit="px" onChange={(v) => patch(selected, { w: v })} />
            <NumberField label="Height" value={placement.h} unit="px" onChange={(v) => patch(selected, { h: v })} />
            <Slider label="Size" min={0.6} max={2} step={0.05} value={placement.s} unit="×" onChange={(v) => patch(selected, { s: v })} />
            <Slider label="See-through" min={0.2} max={1} step={0.05} value={placement.o} onChange={(v) => patch(selected, { o: v })} />
            <NumberField label="Draw order" value={placement.z} onChange={(v) => patch(selected, { z: v })} />
            {EXTRAS[selected]?.()}
            <WideButton onClick={() => reset(selected)}>↺ Put this piece back where it was</WideButton>
          </>
        )}
        {!placement && element && EXTRAS[selected]?.()}

        {collisions.length > 0 && (
          <div className="warn">
            <b>These pieces cover each other</b>
            {collisions.slice(0, 4).map((c) => (
              <i key={`${c.a}-${c.b}`}>
                <span>{`${NAME_BY_KEY[c.a]}  +  ${NAME_BY_KEY[c.b]}`}</span>
                <s>{`${c.area.toLocaleString()} px²`}</s>
              </i>
            ))}
            <u>
              {`Measured on a ${stageW} × ${stageH} window, so it is the layout overlapping and not this preview
              being narrow. In the product today the vitals and the debug legend are both `}
              <code>fixed bottom-4 left-4</code>
              {` — turn debug on and your health bar disappears underneath it.`}
            </u>
          </div>
        )}

        <WideButton onClick={resetAll}>↺ Reset the whole layout to the default</WideButton>
      </div>

      <div className="pfoot">
        <button type="button" className="b pri" style={{ width: '100%', justifyContent: 'center' }} onClick={onDone}>
          ✓ Done — back to the map
        </button>
      </div>
    </>
  )
}
