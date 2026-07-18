import { createCanvas } from '@napi-rs/canvas'
import {
  polyBBox,
  tileHandlePoints,
  handleAtPoint,
  dragOutwardPx,
  scaleFromDrag,
  depthFromDrag,
  drawTileHandles,
  HANDLE_HIT_RADIUS,
} from '@/engine/render/tileHandles'

// A 100×80 axis-aligned rectangle silhouette: minX0 maxX100 minY0 maxY80 → cx50 cy40.
const RECT = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 80 },
  { x: 0, y: 80 },
]

describe('tileHandles — geometry', () => {
  it('polyBBox returns the AABB + centre of a silhouette polygon', () => {
    const b = polyBBox(RECT)
    expect(b).toMatchObject({ minX: 0, minY: 0, maxX: 100, maxY: 80, cx: 50, cy: 40, width: 100, height: 80 })
  })

  it('polyBBox handles a rotated iso diamond (corner points)', () => {
    const diamond = [
      { x: 0, y: 40 }, // left
      { x: 50, y: 0 }, // top
      { x: 100, y: 40 }, // right
      { x: 50, y: 80 }, // bottom
    ]
    expect(polyBBox(diamond)).toMatchObject({ minX: 0, maxX: 100, minY: 0, maxY: 80, cx: 50, cy: 40 })
  })

  it('places the WIDTH handle at the right-middle and HEIGHT at the top-middle', () => {
    const handles = tileHandlePoints(RECT, { zWidth: false })
    const width = handles.find(h => h.id === 'width')!
    const height = handles.find(h => h.id === 'height')!
    expect(width).toMatchObject({ x: 100, y: 40 }) // (maxX, cy)
    expect(height).toMatchObject({ x: 50, y: 0 }) // (cx, minY)
  })

  it('omits the z-width handle in 2D and includes it (bottom-middle) in ISO', () => {
    expect(tileHandlePoints(RECT, { zWidth: false }).some(h => h.id === 'zwidth')).toBe(false)
    const iso = tileHandlePoints(RECT, { zWidth: true })
    const z = iso.find(h => h.id === 'zwidth')!
    expect(z).toMatchObject({ x: 50, y: 80 }) // (cx, maxY)
  })

  it('handleAtPoint hits a handle within the radius and misses outside it', () => {
    const handles = tileHandlePoints(RECT, { zWidth: true })
    expect(handleAtPoint(handles, 100, 40, HANDLE_HIT_RADIUS)?.id).toBe('width')
    expect(handleAtPoint(handles, 100 + HANDLE_HIT_RADIUS - 1, 40, HANDLE_HIT_RADIUS)?.id).toBe('width')
    expect(handleAtPoint(handles, 100 + HANDLE_HIT_RADIUS + 5, 40, HANDLE_HIT_RADIUS)).toBeNull()
    expect(handleAtPoint(handles, 50, 0, HANDLE_HIT_RADIUS)?.id).toBe('height')
    expect(handleAtPoint(handles, 50, 80, HANDLE_HIT_RADIUS)?.id).toBe('zwidth')
  })
})

describe('tileHandles — drag mapping', () => {
  it('projects the drag onto each handle OUTWARD axis (width=+x, height=-y, zwidth=+y)', () => {
    expect(dragOutwardPx('width', 30, -12)).toBe(30) // horizontal only
    expect(dragOutwardPx('height', 7, -25)).toBe(25) // up is +height
    expect(dragOutwardPx('zwidth', 3, 18)).toBe(18) // down is +depth
  })

  it('scaleFromDrag adds delta/baseHalfPx to the start scale (edge tracks the cursor)', () => {
    // baseHalfPx = 40 px == one scale-unit of half-width. Dragging +40px doubles scaleX.
    expect(scaleFromDrag(40, 1, 40, { min: 0.25, max: 5 })).toBeCloseTo(2)
    expect(scaleFromDrag(40, 1, -20, { min: 0.25, max: 5 })).toBeCloseTo(0.5)
  })

  it('scaleFromDrag clamps to the slider range', () => {
    expect(scaleFromDrag(40, 1, 1000, { min: 0.25, max: 5 })).toBe(5)
    expect(scaleFromDrag(40, 1, -1000, { min: 0.25, max: 5 })).toBe(0.25)
  })

  it('combined: a width-handle drag on a real silhouette bbox yields the expected scaleX (edge tracks cursor)', () => {
    // Mirrors the runtime wiring in templates.tsx: baseHalfWpx = (bbox.width / 2) / startScaleX.
    const dragWidthTo = (poly: typeof RECT, startScaleX: number, dxPx: number) => {
      const b = polyBBox(poly)
      const baseHalfWpx = (b.width / 2) / startScaleX
      const outward = dragOutwardPx('width', dxPx, 0)
      return scaleFromDrag(baseHalfWpx, startScaleX, outward, { min: 0.25, max: 5 })
    }
    // RECT is 100px wide at scaleX=1 → baseHalfWpx=50 → dragging the right edge +50px doubles it.
    expect(dragWidthTo(RECT, 1, 50)).toBeCloseTo(2)
    // Already 2× with a 200px silhouette → half-width 100px, baseHalfWpx=50 → +50px pushes the edge to
    // 150px = scaleX 3 (the edge tracks the cursor 1:1).
    const wide = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 80 }, { x: 0, y: 80 }]
    expect(dragWidthTo(wide, 2, 50)).toBeCloseTo(3)
    // A 400px silhouette at 2× → baseHalfWpx=100 → +50px adds exactly 0.5.
    const wider = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 80 }, { x: 0, y: 80 }]
    expect(dragWidthTo(wider, 2, 50)).toBeCloseTo(2.5)
  })

  it('depthFromDrag steps in whole cells and clamps to [1,8]', () => {
    expect(depthFromDrag(30, 1, 60, { min: 1, max: 8 })).toBe(3) // +2 cells
    expect(depthFromDrag(30, 3, -45, { min: 1, max: 8 })).toBe(2) // Math.round(-1.5) = -1 → 3-1 = 2
    expect(depthFromDrag(30, 1, -100, { min: 1, max: 8 })).toBe(1) // clamped
    expect(depthFromDrag(30, 8, 100, { min: 1, max: 8 })).toBe(8) // clamped
  })
})

describe('tileHandles — drawing (real canvas)', () => {
  it('paints a visible marker at each handle point', () => {
    const canvas = createCanvas(200, 160)
    const ctx = canvas.getContext('2d')
    const handles = tileHandlePoints(RECT, { zWidth: true })
    drawTileHandles(ctx as unknown as CanvasRenderingContext2D, handles)
    const px = (x: number, y: number) => {
      const d = ctx.getImageData(x, y, 1, 1).data
      return d[3] // alpha
    }
    // Each handle point should have opaque paint on it.
    for (const h of handles) expect(px(h.x, h.y)).toBeGreaterThan(0)
    // A point far from any handle stays blank.
    expect(px(10, 150)).toBe(0)
  })
})
