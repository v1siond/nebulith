/**
 * "HOW DO I …" — the step-by-step guides, in a movable panel.
 *
 * Alexander, 2026-09-09: *"there's no general step by step guides on how to do stuff."*
 *
 * Two decisions worth stating, because both were the reason the old help did not answer this:
 *
 *  · **A list of jobs first, not a list of features.** The entry point is "Make my first level", not
 *    "Generate panel". Someone who needs a guide does not yet know what the panel is called.
 *  · **The steps are TICKABLE.** A guide you read and then lose your place in is a wall of text. Ticking
 *    as you go is what lets you look away at the map — which every one of these steps asks you to do —
 *    and come back. The panel is movable for the same reason: it has to sit beside the thing it describes.
 *
 * Progress is per-viewer and deliberately not persisted: it records "where am I in this task, right now",
 * which is meaningless the next time you open the editor.
 */
import { useState } from 'react'

import { EDITOR_GUIDES, guideFor, type Guide } from './editorGuides.data'

/** Render `**bold**` runs, so a step can name a control exactly as the button prints it. */
function Instruction({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
        part.startsWith('**') && part.endsWith('**')
          ? <b key={i} className="gctl">{part.slice(2, -2)}</b>
          : <span key={i}>{part}</span>,
      )}
    </>
  )
}

function GuideBody({ guide, onBack }: { guide: Guide; onBack: () => void }) {
  const [done, setDone] = useState<ReadonlySet<number>>(new Set())
  const toggle = (i: number) =>
    setDone(prev => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })

  return (
    <div>
      <button type="button" className="b sm" onClick={onBack}>← All guides</button>
      <div className="ph2" style={{ marginTop: 10 }}>{guide.title}</div>
      <div className="hint">{guide.outcome}</div>
      <ol className="gsteps">
        {guide.steps.map((step, i) => (
          <li key={i} className={done.has(i) ? 'on' : undefined}>
            <label>
              <input type="checkbox" checked={done.has(i)} onChange={() => toggle(i)} />
              <span>
                <Instruction text={step.do} />
                {step.why && <i className="gwhy">{step.why}</i>}
              </span>
            </label>
          </li>
        ))}
      </ol>
      <div className="hint">
        {done.size === guide.steps.length
          ? 'That is the whole job. Ctrl+Z undoes any of it.'
          : `${done.size} of ${guide.steps.length} done.`}
      </div>
    </div>
  )
}

export function GuidesPanel() {
  const [openId, setOpenId] = useState<string | null>(null)
  const guide = openId ? guideFor(openId) : undefined

  if (guide) return <GuideBody guide={guide} onBack={() => setOpenId(null)} />

  return (
    <div>
      <div className="hint">Whole jobs, start to finish. Each step names the button it means.</div>
      <div className="glist">
        {EDITOR_GUIDES.map(g => (
          <button key={g.id} type="button" className="pcard" onClick={() => setOpenId(g.id)}>
            <div>
              <div className="pn">{g.title}</div>
              <div className="pd">{g.outcome}</div>
            </div>
            <span className="ct">{`${g.steps.length} steps`}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
