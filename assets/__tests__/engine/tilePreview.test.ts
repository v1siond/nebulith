/**
 * TILE PREVIEW — behaviour tests.
 *
 * These exist because the previews state FACTS to the user ("12 levels high", "you can walk on 2 cells"),
 * and a fact that is quietly wrong is worse than no fact. Two of them were wrong in the design mockup
 * before these rules were pinned down:
 *
 *  1. the height was measured over the FRONT ROW only, so a castle with a taller back reported 9 levels
 *     when it is 12;
 *  2. fixing that broke the drawing, because one number was answering both "how tall is it" and "how many
 *     rows must I draw".
 *
 * So the suite asserts those are different numbers, and that a missing label yields nothing rather than a
 * stand-in.
 */
import { setStyleCatalog, type StyleCatalog, type StyleTile } from '@/engine/tileset/styleTiles'
import {
  browseableCompositions,
  compositionPreview,
  tileFacts,
  tileFrames,
} from '@/engine/tilePreview'
import type { Composition, CompositionCell } from '@/engine/tileset/tileset'

const STYLE = 'test-style'

function tile(label: string, over: Partial<StyleTile> = {}): StyleTile {
  return { label, char: '?', walkable: true, image: `/tiles/${STYLE}/${label}.png`, ...over }
}

function cell(dx: number, dy: number, over: Partial<CompositionCell> = {}): CompositionCell {
  return { dx, dy, label: 'wall', ...over }
}

function install(tiles: StyleTile[], compositions: Record<string, Composition> = {}): void {
  const catalog: StyleCatalog = {
    id: STYLE,
    name: 'Test',
    tiles: Object.fromEntries(tiles.map((t) => [t.label, t])),
    compositions,
    terrain: {},
  }
  setStyleCatalog(catalog)
}

describe('tileFrames', () => {
  it('returns every served animation frame in order', () => {
    install([tile('bear', { settings: { frames: ['/a.png', '/b.png'], frameMs: 900 } })])
    expect(tileFrames(STYLE, 'bear')).toEqual(['/a.png', '/b.png'])
  })

  it('treats a still tile as a single frame of its own picture', () => {
    install([tile('grass')])
    expect(tileFrames(STYLE, 'grass')).toEqual([`/tiles/${STYLE}/grass.png`])
  })

  it('returns nothing for a label this style does not have — never another label’s art', () => {
    install([tile('grass')])
    expect(tileFrames(STYLE, 'dragon')).toEqual([])
  })

  it('returns nothing when the tile has no picture at all, rather than inventing one', () => {
    install([tile('ghost', { image: undefined })])
    expect(tileFrames(STYLE, 'ghost')).toEqual([])
  })

  it('ignores a malformed frames blob instead of trusting it', () => {
    install([tile('bad', { settings: { frames: 'not-an-array' } })])
    expect(tileFrames(STYLE, 'bad')).toEqual([`/tiles/${STYLE}/bad.png`])
  })
})

describe('tileFacts', () => {
  it('reads the facts the library states, and derives none of them', () => {
    install([
      tile('wall_brick_c', {
        title: 'Brick Wall',
        category: 'walls',
        walkable: false,
        height: 1,
        settings: { scaleY: 4, actAsTile: false },
      }),
    ])
    const facts = tileFacts(STYLE, 'wall_brick_c')
    expect(facts).toMatchObject({
      name: 'Brick Wall',
      category: 'walls',
      blocks: true,
      height: 1,
      scaleY: 4,
      stacks: false,
    })
  })

  it('counts the rows of characters an ascii figure was baked from', () => {
    install([
      tile('bear', {
        settings: {
          artFrames: [
            ['(\\_/)', '( O.O )', '(#####)', ' J   L'],
            ['(\\_/)', '( -.- )', '(#####)', ' L   J'],
          ],
          frameMs: 900,
        },
      }),
    ])
    expect(tileFacts(STYLE, 'bear')?.artRows).toBe(4)
  })

  it('reports zero art rows for a tile that was not baked from characters', () => {
    install([tile('grass')])
    expect(tileFacts(STYLE, 'grass')?.artRows).toBe(0)
  })

  it('marks a walk-over tile as stacking', () => {
    install([tile('road', { settings: { actAsTile: true } })])
    expect(tileFacts(STYLE, 'road')?.stacks).toBe(true)
  })

  it('falls back to the label for the NAME only, and never for the art', () => {
    install([tile('odd_label', { title: undefined })])
    const facts = tileFacts(STYLE, 'odd_label')
    expect(facts?.name).toBe('odd_label')
    expect(facts?.image).toBe(`/tiles/${STYLE}/odd_label.png`)
  })

  it('returns undefined for an unknown label so the caller can show the hole', () => {
    install([tile('grass')])
    expect(tileFacts(STYLE, 'nope')).toBeUndefined()
  })
})

