'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import JSZip from 'jszip'

type FrameTiming = {
  duration: number // ms per frame
}

type GalleryItem = {
  id: string
  type: 'sprite' | 'animation'
  image?: string
  images?: string[]
  prompt: string
  size: number
  animAction?: string
  usage: number
  createdAt: number
  frameTiming?: FrameTiming[] // custom timing per frame
}

type ExportSettings = {
  name: string
  size: number
  animAction?: string
  frameTiming: FrameTiming[]
  totalDuration: number
}

const STORAGE_KEY = 'pixellab-gallery'
const ANIMATION_TYPES = ['idle', 'walking', 'running', 'attacking', 'jumping']
const SPEED_PRESETS = {
  'Very Slow': 400,
  'Slow': 250,
  'Normal': 150,
  'Fast': 80,
  'Very Fast': 40,
}

function loadGallery(): GalleryItem[] {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
  } catch {
    return []
  }
}

function saveGallery(items: GalleryItem[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
}

function dataUrlToBlob(dataUrl: string): Blob {
  const parts = dataUrl.split(',')
  const mime = parts[0].match(/:(.*?);/)?.[1] || 'image/png'
  const binary = atob(parts[1])
  const array = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    array[i] = binary.charCodeAt(i)
  }
  return new Blob([array], { type: mime })
}

// Mirror an image horizontally (no AI, pure canvas manipulation)
async function mirrorImage(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')!
      ctx.translate(canvas.width, 0)
      ctx.scale(-1, 1)
      ctx.drawImage(img, 0, 0)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = reject
    img.src = dataUrl
  })
}

// Create a sprite sheet from multiple images (horizontal strip)
async function createSpriteSheet(images: string[], frameSize: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas')
    canvas.width = frameSize * images.length
    canvas.height = frameSize
    const ctx = canvas.getContext('2d')!

    let loaded = 0
    images.forEach((dataUrl, i) => {
      const img = new Image()
      img.onload = () => {
        ctx.drawImage(img, i * frameSize, 0, frameSize, frameSize)
        loaded++
        if (loaded === images.length) {
          resolve(canvas.toDataURL('image/png'))
        }
      }
      img.onerror = reject
      img.src = dataUrl
    })
  })
}

// Create a combined sprite sheet from multiple animations (grid layout)
async function createCombinedSpriteSheet(
  animations: { name: string; images: string[]; size: number }[]
): Promise<string> {
  return new Promise((resolve, reject) => {
    // Find max frames and consistent size
    const maxFrames = Math.max(...animations.map(a => a.images.length))
    const size = animations[0]?.size || 64

    const canvas = document.createElement('canvas')
    canvas.width = size * maxFrames
    canvas.height = size * animations.length
    const ctx = canvas.getContext('2d')!

    let totalImages = animations.reduce((sum, a) => sum + a.images.length, 0)
    let loaded = 0

    animations.forEach((anim, row) => {
      anim.images.forEach((dataUrl, col) => {
        const img = new Image()
        img.onload = () => {
          ctx.drawImage(img, col * size, row * size, size, size)
          loaded++
          if (loaded === totalImages) {
            resolve(canvas.toDataURL('image/png'))
          }
        }
        img.onerror = reject
        img.src = dataUrl
      })
    })

    // Handle empty case
    if (totalImages === 0) {
      resolve(canvas.toDataURL('image/png'))
    }
  })
}

