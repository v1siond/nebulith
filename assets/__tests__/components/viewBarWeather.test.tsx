/**
 * The Rain button sits beside Day / Night and works like it: press it and the weather changes, the button says which
 * weather it is.
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { ViewBar } from '@/components/game/editorChrome'

const noop = () => {}
const base = {
  activeView: 'iso' as const, onIso: noop, on2D: noop, onTop: noop, onFlow: noop,
  facing: 0 as never, onFacing: noop, playerRange: undefined, onPlayerRange: noop,
  dayNight: 'day' as const, onDayNight: noop,
  showDebug: false, onDebug: noop, showCollisions: false, onCollisions: noop,
  hideEntities: false, onHideEntities: noop, fps: 60, renderMs: 4, onHelp: noop, onGuides: noop, zoomPct: 100,
}

describe('the weather button', () => {
  it('says the weather is clear and is not pressed, then steps it when pressed', () => {
    const onWeather = jest.fn()
    render(<ViewBar {...(base as never)} weather="clear" onWeather={onWeather} />)
    const button = screen.getByRole('button', { name: /clear/i })
    expect(button).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(button)
    expect(onWeather).toHaveBeenCalledTimes(1)
  })

  it('says Rain and reads as pressed while it rains', () => {
    render(<ViewBar {...(base as never)} weather="rain" onWeather={noop} />)
    expect(screen.getByRole('button', { name: /rain/i })).toHaveAttribute('aria-pressed', 'true')
  })

  it('is not drawn where nobody can change the weather', () => {
    render(<ViewBar {...(base as never)} />)
    expect(screen.queryByRole('button', { name: /rain|clear/i })).toBeNull()
  })
})
