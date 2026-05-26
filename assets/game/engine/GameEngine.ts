import { ComputedTile, RGBA, LevelData, EngineConfig, DEFAULT_CONFIG, Rectangle, TileDefinition } from './types'
import { Camera } from './Camera'
import { Player } from './Player'

export class GameEngine {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D

  private config: EngineConfig
  private tiles: ComputedTile[] = []
  private blockingTiles: ComputedTile[] = []
  private animatedTiles: ComputedTile[] = []

  private staticLayer: OffscreenCanvas | null = null
  private staticCtx: OffscreenCanvasRenderingContext2D | null = null
  private staticLayerDirty: boolean = true

  private camera: Camera
  private player: Player | null = null

  private animationStates: Map<string, { lastUpdate: number; bright: boolean }> = new Map()

  private isRunning = false
  private lastFrameTime = 0
  private frameId: number | null = null

  private worldWidth = 0
  private worldHeight = 0

  // Bound event handler for proper cleanup
  private boundResizeHandler: () => void

  constructor(canvas: HTMLCanvasElement, config: Partial<EngineConfig> = {}) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d', { alpha: false })!
    this.config = { ...DEFAULT_CONFIG, ...config }

    this.camera = new Camera(this.config.camera)

    // Bind the resize handler once for proper add/remove
    this.boundResizeHandler = this.resizeCanvas.bind(this)

