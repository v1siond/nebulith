/**
 * PLAYER-CAMERA RANGE CONTROL — the iso-only top-nav control that sets `playerViewRange` (Alexander: "I want
 * to control that setting, so increasing, reducing, etc."). The engine half already culls to a radius around
 * the player and draws a ring; this is the UI that drives it.
 *
 * DEFAULT OFF (range = undefined → today's full-window render, no regression). Toggling ON sets a positive
 * range and reveals a slider to INCREASE / REDUCE it live; toggling OFF returns to undefined.
 */
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { PlayerRangeControl, normalizePlayerViewRange, PLAYER_RANGE_MAX } from '@/components/game/cameraControls'

/** CONTROLLED, like the rotate control — the page owns the range and feeds it to render({ playerViewRange }). */
function Harness({ start }: { start?: number }) {
  const [range, setRange] = useState<number | undefined>(start)
  return (
    <>
      <PlayerRangeControl range={range} onRange={setRange} />
      <output data-testid="range">{range ?? 'off'}</output>
    </>
  )
}

const rangeNow = () => screen.getByTestId('range').textContent

describe('PlayerRangeControl — a live, default-OFF range control', () => {
  test('DEFAULT OFF — range is undefined and no slider is shown (the full-window render, no regression)', () => {
    render(<Harness />)
    expect(rangeNow()).toBe('off')
    expect(screen.queryByRole('slider')).toBeNull()
  })

  test('toggling ON sets a positive range and reveals the slider', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(Number(rangeNow())).toBeGreaterThan(0)
    expect(screen.queryByRole('slider')).not.toBeNull()
  })

  test('the slider INCREASES and REDUCES the range live', () => {
    render(<Harness start={6} />)
    fireEvent.change(screen.getByRole('slider'), { target: { value: '12' } })
    expect(rangeNow()).toBe('12')
    fireEvent.change(screen.getByRole('slider'), { target: { value: '3' } })
    expect(rangeNow()).toBe('3')
  })

  test('toggling OFF returns to undefined (off = the full-window render)', () => {
    render(<Harness start={6} />)
    fireEvent.click(screen.getByRole('checkbox')) // it starts ON at 6
    expect(rangeNow()).toBe('off')
  })
})

describe('normalizePlayerViewRange — OFF unless a positive range', () => {
  test('undefined / 0 / negative → undefined (OFF)', () => {
    expect(normalizePlayerViewRange(undefined)).toBeUndefined()
    expect(normalizePlayerViewRange(0)).toBeUndefined()
    expect(normalizePlayerViewRange(-4)).toBeUndefined()
  })
  test('a positive range is kept, rounded, and clamped to the max', () => {
    expect(normalizePlayerViewRange(6)).toBe(6)
    expect(normalizePlayerViewRange(3.4)).toBe(3)
    expect(normalizePlayerViewRange(9999)).toBe(PLAYER_RANGE_MAX)
  })
})
