/**
 * MULTI-CELL ASCII ASSETS — the "real tileset" model.
 *
 * An asset is a grid of characters (`rows`). When stamped, EACH non-space character
 * occupies ONE grid cell, so a house spans many cells (its footprint). This is how a
 * tileset works: a defined character set composes large, multi-cell structures.
 *
 *   - a non-space char  → drawn in its cell AND blocks collision (a wall, roof, trunk)
 *   - a space ' '       → transparent: that cell is left untouched
 *   - a char in `walkable` (e.g. a door 'D', a path '.') → drawn but does NOT block
 */

export interface MultiCellAsset {
  id: string
  name: string
  category: string
  /** ASCII art — one character per grid cell. Rows top→bottom, cols left→right. */
  rows: string[]
  color?: string
  /** Characters that draw but stay walkable (doors, paths, water you can wade…). */
  walkable?: string[]
}

/** Footprint in CELLS: width = longest row, height = row count. */
export function assetFootprint(asset: MultiCellAsset): { w: number; h: number } {
  return {
    w: asset.rows.reduce((m, r) => Math.max(m, r.length), 0),
    h: asset.rows.length,
  }
}

/** The minimal grid surface stampAsset writes to (IsometricGrid satisfies this). */
export interface StampTarget {
  cols: number
  rows: number
  placeAsset(
    art: string[],
    col: number,
    row: number,
    options?: { type?: string; blocking?: boolean; color?: string; label?: string },
  ): void
}

/**
 * Stamp a multi-cell asset onto the grid with its TOP-LEFT at (anchorCol, anchorRow).
 * Each non-space char becomes a single-cell asset at (anchorCol+c, anchorRow+r);
 * spaces and out-of-bounds cells are skipped. Non-space chars block unless listed in
 * `asset.walkable`.
 */
export function stampAsset(
  grid: StampTarget,
  asset: MultiCellAsset,
  anchorCol: number,
  anchorRow: number,
): void {
  const walkable = new Set(asset.walkable ?? [])
  for (let r = 0; r < asset.rows.length; r++) {
    const line = asset.rows[r]
    for (let c = 0; c < line.length; c++) {
      const ch = line[c]
      if (ch === ' ') continue // transparent cell
      const col = anchorCol + c
      const row = anchorRow + r
      if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) continue
      grid.placeAsset([ch], col, row, {
        type: 'structure',
        blocking: !walkable.has(ch),
        color: asset.color,
        label: asset.id,
      })
    }
  }
}

// ── The library — original, recognizable multi-cell ASCII structures ────────────
// (Each char = one cell. 'D' = door, '.' = path — both walkable.)

export const MULTI_CELL_ASSETS: MultiCellAsset[] = [
  {
    id: 'house_small',
    name: 'Small House',
    category: 'buildings',
    color: '#c8a06a',
    walkable: ['D'],
    rows: [
      ' ____ ',
      '/____\\',
      '|+||+|',
      '|+||+|',
      '|_|D|_|'.slice(0, 6),
    ],
  },
  {
    id: 'house_large',
    name: 'Large House',
    category: 'buildings',
    color: '#caa46e',
    walkable: ['D'],
    rows: [
      '  ______  ',
      ' /______\\ ',
      '/________\\',
      '|+|+||+|+|',
      '|+|+||+|+|',
      '|_|_|D|_|_',
      '|___|D|___',
    ],
  },
  {
    id: 'hut',
    name: 'Hut',
    category: 'buildings',
    color: '#b58a52',
    walkable: ['D'],
    rows: [
      ' /^\\ ',
      '/___\\',
      '| D |',
      '|_D_|',
    ],
  },
  {
    id: 'watchtower',
    name: 'Watchtower',
    category: 'buildings',
    color: '#9aa0a8',
    walkable: ['D'],
    rows: [
      '|^|^|',
      '|___|',
      '| + |',
      '| | |',
      '| + |',
      '| | |',
      '|_D_|',
      '|_D_|',
    ],
  },
  {
    id: 'wall_segment',
    name: 'Wall',
    category: 'buildings',
    color: '#8b8b8b',
    rows: [
      '^^^^^^',
      '||||||',
    ],
  },
  {
    id: 'gate',
    name: 'Gate',
    category: 'buildings',
    color: '#8b8b8b',
    walkable: ['D'],
    rows: [
      '^|^^|^',
      '|DDDD|',
      '|DDDD|',
    ],
  },
  {
    id: 'well',
    name: 'Well',
    category: 'props',
    color: '#9bc4d8',
    rows: [
      '/^^\\',
      '|~~|',
      '|~~|',
      '\\__/',
    ],
  },
  {
    id: 'fountain',
    name: 'Fountain',
    category: 'props',
    color: '#9bc4d8',
    rows: [
      ' .^. ',
      '(~~~)',
      '\\~~~/',
      ' \\_/ ',
    ],
  },
  {
    id: 'statue',
    name: 'Statue',
    category: 'props',
    color: '#cfcabf',
    rows: [
      ' O ',
      '/|\\',
      ' | ',
      '[_]',
      '[_]',
    ],
  },
  {
    id: 'big_tree',
    name: 'Great Tree',
    category: 'nature',
    color: '#3fa63f',
    rows: [
      ' /^^^\\ ',
      '/#####\\',
      '\\#####/',
      ' \\###/ ',
      '   |   ',
      '  /|\\  ',
    ],
  },
  {
    id: 'big_rock',
    name: 'Boulder',
    category: 'nature',
    color: '#8a8a8a',
    rows: [
      ' /▓▓\\ ',
      '/▓▓▓▓\\',
      '\\▓▓▓▓/',
    ],
  },
]

/** Look up a multi-cell asset by id. */
export function multiCellAssetById(id: string): MultiCellAsset | undefined {
  return MULTI_CELL_ASSETS.find(a => a.id === id)
}
