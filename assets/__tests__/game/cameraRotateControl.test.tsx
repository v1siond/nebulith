/**
 * THE ROTATE CONTROL in the top nav (ticket #75).
 *
 * Alexander: "I want the rotate button or action and just rotates the map horizontally, changing the front
 * perspective of the map and showing a different side of it" / "we can rotate the corners, 4 corners, 4
 * rotation options, all faces of the map are visible."
 *
 * So the control must (a) advance ONE quarter-turn per click and wrap 0→1→2→3→0 — four corners, no fifth
 * state — and (b) SHOW which corner you are on, or the user cannot tell a rotated map from the default one.
 */
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { CameraRotateButton } from '@/components/game/cameraControls'
import type { Orientation } from '@/engine/render/isoOrientation'

/** The control is CONTROLLED (the page owns the facing, the render reads it), so drive it from state. */
function Harness({ start = 0 as Orientation }: { start?: Orientation }) {
  const [facing, setFacing] = useState<Orientation>(start)
  return (
    <>
      <CameraRotateButton facing={facing} onFacing={setFacing} />
      <output data-testid="facing">{facing}</output>
    </>
  )
}

const clickRotate = () => fireEvent.click(screen.getByRole('button', { name: /rotate/i }))
const facingNow = () => screen.getByTestId('facing').textContent

describe('the rotate control advances one quarter-turn per click', () => {
  test('four clicks walk 0 → 1 → 2 → 3 and wrap back to 0', () => {
    render(<Harness />)
    expect(facingNow()).toBe('0')
    const seen: (string | null)[] = []
    for (let i = 0; i < 4; i++) {
      clickRotate()
      seen.push(facingNow())
    }
    expect(seen).toEqual(['1', '2', '3', '0'])
  })

  test('it wraps from ANY starting corner — 3 → 0, never a fifth state', () => {
    render(<Harness start={3} />)
    clickRotate()
    expect(facingNow()).toBe('0')
  })
})

describe('the control SHOWS the current corner', () => {
  test('the label carries the quarter-turn in degrees, and changes as you rotate', () => {
    render(<Harness />)
    const btn = screen.getByRole('button', { name: /rotate/i })
    expect(btn.textContent).toMatch(/0°/)
    clickRotate()
    expect(btn.textContent).toMatch(/90°/)
    clickRotate()
    expect(btn.textContent).toMatch(/180°/)
    clickRotate()
    expect(btn.textContent).toMatch(/270°/)
  })

  test('every one of the four corners renders a DISTINCT label', () => {
    const labels = ([0, 1, 2, 3] as Orientation[]).map(f => {
      const { unmount } = render(<CameraRotateButton facing={f} onFacing={jest.fn()} />)
      const text = screen.getByRole('button', { name: /rotate/i }).textContent ?? ''
      unmount()
      return text
    })
    expect(new Set(labels).size).toBe(4)
  })
})
