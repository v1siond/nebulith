'use client'

import { useState, useEffect } from 'react'

/**
 * Sprite Animation Test Page
 *
 * Drop your extracted sprite PNGs into public/sprites/kratos-frames/
 * Name them: idle_0.png, idle_1.png, walk_0.png, walk_1.png, etc.
 *
 * This page will animate them automatically.
 */

type AnimationType = 'idle' | 'walk' | 'attack' | 'jump' | 'run'

const ANIMATIONS: AnimationType[] = ['idle', 'walk', 'run', 'attack', 'jump']

const FRAME_RATES: Record<AnimationType, number> = {
  idle: 400,
  walk: 150,
  attack: 100,
  jump: 150,
  run: 100,
}

interface AnimatedSpriteProps {
  folder: string
  animation: AnimationType
  frameCount?: number
  direction?: 'left' | 'right'
  scale?: number
  width?: number
  height?: number
}

function AnimatedSprite({
  folder,
  animation,
  frameCount = 4,
  direction = 'right',
  scale = 1,
  width = 100,
  height = 180,
}: AnimatedSpriteProps) {
  const [frame, setFrame] = useState(0)
  const [error, setError] = useState(false)

  useEffect(() => {
    setFrame(0)
    setError(false)
  }, [animation, folder])

  useEffect(() => {
    const interval = setInterval(() => {
      setFrame((f) => (f + 1) % frameCount)
    }, FRAME_RATES[animation])
    return () => clearInterval(interval)
  }, [animation, frameCount])

  const src = `/sprites/${folder}/${animation}_${frame}.png`

  if (error) {
    return (
      <div style={{
        width: width * scale,
        height: height * scale,
        background: '#333',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '10px',
        color: '#666',
        textAlign: 'center',
        padding: '0.5rem',
      }}>
        No sprites in<br />/sprites/{folder}/
      </div>
    )
  }

  return (
    <img
      src={src}
      alt={`${animation} frame ${frame}`}
      onError={() => setError(true)}
      style={{
        width: width * scale,
        height: height * scale,
        objectFit: 'contain',
        imageRendering: 'pixelated',
        transform: direction === 'left' ? 'scaleX(-1)' : 'none',
      }}
    />
  )
}

export default function SpritesTestPage() {
  const [animation, setAnimation] = useState<AnimationType>('idle')
  const [direction, setDirection] = useState<'left' | 'right'>('right')
  const [folder, setFolder] = useState('kratos')

  // Available sprite folders
  const folders = ['kratos', 'kratos-frames']

  return (
    <div style={{
      padding: '2rem',
      background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
      minHeight: '100vh',
      color: '#fff',
      fontFamily: 'monospace',
    }}>
      <h1 style={{ marginBottom: '0.5rem' }}>Sprite Animation Test</h1>
      <p style={{ opacity: 0.6, marginBottom: '2rem' }}>
        Place extracted sprites in /public/sprites/[folder]/ as [animation]_[frame].png
      </p>

      {/* Folder selector */}
      <div style={{ marginBottom: '1rem' }}>
        <label style={{ marginRight: '1rem' }}>Folder:</label>
        {folders.map((f) => (
          <button
            key={f}
            onClick={() => setFolder(f)}
            style={{
              padding: '0.5rem 1rem',
              marginRight: '0.5rem',
              background: folder === f ? '#4a9eff' : '#333',
              border: 'none',
              borderRadius: '4px',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            {f}
          </button>
        ))}
        <input
          type="text"
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
          placeholder="custom folder"
          style={{
            padding: '0.5rem',
            background: '#1a1a2e',
            border: '1px solid #333',
            borderRadius: '4px',
            color: '#fff',
            width: '150px',
          }}
        />
      </div>

      {/* Animation controls */}
      <div style={{ marginBottom: '2rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {ANIMATIONS.map((anim) => (
          <button
            key={anim}
            onClick={() => setAnimation(anim)}
            style={{
              padding: '0.5rem 1rem',
              background: animation === anim ? '#4a9eff' : '#333',
              border: 'none',
              borderRadius: '4px',
              color: '#fff',
              cursor: 'pointer',
              textTransform: 'uppercase',
              fontWeight: 'bold',
            }}
          >
            {anim}
          </button>
        ))}
        <button
          onClick={() => setDirection((d) => d === 'left' ? 'right' : 'left')}
          style={{
            padding: '0.5rem 1rem',
            background: '#666',
            border: 'none',
            borderRadius: '4px',
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          {direction === 'right' ? '→' : '←'} {direction.toUpperCase()}
        </button>
      </div>

      {/* Main preview */}
      <div style={{ marginBottom: '3rem' }}>
        <h3>Preview (2x scale)</h3>
        <div style={{
          display: 'inline-flex',
          gap: '2rem',
          padding: '2rem',
          background: '#0a0a14',
          borderRadius: '8px',
        }}>
          <div style={{ textAlign: 'center' }}>
            <AnimatedSprite
              folder={folder}
              animation={animation}
              direction={direction}
              scale={2}
            />
            <p style={{ marginTop: '0.5rem', opacity: 0.7 }}>
              {animation} - {direction}
            </p>
          </div>
        </div>
      </div>

      {/* All animations */}
      <h3>All Animations</h3>
      <div style={{
        display: 'flex',
        gap: '1rem',
        flexWrap: 'wrap',
        marginBottom: '2rem',
      }}>
        {ANIMATIONS.map((anim) => (
          <div key={anim} style={{ textAlign: 'center' }}>
            <div style={{
              background: '#0a0a14',
              padding: '0.5rem',
              borderRadius: '4px',
            }}>
              <AnimatedSprite
                folder={folder}
                animation={anim}
                scale={1}
              />
            </div>
            <p style={{ fontSize: '11px', opacity: 0.6, marginTop: '0.25rem' }}>
              {anim}
            </p>
          </div>
        ))}
      </div>

      {/* Transparency demo */}
      <h3>On Different Backgrounds</h3>
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        {[
          '#ff6b6b',
          '#4ecdc4',
          '#a855f7',
          '#fbbf24',
          'linear-gradient(135deg, #667eea, #764ba2)',
        ].map((bg, i) => (
          <div
            key={i}
            style={{
              background: bg,
              padding: '1rem',
              borderRadius: '8px',
            }}
          >
            <AnimatedSprite
              folder={folder}
              animation={animation}
              direction={direction}
              scale={0.8}
            />
          </div>
        ))}
      </div>

      {/* Instructions */}
      <div style={{
        marginTop: '3rem',
        padding: '1rem',
        background: '#0a0a14',
        borderRadius: '8px',
        fontSize: '13px',
        opacity: 0.8,
      }}>
        <h4 style={{ marginBottom: '0.5rem' }}>How to add sprites:</h4>
        <ol style={{ margin: 0, paddingLeft: '1.5rem' }}>
          <li>Create folder: <code>public/sprites/your-folder/</code></li>
          <li>Add PNGs named: <code>idle_0.png, idle_1.png, idle_2.png, idle_3.png</code></li>
          <li>Same for: <code>walk_*, run_*, attack_*, jump_*</code></li>
          <li>Select your folder above to test</li>
        </ol>
      </div>
    </div>
  )
}