    this.resizeCanvas()
    window.addEventListener('resize', this.boundResizeHandler)
  }

  private resizeCanvas() {
    this.canvas.width = window.innerWidth
    this.canvas.height = window.innerHeight
    this.camera.setViewportSize(window.innerWidth, window.innerHeight)
    this.staticLayerDirty = true
  }

  parseColor(colorStr: string): RGBA {
    const match = colorStr.match(/[\d.]+/g)
    if (!match || match.length < 3) {
      return { r: 255, g: 255, b: 255, a: 1 }
    }
    return {
      r: parseFloat(match[0]),
      g: parseFloat(match[1]),
      b: parseFloat(match[2]),
      a: match[3] ? parseFloat(match[3]) : 1
    }
  }

  rgbaToString(color: RGBA, brightness = 1): string {
    return `rgba(${Math.min(255, color.r * brightness)}, ${Math.min(255, color.g * brightness)}, ${Math.min(255, color.b * brightness)}, ${color.a})`
  }

  // Position-based background gradient (sky -> ground)
  private getBackgroundColor(row: number, totalRows: number): RGBA {
    // Sky zone (top 15%)
    if (row < totalRows * 0.15) {
      return { r: 13, g: 63, b: 88, a: 0.79 }
    }
    // Ground zone (bottom 5%)
    if (row >= totalRows * 0.95) {
      return { r: 21, g: 22, b: 72, a: 0.15 }
    }
    // Gradient zone (middle)
    const gradientStart = totalRows * 0.15
    const gradientEnd = totalRows * 0.95
    const factor = (row - gradientStart) / (gradientEnd - gradientStart)

    // Sky blue to warm brown gradient
    const sky = { r: 13, g: 63, b: 88 }
    const ground = { r: 180, g: 130, b: 70 }

    return {
      r: Math.round(sky.r + factor * (ground.r - sky.r)),
      g: Math.round(sky.g + factor * (ground.g - sky.g)),
      b: Math.round(sky.b + factor * (ground.b - sky.b)),
      a: 0.85 - (factor * 0.3)
    }
  }

  loadLevel(data: LevelData) {
    const { tileSize } = this.config
    this.tiles = []
    this.blockingTiles = []
    this.animatedTiles = []
    this.animationStates.clear()

    // Find max width and normalize all lines to consistent grid
    let maxCols = 0
    for (const line of data.template) {
      maxCols = Math.max(maxCols, line.length)
    }

    // Normalize template lines to consistent width
    const normalizedTemplate = data.template.map(line =>
      line.length < maxCols ? line + ' '.repeat(maxCols - line.length) : line
    )

    for (let row = 0; row < normalizedTemplate.length; row++) {
      const line = normalizedTemplate[row]

      for (let col = 0; col < line.length; col++) {
        const char = line[col]

        // Get tile definition or create empty one for spaces
        let tileDef = data.tileDefinitions[char]

        // For spaces, use position-based background color
        const bgColor = this.getBackgroundColor(row, data.template.length)

        if (!tileDef) {
          tileDef = {
            char: ' ',
            color: { r: 0, g: 0, b: 0, a: 0 },
            fillColor: bgColor,
            isBlocking: false,
            isAnimated: false,
            animationType: null,
            animationInterval: 0
          }
        }

        const tile: ComputedTile = {
          char,
          worldX: col * tileSize,
          worldY: row * tileSize,
          row,
          col,
          color: tileDef.color,
          // Use position-based background for spaces
          fillColor: char === ' ' ? bgColor : tileDef.fillColor,
          isBlocking: tileDef.isBlocking,
          isAnimated: tileDef.isAnimated,
          animationType: tileDef.animationType,
          animationInterval: tileDef.animationInterval
        }

        this.tiles.push(tile)

        if (tile.isBlocking) {
          this.blockingTiles.push(tile)
        }

        if (tile.isAnimated) {
          this.animatedTiles.push(tile)
          this.animationStates.set(`${row}-${col}`, { lastUpdate: 0, bright: false })
        }
      }
    }

    this.worldWidth = maxCols * tileSize
    this.worldHeight = data.template.length * tileSize

    this.camera.setWorldBounds(this.worldWidth, this.worldHeight)

    this.staticLayer = new OffscreenCanvas(this.worldWidth, this.worldHeight)
    this.staticCtx = this.staticLayer.getContext('2d', { alpha: false })!
    this.staticLayerDirty = true

    this.renderStaticLayer()
  }

  createPlayer(startX?: number, startY?: number): Player {
    const x = startX ?? this.worldWidth / 2
    const y = startY ?? this.worldHeight - this.config.tileSize * 4
    this.player = new Player(x, y, this.config.tileSize)
    return this.player
  }

  private renderStaticLayer() {
    if (!this.staticCtx || !this.staticLayer) return

    const ctx = this.staticCtx
    const { tileSize, font } = this.config

    ctx.fillStyle = '#1a1a2e'
    ctx.fillRect(0, 0, this.worldWidth, this.worldHeight)

    ctx.font = `bold ${tileSize}px ${font}`
    ctx.textBaseline = 'top'

    for (const tile of this.tiles) {
      if (tile.isAnimated) continue

      ctx.fillStyle = this.rgbaToString(tile.fillColor)
      ctx.fillRect(tile.worldX, tile.worldY, tileSize, tileSize)

      if (tile.char !== ' ') {
        ctx.fillStyle = this.rgbaToString(tile.color)
        ctx.fillText(tile.char, tile.worldX + 2, tile.worldY + 2)
      }
    }

    this.staticLayerDirty = false
  }

  private renderAnimatedTiles(time: number) {
    const ctx = this.ctx
    const { tileSize, font } = this.config

    ctx.font = `bold ${tileSize}px ${font}`
    ctx.textBaseline = 'top'

    for (const tile of this.animatedTiles) {
      if (!this.camera.isVisible(tile.worldX, tile.worldY, tileSize, tileSize)) continue

      const key = `${tile.row}-${tile.col}`
      const state = this.animationStates.get(key)!

      if (time - state.lastUpdate > tile.animationInterval) {
        state.bright = !state.bright
        state.lastUpdate = time
      }

      let brightness = 1
      if (state.bright && (tile.animationType === 'brightup' || tile.animationType === 'move_brightup')) {
        brightness = 1.3 + Math.random() * 0.4
      }

      const screen = this.camera.worldToScreen(tile.worldX, tile.worldY)

      ctx.fillStyle = this.rgbaToString(tile.fillColor, brightness)
      ctx.fillRect(screen.x, screen.y, tileSize, tileSize)

      ctx.fillStyle = this.rgbaToString(tile.color, brightness)
      ctx.fillText(tile.char, screen.x + 2, screen.y + 2)
    }
  }

  checkCollision = (rect: Rectangle): boolean => {
    const { tileSize } = this.config

    for (const tile of this.blockingTiles) {
      const tileRect: Rectangle = {
        x: tile.worldX,
        y: tile.worldY,
        width: tileSize,
        height: tileSize
      }

      if (
        rect.x < tileRect.x + tileRect.width &&
        rect.x + rect.width > tileRect.x &&
        rect.y < tileRect.y + tileRect.height &&
        rect.y + rect.height > tileRect.y
      ) {
        return true
      }
    }

    if (rect.x < 0 || rect.x + rect.width > this.worldWidth) return true
    if (rect.y < 0 || rect.y + rect.height > this.worldHeight) return true

    return false
  }

  private gameLoop = (time: number) => {
    if (!this.isRunning) return

    const deltaTime = time - this.lastFrameTime
    this.lastFrameTime = time

    if (this.player) {
      this.player.update(deltaTime, this.checkCollision)
      const center = this.player.getCenter()
      this.camera.follow(center.x, center.y)
    }

    this.camera.update()

    this.ctx.fillStyle = '#0a0a15'
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)

    if (this.staticLayer) {
      const cam = this.camera.position
      this.ctx.drawImage(
        this.staticLayer,
        cam.x, cam.y,
        this.camera.viewportWidth, this.camera.viewportHeight,
        0, 0,
        this.camera.viewportWidth, this.camera.viewportHeight
      )
    }

    this.renderAnimatedTiles(time)

    if (this.player) {
      const screen = this.camera.worldToScreen(this.player.position.x, this.player.position.y)
      this.player.render(this.ctx, screen.x, screen.y)
    }

    if (this.config.debug) {
      this.renderDebug()
    }

    this.frameId = requestAnimationFrame(this.gameLoop)
  }

  private renderDebug() {
    const ctx = this.ctx

    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'
    ctx.fillRect(10, 10, 200, 100)

    ctx.fillStyle = 'white'
    ctx.font = '14px monospace'
    ctx.fillText(`Camera: ${Math.round(this.camera.position.x)}, ${Math.round(this.camera.position.y)}`, 20, 30)

    if (this.player) {
      ctx.fillText(`Player: ${Math.round(this.player.position.x)}, ${Math.round(this.player.position.y)}`, 20, 50)
    }

    ctx.fillText(`World: ${this.worldWidth} x ${this.worldHeight}`, 20, 70)
    ctx.fillText(`Blocking tiles: ${this.blockingTiles.length}`, 20, 90)
  }

  start() {
    if (this.isRunning) return
    this.isRunning = true
    this.lastFrameTime = performance.now()
    this.frameId = requestAnimationFrame(this.gameLoop)
  }

  stop() {
    this.isRunning = false
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId)
      this.frameId = null
    }
  }

  destroy() {
    this.stop()
    window.removeEventListener('resize', this.boundResizeHandler)
    // Clean up player keyboard listeners
    if (this.player) {
      this.player.destroy()
    }
    // Clear references to help GC
    this.tiles = []
    this.blockingTiles = []
    this.animatedTiles = []
    this.animationStates.clear()
    this.staticLayer = null
    this.staticCtx = null
  }

  getCamera(): Camera {
    return this.camera
  }

  getPlayer(): Player | null {
    return this.player
  }
}

export default GameEngine
