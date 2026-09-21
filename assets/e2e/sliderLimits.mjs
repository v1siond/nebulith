/**
 * NO SLIDER CAPS A VALUE.
 *
 *     node e2e/sliderLimits.mjs          (server on :6328)
 *
 * *"none of the sliders should be limited... the react side just reacts the values of the backend and
 * allow us to change them in the state, as simple as that."*
 *
 * A range input must have ends to be draggable, so the numbers in the panel are a comfortable DRAG range
 * and the range grows to take in whatever the value actually is. That is not a nicety: before it, a value
 * typed past the end pinned the handle at the end, and the next nudge wrote the end back. Typing 20 into
 * Width and touching the slider left you with 5.
 *
 * So this types past the end and then NUDGES, which is the move that used to destroy the value.
 */
import { chromium } from 'playwright'
import { logIn } from './logIn.mjs'

const BASE = process.env.BASE || 'http://localhost:6328'
const failures = []

function check(ok, label, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? '  ' + detail : ''}`)
  if (!ok) failures.push(label)
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1700, height: 1000 } })

// The editor is behind a login now, so the gate walks through the real form before it can drive it.
await logIn(page, BASE)
await page.goto(`${BASE}/templates`, { waitUntil: 'networkidle' })
await page.waitForTimeout(3000)

// A world to select something in. This never saves: the editor's Save writes over the open template.
await page.locator('button:has-text("Build this world")').first().click()
await page.waitForTimeout(6000)

const box = await page.locator('canvas').first().boundingBox()
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
await page.waitForTimeout(1500)

// The panel's sections are TOGGLES, so a blind click closes one that was already open and the run then
// fails for a reason that has nothing to do with the sliders. Open by outcome: click, and if the control
// we need still is not there, click again.
async function revealWidth() {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (await page.locator('input[type=range][aria-label="Width"]').count()) return true
    await page.locator('text=SIZE & POSITION').first().click().catch(() => {})
    await page.waitForTimeout(800)
  }
  return (await page.locator('input[type=range][aria-label="Width"]').count()) > 0
}

check(await revealWidth(), 'the Size and position section opens')

const sliders = await page.locator('input[type=range]').count()
check(sliders > 0, 'the settings panel has sliders', `${sliders} on screen`)

for (const [label, typed] of [['Width', 20], ['Height', 14]]) {
  const slider = page.locator(`input[type=range][aria-label="${label}"]`).first()
  const field = page.locator(`input[aria-label="${label} value"]`).first()

  if ((await slider.count()) === 0) {
    check(false, `${label} slider is on screen`)
    continue
  }

  const capBefore = Number(await slider.getAttribute('max'))
  await field.fill(String(typed))
  await field.press('Enter')
  await page.waitForTimeout(800)

  check(
    Number(await slider.inputValue()) === typed,
    `${label} accepts ${typed}, past its drag range of ${capBefore}`,
    `value=${await slider.inputValue()}`,
  )
  check(
    Number(await slider.getAttribute('max')) >= typed,
    `${label}'s slider grows to hold ${typed}`,
    `max=${await slider.getAttribute('max')}`,
  )

  // THE MOVE THAT USED TO DESTROY IT. A nudge moves the value by ONE STEP; it must not jump to a cap.
  // Measured against what was typed rather than against the drag range, because on a unit all three axes
  // write the same `size`, so by the second axis the range has already grown and comparing to it proves
  // nothing.
  await slider.focus()
  await page.keyboard.press('ArrowLeft')
  await page.waitForTimeout(800)
  const after = Number(await slider.inputValue())

  check(
    Math.abs(after - typed) <= typed * 0.05,
    `nudging ${label} moves it one step, it does not snap to a cap`,
    `typed=${typed} after=${after}`,
  )
}

await browser.close()

console.log(failures.length ? `\n${failures.length} FAILED` : '\nall passed')
process.exit(failures.length ? 1 : 0)
