/**
 * THE CANVAS MODE CHIP (games-page UX design §4.9; principle §4.1.7 "Modes are visible on the
 * canvas, not implied by which panel is open").
 *
 * The chip answers one question — "what will my next click do?" — so the description must be a pure
 * function of the armed tool state, and its precedence must be the SAME precedence the canvas
 * handlers use (`templates.tsx`'s `editorMode`: connector > composition > character > paint >
 * select). If the two disagreed the chip would confidently describe a click the canvas doesn't make.
 */
import { describeCanvasMode, type CanvasModeState } from '@/components/game/canvasMode'

const nothingArmed: CanvasModeState = {
  connectorMode: false,
  buildingTool: null,
  entityTool: null,
  armedTileLabel: null,
}

const chipFor = (over: Partial<CanvasModeState>) => describeCanvasMode({ ...nothingArmed, ...over })

describe('the chip names what the next click does', () => {
  it('falls back to Select when nothing is armed', () => {
    const chip = chipFor({})
    expect(chip.what).toBe('Select')
    expect(chip.how).toContain('Shift+drag')
  })

  it('names the tile the brush is holding', () => {
    expect(chipFor({ armedTileLabel: 'grass' }).what).toBe('Painting "grass"')
  })

  it('tells the painter how to erase — the one non-obvious gesture', () => {
    expect(chipFor({ armedTileLabel: 'grass' }).how).toContain('Alt-click erases')
  })

  it('announces connection placing', () => {
    const chip = chipFor({ connectorMode: true })
    expect(chip.what).toBe('Placing a connection')
    expect(chip.how).toContain('click a cell')
  })

  it('names the composition being stamped', () => {
    expect(chipFor({ buildingTool: 'house_4' }).what).toBe('Placing "house_4"')
  })

  it('names the character being placed', () => {
    expect(chipFor({ entityTool: 'enemy' }).what).toBe('Placing an enemy')
  })

  it('describes the character eraser and the collision brush by what they do', () => {
    expect(chipFor({ entityTool: 'erase' }).what).toBe('Removing characters')
    expect(chipFor({ entityTool: 'collision' }).what).toBe('Blocking cells')
  })

  it('always offers Esc as the way out of an armed mode', () => {
    const armed: Partial<CanvasModeState>[] = [
      { armedTileLabel: 'grass' },
      { connectorMode: true },
      { buildingTool: 'fountain' },
      { entityTool: 'npc' },
    ]
    for (const state of armed) expect(chipFor(state).how).toContain('Esc')
  })

  it('does not offer Esc in Select — there is nothing armed to disarm', () => {
    expect(chipFor({}).how).not.toContain('Esc')
  })
})

describe('precedence matches the canvas handlers, not the panel that is open', () => {
  it('connector mode wins over every other armed tool', () => {
    const chip = chipFor({ connectorMode: true, buildingTool: 'house_4', entityTool: 'npc', armedTileLabel: 'grass' })
    expect(chip.what).toBe('Placing a connection')
  })

  it('a composition wins over a character and a brush', () => {
    expect(chipFor({ buildingTool: 'house_4', entityTool: 'npc', armedTileLabel: 'grass' }).what).toBe('Placing "house_4"')
  })

  it('a character wins over a brush', () => {
    expect(chipFor({ entityTool: 'npc', armedTileLabel: 'grass' }).what).toBe('Placing an npc')
  })
})

describe('every chip is renderable', () => {
  it('carries a glyph, a what and a how in all modes', () => {
    const states: Partial<CanvasModeState>[] = [
      {},
      { armedTileLabel: 'grass' },
      { connectorMode: true },
      { buildingTool: 'fountain' },
      { entityTool: 'player' },
      { entityTool: 'erase' },
      { entityTool: 'collision' },
    ]
    for (const state of states) {
      const chip = chipFor(state)
      expect(chip.glyph.length).toBeGreaterThan(0)
      expect(chip.what.length).toBeGreaterThan(0)
      expect(chip.how.length).toBeGreaterThan(0)
    }
  })
})
