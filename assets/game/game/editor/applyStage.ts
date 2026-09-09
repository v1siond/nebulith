/**
 * STAGE DATA → A GRID. The one place a generated stage becomes real tiles.
 *
 * Lifted out of the editor page, unchanged. It was always a pure function of its arguments — no state, no
 * refs — but living inside the component made it unreachable, and that was the blocker on preset
 * thumbnails: a thumbnail has to generate a stage and put it in a scratch grid, which is exactly this.
 *
 * Alexander asked for preset thumbnails on 2026-09-08 (*"yes we want this feature"*); this is the seam that
 * unblocks them. Nothing about the behaviour changes — the editor calls the same code it always did.
 */
import { cellStackTop } from '@/engine/cellStack'
import { type IsometricGrid } from '@/engine/IsometricGrid'
import { generatedPropRender, stagePaint, type StageData } from '@/engine/stageGenerator'
import { stagePropTileOverride } from '@/engine/zones'
import { placeGround } from '@/game/editor/tileBrush'
import { stampBuildingKind, stampComposition } from '@/game/runtime/composition'
import { type GeneratorBuildings } from '@/lib/generatorCatalog'

export function applyStageToGrid(stage: StageData, grid: IsometricGrid, buildingSalt = 0, palette?: GeneratorBuildings): void {
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      // The generator OWNS the ground colour: it writes each floor tile's colour as STATE (picked from the
      // ground tile's DB colour via groundTileColor), so every view READS floor.color and nothing is derived
      // or hardcoded at render. A cell the generator left blank gets NO floor (empty) — never an 'ash' fallback.
      const kind = stage.ground[r]?.[c]
      if (kind) {
        // The generator may write a per-cell floor COLOUR as STATE (the meadow season gradient +
        // earth/cobble/river patches — stageGenerator.floorColors). When present, set the floor with THAT
        // colour; otherwise placeGround auto-picks the ground tile's own DB colour. Either way the render
        // just READS floor.color (MAP-MODEL §4 — no render-time colour derivation).
        const floorColor = stage.floorColors?.[r]?.[c]
        if (floorColor) grid.setGround(c, r, kind, floorColor)
        else placeGround(grid, c, r, kind)
      }
      grid.setHeight(c, r, 0)
      grid.setCollision(c, r, !!stage.collision[r]?.[c])
    }
  }
  grid.clearAssets()
  const paint = stagePaint(stage)
  for (const g of paint.ground) {
    if (g.col >= 0 && g.col < grid.cols && g.row >= 0 && g.row < grid.rows) placeGround(grid, g.col, g.row, g.type)
  }
  // Pin each generated prop to the SAME curated catalog tile the palette brush uses, per zone + role
  // (trees, flowers, floor-litter, rocks, mushrooms) — instead of the generic per-kind styleTiles('emoji')
  // fallback — so the RANDOMIZER's assets MATCH what the palette offers. VISUAL-ONLY: the override
  // reskins the glyph; the prop's own collision/height are untouched.
  // Trade-off: trees now wear the SEASON's curated species tile (🌸 spring / 🌳 summer / 🍁 autumn /
  // 🪾 winter / 🌵 desert / 🌴 beach) rather than one 🌲 recoloured per season — so per-tree seasonal
  // TONAL variety is dropped in favour of a distinct, palette-matching species per season.
  for (const a of paint.assets) {
    const override = stagePropTileOverride(stage.zone, a.type)
    // A prop STACKS on whatever is already in the cell — the SHARED lego rule (`cellStackTop`), not a special
    // floor lift: on a flat town floor the top is 0 (byte-identical); on a height-1 meadow the top is 1 so the
    // flower billboard sits ON the meadow block instead of embedding in its green volume. "Floors are tiles,
    // all tiles stack" (Alexander) — no floorStackLift, the prop just lands on top of what's there.
    const propLift = cellStackTop(grid, a.col, a.row)
    // Per-instance render for standing props (a flower = single billboard, height 1) — the SAME override the
    // SAVE path (stageToTemplate) writes, so live + saved/loaded match. Spreads height + settings.display.
    grid.placeAsset([a.char], a.col, a.row, { type: a.type, blocking: a.blocking, color: a.color, label: a.label, baseShadow: a.baseShadow, buildingType: a.buildingType, edge: a.edge, footprint: a.footprint, cellPart: a.label, tileOverride: override, heightLevel: propLift, ...generatedPropRender(a.type) })
  }
  // Mirror the generator's authoritative collision into the grid so trees/water/
  // features are truly blocked — enemies (manual placement + scatter) only land on
  // walkable cells, and patrols collide correctly.
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      if (stage.collision[r]?.[c] !== undefined) grid.setCollision(c, r, stage.collision[r][c])
    }
  }
  // A BUILDING is just TILES: stamp each GENERATED building as its backend COMPOSITION's per-cell tiles by
  // its authoritative kind (stampBuildingKind → one asset per cell+level of house_4 / store_5 / …), rotated
  // to face its road — the SAME stamp trees use. b.col + b.row are the footprint TOP-LEFT-col and BOTTOM row,
  // so back the row off its height to anchor the composition at the footprint top-left.
  // A building uses ONE wall material — variety is BETWEEN buildings, not within one. A RESIDENTIAL building
  // (house / big-house) picks its material at generation from the GENERATOR's palette; store/hospital/office/
  // civic keep their FIXED identity material. The pick is derived from the footprint position so a re-stamp of
  // the same stage is stable (no per-frame flicker) while neighbours still differ.
  // Colour is a per-tile SETTING that FILTERS the baked tile (composition.ts / render tintedImage), so we
  // recolour buildings by their colour value — no new tiles. ROOF colour randomizes for every type EXCEPT
  // the two FIXED-identity buildings; WALL colour randomizes for RESIDENTIAL only (others keep their
  // material's own tone). store/hospital get FIXED colours so they stay identifiable. Every roll is derived
  // from the footprint position (like the material roll) so a re-stamp of the same stage is stable, while
  // neighbours differ — and roof/wall use DIFFERENT hashes so a house's roof and walls vary independently.
  const pick = (arr: readonly string[], seed: number): string | undefined =>
    arr.length === 0 ? undefined : arr[(((seed % arr.length) + arr.length) % arr.length)]
  for (const b of stage.buildings) {
    const anchorRow = b.row - (b.height - 1)
    const residential = b.type === 'house' || b.type === 'big-house'
    const material = residential && palette ? pick(palette.materials, b.col * 31 + b.row * 17 + buildingSalt) : undefined
    let roofColor: string | undefined
    let wallColor: string | undefined
    if (b.type === 'store') { roofColor = palette?.storeRoof; wallColor = palette?.fixedWall }
    else if (b.type === 'hospital') { roofColor = palette?.hospitalRoof; wallColor = palette?.fixedWall }
    else if (palette) {
      roofColor = pick(palette.roofColors, b.col * 13 + b.row * 7 + buildingSalt)
      wallColor = residential ? pick(palette.wallColors, b.col * 23 + b.row * 29 + buildingSalt) : undefined
    }
    // Stamp by the building's AUTHORITATIVE composition kind (derived from the facade length at plan time),
    // NOT re-derived from b.length: b.length is the grid COL-SPAN, which for an east/west-facing plot is the
    // DEPTH, not the facade length — deriving the kind from it asks for a non-existent composition
    // (hospital_4 / big_house_4 / temple_4) → 0 cells stamped → a foundation with NO building (Image #42).
    stampBuildingKind(grid, b.kind, b.col, anchorRow, stage.zone, b.facing, material, roofColor, wallColor)
  }
  // A TREE is just TILES too: stamp each recorded tree ANCHOR as a rich stacked composition
  // (stampComposition → one asset per cell+level of tree_small / tree_dead), the SAME per-block path
  // buildings use — so every generated tree is 100% backend DB tiles AND each tile is individually
  // selectable. The generator recorded anchors (stage.trees) instead of baking flat tree props (TreeAnchor).
  // A tree STACKS on the anchor cell's current top — the SHARED lego rule (`cellStackTop`): a raised meadow
  // floor (DB height 1) puts the trunk ON TOP of the block instead of embedding at level 0 (the exposed-trunk
  // bug), a flat town/grass floor (top 0) is byte-identical. No floorStackLift — the composition just lands on
  // what is already there, "floors are tiles, all tiles stack" (Alexander).
  for (const t of stage.trees ?? []) stampComposition(grid, t.kind, t.col, t.row, stage.zone, t.variant, 0)
  // A FOUNTAIN is just TILES too: stamp each recorded composition ANCHOR (the plaza fountain — rim +
  // water + jets) through the SAME path, so it's per-cell backend tiles, not a special drawer/prop — lifted
  // onto its floor block the same way (0 on a flat plaza, so town fountains are unchanged).
  for (const c of stage.compositions ?? []) stampComposition(grid, c.kind, c.col, c.row, stage.zone, c.variant ?? 0, 0)
  // GROUND stays PER-CELL — deliberately NOT merged into z-width runs. A merged run spans many camera depths
  // under ONE sort key, so no key can be right: sorted by its anchor its FRONT cells get wrongly occluded (a
  // grass cell "looks behind" the thing in front of it), and the front-extent patch over-corrects. Keeping each
  // ground cell its own block sorts it at its OWN camera depth — pure perspective, correct at every rotation
  // (Alexander 2026-07-27: "prioritize the CAMERA perspective OF THE ELEMENTS", no front-side priority). The
  // perf cost is small in practice (~2-4ms; measured ~11ms/frame on a town), so correctness wins. (`compressGround`
  // stays defined but uncalled — the old FPS trick, kept only for reference.)
}