describe('compositionPreview', () => {
  /**
   * A 2-wide house whose BACK wall is taller than its front. The front row is the visible one, so the
   * elevation draws 2 levels — but the thing is 5 levels tall, and that is what the user is told.
   */
  const unevenHouse: Composition = {
    footprint: { w: 2, h: 2 },
    title: 'Uneven House',
    category: 'buildings',
    cells: [
      cell(0, 1, { level: 0, settings: { scaleY: 2 } }), // front-left, 2 high
      cell(1, 1, { level: 0, settings: { scaleY: 2 } }), // front-right, 2 high
      cell(0, 0, { level: 0, settings: { scaleY: 5 } }), // BACK-left, 5 high
      cell(1, 0, { level: 0, settings: { scaleY: 5 } }), // BACK-right, 5 high
    ],
  }

  it('states the height over EVERY cell, not just the row it can draw', () => {
    install([tile('wall')], { uneven: unevenHouse })
    const preview = compositionPreview(STYLE, 'uneven')
    expect(preview?.levels).toBe(5)
  })

  it('draws only the rows the front elevation actually occupies', () => {
    install([tile('wall')], { uneven: unevenHouse })
    const preview = compositionPreview(STYLE, 'uneven')
    expect(preview?.drawnLevels).toBe(2)
  })

  it('keeps the stated height and the drawn rows as separate numbers', () => {
    install([tile('wall')], { uneven: unevenHouse })
    const preview = compositionPreview(STYLE, 'uneven')
    expect(preview?.levels).not.toBe(preview?.drawnLevels)
  })

  it('spans one authored tile up scaleY levels in the elevation', () => {
    install([tile('wall')], { uneven: unevenHouse })
    const column0 = compositionPreview(STYLE, 'uneven')?.elevation.filter((e) => e.col === 0)
    expect(column0?.map((e) => e.level).sort()).toEqual([0, 1])
  })

  it('reads the footprint from the composition rather than deriving it from the cells', () => {
    install([tile('wall')], {
      sparse: { footprint: { w: 9, h: 4 }, cells: [cell(0, 0)] },
    })
    const preview = compositionPreview(STYLE, 'sparse')
    expect(preview?.width).toBe(9)
    expect(preview?.depth).toBe(4)
  })

  it('marks a square walkable only when every tile stacked on it is walkable', () => {
    install([tile('wall')], {
      door: {
        footprint: { w: 2, h: 1 },
        cells: [
          cell(0, 0, { walkable: true }), // an open doorway
          cell(1, 0, { walkable: true }), // walkable…
          cell(1, 0, { walkable: false, level: 1 }), // …until something solid is stacked on it
        ],
      },
    })
    const plan = compositionPreview(STYLE, 'door')?.plan
    expect(plan?.find((c) => c.dx === 0)?.walkable).toBe(true)
    expect(plan?.find((c) => c.dx === 1)?.walkable).toBe(false)
  })

  it('counts the walkable squares — the door a player enters through', () => {
    install([tile('wall')], {
      hut: {
        footprint: { w: 3, h: 1 },
        cells: [cell(0, 0), cell(1, 0, { walkable: true }), cell(2, 0)],
      },
    })
    expect(compositionPreview(STYLE, 'hut')?.walkableCount).toBe(1)
  })

  it('counts every placed cell, including ones stacked on the same square', () => {
    install([tile('wall')], {
      tower: { footprint: { w: 1, h: 1 }, cells: [cell(0, 0), cell(0, 0, { level: 1 }), cell(0, 0, { level: 2 })] },
    })
    expect(compositionPreview(STYLE, 'tower')?.cellCount).toBe(3)
  })

  it('names an untitled composition from its slug', () => {
    install([tile('wall')], { tree_big: { footprint: { w: 1, h: 1 }, cells: [cell(0, 0)] } })
    expect(compositionPreview(STYLE, 'tree_big')?.name).toBe('Tree big')
  })

  it('returns undefined for an unknown object', () => {
    install([tile('wall')], {})
    expect(compositionPreview(STYLE, 'castle')).toBeUndefined()
  })

  it('returns undefined for a composition with no cells rather than an empty picture', () => {
    install([tile('wall')], { empty: { footprint: { w: 1, h: 1 }, cells: [] } })
    expect(compositionPreview(STYLE, 'empty')).toBeUndefined()
  })

  it('treats a nonsensical scaleY as a single level instead of trusting it', () => {
    install([tile('wall')], {
      broken: { footprint: { w: 1, h: 1 }, cells: [cell(0, 0, { settings: { scaleY: 0 } })] },
    })
    expect(compositionPreview(STYLE, 'broken')?.levels).toBe(1)
  })
})

describe('browseableCompositions', () => {
  it('lists every object in the style, sorted by name', () => {
    install([tile('wall')], {
      well: { footprint: { w: 1, h: 1 }, title: 'Well', cells: [cell(0, 0)] },
      bush: { footprint: { w: 1, h: 1 }, title: 'Bush', cells: [cell(0, 0)] },
    })
    expect(browseableCompositions(STYLE).map((c) => c.name)).toEqual(['Bush', 'Well'])
  })

  it('is empty for a style that has not loaded, rather than borrowing another style’s objects', () => {
    install([tile('wall')], { well: { footprint: { w: 1, h: 1 }, cells: [cell(0, 0)] } })
    expect(browseableCompositions('never-loaded')).toEqual([])
  })

  it('drops an object with no cells instead of listing an unpreviewable entry', () => {
    install([tile('wall')], {
      good: { footprint: { w: 1, h: 1 }, title: 'Good', cells: [cell(0, 0)] },
      hollow: { footprint: { w: 1, h: 1 }, title: 'Hollow', cells: [] },
    })
    expect(browseableCompositions(STYLE).map((c) => c.name)).toEqual(['Good'])
  })
})
