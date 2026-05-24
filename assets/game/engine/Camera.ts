import { Vector2, Rectangle, CameraConfig } from './types'

export class Camera {
  position: Vector2 = { x: 0, y: 0 }
  target: Vector2 = { x: 0, y: 0 }

  viewportWidth: number
  viewportHeight: number
  smoothing: number

  worldBounds: Rectangle = { x: 0, y: 0, width: 0, height: 0 }

  constructor(config: CameraConfig) {
    this.viewportWidth = config.viewportWidth
    this.viewportHeight = config.viewportHeight
    this.smoothing = config.smoothing
  }

  setWorldBounds(width: number, height: number) {
    this.worldBounds = { x: 0, y: 0, width, height }
  }

  setViewportSize(width: number, height: number) {
    this.viewportWidth = width
    this.viewportHeight = height
  }

  follow(targetX: number, targetY: number) {
    this.target.x = targetX - this.viewportWidth / 2
    this.target.y = targetY - this.viewportHeight / 2
  }

  update() {
    this.position.x += (this.target.x - this.position.x) * this.smoothing
    this.position.y += (this.target.y - this.position.y) * this.smoothing

    this.position.x = Math.max(0, Math.min(this.position.x, this.worldBounds.width - this.viewportWidth))
    this.position.y = Math.max(0, Math.min(this.position.y, this.worldBounds.height - this.viewportHeight))

    if (this.worldBounds.width < this.viewportWidth) {
      this.position.x = (this.worldBounds.width - this.viewportWidth) / 2
    }
    if (this.worldBounds.height < this.viewportHeight) {
      // Align world to BOTTOM of viewport (not center) for platformers
      this.position.y = this.worldBounds.height - this.viewportHeight
    }
  }

  worldToScreen(worldX: number, worldY: number): Vector2 {
    return {
      x: worldX - this.position.x,
      y: worldY - this.position.y
    }
  }

  screenToWorld(screenX: number, screenY: number): Vector2 {
    return {
      x: screenX + this.position.x,
      y: screenY + this.position.y
    }
  }

  isVisible(worldX: number, worldY: number, width: number, height: number): boolean {
    return (
      worldX + width > this.position.x &&
      worldX < this.position.x + this.viewportWidth &&
      worldY + height > this.position.y &&
      worldY < this.position.y + this.viewportHeight
    )
  }

  getVisibleBounds(): Rectangle {
    return {
      x: this.position.x,
      y: this.position.y,
      width: this.viewportWidth,
      height: this.viewportHeight
    }
  }
}

export default Camera
