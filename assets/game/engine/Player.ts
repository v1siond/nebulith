import { Vector2, Rectangle, RGBA } from './types'

const SPRITES = {
  stop: [
    ' 0 ',
    '<#>',
    '/ \\'
  ],
  walkRight1: [
    ' 0 ',
    '/#>',
    '- \\'
  ],
  walkRight2: [
    ' 0 ',
    '<#\\',
    ' > '
  ],
  walkLeft1: [
    ' 0 ',
    '<#\\',
    '/ -'
  ],
  walkLeft2: [
    ' 0 ',
    '/#>',
    ' < '
  ],
  walkUp1: [
    ' O ',
    "<#'",
    "' !"
  ],
  walkUp2: [
    ' O ',
    "'#>",
    "! '"
  ],
  walkDown1: [
    ' O ',
    "'#>",
    "! '"
  ],
  walkDown2: [
    ' O ',
    "<#'",
    "' !"
  ],
  jump: [
    '\\0/',
    ' # ',
    '! !'
  ]
}

const CHAR_COLORS: Record<string, RGBA> = {
  '0': { r: 255, g: 200, b: 50, a: 1 },
  'O': { r: 255, g: 200, b: 50, a: 1 },
  '#': { r: 255, g: 80, b: 80, a: 1 },
  '/': { r: 255, g: 220, b: 100, a: 1 },
  '\\': { r: 255, g: 220, b: 100, a: 1 },
  '>': { r: 255, g: 220, b: 100, a: 1 },
  '<': { r: 255, g: 220, b: 100, a: 1 },
  '-': { r: 255, g: 220, b: 100, a: 1 },
  '|': { r: 255, g: 220, b: 100, a: 1 },
  '!': { r: 255, g: 220, b: 100, a: 1 },
  "'": { r: 255, g: 220, b: 100, a: 1 },
}

export class Player {
  position: Vector2
  velocity: Vector2 = { x: 0, y: 0 }

  width: number
  height: number
  tileSize: number

  speed: number = 250
  jumpForce: number = 50  // Initial upward velocity (negative direction)
  gravityCoef: number = 3  // Accumulates each frame like original
  gravityY: number = 0  // Current gravity velocity (like original gravity.y)
  isJumping: boolean = false
  jumpStartY: number = 0  // Ground level when jump started

  private currentSprite: string[] = SPRITES.stop
  private facing: 'left' | 'right' | 'up' | 'down' = 'right'
  private animationFrame: number = 0
  private lastAnimationTime: number = 0
  private animationInterval: number = 120

  private keys: Record<string, boolean> = {}

  // Bound event handlers for proper cleanup
  private boundKeyDown: (e: KeyboardEvent) => void
  private boundKeyUp: (e: KeyboardEvent) => void

  private static readonly ACTION_KEYS = new Set([
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'w', 'W', 'a', 'A', 's', 'S', 'd', 'D', ' '
  ])

  constructor(x: number, y: number, tileSize: number) {
    this.tileSize = tileSize
    // Smaller collision box - player can squeeze through tighter spaces
    this.width = tileSize * 0.8
    this.height = tileSize * 1.2
    this.position = { x, y }

    // Bind handlers once for proper add/remove
    this.boundKeyDown = this.handleKeyDown.bind(this)
    this.boundKeyUp = this.handleKeyUp.bind(this)

    this.setupInput()
  }

  private handleKeyDown(e: KeyboardEvent) {
    if (Player.ACTION_KEYS.has(e.key)) {
      e.preventDefault()
      // Normalize: lowercase for letters, keep original for arrows/space
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
      this.keys[key] = true
    }
  }

  private handleKeyUp(e: KeyboardEvent) {
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
    this.keys[key] = false
  }

  private setupInput() {
    if (typeof window === 'undefined') return
    window.addEventListener('keydown', this.boundKeyDown)
    window.addEventListener('keyup', this.boundKeyUp)
  }

  destroy() {
    if (typeof window === 'undefined') return
    window.removeEventListener('keydown', this.boundKeyDown)
    window.removeEventListener('keyup', this.boundKeyUp)
  }

