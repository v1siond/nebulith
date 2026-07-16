/**
 * The building TYPE vocabulary — the small, dependency-free enum shared by generation, the editor
 * and the composition helpers. A building is NOT a procedural unit: a pre-built building is a backend
 * composition TEMPLATE (see game/runtime/buildingComposition.ts) stamped as per-cell tiles, the SAME
 * path trees use. This module is just the name set, kept separate so nothing has to import a heavy
 * generator to name a type.
 */
export type BuildingType =
  | 'house'
  | 'big-house'
  | 'store'
  | 'office'
  | 'hospital'
  | 'cathedral'
  | 'temple'
  | 'castle'
