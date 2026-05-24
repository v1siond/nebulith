export interface RGBA {
  r: number
  g: number
  b: number
  a: number
}

export interface Vector2 {
  x: number
  y: number
}

export interface Rectangle {
  x: number
  y: number
  width: number
  height: number
}

export interface TileDefinition {
  char: string
  color: RGBA
  fillColor: RGBA
  isBlocking: boolean
  isAnimated: boolean
  animationType: 'move' | 'brightup' | 'move_brightup' | null
  animationInterval: number
}

export interface ComputedTile {
  char: string
  worldX: number
  worldY: number
  row: number
  col: number
  color: RGBA
  fillColor: RGBA
  isBlocking: boolean
  isAnimated: boolean
  animationType: 'move' | 'brightup' | 'move_brightup' | null
  animationInterval: number
}

export interface LevelData {
  template: string[]
  tileDefinitions: Record<string, TileDefinition>
}

export interface CameraConfig {
  viewportWidth: number
  viewportHeight: number
  smoothing: number
}

export interface EngineConfig {
  tileSize: number
  font: string
  targetFPS: number
  camera: CameraConfig
  debug: boolean
}

export const DEFAULT_CONFIG: EngineConfig = {
  tileSize: 24,
  font: 'Silkscreen',
  targetFPS: 60,
  camera: {
    viewportWidth: 800,
    viewportHeight: 600,
    smoothing: 0.1
  },
  debug: false
}
