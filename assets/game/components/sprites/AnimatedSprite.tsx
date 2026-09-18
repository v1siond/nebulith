'use client'

import { useState, useEffect, useRef } from 'react'

export type FrameTiming = {
  duration: number
}

export type SpriteAnimation = {
  name: string
  frames: string[] // data URLs or paths
  frameTiming?: FrameTiming[]
  defaultDuration?: number
}

export type SpriteConfig = {
  idle?: SpriteAnimation
  walking?: SpriteAnimation
  running?: SpriteAnimation
  attacking?: SpriteAnimation
  jumping?: SpriteAnimation
  [key: string]: SpriteAnimation | undefined
}

interface AnimatedSpriteProps {
  config: SpriteConfig
  animation?: string
  autoPlay?: boolean
  loop?: boolean
  scale?: number
  flipX?: boolean
  flipY?: boolean
  style?: React.CSSProperties
  className?: string
  onAnimationEnd?: () => void
  onFrameChange?: (frame: number) => void
}

export function AnimatedSprite({
  config,
  animation = 'idle',
  autoPlay = true,
  loop = true,
  scale = 1,
  flipX = false,
  flipY = false,
  style,
  className,
  onAnimationEnd,
  onFrameChange,
}: AnimatedSpriteProps) {
  const [frame, setFrame] = useState(0)
  const [playing, setPlaying] = useState(autoPlay)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  const currentAnim = config[animation]

  useEffect(() => {
    setFrame(0)
    setPlaying(autoPlay)
  }, [animation, autoPlay])

  useEffect(() => {
    if (!currentAnim || !playing) return

    const frames = currentAnim.frames
    const timing = currentAnim.frameTiming
    const defaultDur = currentAnim.defaultDuration || 150

    const scheduleNext = () => {
      const currentDuration = timing?.[frame]?.duration || defaultDur

      timeoutRef.current = setTimeout(() => {
        const nextFrame = frame + 1

        if (nextFrame >= frames.length) {
          if (loop) {
            setFrame(0)
            onFrameChange?.(0)
          } else {
            setPlaying(false)
            onAnimationEnd?.()
          }
        } else {
          setFrame(nextFrame)
          onFrameChange?.(nextFrame)
        }
      }, currentDuration)
    }

    scheduleNext()

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [currentAnim, playing, frame, loop, onAnimationEnd, onFrameChange])

  if (!currentAnim || !currentAnim.frames.length) {
    return null
  }

  const frameSrc = currentAnim.frames[frame]

  return (
    <img
      src={frameSrc}
      alt={`${animation} frame ${frame}`}
      className={className}
      style={{
        imageRendering: 'pixelated',
        transform: `scale(${flipX ? -scale : scale}, ${flipY ? -scale : scale})`,
        ...style,
      }}
    />
  )
}

// Hook for programmatic control
export function useAnimatedSprite(config: SpriteConfig, initialAnimation = 'idle') {
  const [animation, setAnimation] = useState(initialAnimation)
  const [isPlaying, setIsPlaying] = useState(true)

  const play = (animName?: string) => {
    if (animName) setAnimation(animName)
    setIsPlaying(true)
  }

  const pause = () => setIsPlaying(false)
  const stop = () => {
    setIsPlaying(false)
    setAnimation(initialAnimation)
  }

  return {
    animation,
    isPlaying,
    play,
    pause,
    stop,
    setAnimation,
  }
}

// Load sprite config from exported ZIP settings
export async function loadSpriteFromExport(zipPath: string): Promise<SpriteAnimation | null> {
  try {
    const response = await fetch(zipPath)
    const settings = await response.json()

    return {
      name: settings.name,
      frames: [], // Would need to load frames separately
      frameTiming: settings.frameTiming,
      defaultDuration: settings.totalDuration / settings.frameTiming.length,
    }
  } catch {
    return null
  }
}

// Helper to create config from public folder sprites
export function createSpriteConfig(
  basePath: string,
  animations: Record<string, { frameCount: number; frameTiming?: FrameTiming[]; defaultDuration?: number }>
): SpriteConfig {
  const config: SpriteConfig = {}

  for (const [name, { frameCount, frameTiming, defaultDuration }] of Object.entries(animations)) {
    config[name] = {
      name,
      frames: Array.from({ length: frameCount }, (_, i) =>
        `${basePath}/${name}_${i}.png`
      ),
      frameTiming,
      defaultDuration,
    }
  }

  return config
}
