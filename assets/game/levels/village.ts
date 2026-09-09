/**
 * THE GRID DEFAULTS a new/loaded map starts from — its size, its cell size and the iso scale, plus the
 * default spawn cell. This is the last of the old hand-built "village level" file: the 165-line
 * `createVillageLevel` that hand-placed a fixed map's every tile had no callers and is gone (the real
 * generator makes maps now).
 *
 * NOTE (T-120): these numbers are generator INPUT and belong in the backend generator record —
 * Alexander: *"we should generate the maps based of the specified grid settings, IE: cell size, rows x col"*.
 */
export const VILLAGE_CONFIG = {
  cols: 50,
  rows: 50,
  cellSize: 16,
  isoScale: 2.5,  // Larger scale for smaller cells
  spawnCol: 35,
  spawnRow: 22,
}
