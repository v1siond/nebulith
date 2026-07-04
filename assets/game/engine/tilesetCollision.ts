import type { IsometricGrid } from './IsometricGrid'

/**
 * Sync multi-cell PROP collision to the active tileset.
 *
 * Some props are ONE tile in emoji but a multi-cell structure in ASCII. The clearest is the town-square
 * fountain: a big `footprint × footprint` basin in ASCII (a wide basin + tiered column), but a single
 * ⛲ tile in emoji. `generateStage` bakes the ASCII (multi-cell) collision into the grid; nothing else
 * recomputes it. So in emoji the fountain draws as one cell yet keeps its whole ASCII basin blocked —
 * the "collision from the ascii side, not the emoji real tile" bug.
 *
 * This makes collision follow the tileset: in emoji a fountain blocks only the single cell it draws; in
 * ASCII it blocks the full basin. Idempotent — safe to call on generate AND on every Style switch. Only
 * touches the fountain's own basin cells, so it never disturbs buildings / terrain / other props.
 */
export function syncTilesetPropCollision(grid: IsometricGrid, emoji: boolean): void {
  for (const a of grid.assets) {
    if (a.type !== 'fountain' || !a.footprint || a.footprint <= 1) continue
    const f = a.footprint
    const c0 = a.col - Math.floor(f / 2) // basin top-left (the prop sits at the basin centre)
    const r0 = a.row - Math.floor(f / 2)
    for (let r = r0; r < r0 + f; r++) {
      for (let c = c0; c < c0 + f; c++) {
        // emoji → only the fountain's own (centre) cell blocks; ASCII → the whole basin blocks.
        grid.setCollision(c, r, emoji ? c === a.col && r === a.row : true)
      }
    }
  }
}
