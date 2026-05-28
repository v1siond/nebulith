/**
 * Tests for AnimatedSprite component
 */
import React from 'react'
import { render, screen, act } from '@testing-library/react'
import '@testing-library/jest-dom'

import {
  AnimatedSprite,
  useAnimatedSprite,
  createSpriteConfig,
  type SpriteConfig,
  type SpriteAnimation,
} from '@/components/sprites/AnimatedSprite'

// Mock timers for animation testing
jest.useFakeTimers()

describe('AnimatedSprite Component', () => {
  const mockConfig: SpriteConfig = {
    idle: {
      name: 'idle',
      frames: [
        'data:image/png;base64,frame1',
        'data:image/png;base64,frame2',
        'data:image/png;base64,frame3',
        'data:image/png;base64,frame4',
      ],
      defaultDuration: 150,
    },
    walking: {
      name: 'walking',
      frames: [
        'data:image/png;base64,walk1',
        'data:image/png;base64,walk2',
      ],
      frameTiming: [
        { duration: 100 },
        { duration: 200 },
      ],
    },
  }

  beforeEach(() => {
    jest.clearAllTimers()
  })

  describe('Rendering', () => {
    it('renders an img element', () => {
      render(<AnimatedSprite config={mockConfig} animation="idle" />)

      const img = screen.getByRole('img')
      expect(img).toBeInTheDocument()
    })

    it('renders first frame initially', () => {
      render(<AnimatedSprite config={mockConfig} animation="idle" />)

      const img = screen.getByRole('img')
      expect(img).toHaveAttribute('src', 'data:image/png;base64,frame1')
    })

    it('applies pixelated image rendering', () => {
      render(<AnimatedSprite config={mockConfig} animation="idle" />)

      const img = screen.getByRole('img')
      expect(img).toHaveStyle({ imageRendering: 'pixelated' })
    })

    it('returns null for missing animation', () => {
      const { container } = render(
        <AnimatedSprite config={mockConfig} animation="nonexistent" />
      )

      expect(container.firstChild).toBeNull()
    })

    it('returns null for animation with no frames', () => {
      const emptyConfig: SpriteConfig = {
        empty: { name: 'empty', frames: [] },
      }

      const { container } = render(
        <AnimatedSprite config={emptyConfig} animation="empty" />
      )

      expect(container.firstChild).toBeNull()
    })
  })

  describe('Animation Playback', () => {
    it('advances frames over time when autoPlay is true', () => {
      render(<AnimatedSprite config={mockConfig} animation="idle" autoPlay={true} />)

      const img = screen.getByRole('img')
      expect(img).toHaveAttribute('src', 'data:image/png;base64,frame1')

      // Advance past first frame duration (150ms)
      act(() => {
        jest.advanceTimersByTime(160)
      })

      expect(img).toHaveAttribute('src', 'data:image/png;base64,frame2')
    })

    it('does not advance when autoPlay is false', () => {
      render(<AnimatedSprite config={mockConfig} animation="idle" autoPlay={false} />)

      const img = screen.getByRole('img')
      expect(img).toHaveAttribute('src', 'data:image/png;base64,frame1')

      act(() => {
        jest.advanceTimersByTime(500)
      })

      // Should still be on frame 1
      expect(img).toHaveAttribute('src', 'data:image/png;base64,frame1')
    })

    it('loops back to first frame when loop is true', () => {
      render(<AnimatedSprite config={mockConfig} animation="idle" loop={true} />)

      const img = screen.getByRole('img')

      // Advance through frames one at a time (each 150ms + buffer)
      for (let i = 0; i < 5; i++) {
        act(() => {
          jest.advanceTimersByTime(160)
        })
      }

      // After 5 frame advances from frame 0, should have looped
      // Frame sequence: 0 -> 1 -> 2 -> 3 -> 0 -> 1
      expect(img).toHaveAttribute('src', 'data:image/png;base64,frame2')
    })

    it('stops at last frame when loop is false', () => {
      render(<AnimatedSprite config={mockConfig} animation="idle" loop={false} />)

      const img = screen.getByRole('img')

      // Advance through frames one at a time
      for (let i = 0; i < 5; i++) {
        act(() => {
          jest.advanceTimersByTime(160)
        })
      }

      // With loop=false, should stop at frame 4 (index 3)
      expect(img).toHaveAttribute('src', 'data:image/png;base64,frame4')
    })

    it('uses per-frame timing when provided', () => {
      render(<AnimatedSprite config={mockConfig} animation="walking" />)

      const img = screen.getByRole('img')
      expect(img).toHaveAttribute('src', 'data:image/png;base64,walk1')

      // First frame: 100ms
      act(() => {
        jest.advanceTimersByTime(110)
      })
      expect(img).toHaveAttribute('src', 'data:image/png;base64,walk2')

      // Second frame: 200ms
      act(() => {
        jest.advanceTimersByTime(100) // Not enough
      })
      expect(img).toHaveAttribute('src', 'data:image/png;base64,walk2')

      act(() => {
        jest.advanceTimersByTime(110) // Now enough
      })
      expect(img).toHaveAttribute('src', 'data:image/png;base64,walk1') // Looped
    })
  })

  describe('Animation Switching', () => {
    it('resets to frame 0 when animation changes', () => {
      const { rerender } = render(
        <AnimatedSprite config={mockConfig} animation="idle" />
      )

      const img = screen.getByRole('img')

      // Advance to frame 2
      act(() => {
        jest.advanceTimersByTime(200)
      })
      expect(img).toHaveAttribute('src', 'data:image/png;base64,frame2')

      // Change animation
      rerender(<AnimatedSprite config={mockConfig} animation="walking" />)

      expect(img).toHaveAttribute('src', 'data:image/png;base64,walk1')
    })
  })

  describe('Transformations', () => {
    it('applies scale transform', () => {
      render(<AnimatedSprite config={mockConfig} animation="idle" scale={2} />)

      const img = screen.getByRole('img')
      expect(img).toHaveStyle({ transform: 'scale(2, 2)' })
    })

    it('applies flipX transform', () => {
      render(<AnimatedSprite config={mockConfig} animation="idle" flipX={true} />)

      const img = screen.getByRole('img')
      expect(img).toHaveStyle({ transform: 'scale(-1, 1)' })
    })

    it('applies flipY transform', () => {
      render(<AnimatedSprite config={mockConfig} animation="idle" flipY={true} />)

      const img = screen.getByRole('img')
      expect(img).toHaveStyle({ transform: 'scale(1, -1)' })
    })

    it('combines scale and flip', () => {
      render(
        <AnimatedSprite
          config={mockConfig}
          animation="idle"
          scale={3}
          flipX={true}
        />
      )

      const img = screen.getByRole('img')
      expect(img).toHaveStyle({ transform: 'scale(-3, 3)' })
    })
  })

  describe('Callbacks', () => {
    it('calls onFrameChange when frame advances', () => {
      const onFrameChange = jest.fn()

      render(
        <AnimatedSprite
          config={mockConfig}
          animation="idle"
          onFrameChange={onFrameChange}
        />
      )

      act(() => {
        jest.advanceTimersByTime(160)
      })

      expect(onFrameChange).toHaveBeenCalledWith(1)
    })

    it('calls onAnimationEnd when animation completes (no loop)', () => {
      const onAnimationEnd = jest.fn()

      render(
        <AnimatedSprite
          config={mockConfig}
          animation="idle"
          loop={false}
          onAnimationEnd={onAnimationEnd}
        />
      )

      // Play through all 4 frames one at a time
      for (let i = 0; i < 4; i++) {
        act(() => {
          jest.advanceTimersByTime(160)
        })
      }

      expect(onAnimationEnd).toHaveBeenCalled()
    })
  })

  describe('Custom Styles', () => {
    it('applies custom styles', () => {
      render(
        <AnimatedSprite
          config={mockConfig}
          animation="idle"
          style={{ border: '1px solid red' }}
        />
      )

      const img = screen.getByRole('img')
      expect(img).toHaveStyle({ border: '1px solid red' })
    })

    it('applies className', () => {
      render(
        <AnimatedSprite
          config={mockConfig}
          animation="idle"
          className="my-sprite"
        />
      )

      const img = screen.getByRole('img')
      expect(img).toHaveClass('my-sprite')
    })
  })
})