  update(deltaTime: number, checkCollision: (rect: Rectangle) => boolean) {
    const dt = deltaTime / 1000

    // Movement (Arrow keys + WASD)
    this.velocity.x = 0
    let moving = false

    const right = this.keys['ArrowRight'] || this.keys['d']
    const left = this.keys['ArrowLeft'] || this.keys['a']
    const up = this.keys['ArrowUp'] || this.keys['w']
    const down = this.keys['ArrowDown'] || this.keys['s']

    if (right) {
      this.velocity.x = this.speed
      this.facing = 'right'
      moving = true
    }
    if (left) {
      this.velocity.x = -this.speed
      this.facing = 'left'
      moving = true
    }

    // Vertical movement - only if not jumping
    if (!this.isJumping) {
      this.velocity.y = 0
      if (up) {
        this.velocity.y = -this.speed
        this.facing = 'up'
        moving = true
      }
      if (down) {
        this.velocity.y = this.speed
        this.facing = 'down'
        moving = true
      }
    }

    // Jump - spacebar (like original: sets gravityY to negative, then accumulates back)
    if (this.keys[' '] && !this.isJumping && this.gravityY === 0) {
      this.gravityY = -this.jumpForce  // Negative = going up
      this.isJumping = true
      this.jumpStartY = this.position.y  // Remember ground level
    }

    // Apply gravity - accumulates each frame like original code
    if (this.isJumping) {
      // Check if we've returned to ground level
      if (this.position.y >= this.jumpStartY && this.gravityY > 0) {
        this.position.y = this.jumpStartY
        this.gravityY = 0
        this.isJumping = false
      } else {
        // Accumulate gravity (adds positive value, so goes from negative to positive)
        this.gravityY += this.gravityCoef
        this.velocity.y = this.gravityY * 10  // Scale for movement speed
        moving = true
      }
    }

    // Move X - when jumping, check collision at ground level, not mid-air
    const newX = this.position.x + this.velocity.x * dt
    const collisionY = this.isJumping ? this.jumpStartY : this.position.y
    const newBoundsX: Rectangle = {
      x: newX,
      y: collisionY,
      width: this.width,
      height: this.height
    }

    if (!checkCollision(newBoundsX)) {
      this.position.x = newX
    }

    // Move Y - jumping bypasses collision (it's a visual hop)
    const newY = this.position.y + this.velocity.y * dt
    if (this.isJumping) {
      this.position.y = newY
    } else {
      const newBoundsY: Rectangle = {
        x: this.position.x,
        y: newY,
        width: this.width,
        height: this.height
      }
      if (!checkCollision(newBoundsY)) {
        this.position.y = newY
      }
    }

    this.updateAnimation(moving)
  }

  private updateAnimation(moving: boolean) {
    const now = performance.now()

    if (now - this.lastAnimationTime > this.animationInterval) {
      this.animationFrame = (this.animationFrame + 1) % 2
      this.lastAnimationTime = now
    }

    // Jumping - show jump sprite
    if (this.isJumping) {
      this.currentSprite = SPRITES.jump
      return
    }

    // Not moving - show stop
    if (!moving) {
      this.currentSprite = SPRITES.stop
      return
    }

    // Walking animation based on facing direction
    switch (this.facing) {
      case 'right':
        this.currentSprite = this.animationFrame === 0 ? SPRITES.walkRight1 : SPRITES.walkRight2
        break
      case 'left':
        this.currentSprite = this.animationFrame === 0 ? SPRITES.walkLeft1 : SPRITES.walkLeft2
        break
      case 'up':
        this.currentSprite = this.animationFrame === 0 ? SPRITES.walkUp1 : SPRITES.walkUp2
        break
      case 'down':
        this.currentSprite = this.animationFrame === 0 ? SPRITES.walkDown1 : SPRITES.walkDown2
        break
    }
  }

  render(ctx: CanvasRenderingContext2D, screenX: number, screenY: number) {
    const charSize = this.tileSize
    ctx.font = `bold ${charSize}px Silkscreen`
    ctx.textBaseline = 'top'

    // Calculate sprite dimensions for centering
    const spriteWidth = 3 // All sprites are 3 chars wide
    const spriteHeight = this.currentSprite.length
    const charWidth = charSize * 0.65
    const charHeight = charSize * 0.85

    // Center the sprite on the player's collision box
    const offsetX = (this.width - spriteWidth * charWidth) / 2
    const offsetY = (this.height - spriteHeight * charHeight) / 2

    for (let row = 0; row < this.currentSprite.length; row++) {
      const line = this.currentSprite[row]
      for (let col = 0; col < line.length; col++) {
        const char = line[col]
        if (char === ' ') continue

        const color = CHAR_COLORS[char] || { r: 255, g: 255, b: 255, a: 1 }
        const x = screenX + offsetX + col * charWidth
        const y = screenY + offsetY + row * charHeight

        // Draw outline
        ctx.strokeStyle = 'black'
        ctx.lineWidth = 3
        ctx.strokeText(char, x, y)

        // Draw fill
        ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a})`
        ctx.fillText(char, x, y)
      }
    }
  }

  getBounds(): Rectangle {
    return {
      x: this.position.x,
      y: this.position.y,
      width: this.width,
      height: this.height
    }
  }

  getCenter(): Vector2 {
    return {
      x: this.position.x + this.width / 2,
      y: this.position.y + this.height / 2
    }
  }
}

export default Player
