/**
 * DEAD cell-anim PRESET CARD removed from the CELL inspector.
 *
 * The right-sidebar "ANIMATION" card (preset buttons Wind sway / Flower sway / Lamp flicker /
 * Bush rustle + Preview / Apply) was a dead authoring path — it wrote asset.cellAnim via the old
 * frame-preset flow and was superseded by the real per-asset TileAnimationEditor modal. It's gone.
 *
 * These tests lock the removal two ways:
 *   1. STRUCTURE — the real animation entry (the "Animate tile" button that opens TileAnimationEditor)
 *      still renders on an asset tile, and the dead preset controls never render in the inspector.
 *   2. SOURCE GUARD — the page source no longer carries the preset card markup or its exclusive wiring,
 *      while the TileAnimationEditor modal wiring is untouched. (The card lived inline in the page, so a
 *      source assertion is the honest regression guard against it being re-added as a sibling.)
 */
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { render, screen, fireEvent } from '@testing-library/react'
import { PropertiesPanel, type TileControlModel } from '@/components/game/editorChrome'

const TEMPLATES_SRC = resolve(__dirname, '../../pages/personal-projects/game-engine/templates.tsx')
const PRESET_NAMES = ['Wind sway', 'Flower sway', 'Lamp flicker', 'Bush rustle'] as const

/** A minimal asset-tile model (level 1) that exposes the real TileAnimationEditor entry point. */
function assetTile(overrides: Partial<TileControlModel> = {}): TileControlModel {
  return {
    key: 'tile-0',
    label: 'lamp',
    dims: { width: 1, height: 1, depth: 1, zoom: 1 },
    color: null,
    colorFallback: '#8a8a8a',
    onDim: jest.fn(),
    onColor: jest.fn(),
    onClearColor: jest.fn(),
    override: null,
    styleName: 'Emoji',
    onOpenLibrary: jest.fn(),
    pose: { dx: 0, dy: 0, rot: 0 },
    onPose: jest.fn(),
    onPoseReset: jest.fn(),
    ...overrides,
  }
}

describe('Cell inspector — the real TileAnimationEditor entry survives', () => {
  it('an asset tile still shows the "Animate…" entry and it fires onOpenAnimator', () => {
    const onOpenAnimator = jest.fn()
    render(
      <PropertiesPanel
        collision={true}
        onCollision={jest.fn()}
        tile={assetTile({ onOpenAnimator, animations: [] })}
        level={2}
        levelCount={2}
        onLevel={jest.fn()}
      />,
    )
    const animate = screen.getByRole('button', { name: /Animate tile/i })
    expect(animate).toBeInTheDocument()
    fireEvent.click(animate)
    expect(onOpenAnimator).toHaveBeenCalledTimes(1)
  })

  it('a floor tile (no onOpenAnimator) shows no animation entry at all', () => {
    render(
      <PropertiesPanel
        collision={false}
        onCollision={jest.fn()}
        tile={assetTile({ key: 'floor', label: 'grass', onOpenAnimator: undefined })}
        level={1}
        levelCount={1}
        onLevel={jest.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: /Animate tile/i })).toBeNull()
  })
})

describe('Cell inspector — the dead cell-anim PRESET card is gone', () => {
  it('the inspector never renders the preset buttons or Preview/Apply', () => {
    render(
      <PropertiesPanel
        collision={true}
        onCollision={jest.fn()}
        tile={assetTile({ onOpenAnimator: jest.fn(), animations: [] })}
        level={2}
        levelCount={2}
        onLevel={jest.fn()}
      />,
    )
    for (const name of PRESET_NAMES) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
    // the dead card's action buttons — "Preview"/"Apply" belonged only to that preset card.
    expect(screen.queryByRole('button', { name: 'Preview' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull()
  })
})

describe('templates page source — preset card + exclusive wiring removed', () => {
  const src = readFileSync(TEMPLATES_SRC, 'utf8')

  it('drops the preset card markup and its exclusive handlers/state', () => {
    // the card itself
    expect(src).not.toContain('title="Animation"')
    expect(src).not.toContain('sectionId="animation"')
    // exclusive wiring that only the card used
    expect(src).not.toMatch(/\bCELL_ANIM_PRESETS\b/)
    expect(src).not.toMatch(/\battachAuthorAnim\b/)
    expect(src).not.toMatch(/\bloadAuthorPreset\b/)
    expect(src).not.toMatch(/\bauthorFrames\b/)
    expect(src).not.toMatch(/\bauthorStatus\b/)
    expect(src).not.toMatch(/\banimReady\b/)
    // the now-unused engine import line is gone (authoring helpers no longer pulled into the page)
    expect(src).not.toContain("from '@/engine/cellAnimation'")
  })

  it('leaves the real TileAnimationEditor modal wiring intact', () => {
    expect(src).toContain('TileAnimationEditor')
    expect(src).toContain('tileAnimatorOpen')
    expect(src).toContain('setAssetAnimations')
  })
})