describe('useAnimatedSprite Hook', () => {
  // Test component to use the hook
  function TestHookComponent({
    config,
    initialAnimation,
  }: {
    config: SpriteConfig
    initialAnimation: string
  }) {
    const sprite = useAnimatedSprite(config, initialAnimation)

    return (
      <div>
        <span data-testid="animation">{sprite.animation}</span>
        <span data-testid="playing">{sprite.isPlaying.toString()}</span>
        <button onClick={() => sprite.play('walking')}>Play Walk</button>
        <button onClick={() => sprite.pause()}>Pause</button>
        <button onClick={() => sprite.stop()}>Stop</button>
      </div>
    )
  }

  const mockConfig: SpriteConfig = {
    idle: { name: 'idle', frames: ['frame1', 'frame2'] },
    walking: { name: 'walking', frames: ['walk1', 'walk2'] },
  }

  it('initializes with correct animation', () => {
    render(<TestHookComponent config={mockConfig} initialAnimation="idle" />)

    expect(screen.getByTestId('animation')).toHaveTextContent('idle')
    expect(screen.getByTestId('playing')).toHaveTextContent('true')
  })

  it('play() changes animation', async () => {
    render(<TestHookComponent config={mockConfig} initialAnimation="idle" />)

    const playButton = screen.getByText('Play Walk')
    await act(async () => {
      playButton.click()
    })

    expect(screen.getByTestId('animation')).toHaveTextContent('walking')
  })

  it('pause() stops playback', async () => {
    render(<TestHookComponent config={mockConfig} initialAnimation="idle" />)

    const pauseButton = screen.getByText('Pause')
    await act(async () => {
      pauseButton.click()
    })

    expect(screen.getByTestId('playing')).toHaveTextContent('false')
  })

  it('stop() resets to initial animation', async () => {
    render(<TestHookComponent config={mockConfig} initialAnimation="idle" />)

    // Play walking
    await act(async () => {
      screen.getByText('Play Walk').click()
    })
    expect(screen.getByTestId('animation')).toHaveTextContent('walking')

    // Stop
    await act(async () => {
      screen.getByText('Stop').click()
    })
    expect(screen.getByTestId('animation')).toHaveTextContent('idle')
    expect(screen.getByTestId('playing')).toHaveTextContent('false')
  })
})


describe('createSpriteConfig', () => {
  it('creates config from base path and animation definitions', () => {
    const config = createSpriteConfig('/sprites/warrior', {
      idle: { frameCount: 4 },
      walk: { frameCount: 6, defaultDuration: 100 },
    })

    expect(config.idle).toBeDefined()
    expect(config.idle?.frames).toHaveLength(4)
    expect(config.idle?.frames[0]).toBe('/sprites/warrior/idle_0.png')
    expect(config.idle?.frames[3]).toBe('/sprites/warrior/idle_3.png')

    expect(config.walk?.frames).toHaveLength(6)
    expect(config.walk?.defaultDuration).toBe(100)
  })

  it('includes custom frame timing when provided', () => {
    const timing = [{ duration: 100 }, { duration: 200 }]

    const config = createSpriteConfig('/sprites/hero', {
      attack: { frameCount: 2, frameTiming: timing },
    })

    expect(config.attack?.frameTiming).toEqual(timing)
  })
})
