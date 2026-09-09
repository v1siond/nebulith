/**
 * ◈ Unit top-nav — the ENEMY / CREATURE picker (Alexander: "I don't see the enemy tiles in the unit top nav
 * option, how can I decide which enemies to add now? … move the enemy painting to the unit top nav and edit
 * the functionality either randomize the enemies (scatter them) or add/remove them normally like we'd do when
 * painting" + "add the unit static or with a randomized animation").
 *
 * These lock the restored flow two ways:
 *   1. STRUCTURE — the UnitPicker component lists the `units` tiles so you can SEE + pick a creature, exposes
 *      the Add / Scatter modes and the Static / Animated motion toggle, and fires the right callbacks.
 *   2. SOURCE GUARD — the page wires the picker into the top-nav Unit dropdown, and the three removals
 *      (Paint Height/Opacity/Clear, the Inspector STYLE card, the tutorial prose) stay removed.
 */
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { render, screen, fireEvent } from '@testing-library/react'
import { UnitPicker, UnitPlacementBody } from '@/components/game/editorChrome'
import type { TileDef } from '@/game/artStyle'

const TEMPLATES_SRC = resolve(__dirname, '../../pages/personal-projects/game-engine/templates.tsx')

/** A minimal units-category TileDef (a glyph creature) — the shape the picker renders. */
function unit(id: string, label: string, char: string): TileDef {
  return { id, label, category: 'units', styleId: 'emoji', visual: { kind: 'glyph', char } }
}
const GOBLIN = unit('emoji:goblin', 'Goblin', '👺')
const WOLF = unit('emoji:wolf', 'Wolf', '🐺')

function renderPicker(overrides: Partial<React.ComponentProps<typeof UnitPicker>> = {}) {
  const props: React.ComponentProps<typeof UnitPicker> = {
    units: [GOBLIN, WOLF],
    pickedId: null,
    onPick: jest.fn(),
    mode: 'add',
    onMode: jest.fn(),
    animated: false,
    onAnimated: jest.fn(),
    onScatter: jest.fn(),
    ...overrides,
  }
  return { props, ...render(<UnitPicker {...props} />) }
}

describe('◈ Unit top-nav — the creature picker', () => {
  it('lists the units-category tiles so you can SEE which enemy/creature to add', () => {
    renderPicker()
    expect(screen.getByTitle('Goblin')).toBeInTheDocument()
    expect(screen.getByTitle('Wolf')).toBeInTheDocument()
  })

  it('picking a tile fires onPick with that tile', () => {
    const onPick = jest.fn()
    renderPicker({ onPick })
    fireEvent.click(screen.getByTitle('Goblin'))
    expect(onPick).toHaveBeenCalledWith(GOBLIN)
  })

  it('re-picking the armed tile disarms (onPick(null))', () => {
    const onPick = jest.fn()
    renderPicker({ pickedId: GOBLIN.id, onPick })
    const btn = screen.getByTitle('Goblin')
    expect(btn).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(btn)
    expect(onPick).toHaveBeenCalledWith(null)
  })

  it('sends you to the Behaviour panel, and says what it is set to without opening it', () => {
    const onOpenPlacement = jest.fn()
    renderPicker({ onOpenPlacement, placeAs: 'enemy', animated: true })
    const btn = screen.getByRole('button', { name: /Behaviour/i })
    expect(btn).toHaveTextContent('Unfriendly · Patrols') // readable at a glance, unopened
    fireEvent.click(btn)
    expect(onOpenPlacement).toHaveBeenCalledTimes(1)
  })

  it('with no units it degrades gracefully (no crash, a hint instead of a grid)', () => {
    renderPicker({ units: [] })
    expect(screen.getByText(/No characters in this style yet/i)).toBeInTheDocument()
  })
})