export default function SpriteGeneratorPage() {
  // Form state
  const [prompt, setPrompt] = useState('pixel art character, side view, warrior')
  const [size, setSize] = useState(64)

  // UI state
  const [loading, setLoading] = useState(false)
  const [loadingMsg, setLoadingMsg] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [balance, setBalance] = useState<number | null>(null)
  const [showTimingEditor, setShowTimingEditor] = useState(false)

  // Gallery & selection
  const [gallery, setGallery] = useState<GalleryItem[]>([])
  const [selected, setSelected] = useState<GalleryItem | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showAnimPicker, setShowAnimPicker] = useState(false)
  const [showExportModal, setShowExportModal] = useState(false)

  // Animation playback with custom timing
  const [frame, setFrame] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [globalSpeed, setGlobalSpeed] = useState(150)
  const [frameTiming, setFrameTiming] = useState<FrameTiming[]>([])
  const frameTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Fetch balance
  const fetchBalance = useCallback(async () => {
    try {
      const res = await fetch('/api/pixellab', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'balance' }),
      })
      const data = await res.json()
      if (res.ok) setBalance(data.balance || 0)
    } catch { /* ignore */ }
  }, [])

  // Load on mount
  useEffect(() => {
    setGallery(loadGallery())
    fetchBalance()
  }, [fetchBalance])

  // Initialize frame timing when animation changes
  useEffect(() => {
    if (selected?.images) {
      const savedTiming = selected.frameTiming
      if (savedTiming && savedTiming.length === selected.images.length) {
        setFrameTiming(savedTiming)
      } else {
        setFrameTiming(selected.images.map(() => ({ duration: globalSpeed })))
      }
    }
  }, [selected?.id, selected?.images, selected?.frameTiming, globalSpeed])

  // Animation loop with per-frame timing
  useEffect(() => {
    if (!selected?.images || !playing || frameTiming.length === 0) return

    const scheduleNext = () => {
      const currentDuration = frameTiming[frame]?.duration || globalSpeed
      frameTimeoutRef.current = setTimeout(() => {
        setFrame(f => (f + 1) % selected.images!.length)
      }, currentDuration)
    }

    scheduleNext()
    return () => {
      if (frameTimeoutRef.current) clearTimeout(frameTimeoutRef.current)
    }
  }, [selected, playing, frame, frameTiming, globalSpeed])

  // Reset frame when selection changes
  useEffect(() => {
    setFrame(0)
    setPlaying(true)
    setShowAnimPicker(false)
    setShowTimingEditor(false)
  }, [selected?.id])

  // Gallery helpers
  const addToGallery = (item: GalleryItem) => {
    const updated = [item, ...gallery].slice(0, 50)
    setGallery(updated)
    saveGallery(updated)
  }

  const updateGalleryItem = (id: string, updates: Partial<GalleryItem>) => {
    const updated = gallery.map(g => g.id === id ? { ...g, ...updates } : g)
    setGallery(updated)
    saveGallery(updated)
    if (selected?.id === id) {
      setSelected({ ...selected, ...updates })
    }
  }

  const deleteItem = (id: string) => {
    const updated = gallery.filter(g => g.id !== id)
    setGallery(updated)
    saveGallery(updated)
    if (selected?.id === id) setSelected(null)
  }

  // Update single frame timing
  const updateFrameDuration = (frameIndex: number, duration: number) => {
    const newTiming = [...frameTiming]
    newTiming[frameIndex] = { duration }
    setFrameTiming(newTiming)
  }

  // Apply preset to range of frames
  const applyPresetToRange = (startFrame: number, endFrame: number, duration: number) => {
    const newTiming = [...frameTiming]
    for (let i = startFrame; i <= endFrame && i < newTiming.length; i++) {
      newTiming[i] = { duration }
    }
    setFrameTiming(newTiming)
  }

  // Save timing to gallery item
  const saveTimingToItem = () => {
    if (selected) {
      updateGalleryItem(selected.id, { frameTiming })
    }
  }

  // Mirror image (no AI - pure canvas flip)
  const mirrorSelectedImage = async () => {
    if (!selected) return

    setLoading(true)
    setLoadingMsg('Mirroring image...')

    try {
      if (selected.type === 'sprite' && selected.image) {
        const mirrored = await mirrorImage(selected.image)
        const item: GalleryItem = {
          id: Date.now().toString(),
          type: 'sprite',
          image: mirrored,
          prompt: selected.prompt + ' (mirrored)',
          size: selected.size,
          usage: 0,
          createdAt: Date.now(),
        }
        addToGallery(item)
        setSelected(item)
      } else if (selected.type === 'animation' && selected.images) {
        const mirroredFrames = await Promise.all(selected.images.map(mirrorImage))
        const item: GalleryItem = {
          id: Date.now().toString(),
          type: 'animation',
          images: mirroredFrames,
          prompt: selected.prompt + ' (mirrored)',
          size: selected.size,
          animAction: selected.animAction + '-mirrored',
          usage: 0,
          createdAt: Date.now(),
          frameTiming: selected.frameTiming,
        }
        addToGallery(item)
        setSelected(item)
      }
    } catch (err) {
      setError('Failed to mirror image')
    } finally {
      setLoading(false)
      setLoadingMsg('')
    }
  }

  // Toggle selection for batch export
  const toggleSelectForExport = (id: string) => {
    const newSet = new Set(selectedIds)
    if (newSet.has(id)) {
      newSet.delete(id)
    } else {
      newSet.add(id)
    }
    setSelectedIds(newSet)
  }

  // Select all animations for export
  const selectAllAnimations = () => {
    const animIds = gallery.filter(g => g.type === 'animation').map(g => g.id)
    setSelectedIds(new Set(animIds))
  }

  // Comprehensive export: individual frames + sprite sheets + combined sheet
  const exportComprehensive = async () => {
    const itemsToExport = gallery.filter(g => selectedIds.has(g.id) && g.type === 'animation')

    if (itemsToExport.length === 0) {
      setError('Select at least one animation to export')
      return
    }

    setLoading(true)
    setLoadingMsg('Creating export package...')

    try {
      const zip = new JSZip()

      // 1. Individual frames per animation
      const individualsFolder = zip.folder('individual_frames')!
      for (const item of itemsToExport) {
        if (!item.images) continue
        const animFolder = individualsFolder.folder(item.animAction || 'animation')!
        for (let i = 0; i < item.images.length; i++) {
          const blob = dataUrlToBlob(item.images[i])
          animFolder.file(`frame_${i.toString().padStart(2, '0')}.png`, blob)
        }
      }

      // 2. Sprite sheet per animation (horizontal strip)
      const sheetsFolder = zip.folder('sprite_sheets')!
      for (const item of itemsToExport) {
        if (!item.images) continue
        const sheet = await createSpriteSheet(item.images, item.size)
        const blob = dataUrlToBlob(sheet)
        sheetsFolder.file(`${item.animAction || 'animation'}_sheet.png`, blob)
      }

      // 3. Combined sprite sheet (all animations in grid)
      const animations = itemsToExport
        .filter(item => item.images && item.images.length > 0)
        .map(item => ({
          name: item.animAction || 'animation',
          images: item.images!,
          size: item.size,
        }))

      if (animations.length > 0) {
        const combinedSheet = await createCombinedSpriteSheet(animations)
        const combinedBlob = dataUrlToBlob(combinedSheet)
        zip.file('combined_spritesheet.png', combinedBlob)
      }

      // 4. Metadata/settings JSON
      const metadata = {
        exportDate: new Date().toISOString(),
        animations: itemsToExport.map(item => ({
          name: item.animAction,
          frameCount: item.images?.length || 0,
          size: item.size,
          frameTiming: item.frameTiming,
        })),
        totalFrames: itemsToExport.reduce((sum, item) => sum + (item.images?.length || 0), 0),
      }
      zip.file('metadata.json', JSON.stringify(metadata, null, 2))

      // Generate and download
      const content = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(content)
      const a = document.createElement('a')
      a.href = url
      a.download = `sprite_export_${Date.now()}.zip`
      a.click()
      URL.revokeObjectURL(url)

      setShowExportModal(false)
      setSelectedIds(new Set())
    } catch (err) {
      setError('Export failed: ' + (err instanceof Error ? err.message : 'Unknown error'))
    } finally {
      setLoading(false)
      setLoadingMsg('')
    }
  }

  // Simple single animation export
  const exportImages = async () => {
    if (!selected?.images) return

    const zip = new JSZip()
    const folder = zip.folder(selected.animAction || 'sprite')!

    for (let i = 0; i < selected.images.length; i++) {
      const blob = dataUrlToBlob(selected.images[i])
      folder.file(`frame_${i.toString().padStart(2, '0')}.png`, blob)
    }

    // Add sprite sheet
    const sheet = await createSpriteSheet(selected.images, selected.size)
    folder.file('spritesheet.png', dataUrlToBlob(sheet))

    // Add settings JSON
    const settings: ExportSettings = {
      name: selected.animAction || 'animation',
      size: selected.size,
      animAction: selected.animAction,
      frameTiming: frameTiming,
      totalDuration: frameTiming.reduce((sum, f) => sum + f.duration, 0),
    }
    folder.file('settings.json', JSON.stringify(settings, null, 2))

    const content = await zip.generateAsync({ type: 'blob' })
    const url = URL.createObjectURL(content)
    const a = document.createElement('a')
    a.href = url
    a.download = `${selected.animAction || 'sprite'}_${selected.size}px.zip`
    a.click()
    URL.revokeObjectURL(url)
  }

  const exportSingleFrame = (frameIndex: number) => {
    if (!selected?.images?.[frameIndex]) return
    const a = document.createElement('a')
    a.href = selected.images[frameIndex]
    a.download = `${selected.animAction || 'sprite'}_frame_${frameIndex}.png`
    a.click()
  }

  // API: Generate sprite
  const generateSprite = async () => {
    setLoading(true)
    setLoadingMsg('Generating sprite...')
    setError(null)

    try {
      const res = await fetch('/api/pixellab', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate',
          description: prompt,
          width: size,
          height: size,
          noBackground: true,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      const item: GalleryItem = {
        id: Date.now().toString(),
        type: 'sprite',
        image: data.image,
        prompt,
        size,
        usage: data.usage || 0,
        createdAt: Date.now(),
      }
      addToGallery(item)
      setSelected(item)
      fetchBalance()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate')
    } finally {
      setLoading(false)
      setLoadingMsg('')
    }
  }

  // API: Animate sprite
  const animateSprite = async (action: string) => {
    if (!selected?.image) return

    setShowAnimPicker(false)
    setLoading(true)
    setLoadingMsg(`Creating ${action} animation...`)
    setError(null)

    try {
      const base64 = selected.image.split(',')[1]
      const spriteSize = selected.size

      if (spriteSize <= 64) {
        const res = await fetch('/api/pixellab', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'animate',
            description: selected.prompt,
            animationAction: action,
            referenceImage: base64,
            noBackground: true,
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error)

        const item: GalleryItem = {
          id: Date.now().toString(),
          type: 'animation',
          images: data.images,
          prompt: selected.prompt,
          size: 64,
          animAction: action,
          usage: data.usage || 0,
          createdAt: Date.now(),
        }
        addToGallery(item)
        setSelected(item)
        fetchBalance()
        return
      }

      setLoadingMsg(`Starting ${action} animation...`)
      const startRes = await fetch('/api/pixellab', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'animate-v3-start',
          firstFrame: base64,
          animationAction: action,
          width: spriteSize,
          height: spriteSize,
          frameCount: 8,
          noBackground: true,
        }),
      })
      const startData = await startRes.json()
      if (!startRes.ok) throw new Error(startData.error)

      const jobId = startData.jobId
      setLoadingMsg('Rendering... (30-60s)')

      let attempts = 0
      while (attempts < 60) {
        await new Promise(r => setTimeout(r, 3000))
        attempts++

        const statusRes = await fetch('/api/pixellab', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'animate-v3-status', jobId }),
        })
        const status = await statusRes.json()

        if (status.status === 'completed') {
          const item: GalleryItem = {
            id: Date.now().toString(),
            type: 'animation',
            images: status.images,
            prompt: selected.prompt,
            size: spriteSize,
            animAction: action,
            usage: status.usage || 0,
            createdAt: Date.now(),
          }
          addToGallery(item)
          setSelected(item)
          fetchBalance()
          return
        } else if (status.status === 'failed') {
          throw new Error(status.error || 'Animation failed')
        }

        setLoadingMsg(`Rendering... (${attempts * 3}s)`)
      }

      throw new Error('Animation timed out')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to animate')
    } finally {
      setLoading(false)
      setLoadingMsg('')
    }
  }

  const checkerBg = {
    background: `
      linear-gradient(45deg, #1a1a1a 25%, transparent 25%, transparent 75%, #1a1a1a 75%),
      linear-gradient(45deg, #1a1a1a 25%, transparent 25%, transparent 75%, #1a1a1a 75%)
    `,
    backgroundSize: '12px 12px',
    backgroundPosition: '0 0, 6px 6px',
    backgroundColor: '#252525',
  }

  const totalDuration = frameTiming.reduce((sum, f) => sum + f.duration, 0)

  return (
    <div style={{ minHeight: '100vh', background: '#0d0d0d', color: '#e0e0e0', fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <header style={{ padding: '1rem 2rem', borderBottom: '1px solid #222', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, background: '#0d0d0d', zIndex: 100 }}>
        <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>Sprite Generator</h1>
        <span style={{ color: '#4ecdc4', fontFamily: 'monospace' }}>${balance?.toFixed(4) || '-.--'}</span>
      </header>

      <main style={{ maxWidth: 1000, margin: '0 auto', padding: '2rem' }}>
        {/* Generate Section */}
        <section style={{ marginBottom: '3rem' }}>
          <h2 style={{ fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.6, marginBottom: '1rem' }}>Generate</h2>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <input
              type="text"
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="Describe your character..."
              style={{ flex: 1, minWidth: 200, padding: '0.75rem 1rem', background: '#1a1a1a', border: '1px solid #333', borderRadius: '8px', color: '#fff', fontSize: '0.9375rem' }}
            />
            <select
              value={size}
              onChange={e => setSize(Number(e.target.value))}
              style={{ padding: '0.75rem 1rem', background: '#1a1a1a', border: '1px solid #333', borderRadius: '8px', color: '#fff' }}
            >
              <option value={32}>32px</option>
              <option value={64}>64px</option>
              <option value={128}>128px</option>
            </select>
            <button
              onClick={generateSprite}
              disabled={loading || !prompt.trim()}
              style={{ padding: '0.75rem 2rem', background: loading ? '#333' : '#4a9eff', border: 'none', borderRadius: '8px', color: '#fff', fontWeight: 600, cursor: loading ? 'wait' : 'pointer', minWidth: 120 }}
            >
              {loading && loadingMsg.includes('Generating') ? loadingMsg : 'Generate'}
            </button>
          </div>
        </section>

        {/* Error */}
        {error && (
          <div style={{ padding: '1rem', background: '#ff4444', borderRadius: '8px', marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{error}</span>
            <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '1.25rem' }}>×</button>
          </div>
        )}

        {/* Gallery */}
        <section style={{ marginBottom: '3rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.6, margin: 0 }}>
              Gallery {gallery.length > 0 && `(${gallery.length})`}
            </h2>
            {gallery.filter(g => g.type === 'animation').length > 0 && (
              <button
                onClick={() => setShowExportModal(true)}
                style={{ padding: '0.5rem 1rem', background: '#4ecdc4', border: 'none', borderRadius: '6px', color: '#000', cursor: 'pointer', fontSize: '0.8125rem', fontWeight: 600 }}
              >
                Batch Export
              </button>
            )}
          </div>
          {gallery.length === 0 ? (
            <p style={{ opacity: 0.4 }}>Generated sprites will appear here</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', gap: '0.75rem' }}>
              {gallery.map(item => (
                <div
                  key={item.id}
                  onClick={() => setSelected(item)}
                  style={{
                    aspectRatio: '1',
                    ...checkerBg,
                    borderRadius: '8px',
                    cursor: 'pointer',
                    border: selected?.id === item.id ? '2px solid #4ecdc4' : '2px solid transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    position: 'relative',
                    transition: 'transform 0.1s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.05)')}
                  onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
                >
                  <img
                    src={item.type === 'animation' ? item.images?.[0] : item.image}
                    alt=""
                    style={{ width: '80%', height: '80%', objectFit: 'contain', imageRendering: 'pixelated' }}
                  />
                  {item.type === 'animation' && (
                    <div style={{ position: 'absolute', bottom: 4, right: 4, background: '#4ecdc4', color: '#000', fontSize: '9px', padding: '2px 4px', borderRadius: '3px', fontWeight: 600 }}>
                      {item.animAction?.slice(0, 4).toUpperCase()}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Selected Item Preview */}
        {selected && (
          <section style={{ background: '#1a1a1a', borderRadius: '12px', padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.125rem' }}>
                  {selected.type === 'animation' ? `${selected.animAction} animation` : 'Sprite'}
                </h3>
                <span style={{ fontSize: '0.8125rem', opacity: 0.5 }}>{selected.size}px · ${selected.usage?.toFixed(4)}</span>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button
                  onClick={mirrorSelectedImage}
                  disabled={loading}
                  style={{ background: '#6366f1', border: 'none', borderRadius: '6px', padding: '0.5rem 1rem', color: '#fff', cursor: loading ? 'wait' : 'pointer', fontSize: '0.8125rem', fontWeight: 600 }}
                >
                  Mirror
                </button>
                {selected.type === 'animation' && (
                  <button
                    onClick={exportImages}
                    style={{ background: '#4ecdc4', border: 'none', borderRadius: '6px', padding: '0.5rem 1rem', color: '#000', cursor: 'pointer', fontSize: '0.8125rem', fontWeight: 600 }}
                  >
                    Export ZIP
                  </button>
                )}
                <button
                  onClick={() => deleteItem(selected.id)}
                  style={{ background: '#ff444433', border: '1px solid #ff4444', borderRadius: '6px', padding: '0.5rem 1rem', color: '#ff6666', cursor: 'pointer', fontSize: '0.8125rem' }}
                >
                  Delete
                </button>
              </div>
            </div>

            {/* Preview Image */}
            <div style={{ ...checkerBg, padding: '2rem', borderRadius: '8px', display: 'flex', justifyContent: 'center', marginBottom: '1.5rem' }}>
              <img
                src={selected.type === 'animation' ? selected.images?.[frame] : selected.image}
                alt=""
                style={{ width: Math.max(selected.size * 3, 128), height: Math.max(selected.size * 3, 128), imageRendering: 'pixelated' }}
              />
            </div>

            {/* Animation Controls */}
            {selected.type === 'animation' && selected.images && (
              <div style={{ marginBottom: '1.5rem' }}>
                {/* Playback controls */}
                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => setPlaying(!playing)}
                    style={{ padding: '0.5rem 1rem', background: playing ? '#ff6b6b' : '#4ecdc4', border: 'none', borderRadius: '6px', color: '#fff', cursor: 'pointer', fontWeight: 600 }}
                  >
                    {playing ? 'Pause' : 'Play'}
                  </button>
                  <button onClick={() => { setPlaying(false); setFrame(f => (f - 1 + selected.images!.length) % selected.images!.length) }} style={{ padding: '0.5rem 0.75rem', background: '#333', border: 'none', borderRadius: '6px', color: '#fff', cursor: 'pointer' }}>◀</button>
                  <span style={{ minWidth: 60, textAlign: 'center', fontFamily: 'monospace' }}>{frame + 1} / {selected.images.length}</span>
                  <button onClick={() => { setPlaying(false); setFrame(f => (f + 1) % selected.images!.length) }} style={{ padding: '0.5rem 0.75rem', background: '#333', border: 'none', borderRadius: '6px', color: '#fff', cursor: 'pointer' }}>▶</button>
                  <span style={{ fontSize: '0.75rem', opacity: 0.6, marginLeft: '0.5rem' }}>
                    Total: {totalDuration}ms ({(1000 / (totalDuration / selected.images.length)).toFixed(1)} fps avg)
                  </span>
                </div>

                {/* Frame thumbnails with timing */}
                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap', marginBottom: '1rem' }}>
                  {selected.images.map((img, i) => (
                    <div key={i} style={{ textAlign: 'center' }}>
                      <img
                        src={img}
                        alt={`Frame ${i + 1}`}
                        onClick={() => { setFrame(i); setPlaying(false) }}
                        onDoubleClick={() => exportSingleFrame(i)}
                        title="Click to select, double-click to download"
                        style={{
                          width: 48,
                          height: 48,
                          imageRendering: 'pixelated',
                          border: i === frame ? '2px solid #4ecdc4' : '2px solid #333',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          background: '#252525',
                        }}
                      />
                      <div style={{ fontSize: '10px', opacity: 0.6, marginTop: '2px' }}>
                        {frameTiming[i]?.duration || globalSpeed}ms
                      </div>
                    </div>
                  ))}
                </div>

                {/* Timing Editor Toggle */}
                <button
                  onClick={() => setShowTimingEditor(!showTimingEditor)}
                  style={{ width: '100%', padding: '0.5rem', background: showTimingEditor ? '#333' : '#252525', border: '1px solid #444', borderRadius: '6px', color: '#fff', cursor: 'pointer', marginBottom: showTimingEditor ? '1rem' : 0 }}
                >
                  {showTimingEditor ? '▼ Hide Timing Editor' : '▶ Speed Curve Editor'}
                </button>

                {/* Timing Editor */}
                {showTimingEditor && (
                  <div style={{ background: '#0d0d0d', borderRadius: '8px', padding: '1rem' }}>
                    {/* Global speed */}
                    <div style={{ marginBottom: '1rem' }}>
                      <label style={{ fontSize: '0.75rem', opacity: 0.6, display: 'block', marginBottom: '0.5rem' }}>Global Speed (applies to all frames)</label>
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        {Object.entries(SPEED_PRESETS).map(([name, ms]) => (
                          <button
                            key={name}
                            onClick={() => {
                              setGlobalSpeed(ms)
                              setFrameTiming(selected.images!.map(() => ({ duration: ms })))
                            }}
                            style={{
                              padding: '0.25rem 0.75rem',
                              background: globalSpeed === ms ? '#4ecdc4' : '#333',
                              color: globalSpeed === ms ? '#000' : '#fff',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontSize: '0.75rem',
                            }}
                          >
                            {name} ({ms}ms)
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Per-frame timing */}
                    <div style={{ marginBottom: '1rem' }}>
                      <label style={{ fontSize: '0.75rem', opacity: 0.6, display: 'block', marginBottom: '0.5rem' }}>Per-Frame Duration (ms)</label>
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                        {frameTiming.map((ft, i) => (
                          <div key={i} style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '10px', opacity: 0.5, marginBottom: '2px' }}>F{i + 1}</div>
                            <input
                              type="number"
                              value={ft.duration}
                              onChange={e => updateFrameDuration(i, Math.max(10, parseInt(e.target.value) || 100))}
                              style={{
                                width: 50,
                                padding: '0.25rem',
                                background: i === frame ? '#4ecdc4' : '#252525',
                                color: i === frame ? '#000' : '#fff',
                                border: '1px solid #444',
                                borderRadius: '4px',
                                textAlign: 'center',
                                fontSize: '0.75rem',
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Quick patterns */}
                    <div style={{ marginBottom: '1rem' }}>
                      <label style={{ fontSize: '0.75rem', opacity: 0.6, display: 'block', marginBottom: '0.5rem' }}>Quick Patterns</label>
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <button
                          onClick={() => {
                            const half = Math.floor(frameTiming.length / 2)
                            applyPresetToRange(0, half - 1, 200)
                            applyPresetToRange(half, frameTiming.length - 1, 80)
                          }}
                          style={{ padding: '0.25rem 0.75rem', background: '#333', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer', fontSize: '0.75rem' }}
                        >
                          Slow → Fast
                        </button>
                        <button
                          onClick={() => {
                            const half = Math.floor(frameTiming.length / 2)
                            applyPresetToRange(0, half - 1, 80)
                            applyPresetToRange(half, frameTiming.length - 1, 200)
                          }}
                          style={{ padding: '0.25rem 0.75rem', background: '#333', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer', fontSize: '0.75rem' }}
                        >
                          Fast → Slow
                        </button>
                        <button
                          onClick={() => {
                            const third = Math.floor(frameTiming.length / 3)
                            applyPresetToRange(0, third - 1, 200)
                            applyPresetToRange(third, third * 2 - 1, 50)
                            applyPresetToRange(third * 2, frameTiming.length - 1, 300)
                          }}
                          style={{ padding: '0.25rem 0.75rem', background: '#333', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer', fontSize: '0.75rem' }}
                        >
                          Slow → Fast → Hold
                        </button>
                        <button
                          onClick={() => {
                            setFrameTiming(frameTiming.map((_, i) => ({
                              duration: i === 0 || i === frameTiming.length - 1 ? 300 : 80
                            })))
                          }}
                          style={{ padding: '0.25rem 0.75rem', background: '#333', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer', fontSize: '0.75rem' }}
                        >
                          Hold Ends
                        </button>
                      </div>
                    </div>

                    {/* Save timing */}
                    <button
                      onClick={saveTimingToItem}
                      style={{ width: '100%', padding: '0.5rem', background: '#4a9eff', border: 'none', borderRadius: '6px', color: '#fff', cursor: 'pointer', fontWeight: 600 }}
                    >
                      Save Timing to Animation
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Actions for sprites */}
            {selected.type === 'sprite' && (
              <div>
                {loading ? (
                  <div style={{ width: '100%', padding: '1rem', background: '#333', borderRadius: '8px', textAlign: 'center' }}>
                    <span style={{ color: '#4ecdc4' }}>{loadingMsg || 'Processing...'}</span>
                  </div>
                ) : !showAnimPicker ? (
                  <button
                    onClick={() => setShowAnimPicker(true)}
                    style={{ width: '100%', padding: '1rem', background: '#4ecdc4', border: 'none', borderRadius: '8px', color: '#000', fontWeight: 600, cursor: 'pointer', fontSize: '1rem' }}
                  >
                    Animate This Sprite
                  </button>
                ) : (
                  <div>
                    <p style={{ marginBottom: '0.75rem', opacity: 0.7, textAlign: 'center' }}>Choose animation type:</p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: '0.5rem' }}>
                      {ANIMATION_TYPES.map(type => (
                        <button
                          key={type}
                          onClick={() => animateSprite(type)}
                          style={{
                            padding: '0.75rem',
                            background: '#252525',
                            border: '1px solid #444',
                            borderRadius: '6px',
                            color: '#fff',
                            cursor: 'pointer',
                            textTransform: 'capitalize',
                            transition: 'background 0.1s',
                          }}
                          onMouseEnter={e => (e.currentTarget.style.background = '#333')}
                          onMouseLeave={e => (e.currentTarget.style.background = '#252525')}
                        >
                          {type}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => setShowAnimPicker(false)}
                      style={{ width: '100%', marginTop: '0.75rem', padding: '0.5rem', background: 'transparent', border: '1px solid #333', borderRadius: '6px', color: '#888', cursor: 'pointer' }}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Prompt */}
            <div style={{ marginTop: '1.5rem', padding: '0.75rem', background: '#0d0d0d', borderRadius: '6px', fontSize: '0.8125rem' }}>
              <span style={{ opacity: 0.5 }}>Prompt: </span>{selected.prompt}
            </div>
          </section>
        )}
      </main>

      {/* Batch Export Modal */}
      {showExportModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setShowExportModal(false)}
        >
          <div
            style={{
              background: '#1a1a1a',
              borderRadius: '12px',
              padding: '1.5rem',
              maxWidth: 600,
              width: '90%',
              maxHeight: '80vh',
              overflow: 'auto',
            }}
            onClick={e => e.stopPropagation()}
          >
            <h2 style={{ margin: '0 0 1rem 0', fontSize: '1.25rem' }}>Batch Export Sprites</h2>
            <p style={{ opacity: 0.6, fontSize: '0.875rem', marginBottom: '1rem' }}>
              Select animations to export. Package includes: individual frames, sprite sheets per animation, and a combined master sheet.
            </p>

            {/* Quick actions */}
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
              <button
                onClick={selectAllAnimations}
                style={{ padding: '0.5rem 1rem', background: '#333', border: 'none', borderRadius: '6px', color: '#fff', cursor: 'pointer', fontSize: '0.75rem' }}
              >
                Select All
              </button>
              <button
                onClick={() => setSelectedIds(new Set())}
                style={{ padding: '0.5rem 1rem', background: '#333', border: 'none', borderRadius: '6px', color: '#fff', cursor: 'pointer', fontSize: '0.75rem' }}
              >
                Clear Selection
              </button>
            </div>

            {/* Animation list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.5rem' }}>
              {gallery.filter(g => g.type === 'animation').map(item => (
                <label
                  key={item.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    padding: '0.75rem',
                    background: selectedIds.has(item.id) ? '#4ecdc422' : '#252525',
                    border: selectedIds.has(item.id) ? '1px solid #4ecdc4' : '1px solid #333',
                    borderRadius: '8px',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(item.id)}
                    onChange={() => toggleSelectForExport(item.id)}
                    style={{ width: 18, height: 18 }}
                  />
                  <img
                    src={item.images?.[0]}
                    alt=""
                    style={{ width: 40, height: 40, imageRendering: 'pixelated', background: '#333', borderRadius: '4px' }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>{item.animAction}</div>
                    <div style={{ fontSize: '0.75rem', opacity: 0.6 }}>
                      {item.images?.length} frames · {item.size}px
                    </div>
                  </div>
                </label>
              ))}
            </div>

            {/* Export info */}
            {selectedIds.size > 0 && (
              <div style={{ padding: '0.75rem', background: '#0d0d0d', borderRadius: '6px', marginBottom: '1rem', fontSize: '0.8125rem' }}>
                <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Export will include:</div>
                <ul style={{ margin: 0, paddingLeft: '1.25rem', opacity: 0.7 }}>
                  <li>{gallery.filter(g => selectedIds.has(g.id)).reduce((sum, g) => sum + (g.images?.length || 0), 0)} individual frame PNGs</li>
                  <li>{selectedIds.size} sprite sheet{selectedIds.size > 1 ? 's' : ''} (horizontal strips)</li>
                  <li>1 combined master sprite sheet</li>
                  <li>metadata.json with frame timings</li>
                </ul>
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowExportModal(false)}
                style={{ padding: '0.75rem 1.5rem', background: '#333', border: 'none', borderRadius: '6px', color: '#fff', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={exportComprehensive}
                disabled={selectedIds.size === 0 || loading}
                style={{
                  padding: '0.75rem 1.5rem',
                  background: selectedIds.size === 0 ? '#333' : '#4ecdc4',
                  border: 'none',
                  borderRadius: '6px',
                  color: selectedIds.size === 0 ? '#666' : '#000',
                  cursor: selectedIds.size === 0 || loading ? 'not-allowed' : 'pointer',
                  fontWeight: 600,
                }}
              >
                {loading ? 'Exporting...' : `Export ${selectedIds.size} Animation${selectedIds.size !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
