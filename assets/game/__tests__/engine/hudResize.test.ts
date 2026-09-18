/**
 * RESIZING A HUD PIECE, the grip has to follow the cursor, whatever the piece is pinned to.
 *
 * That describes anchor maths, not a sign error. A piece pinned to the BOTTOM keeps its bottom edge where
 * it is, so growing its height pushes the TOP up, and the grip, drawn at the bottom-right, sits still under
 * the cursor while the piece grows away from it. On a centre anchor the piece grows both pathways at once, so
 * the grip tracks at half speed. Only a top-left pinned piece ever behaved.
 */
import { hudGripCorner, hudResize } from '@/engine/hudLayout'
import type { HudPlacement } from '@/components/shell/playerUi.data'

const piece = (over: Partial<HudPlacement> = {}): HudPlacement =>
  ({ a: 'TL', x: 0, y: 0, w: 200, h: 100, s: 1, o: 1, z: 0, on: true, ...over }) as HudPlacement

describe('which corner carries the grip', () => {
  it('puts it opposite the pin, because that is the corner that can actually move', () => {
    expect(hudGripCorner('TL')).toEqual({ x: 'right', y: 'bottom' })
    expect(hudGripCorner('BR')).toEqual({ x: 'left', y: 'top' })
    expect(hudGripCorner('BC')).toEqual({ x: 'right', y: 'top' })
    expect(hudGripCorner('TR')).toEqual({ x: 'left', y: 'bottom' })
  })

  it('treats a centre pin as free on both sides', () => {
    expect(hudGripCorner('MC')).toEqual({ x: 'right', y: 'bottom' })
  })
})

describe('the grip follows the cursor', () => {
  it('top-left pinned: drag down and right, it grows by exactly that much', () => {
    expect(hudResize(piece({ a: 'TL' }), 30, 20)).toEqual({ w: 230, h: 120 })
  })

  it('BOTTOM-CENTRE pinned (the action bar): the grip is on top, so dragging UP grows it', () => {
    // This is the reported bug. The bottom edge is pinned, so the height can only grow upward.
    expect(hudResize(piece({ a: 'BC' }), 0, -20)).toEqual({ w: 200, h: 120 })
    expect(hudResize(piece({ a: 'BC' }), 0, 20)).toEqual({ w: 200, h: 80 })
  })

  it('bottom-centre pinned: horizontally it grows BOTH pathways, so the right edge still tracks 1:1', () => {
    // originX 0.5 → the piece widens by 2 for every 1 the right edge moves.
    expect(hudResize(piece({ a: 'BC' }), 15, 0)).toEqual({ w: 230, h: 100 })
  })

  it('bottom-right pinned: both edges are on the far side, so both deltas invert', () => {
    expect(hudResize(piece({ a: 'BR' }), -30, -20)).toEqual({ w: 230, h: 120 })
  })

  it('accounts for the piece SCALE, a 2× piece needs half the placement change to move the same pixels', () => {
    expect(hudResize(piece({ a: 'TL', s: 2 }), 40, 40)).toEqual({ w: 220, h: 120 })
  })

  it('never shrinks a piece below something you can still grab', () => {
    expect(hudResize(piece({ a: 'TL', w: 50, h: 30 }), -400, -400)).toEqual({ w: 40, h: 20 })
  })
})