// The three placement decisions moved OUT of the picker into their own movable panel — Alexander,
// 2026-09-09: *"that's why I requested explicitly to consider movable modals, because I knew this was gonna
// be a problem."* Stacked under the grid they crushed the swatches into one clipped row. They were relabelled
// in the same pass (*"'how it will be placed' is not clear at all"*, *"we need clear concise labeling that
// clearly points at the action/feature"*), so both the HOME and the WORDS below are the current ones.
describe('◈ How a character lands — the behaviour panel', () => {
  const renderPlacement = (overrides: Partial<React.ComponentProps<typeof UnitPlacementBody>> = {}) => {
    const props: React.ComponentProps<typeof UnitPlacementBody> = {
      mode: 'add',
      onMode: jest.fn(),
      animated: false,
      onAnimated: jest.fn(),
      onScatter: jest.fn(),
      placeAs: 'auto',
      onPlaceAs: jest.fn(),
      ...overrides,
    }
    return { props, ...render(<UnitPlacementBody {...props} />) }
  }

  it('offers one-at-a-time vs sprinkle, and switches between them', () => {
    const onMode = jest.fn()
    renderPlacement({ onMode })
    expect(screen.getByRole('button', { name: /One at a time/i })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: /Sprinkle several/i }))
    expect(onMode).toHaveBeenCalledWith('scatter')
  })

  it('one-at-a-time offers the motion choice — stands still vs patrols', () => {
    const onAnimated = jest.fn()
    renderPlacement({ mode: 'add', onAnimated })
    expect(screen.getByRole('button', { name: /Stands still/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Patrols nearby/i }))
    expect(onAnimated).toHaveBeenCalledWith(true)
  })

  it('sprinkling runs onScatter, names what it will sprinkle, and hides the motion choice', () => {
    const onScatter = jest.fn()
    renderPlacement({ mode: 'scatter', pickedLabel: 'Goblin', onScatter })
    // motion only bites one-at-a-time — a sprinkle always attaches a patrol
    expect(screen.queryByRole('button', { name: /Stands still/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Sprinkle Goblin/i }))
    expect(onScatter).toHaveBeenCalledTimes(1)
  })

  it('whose side is two answers, not three — neither pressed means the creature decides', () => {
    // Alexander, 2026-09-08: *"I don't think auto should be an option in the character, it's either friendly
    // or unfriendly as simple as that."* So `auto` survives as the DEFAULT, never as a third button.
    const onPlaceAs = jest.fn()
    renderPlacement({ placeAs: 'auto', onPlaceAs })
    expect(screen.getByRole('button', { name: /^Friendly$/i })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: /^Unfriendly$/i })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('button', { name: /^Auto$/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^Friendly$/i }))
    expect(onPlaceAs).toHaveBeenCalledWith('npc')
  })
})

describe('templates page source — the picker is wired into the top-nav Unit dropdown', () => {
  const src = readFileSync(TEMPLATES_SRC, 'utf8')

  it('renders UnitPicker with the add/scatter + static/animated plumbing', () => {
    expect(src).toContain('UnitPicker')
    expect(src).toContain('pickUnitTile')
    expect(src).toContain('scatterUnits')
    expect(src).toContain('unitPlaceMode')
    expect(src).toContain('unitAnimated')
    // the picker reads the `units` category (placeable figures) from the live tileset
    expect(src).toMatch(/tilesForStyle\(activeStyleId\)\.units/)
    // the old free-text "Enemy type" field + its state are gone (replaced by the visual picker)
    expect(src).not.toContain('Enemy type')
    expect(src).not.toMatch(/\bsetEnemyType\b/)
  })
})

describe('templates page source — Paint sidebar drops Height / Opacity / Clear (they live in the Inspector)', () => {
  const src = readFileSync(TEMPLATES_SRC, 'utf8')

  it('removes the paint-side height stepper, opacity slider and clear-selected button + their handlers', () => {
    expect(src).not.toContain('Tile placement opacity')
    expect(src).not.toContain('Clear selected cells')
    expect(src).not.toMatch(/\bplaceHeight\b/)
    expect(src).not.toMatch(/\bclearSelectedCells\b/)
    expect(src).not.toMatch(/\bplaceOpacity\b/)
    expect(src).not.toMatch(/\bheightEditMode\b/)
    // the paint palette itself stays (pick a tile + place it)
    expect(src).toContain('<TilePalette')
  })
})

describe('templates page source — the redundant STYLE card is gone from the Inspector', () => {
  const src = readFileSync(TEMPLATES_SRC, 'utf8')

  it('the nothing-selected Inspector no longer renders a Style card (style lives in the top-nav)', () => {
    expect(src).not.toContain('title="Style"')
    // the top-nav 🎨 Style dropdown still owns the picker
    expect(src).toContain('🎨 Style')
  })
})

describe('templates page source — tutorial prose stripped from the cards', () => {
  const src = readFileSync(TEMPLATES_SRC, 'utf8')

  it('drops the how-to guide + the Paint/Buildings instructional paragraphs', () => {
    expect(src).not.toContain('How to build a house')
    expect(src).not.toContain('build-house-guide')
    expect(src).not.toContain('Pick a building and click the map to STAMP')
    expect(src).not.toContain('A building is just its cells')
    expect(src).not.toContain('Pick a tile below, then LEFT-click')
  })
})
