/**
 * GAME ENGINE - Template Editor
 * Isometric level editor with ASCII tiles
 *
 * URL Params:
 * - ?new=1  - Start with random map
 * - ?id=xxx - Load existing template
 *
 * VIEW MODES (buttons in top-right):
 * - ISO: Isometric 3D game view
 * - TOP: 2D bird's-eye blueprint (no height)
 * - DEBUG: Isometric + collision overlay, asset labels
 */
import { useRef, useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import Link from 'next/link'
import { createVillageLevel, VILLAGE_CONFIG, GROUND_COLORS } from '@/levels/village'
import { IsometricGrid, GridAsset } from '@/engine/IsometricGrid'
import { player as playerSprite } from '@/assets/ascii'
import { TILES, COMPOSITE_ASSETS, getTilesByCategory, getAssetsByCategory, TileDef, CompositeAsset } from '@/engine/Tileset'
import { listTemplates, getTemplate, createTemplate, updateTemplate, deleteTemplate, serializeGrid, deserializeToGrid, TemplateListItem, Connector } from '@/lib/api'

const ASCII_FONT = '"JetBrains Mono", "Fira Code", "Consolas", monospace'

// Block-based sizing: each block is 16x16x16 (width x depth x height)
const BLOCK_SIZE = 16

// Character dimensions in blocks
const CHAR_WIDTH = 1   // 1 block wide
const CHAR_DEPTH = 1   // 1 block deep
const CHAR_HEIGHT = 3  // 3 blocks tall (legs, body, head)

// View mode states (global for game loop access)
let debugMode = false
let topViewMode = false
let flowViewMode = false

// Template limits
const MAX_TEMPLATES_PROD = 1

// ═══════════════════════════════════════════════════════════════════
// TEMPLATE PRESET SYSTEM
// Categorized by: Size (S/M/L) × Theme × Type (exterior/interior)
// ═══════════════════════════════════════════════════════════════════

type TemplateSize = 'small' | 'medium' | 'large'
type TemplateTheme = 'village' | 'forest' | 'castle' | 'ice' | 'desert' | 'dungeon'
type TemplateType = 'exterior' | 'interior'

interface TemplatePreset {
  id: string
  name: string
  description: string
  size: TemplateSize
  theme: TemplateTheme
  type: TemplateType
  // Grid dimensions
  cols: { min: number; max: number }
  rows: { min: number; max: number }
  // Road system
  roads: {
    enabled: boolean
    pattern: 'grid' | 'cross' | 'winding' | 'single' | 'none'
    width: number // 1-3
  }
  // Water features
  water: {
    type: 'river' | 'lake' | 'ocean' | 'moat' | 'none'
    coverage: number // 0-1
  }
  // Buildings
  buildings: {
    count: { min: number; max: number }
    types: ('house' | 'shop' | 'tower' | 'castle' | 'hut')[]
    hasPlaza: boolean
  }
  // Nature
  nature: {
    treeDensity: number // 0-1
    bushDensity: number // 0-1
    flowerDensity: number // 0-1
    rockDensity: number // 0-1
  }
  // NPCs
  npcs: {
    enabled: boolean
    count: { min: number; max: number }
  }
  // Ground colors
  groundType: 'grass' | 'stone' | 'sand' | 'snow' | 'wood'
  // Walls (for interiors)
  walls?: {
    enabled: boolean
    thickness: number
  }
}

const TEMPLATE_PRESETS: Record<string, TemplatePreset> = {
  // ─── VILLAGES ─────────────────────────────────────────────────────
  'village-small': {
    id: 'village-small',
    name: 'Small Village',
    description: 'Cozy hamlet with a few houses',
    size: 'small',
    theme: 'village',
    type: 'exterior',
    cols: { min: 30, max: 40 },
    rows: { min: 30, max: 40 },
    roads: { enabled: true, pattern: 'cross', width: 2 },
    water: { type: 'lake', coverage: 0.05 },
    buildings: { count: { min: 3, max: 5 }, types: ['house', 'shop'], hasPlaza: true },
    nature: { treeDensity: 0.25, bushDensity: 0.1, flowerDensity: 0.05, rockDensity: 0.02 },
    npcs: { enabled: true, count: { min: 2, max: 4 } },
    groundType: 'grass',
  },
  'village-medium': {
    id: 'village-medium',
    name: 'Town',
    description: 'Bustling town with markets and homes',
    size: 'medium',
    theme: 'village',
    type: 'exterior',
    cols: { min: 50, max: 65 },
    rows: { min: 50, max: 65 },
    roads: { enabled: true, pattern: 'grid', width: 2 },
    water: { type: 'river', coverage: 0.08 },
    buildings: { count: { min: 6, max: 10 }, types: ['house', 'shop', 'tower'], hasPlaza: true },
    nature: { treeDensity: 0.2, bushDensity: 0.08, flowerDensity: 0.04, rockDensity: 0.02 },
    npcs: { enabled: true, count: { min: 4, max: 8 } },
    groundType: 'grass',
  },
  'village-large': {
    id: 'village-large',
    name: 'City',
    description: 'Large city with districts',
    size: 'large',
    theme: 'village',
    type: 'exterior',
    cols: { min: 80, max: 100 },
    rows: { min: 80, max: 100 },
    roads: { enabled: true, pattern: 'grid', width: 3 },
    water: { type: 'river', coverage: 0.1 },
    buildings: { count: { min: 12, max: 20 }, types: ['house', 'shop', 'tower', 'castle'], hasPlaza: true },
    nature: { treeDensity: 0.15, bushDensity: 0.05, flowerDensity: 0.03, rockDensity: 0.01 },
    npcs: { enabled: true, count: { min: 8, max: 15 } },
    groundType: 'grass',
  },

  // ─── FORESTS ──────────────────────────────────────────────────────
  'forest-small': {
    id: 'forest-small',
    name: 'Forest Clearing',
    description: 'Small woodland area',
    size: 'small',
    theme: 'forest',
    type: 'exterior',
    cols: { min: 30, max: 40 },
    rows: { min: 30, max: 40 },
    roads: { enabled: true, pattern: 'winding', width: 1 },
    water: { type: 'lake', coverage: 0.08 },
    buildings: { count: { min: 0, max: 1 }, types: ['hut'], hasPlaza: false },
    nature: { treeDensity: 0.5, bushDensity: 0.2, flowerDensity: 0.08, rockDensity: 0.05 },
    npcs: { enabled: false, count: { min: 0, max: 1 } },
    groundType: 'grass',
  },
  'forest-large': {
    id: 'forest-large',
    name: 'Deep Woods',
    description: 'Dense forest with hidden paths',
    size: 'large',
    theme: 'forest',
    type: 'exterior',
    cols: { min: 70, max: 90 },
    rows: { min: 70, max: 90 },
    roads: { enabled: true, pattern: 'winding', width: 1 },
    water: { type: 'river', coverage: 0.1 },
    buildings: { count: { min: 1, max: 3 }, types: ['hut', 'tower'], hasPlaza: false },
    nature: { treeDensity: 0.6, bushDensity: 0.25, flowerDensity: 0.1, rockDensity: 0.08 },
    npcs: { enabled: true, count: { min: 1, max: 3 } },
    groundType: 'grass',
  },

  // ─── CASTLES ──────────────────────────────────────────────────────
  'castle-exterior': {
    id: 'castle-exterior',
    name: 'Castle Grounds',
    description: 'Fortified castle with courtyard',
    size: 'large',
    theme: 'castle',
    type: 'exterior',
    cols: { min: 60, max: 80 },
    rows: { min: 60, max: 80 },
    roads: { enabled: true, pattern: 'cross', width: 3 },
    water: { type: 'moat', coverage: 0.15 },
    buildings: { count: { min: 4, max: 8 }, types: ['castle', 'tower', 'house'], hasPlaza: true },
    nature: { treeDensity: 0.1, bushDensity: 0.05, flowerDensity: 0.02, rockDensity: 0.03 },
    npcs: { enabled: true, count: { min: 4, max: 8 } },
    groundType: 'grass',
  },
  'castle-interior': {
    id: 'castle-interior',
    name: 'Castle Hall',
    description: 'Grand interior hall',
    size: 'medium',
    theme: 'castle',
    type: 'interior',
    cols: { min: 25, max: 35 },
    rows: { min: 20, max: 30 },
    roads: { enabled: false, pattern: 'none', width: 0 },
    water: { type: 'none', coverage: 0 },
    buildings: { count: { min: 0, max: 0 }, types: [], hasPlaza: false },
    nature: { treeDensity: 0, bushDensity: 0, flowerDensity: 0.02, rockDensity: 0 },
    npcs: { enabled: true, count: { min: 2, max: 5 } },
    groundType: 'stone',
    walls: { enabled: true, thickness: 2 },
  },

  // ─── ICE THEME ────────────────────────────────────────────────────
  'ice-village': {
    id: 'ice-village',
    name: 'Frozen Village',
    description: 'Snow-covered settlement',
    size: 'medium',
    theme: 'ice',
    type: 'exterior',
    cols: { min: 45, max: 60 },
    rows: { min: 45, max: 60 },
    roads: { enabled: true, pattern: 'cross', width: 2 },
    water: { type: 'lake', coverage: 0.1 }, // Frozen lake
    buildings: { count: { min: 4, max: 7 }, types: ['house', 'tower'], hasPlaza: true },
    nature: { treeDensity: 0.15, bushDensity: 0.05, flowerDensity: 0, rockDensity: 0.08 },
    npcs: { enabled: true, count: { min: 2, max: 5 } },
    groundType: 'snow',
  },
  'ice-castle-interior': {
    id: 'ice-castle-interior',
    name: 'Ice Castle Interior',
    description: 'Frozen throne room',
    size: 'large',
    theme: 'ice',
    type: 'interior',
    cols: { min: 35, max: 50 },
    rows: { min: 30, max: 45 },
    roads: { enabled: false, pattern: 'none', width: 0 },
    water: { type: 'none', coverage: 0 },
    buildings: { count: { min: 0, max: 0 }, types: [], hasPlaza: false },
    nature: { treeDensity: 0, bushDensity: 0, flowerDensity: 0, rockDensity: 0.05 },
    npcs: { enabled: true, count: { min: 1, max: 4 } },
    groundType: 'snow',
    walls: { enabled: true, thickness: 3 },
  },

  // ─── DESERT ───────────────────────────────────────────────────────
  'desert-oasis': {
    id: 'desert-oasis',
    name: 'Desert Oasis',
    description: 'Sandy area with water source',
    size: 'medium',
    theme: 'desert',
    type: 'exterior',
    cols: { min: 45, max: 60 },
    rows: { min: 45, max: 60 },
    roads: { enabled: true, pattern: 'winding', width: 1 },
    water: { type: 'lake', coverage: 0.12 },
    buildings: { count: { min: 2, max: 5 }, types: ['house', 'shop'], hasPlaza: true },
    nature: { treeDensity: 0.08, bushDensity: 0.1, flowerDensity: 0.02, rockDensity: 0.15 },
    npcs: { enabled: true, count: { min: 2, max: 4 } },
    groundType: 'sand',
  },

  // ─── DUNGEONS ─────────────────────────────────────────────────────
  'dungeon-small': {
    id: 'dungeon-small',
    name: 'Dungeon Room',
    description: 'Single dungeon chamber',
    size: 'small',
    theme: 'dungeon',
    type: 'interior',
    cols: { min: 20, max: 25 },
    rows: { min: 20, max: 25 },
    roads: { enabled: false, pattern: 'none', width: 0 },
    water: { type: 'none', coverage: 0 },
    buildings: { count: { min: 0, max: 0 }, types: [], hasPlaza: false },
    nature: { treeDensity: 0, bushDensity: 0, flowerDensity: 0, rockDensity: 0.1 },
    npcs: { enabled: true, count: { min: 1, max: 3 } },
    groundType: 'stone',
    walls: { enabled: true, thickness: 2 },
  },
  'dungeon-large': {
    id: 'dungeon-large',
    name: 'Dungeon Complex',
    description: 'Multi-room dungeon',
    size: 'large',
    theme: 'dungeon',
    type: 'interior',
    cols: { min: 50, max: 70 },
    rows: { min: 50, max: 70 },
    roads: { enabled: true, pattern: 'grid', width: 2 }, // Corridors
    water: { type: 'none', coverage: 0 },
    buildings: { count: { min: 0, max: 0 }, types: [], hasPlaza: false },
    nature: { treeDensity: 0, bushDensity: 0, flowerDensity: 0, rockDensity: 0.08 },
    npcs: { enabled: true, count: { min: 3, max: 8 } },
    groundType: 'stone',
    walls: { enabled: true, thickness: 1 },
  },
}

// Group presets by theme for UI
const PRESET_CATEGORIES = {
  village: { label: 'Village/Town', color: 'bg-green-700' },
  forest: { label: 'Forest', color: 'bg-emerald-800' },
  castle: { label: 'Castle', color: 'bg-purple-700' },
  ice: { label: 'Ice/Snow', color: 'bg-cyan-700' },
  desert: { label: 'Desert', color: 'bg-amber-700' },
  dungeon: { label: 'Dungeon', color: 'bg-gray-700' },
}

// Tile swatch component for palette
function TileSwatch({
  char,
  name,
  bg,
  fg,
  onClick,
  selected,
  zoom = 1.0
}: {
  char: string
  name: string
  bg: string
  fg: string
  onClick?: () => void
  selected?: boolean
  zoom?: number
}) {
  const baseSize = 56
  const size = baseSize * zoom
  const fontSize = 20 * zoom
  const labelSize = 9 * zoom

  return (
    <button
      onClick={onClick}
      className={`rounded flex flex-col items-center justify-center transition-all flex-shrink-0 ${
        selected ? 'ring-2 ring-yellow-400' : 'hover:ring-2 hover:ring-yellow-400/50'
      }`}
      style={{
        backgroundColor: bg,
        width: size,
        height: size,
        minWidth: size,
      }}
      title={name}
    >
      <span style={{ color: fg, fontSize }} className="font-bold leading-none">{char}</span>
      <span style={{ fontSize: labelSize }} className="text-gray-300 leading-none mt-1">{name}</span>
    </button>
  )
}

// Player state
interface PlayerState {
  x: number
  z: number
  facing: 'up' | 'down' | 'left' | 'right'
  moving: boolean
  frame: number
}

const NODE_WIDTH = 160
const NODE_HEIGHT = 80

// Flow View Overlay Component - shows current template's connections
function FlowViewOverlay({
  currentTemplate,
  connectors,
  allTemplates,
  onSelectTemplate,
}: {
  currentTemplate: { id: string; name: string } | null
  connectors: Connector[]
  allTemplates: TemplateListItem[]
  onSelectTemplate: (id: string) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const render = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !currentTemplate) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = window.innerWidth
    canvas.height = window.innerHeight

    const centerX = canvas.width / 2
    const centerY = canvas.height / 2

    // Clear with dark space background
    ctx.fillStyle = '#0a0a12'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // Subtle star field
    ctx.fillStyle = 'rgba(255,255,255,0.3)'
    for (let i = 0; i < 50; i++) {
      const x = (Math.sin(i * 123.456) * 0.5 + 0.5) * canvas.width
      const y = (Math.cos(i * 78.9) * 0.5 + 0.5) * canvas.height
      ctx.beginPath()
      ctx.arc(x, y, Math.random() * 1.5, 0, Math.PI * 2)
      ctx.fill()
    }

    // Find connected templates
    const outgoingIds = new Set(connectors.map(c => c.targetTemplateId))
    const incomingTemplates = allTemplates.filter(t => {
      const tConnectors = (t.connectors as Connector[]) || []
      return tConnectors.some(c => c.targetTemplateId === currentTemplate.id)
    })
    const incomingIds = new Set(incomingTemplates.map(t => t.id))

    // Build node positions - current in center, connected around it
    const connectedIds = new Set([...outgoingIds, ...incomingIds])
    const connectedTemplates = allTemplates.filter(t => connectedIds.has(t.id) && t.id !== currentTemplate.id)

    // Position connected templates in a circle around center
    const radius = Math.min(canvas.width, canvas.height) * 0.3
    const nodes: Array<{ id: string; name: string; x: number; y: number; isOutgoing: boolean; isIncoming: boolean }> = []

    connectedTemplates.forEach((t, i) => {
      const angle = (i / connectedTemplates.length) * Math.PI * 2 - Math.PI / 2
      nodes.push({
        id: t.id,
        name: t.name,
        x: centerX + Math.cos(angle) * radius - NODE_WIDTH / 2,
        y: centerY + Math.sin(angle) * radius - NODE_HEIGHT / 2,
        isOutgoing: outgoingIds.has(t.id),
        isIncoming: incomingIds.has(t.id),
      })
    })

    // Draw connections from current to outgoing
    for (const connector of connectors) {
      const targetNode = nodes.find(n => n.id === connector.targetTemplateId)
      if (!targetNode) continue

      const startX = centerX
      const startY = centerY
      const endX = targetNode.x + NODE_WIDTH / 2
      const endY = targetNode.y + NODE_HEIGHT / 2

      // Gradient line
      const gradient = ctx.createLinearGradient(startX, startY, endX, endY)
      const color = connector.interaction === 'walk' ? '#aa66ff' :
                    connector.interaction === 'interact' ? '#66aaff' : '#ffaa66'
      gradient.addColorStop(0, color)
      gradient.addColorStop(1, color + '88')

      ctx.strokeStyle = gradient
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(startX, startY)
      ctx.lineTo(endX, endY)
      ctx.stroke()

      // Arrow head
      const angle = Math.atan2(endY - startY, endX - startX)
      const arrowDist = Math.sqrt((endX - startX) ** 2 + (endY - startY) ** 2) - NODE_WIDTH / 2 - 10
      const arrowX = startX + Math.cos(angle) * arrowDist
      const arrowY = startY + Math.sin(angle) * arrowDist

      ctx.fillStyle = color
      ctx.beginPath()
      ctx.moveTo(arrowX + Math.cos(angle) * 12, arrowY + Math.sin(angle) * 12)
      ctx.lineTo(arrowX + Math.cos(angle - 0.4) * -8, arrowY + Math.sin(angle - 0.4) * -8)
      ctx.lineTo(arrowX + Math.cos(angle + 0.4) * -8, arrowY + Math.sin(angle + 0.4) * -8)
      ctx.closePath()
      ctx.fill()

      // Interaction label
      const midX = (startX + endX) / 2
      const midY = (startY + endY) / 2
      ctx.font = 'bold 11px monospace'
      ctx.fillStyle = '#fff'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(connector.interaction, midX, midY - 12)
    }

    // Draw incoming connections
    for (const t of incomingTemplates) {
      const sourceNode = nodes.find(n => n.id === t.id)
      if (!sourceNode) continue

      const tConnectors = (t.connectors as Connector[]) || []
      const relevantConnectors = tConnectors.filter(c => c.targetTemplateId === currentTemplate.id)

      for (const connector of relevantConnectors) {
        const startX = sourceNode.x + NODE_WIDTH / 2
        const startY = sourceNode.y + NODE_HEIGHT / 2
        const endX = centerX
        const endY = centerY

        ctx.strokeStyle = '#44aa44'
        ctx.lineWidth = 2
        ctx.setLineDash([5, 5])
        ctx.beginPath()
        ctx.moveTo(startX, startY)
        ctx.lineTo(endX, endY)
        ctx.stroke()
        ctx.setLineDash([])

        // Arrow pointing to center
        const angle = Math.atan2(endY - startY, endX - startX)
        const arrowDist = Math.sqrt((endX - startX) ** 2 + (endY - startY) ** 2) - NODE_WIDTH / 2 - 10
        const arrowX = startX + Math.cos(angle) * arrowDist
        const arrowY = startY + Math.sin(angle) * arrowDist

        ctx.fillStyle = '#44aa44'
        ctx.beginPath()
        ctx.moveTo(arrowX + Math.cos(angle) * 10, arrowY + Math.sin(angle) * 10)
        ctx.lineTo(arrowX + Math.cos(angle - 0.4) * -6, arrowY + Math.sin(angle - 0.4) * -6)
        ctx.lineTo(arrowX + Math.cos(angle + 0.4) * -6, arrowY + Math.sin(angle + 0.4) * -6)
        ctx.closePath()
        ctx.fill()
      }
    }

    // Draw current template node (center)
    ctx.fillStyle = '#2a1a3a'
    ctx.beginPath()
    ctx.roundRect(centerX - NODE_WIDTH / 2, centerY - NODE_HEIGHT / 2, NODE_WIDTH, NODE_HEIGHT, 12)
    ctx.fill()
    ctx.strokeStyle = '#ffaa00'
    ctx.lineWidth = 3
    ctx.stroke()

    // Glow effect
    ctx.shadowColor = '#ffaa00'
    ctx.shadowBlur = 20
    ctx.strokeStyle = '#ffaa0044'
    ctx.stroke()
    ctx.shadowBlur = 0

    ctx.fillStyle = '#ffdd00'
    ctx.font = 'bold 14px monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(
      currentTemplate.name.length > 12 ? currentTemplate.name.slice(0, 11) + '…' : currentTemplate.name,
      centerX, centerY - 5
    )
    ctx.fillStyle = '#888'
    ctx.font = '10px monospace'
    ctx.fillText(`${connectors.length} outgoing`, centerX, centerY + 15)

    // Draw connected template nodes
    for (const node of nodes) {
      ctx.fillStyle = node.isOutgoing ? '#1a2a3a' : '#1a3a2a'
      ctx.beginPath()
      ctx.roundRect(node.x, node.y, NODE_WIDTH, NODE_HEIGHT, 8)
      ctx.fill()

      ctx.strokeStyle = node.isOutgoing ? '#aa66ff' : '#44aa44'
      ctx.lineWidth = 2
      ctx.stroke()

      ctx.fillStyle = '#ffffff'
      ctx.font = 'bold 12px monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(
        node.name.length > 14 ? node.name.slice(0, 13) + '…' : node.name,
        node.x + NODE_WIDTH / 2, node.y + NODE_HEIGHT / 2 - 8
      )

      ctx.fillStyle = '#666'
      ctx.font = '10px monospace'
      const label = node.isOutgoing && node.isIncoming ? 'both' : node.isOutgoing ? 'outgoing' : 'incoming'
      ctx.fillText(label, node.x + NODE_WIDTH / 2, node.y + NODE_HEIGHT / 2 + 12)
    }

    // Legend
    ctx.fillStyle = '#666'
    ctx.font = '11px monospace'
    ctx.textAlign = 'left'
    ctx.fillText('Click a template to navigate to it', 20, canvas.height - 40)
    ctx.fillStyle = '#aa66ff'
    ctx.fillText('━━ outgoing', 20, canvas.height - 20)
    ctx.fillStyle = '#44aa44'
    ctx.fillText('┄┄ incoming', 140, canvas.height - 20)

    // No connections message
    if (connectedTemplates.length === 0) {
      ctx.fillStyle = '#666'
      ctx.font = '14px monospace'
      ctx.textAlign = 'center'
      ctx.fillText('No connections yet', centerX, centerY + NODE_HEIGHT)
      ctx.font = '12px monospace'
      ctx.fillText('Add connectors in TOP view to link templates', centerX, centerY + NODE_HEIGHT + 20)
    }
  }, [currentTemplate, connectors, allTemplates])

  useEffect(() => {
    render()
    window.addEventListener('resize', render)
    return () => window.removeEventListener('resize', render)
  }, [render])

  const handleClick = (e: React.MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas || !currentTemplate) return

    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const centerX = canvas.width / 2
    const centerY = canvas.height / 2

    // Find connected templates
    const outgoingIds = new Set(connectors.map(c => c.targetTemplateId))
    const incomingTemplates = allTemplates.filter(t => {
      const tConnectors = (t.connectors as Connector[]) || []
      return tConnectors.some(c => c.targetTemplateId === currentTemplate.id)
    })
    const connectedIds = new Set([...outgoingIds, ...incomingTemplates.map(t => t.id)])
    const connectedTemplates = allTemplates.filter(t => connectedIds.has(t.id) && t.id !== currentTemplate.id)

    const radius = Math.min(canvas.width, canvas.height) * 0.3

    // Check if clicked on a connected template
    for (let i = 0; i < connectedTemplates.length; i++) {
      const angle = (i / connectedTemplates.length) * Math.PI * 2 - Math.PI / 2
      const nodeX = centerX + Math.cos(angle) * radius - NODE_WIDTH / 2
      const nodeY = centerY + Math.sin(angle) * radius - NODE_HEIGHT / 2

      if (x >= nodeX && x <= nodeX + NODE_WIDTH && y >= nodeY && y <= nodeY + NODE_HEIGHT) {
        onSelectTemplate(connectedTemplates[i].id)
        return
      }
    }
  }

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 z-10 cursor-pointer"
      onClick={handleClick}
    />
  )
}

export default function TemplateEditor() {
  const router = useRouter()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gridRef = useRef<IsometricGrid | null>(null)
  const [showDebug, setShowDebug] = useState(false)
  const [showTopView, setShowTopView] = useState(false)
  const [showFlowView, setShowFlowView] = useState(false)
  const [topViewZoom, setTopViewZoom] = useState(1.0)
  const zoomRef = useRef(1.0)
  const [gridSize, setGridSize] = useState({ cols: VILLAGE_CONFIG.cols, rows: VILLAGE_CONFIG.rows })
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set())
  const [isSelecting, setIsSelecting] = useState(false)
  const [selectionStart, setSelectionStart] = useState<{ col: number; row: number } | null>(null)
  const selectedCellsRef = useRef<Set<string>>(new Set())
  // Camera panning with mouse drag
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState<{ x: number; y: number } | null>(null)
  const [camOffset, setCamOffset] = useState({ x: 0, y: 0 })
  const camOffsetRef = useRef({ x: 0, y: 0 })
  const [selectedTile, setSelectedTile] = useState<{ char: string; type: 'ground' | 'asset'; groundType?: string; tileKey?: string } | null>(null)
  const [selectedComposite, setSelectedComposite] = useState<string | null>(null)
  const [selectedHeight, setSelectedHeight] = useState(0)
  const [heightEditMode, setHeightEditMode] = useState(false)
  const [initialized, setInitialized] = useState(false)

  // Template limits
  const isProd = process.env.NODE_ENV === 'production'
  const maxTemplates = isProd ? MAX_TEMPLATES_PROD : Infinity

  // Template management state
  const [savedTemplates, setSavedTemplates] = useState<TemplateListItem[]>([])
  const [currentTemplateId, setCurrentTemplateId] = useState<string | null>(null)
  const [templateName, setTemplateName] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [showTemplateList, setShowTemplateList] = useState(false)

  // Sidebar state - load from localStorage
  const [sidebarWidth, setSidebarWidth] = useState(280)
  const [sidebarZoom, setSidebarZoom] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('nebulith-sidebar-zoom')
      return saved ? parseFloat(saved) : 1.0
    }
    return 1.0
  })
  const [isResizingSidebar, setIsResizingSidebar] = useState(false)
  const sidebarRef = useRef<HTMLDivElement>(null)

  // Save sidebarZoom to localStorage
  useEffect(() => {
    localStorage.setItem('nebulith-sidebar-zoom', String(sidebarZoom))
  }, [sidebarZoom])

  // Template view type (isometric or 2d)
  const [viewType, setViewType] = useState<'isometric' | '2d'>('isometric')

  // Connector state
  const [connectors, setConnectors] = useState<Connector[]>([])
  const [connectorMode, setConnectorMode] = useState(false)
  const [editingConnector, setEditingConnector] = useState<{ col: number; row: number } | null>(null)
  const [connectorForm, setConnectorForm] = useState<Partial<Connector>>({
    interaction: 'walk',
    spawnCol: 25,
    spawnRow: 25,
  })
  const connectorsRef = useRef<Connector[]>([])
  const connectorModeRef = useRef(false)
  const viewTypeRef = useRef<'isometric' | '2d'>('isometric')

  // Keep viewType ref in sync
  useEffect(() => {
    viewTypeRef.current = viewType
  }, [viewType])

  // UI panels
  const [showControlsPanel, setShowControlsPanel] = useState(true)
  const [isMobile, setIsMobile] = useState(false)

  // Detect mobile
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // Load view state from localStorage on mount
  useEffect(() => {
    const savedDebug = localStorage.getItem('village-debug') === 'true'
    const savedTopView = localStorage.getItem('village-topview') === 'true'
    const savedZoom = parseFloat(localStorage.getItem('village-topview-zoom') || '1.0')
    debugMode = savedDebug
    topViewMode = savedTopView
    zoomRef.current = savedZoom
    setShowDebug(savedDebug)
    setShowTopView(savedTopView)
    setTopViewZoom(savedZoom)
  }, [])

  // Save view state to localStorage when it changes
  useEffect(() => {
    localStorage.setItem('village-debug', showDebug.toString())
    localStorage.setItem('village-topview', showTopView.toString())
    localStorage.setItem('village-topview-zoom', topViewZoom.toString())
    zoomRef.current = topViewZoom
  }, [showDebug, showTopView, topViewZoom])

  // Keep selectedCells ref in sync
  useEffect(() => {
    selectedCellsRef.current = selectedCells
  }, [selectedCells])

  // Keep connectors ref in sync
  useEffect(() => {
    connectorsRef.current = connectors
  }, [connectors])

  // Keep connectorMode ref in sync
  useEffect(() => {
    connectorModeRef.current = connectorMode
  }, [connectorMode])

  // Sidebar resize handlers
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingSidebar) return
      const maxWidth = window.innerWidth * 0.5
      const newWidth = Math.max(200, Math.min(maxWidth, e.clientX - 16))
      setSidebarWidth(newWidth)
    }

    const handleMouseUp = () => {
      setIsResizingSidebar(false)
    }

    if (isResizingSidebar) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = 'ew-resize'
      document.body.style.userSelect = 'none'
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizingSidebar])

  // Convert screen position to grid cell (for top view)
  const screenToCell = (clientX: number, clientY: number): { col: number; row: number } | null => {
    const canvas = canvasRef.current
    const grid = gridRef.current
    if (!canvas || !grid || !topViewMode) return null

    const rect = canvas.getBoundingClientRect()
    const x = clientX - rect.left
    const y = clientY - rect.top

    const tileSize = 16 * zoomRef.current
    const playerCol = playerRef.current.x / grid.cellSize
    const playerRow = playerRef.current.z / grid.cellSize
    const offsetX = canvas.width / 2 - playerCol * tileSize
    const offsetY = canvas.height / 2 - playerRow * tileSize

    const col = Math.floor((x - offsetX) / tileSize)
    const row = Math.floor((y - offsetY) / tileSize)

    if (col >= 0 && col < grid.cols && row >= 0 && row < grid.rows) {
      return { col, row }
    }
    return null
  }

  // Mouse handlers for cell selection and panning
  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    // Middle mouse button (1) or right click (2) for panning
    if (e.button === 1 || e.button === 2) {
      e.preventDefault()
      setIsPanning(true)
      setPanStart({ x: e.clientX, y: e.clientY })
      return
    }

    if (!topViewMode) return
    const cell = screenToCell(e.clientX, e.clientY)
    if (!cell) return

    // In connector mode, open connector editor
    if (connectorMode) {
      const existingConnector = connectors.find(c => c.col === cell.col && c.row === cell.row)
      if (existingConnector) {
        setConnectorForm(existingConnector)
      } else {
        setConnectorForm({
          col: cell.col,
          row: cell.row,
          interaction: 'walk',
          spawnCol: 25,
          spawnRow: 25,
          targetTemplateId: '',
        })
      }
      setEditingConnector(cell)
      return
    }

    setIsSelecting(true)
    setSelectionStart(cell)

    if (e.shiftKey) {
      // Add to selection
      setSelectedCells(prev => {
        const next = new Set(prev)
        next.add(`${cell.col},${cell.row}`)
        return next
      })
    } else {
      // New selection
      setSelectedCells(new Set([`${cell.col},${cell.row}`]))
    }
  }

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    // Handle panning
    if (isPanning && panStart) {
      const dx = e.clientX - panStart.x
      const dy = e.clientY - panStart.y
      const newOffset = {
        x: camOffsetRef.current.x + dx,
        y: camOffsetRef.current.y + dy
      }
      setCamOffset(newOffset)
      camOffsetRef.current = newOffset
      setPanStart({ x: e.clientX, y: e.clientY })
      return
    }

    if (!isSelecting || !selectionStart || !topViewMode) return
    const cell = screenToCell(e.clientX, e.clientY)
    if (!cell) return

    // Select rectangle from start to current
    const minCol = Math.min(selectionStart.col, cell.col)
    const maxCol = Math.max(selectionStart.col, cell.col)
    const minRow = Math.min(selectionStart.row, cell.row)
    const maxRow = Math.max(selectionStart.row, cell.row)

    const newSelection = new Set<string>()
    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        newSelection.add(`${c},${r}`)
      }
    }
    setSelectedCells(newSelection)
  }

  const handleCanvasMouseUp = () => {
    setIsSelecting(false)
    setIsPanning(false)
    setPanStart(null)
  }

  // Prevent context menu on right click (for panning)
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
  }

  // Find a valid walkable spawn point near a target position
  const findValidSpawn = (grid: IsometricGrid, targetCol: number, targetRow: number): { col: number; row: number } => {
    // Check if target is valid
    if (isValidSpawn(grid, targetCol, targetRow)) {
      return { col: targetCol, row: targetRow }
    }

    // Spiral search outward from target
    for (let radius = 1; radius < Math.max(grid.cols, grid.rows); radius++) {
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue // Only check perimeter
          const col = targetCol + dx
          const row = targetRow + dy
          if (isValidSpawn(grid, col, row)) {
            return { col, row }
          }
        }
      }
    }

    // Fallback: find any valid spot
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        if (isValidSpawn(grid, c, r)) {
          return { col: c, row: r }
        }
      }
    }

    // Last resort: center of map
    return { col: Math.floor(grid.cols / 2), row: Math.floor(grid.rows / 2) }
  }

  // Check if a cell is valid for spawning (walkable ground, no blocking assets)
  const isValidSpawn = (grid: IsometricGrid, col: number, row: number): boolean => {
    if (col < 0 || col >= grid.cols || row < 0 || row >= grid.rows) return false

    // Check ground type - water is not walkable
    const groundType = grid.ground[row]?.[col]
    if (groundType === 'water') return false

    // Check collision grid
    if (grid.isBlocked(col, row)) return false

    return true
  }

  // Move player to valid spawn point
  const movePlayerToValidSpawn = (targetCol?: number, targetRow?: number) => {
    const grid = gridRef.current
    if (!grid) return

    const col = targetCol ?? Math.floor(grid.cols / 2)
    const row = targetRow ?? Math.floor(grid.rows / 2)

    const spawn = findValidSpawn(grid, col, row)
    playerRef.current.x = spawn.col * grid.cellSize + grid.cellSize / 2
    playerRef.current.z = spawn.row * grid.cellSize + grid.cellSize / 2
  }

  // Save connector
  const saveConnector = () => {
    if (!connectorForm.targetTemplateId || !editingConnector) return

    const connector: Connector = {
      col: editingConnector.col,
      row: editingConnector.row,
      targetTemplateId: connectorForm.targetTemplateId!,
      targetTemplateName: savedTemplates.find(t => t.id === connectorForm.targetTemplateId)?.name,
      interaction: connectorForm.interaction || 'walk',
      spawnCol: connectorForm.spawnCol ?? 25,
      spawnRow: connectorForm.spawnRow ?? 25,
    }

    setConnectors(prev => {
      const filtered = prev.filter(c => !(c.col === connector.col && c.row === connector.row))
      return [...filtered, connector]
    })
    setEditingConnector(null)
    setConnectorForm({ interaction: 'walk', spawnCol: 25, spawnRow: 25 })
  }

  // Delete connector
  const deleteConnector = (col: number, row: number) => {
    setConnectors(prev => prev.filter(c => !(c.col === col && c.row === row)))
    if (editingConnector?.col === col && editingConnector?.row === row) {
      setEditingConnector(null)
    }
  }

  // Resize grid function
  const resizeGrid = (cols: number, rows: number) => {
    const newConfig = { ...VILLAGE_CONFIG, cols, rows }
    gridRef.current = new IsometricGrid(newConfig)
    // Fill with grass by default
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        gridRef.current.setGround(c, r, 'grass')
      }
    }
    setGridSize({ cols, rows })
    // Reset player to valid spawn at center
    movePlayerToValidSpawn(Math.floor(cols / 2), Math.floor(rows / 2))
  }

  // Check if ground type is a road/path (buildings cannot be placed on these)
  const isRoadGround = (groundType: string): boolean => {
    return ['road', 'plaza', 'path_stone', 'path_dirt', 'bridge'].includes(groundType)
  }

  // Place tile on selected cells
  const placeTile = (tileInfo: { char: string; type: 'ground' | 'asset'; groundType?: string; tileKey?: string }) => {
    const grid = gridRef.current
    if (!grid || selectedCells.size === 0) {
      setSelectedTile(tileInfo)
      setSelectedComposite(null)
      setHeightEditMode(false)
      return
    }

    // Check if this is a building/structure asset
    const tileDef = tileInfo.tileKey ? TILES[tileInfo.tileKey] : null
    const assetType = tileDef?.category ?? getAssetType(tileInfo.char)
    const isBuilding = assetType === 'building'

    selectedCells.forEach(key => {
      const [col, row] = key.split(',').map(Number)
      if (tileInfo.type === 'ground' && tileInfo.groundType) {
        grid.setGround(col, row, tileInfo.groundType)
      } else if (tileInfo.type === 'asset') {
        // Prevent buildings on roads
        const groundType = grid.ground[row]?.[col] || 'grass'
        if (isBuilding && isRoadGround(groundType)) {
          return // Skip this cell - can't place building on road
        }
        // Remove any existing asset at this location first
        grid.assets = grid.assets.filter(a => !(a.col === col && a.row === row))
        // Use tileset definition if available
        grid.placeAsset([tileInfo.char], col, row, {
          type: assetType,
          blocking: tileDef?.blocking ?? isBlockingAsset(tileInfo.char),
          color: tileDef?.fg ?? getAssetColor(tileInfo.char),
          bgColor: tileDef?.bg,
          height: getDefaultAssetHeight(tileInfo.char),
          tileKey: tileInfo.tileKey,
        })
      }
    })
    setSelectedCells(new Set())
    setSelectedTile(null)
  }

  // Place a composite asset at the first selected cell
  const placeCompositeAsset = (assetKey: string) => {
    const grid = gridRef.current
    if (!grid) return

    // Get the composite asset definition
    const asset = COMPOSITE_ASSETS[assetKey]
    if (!asset) return

    // If no cells selected, just select the asset for next click
    if (selectedCells.size === 0) {
      setSelectedComposite(assetKey)
      setSelectedTile(null)
      setHeightEditMode(false)
      return
    }

    // Get the first selected cell as the anchor point
    const firstCell = Array.from(selectedCells)[0]
    const [col, row] = firstCell.split(',').map(Number)

    // Check if any target cell is on a road (buildings can't go there)
    if (asset.category === 'building') {
      for (const t of asset.tiles) {
        const targetCol = col + t.dx
        const targetRow = row + t.dy
        const groundType = grid.ground[targetRow]?.[targetCol] || 'grass'
        if (isRoadGround(groundType)) {
          return // Can't place building on road
        }
      }
    }

    // Build the tiles array with actual characters
    const tiles = asset.tiles.map(t => {
      const tileDef = TILES[t.tile]
      return {
        tile: t.tile,
        char: tileDef?.char ?? '?',
        dx: t.dx,
        dy: t.dy,
        height: t.height,
        color: t.colorOverride ?? tileDef?.fg,
        bgColor: tileDef?.bg,
        blocking: tileDef?.blocking ?? false,
        type: asset.category,
      }
    })

    // Place the composite
    grid.placeComposite(assetKey, tiles, col, row)

    setSelectedCells(new Set())
    setSelectedComposite(null)
  }

  // Place height on selected cells
  const placeHeight = (h: number) => {
    const grid = gridRef.current
    if (!grid || selectedCells.size === 0) {
      setSelectedHeight(h)
      setHeightEditMode(true)
      return
    }

    selectedCells.forEach(key => {
      const [col, row] = key.split(',').map(Number)
      grid.setHeight(col, row, h)
    })
    setSelectedCells(new Set())
  }

  // Default heights for different asset types
  const getDefaultAssetHeight = (char: string): number => {
    switch (char) {
      case '█': return 2  // Wall - 2 blocks tall
      case '▀': return 3  // Roof - 3 blocks tall (on top of walls)
      case '░': return 1  // Floor - 1 block tall
      case '@': return 3  // Tree - 3 blocks tall
      case '*': return 1  // Bush - 1 block tall
      case '!': return 2  // Lamp - 2 blocks tall
      case '☺': return 2  // NPC - 2 blocks tall
      default: return 1
    }
  }

  // Helper functions for asset properties
  const getAssetType = (char: string): string => {
    switch (char) {
      case '@': case '*': return 'tree'
      case '$': return 'crate'
      case '!': return 'lamp'
      case '+': return 'flower'
      case 'o': return 'decoration'
      case '█': case '▀': case '░': return 'building'
      case '☺': return 'npc'
      default: return 'decoration'
    }
  }

  const isBlockingAsset = (char: string): boolean => {
    return ['@', '*', '$', '!', 'o', '█', '▀', '☺'].includes(char)
  }

  const getAssetColor = (char: string): string => {
    switch (char) {
      case '@': return '#33cc33'
      case '*': return '#44bb44'
      case '$': return '#ddaa55'
      case '!': return '#ffff55'
      case '+': return '#ff88cc'
      case 'o': return '#888888'
      case '█': return '#aa7755'
      case '▀': return '#dd7755'
      case '░': return '#aa9977'
      case '☺': return '#ffdd00'
      default: return '#ffffff'
    }
  }

  // Layout templates - complete with buildings, trees, NPCs
  const applyTemplate = (template: string) => {
    const grid = gridRef.current
    if (!grid) return

    const cols = grid.cols
    const rows = grid.rows
    const cx = Math.floor(cols / 2)
    const cy = Math.floor(rows / 2)

    // Clear grid first
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        grid.setGround(c, r, 'grass')
        grid.setCollision(c, r, false)
        grid.setHeight(c, r, 0)
      }
    }
    grid.assets = []

    // Helper to place a building (3x3 with walls, elevated)
    const placeBuilding = (x: number, y: number, color: string = '#aa7755', height: number = 2) => {
      for (let dy = 0; dy < 3; dy++) {
        for (let dx = 0; dx < 3; dx++) {
          if (x + dx < cols && y + dy < rows) {
            // Set cell height for the building footprint
            grid.setHeight(x + dx, y + dy, height)
            // Place wall asset on top
            grid.placeAsset(['█'], x + dx, y + dy, { type: 'building', blocking: true, color, height })
          }
        }
      }
    }

    // Helper to place a tower (2x2 with extra height)
    const placeTower = (x: number, y: number, color: string = '#666666', height: number = 4) => {
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          if (x + dx < cols && y + dy < rows) {
            grid.setHeight(x + dx, y + dy, height)
            grid.placeAsset(['█'], x + dx, y + dy, { type: 'building', blocking: true, color, height })
          }
        }
      }
    }

    // Helper to place trees in area (trees inherit cell height, not set their own)
    const placeTrees = (x: number, y: number, w: number, h: number, density: number = 0.15) => {
      for (let dy = 0; dy < h; dy++) {
        for (let dx = 0; dx < w; dx++) {
          if (Math.random() < density && x + dx < cols && y + dy < rows) {
            const cell = grid.ground[y + dy]?.[x + dx]
            if (cell === 'grass') {
              grid.placeAsset(['@'], x + dx, y + dy, { type: 'tree', blocking: true, color: '#33cc33', height: 3 })
            }
          }
        }
      }
    }

    // Helper to place NPC
    const placeNPC = (x: number, y: number) => {
      if (x < cols && y < rows) {
        grid.placeAsset(['☺'], x, y, { type: 'npc', blocking: true, color: '#ffdd00' })
      }
    }

    switch (template) {
      case 'village':
        // Main roads - cross pattern
        grid.fillGround(cx - 1, 2, 3, rows - 4, 'road')
        grid.fillGround(2, cy - 1, cols - 4, 3, 'road')

        // Central plaza
        grid.fillGround(cx - 5, cy - 5, 11, 11, 'plaza')

        // Fountain in center
        grid.fillGround(cx - 1, cy - 1, 3, 3, 'water')

        // Buildings around plaza
        placeBuilding(cx - 10, cy - 2, '#aa7755')  // Left building
        placeBuilding(cx + 8, cy - 2, '#aa6644')   // Right building
        placeBuilding(cx - 2, cy - 10, '#997766')  // Top building
        placeBuilding(cx - 2, cy + 8, '#bb8866')   // Bottom building

        // Corner houses
        placeBuilding(4, 4, '#cc9966')
        placeBuilding(cols - 7, 4, '#aa8855')
        placeBuilding(4, rows - 7, '#bb9955')
        placeBuilding(cols - 7, rows - 7, '#aa7744')

        // Trees in corners
        placeTrees(2, 2, 8, 8, 0.2)
        placeTrees(cols - 10, 2, 8, 8, 0.2)
        placeTrees(2, rows - 10, 8, 8, 0.2)
        placeTrees(cols - 10, rows - 10, 8, 8, 0.2)

        // River on one side
        for (let r = 0; r < rows; r++) {
          const offset = Math.floor(Math.sin(r * 0.15) * 2)
          grid.fillGround(cols - 5 + offset, r, 3, 1, 'water')
        }
        // Bridge over river
        grid.fillGround(cols - 6, cy - 1, 5, 3, 'bridge')

        // Lamps along main roads
        grid.placeAsset(['!'], cx - 1, cy - 7, { type: 'lamp', blocking: true, color: '#ffff44' })
        grid.placeAsset(['!'], cx + 1, cy + 7, { type: 'lamp', blocking: true, color: '#ffff44' })
        grid.placeAsset(['!'], cx - 7, cy - 1, { type: 'lamp', blocking: true, color: '#ffff44' })
        grid.placeAsset(['!'], cx + 7, cy + 1, { type: 'lamp', blocking: true, color: '#ffff44' })

        // NPCs
        placeNPC(cx + 3, cy + 3)
        placeNPC(cx - 8, cy)
        placeNPC(6, 8)
        break

      case 'forest':
        // Winding path through forest
        let pathX = 2
        for (let r = 0; r < rows; r++) {
          pathX += Math.floor(Math.random() * 3) - 1
          pathX = Math.max(2, Math.min(cols - 4, pathX))
          grid.fillGround(pathX, r, 2, 1, 'road')
        }

        // Second path crossing
        let pathY = 2
        for (let c = 0; c < cols; c++) {
          pathY += Math.floor(Math.random() * 3) - 1
          pathY = Math.max(2, Math.min(rows - 4, pathY))
          grid.fillGround(c, pathY, 1, 2, 'road')
        }

        // Dense trees everywhere
        placeTrees(0, 0, cols, rows, 0.25)

        // Small clearing with cabin (height 2 for cozy cabin)
        grid.fillGround(cx - 4, cy - 4, 9, 9, 'grass')
        // Remove trees from clearing (they were placed, need to filter)
        grid.assets = grid.assets.filter(a => {
          const inClearing = a.col >= cx - 4 && a.col < cx + 5 && a.row >= cy - 4 && a.row < cy + 5
          return !inClearing || a.type !== 'tree'
        })
        placeBuilding(cx - 1, cy - 1, '#8b4513', 2)

        // Mushrooms and flowers
        for (let i = 0; i < 20; i++) {
          const x = Math.floor(Math.random() * cols)
          const y = Math.floor(Math.random() * rows)
          if (grid.ground[y]?.[x] === 'grass') {
            grid.placeAsset(['+'], x, y, { type: 'flower', color: Math.random() > 0.5 ? '#ff88cc' : '#ffaa44' })
          }
        }

        // Hermit NPC
        placeNPC(cx + 2, cy)
        break

      case 'castle':
        // Outer walls
        grid.fillGround(0, 0, cols, rows, 'plaza')

        // Castle walls (thick, height 3)
        for (let i = 0; i < 3; i++) {
          for (let c = 2; c < cols - 2; c++) {
            grid.setHeight(c, 2 + i, 3)
            grid.placeAsset(['█'], c, 2 + i, { type: 'building', blocking: true, color: '#666666', height: 3 })
            grid.setHeight(c, rows - 5 + i, 3)
            grid.placeAsset(['█'], c, rows - 5 + i, { type: 'building', blocking: true, color: '#666666', height: 3 })
          }
          for (let r = 2; r < rows - 2; r++) {
            grid.setHeight(2 + i, r, 3)
            grid.placeAsset(['█'], 2 + i, r, { type: 'building', blocking: true, color: '#666666', height: 3 })
            grid.setHeight(cols - 5 + i, r, 3)
            grid.placeAsset(['█'], cols - 5 + i, r, { type: 'building', blocking: true, color: '#666666', height: 3 })
          }
        }

        // Gate entrance (bottom) - clear height at gate
        grid.fillGround(cx - 2, rows - 5, 5, 3, 'road')
        grid.fillHeight(cx - 2, rows - 5, 5, 3, 0)
        // Remove wall blocks at gate
        grid.assets = grid.assets.filter(a => {
          const atGate = a.col >= cx - 2 && a.col < cx + 3 && a.row >= rows - 5
          return !atGate
        })

        // Inner courtyard
        grid.fillGround(8, 8, cols - 16, rows - 16, 'road')

        // Main keep (large building in center-back, height 4)
        for (let dy = 0; dy < 6; dy++) {
          for (let dx = 0; dx < 8; dx++) {
            grid.setHeight(cx - 4 + dx, 8 + dy, 4)
            grid.placeAsset(['█'], cx - 4 + dx, 8 + dy, { type: 'building', blocking: true, color: '#777777', height: 4 })
          }
        }

        // Corner towers (height 5 - tallest structures)
        placeTower(6, 6, '#555555', 5)
        placeTower(cols - 8, 6, '#555555', 5)
        placeTower(6, rows - 8, '#555555', 5)
        placeTower(cols - 8, rows - 8, '#555555', 5)

        // Training grounds
        grid.fillGround(10, rows - 15, 8, 6, 'plaza')

        // Garden area
        grid.fillGround(cols - 18, rows - 15, 8, 6, 'grass')
        placeTrees(cols - 17, rows - 14, 6, 4, 0.3)

        // Well in courtyard
        grid.fillGround(cx - 1, cy + 2, 3, 3, 'water')

        // Guards (NPCs)
        placeNPC(cx - 3, rows - 8)
        placeNPC(cx + 3, rows - 8)
        placeNPC(8, 10)
        placeNPC(cols - 9, 10)
        break

      case 'beach':
        // Ocean on left (depth -1 for water)
        grid.fillGround(0, 0, Math.floor(cols * 0.35), rows, 'water')

        // Wavy shoreline
        for (let r = 0; r < rows; r++) {
          const waveOffset = Math.floor(Math.sin(r * 0.2) * 3 + Math.sin(r * 0.1) * 2)
          const sandStart = Math.floor(cols * 0.35) + waveOffset
          grid.fillGround(sandStart, r, 6, 1, 'road') // sand
        }

        // Beach huts (lower height 1 for beach style)
        placeBuilding(Math.floor(cols * 0.5), 5, '#dda050', 1)
        placeBuilding(Math.floor(cols * 0.5), rows - 8, '#cc9040', 1)

        // Palm trees along beach (tall trees)
        for (let r = 3; r < rows - 3; r += 5) {
          const x = Math.floor(cols * 0.42) + Math.floor(Math.random() * 4)
          grid.placeAsset(['@'], x, r, { type: 'tree', blocking: true, color: '#44aa44', height: 4 })
        }

        // Path from beach inland
        grid.fillGround(Math.floor(cols * 0.45), cy - 1, cols - Math.floor(cols * 0.45) - 2, 3, 'road')

        // Inland village (taller buildings)
        grid.fillGround(cols - 15, cy - 8, 12, 16, 'grass')
        placeBuilding(cols - 12, cy - 5, '#aa8866', 2)
        placeBuilding(cols - 12, cy + 3, '#bb9977', 2)
        placeTrees(cols - 14, cy - 7, 10, 14, 0.1)

        // Dock
        grid.fillGround(Math.floor(cols * 0.30), cy - 1, 6, 3, 'bridge')

        // Beach NPCs
        placeNPC(Math.floor(cols * 0.40), cy + 5)
        placeNPC(Math.floor(cols * 0.38), 8)
        break

      case 'island':
        // All water base
        grid.fillGround(0, 0, cols, rows, 'water')

        // Main island (circular)
        const radius = Math.min(cols, rows) * 0.35
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const dist = Math.sqrt((c - cx) ** 2 + (r - cy) ** 2)
            if (dist < radius - 2) {
              grid.setGround(c, r, 'grass')
            } else if (dist < radius) {
              grid.setGround(c, r, 'road') // beach ring
            }
          }
        }

        // Central village (main building height 3)
        grid.fillGround(cx - 4, cy - 4, 9, 9, 'plaza')
        placeBuilding(cx - 1, cy - 1, '#aa8855', 3)

        // Paths to edges
        grid.fillGround(cx - 1, cy - Math.floor(radius) + 2, 3, Math.floor(radius) - 5, 'road')
        grid.fillGround(cx - 1, cy + 3, 3, Math.floor(radius) - 5, 'road')

        // Trees around village
        placeTrees(cx - Math.floor(radius) + 3, cy - Math.floor(radius) + 3,
                   Math.floor(radius * 2) - 6, Math.floor(radius * 2) - 6, 0.12)
        // Clear trees from village area
        grid.assets = grid.assets.filter(a => {
          const inVillage = a.col >= cx - 5 && a.col < cx + 6 && a.row >= cy - 5 && a.row < cy + 6
          return !inVillage || a.type !== 'tree'
        })

        // Small dock
        grid.fillGround(cx - 1, cy + Math.floor(radius) - 1, 3, 4, 'bridge')

        // Boat (just a decoration)
        grid.placeAsset(['$'], cx, cy + Math.floor(radius) + 2, { type: 'crate', blocking: true, color: '#8b4513' })

        // Island NPCs
        placeNPC(cx + 3, cy)
        placeNPC(cx - 2, cy + 4)
        break
    }

    // Move player to valid spawn point near center
    movePlayerToValidSpawn(cx, cy)
    setSelectedCells(new Set())
  }

  // Random map generator using TEMPLATE_PRESETS system
  // Pipeline: grid → roads → buildings around roads → nature → collisions → NPCs
  const generateRandomMap = (presetId: string = 'village-small') => {
    const preset = TEMPLATE_PRESETS[presetId] || TEMPLATE_PRESETS['village-small']
    const seed = Math.random() * 10000

    // === STEP 0: Resize grid based on preset ===
    const cols = preset.cols.min + Math.floor(Math.random() * (preset.cols.max - preset.cols.min))
    const rows = preset.rows.min + Math.floor(Math.random() * (preset.rows.max - preset.rows.min))
    resizeGrid(cols, rows)

    // IMPORTANT: Get grid reference AFTER resizeGrid creates new grid
    const grid = gridRef.current
    if (!grid) return
    const cx = Math.floor(cols / 2)
    const cy = Math.floor(rows / 2)

    // Seeded random for reproducible noise
    const seededRandom = (x: number, y: number): number => {
      const n = Math.sin(x * 12.9898 + y * 78.233 + seed) * 43758.5453
      return n - Math.floor(n)
    }

    // Smooth noise for natural terrain formations
    const smoothNoise = (x: number, y: number, scale: number): number => {
      const sx = x / scale
      const sy = y / scale
      const x0 = Math.floor(sx)
      const y0 = Math.floor(sy)
      const fx = sx - x0
      const fy = sy - y0
      const n00 = seededRandom(x0, y0)
      const n10 = seededRandom(x0 + 1, y0)
      const n01 = seededRandom(x0, y0 + 1)
      const n11 = seededRandom(x0 + 1, y0 + 1)
      const nx0 = n00 * (1 - fx) + n10 * fx
      const nx1 = n01 * (1 - fx) + n11 * fx
      return nx0 * (1 - fy) + nx1 * fy
    }

    // Ground type mapping for themes
    const getBaseGround = (): string => {
      switch (preset.groundType) {
        case 'snow': return 'grass' // will color differently
        case 'sand': return 'grass' // will color differently
        case 'stone': return 'plaza'
        case 'wood': return 'bridge'
        default: return 'grass'
      }
    }

    // === STEP 1: Clear grid with natural ground formations ===
    grid.assets = []
    const baseGround = getBaseGround()
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (preset.type === 'interior') {
          grid.setGround(c, r, baseGround)
        } else {
          // Natural grass patches using noise
          const grassNoise = smoothNoise(c, r, 8)
          const grassType = grassNoise > 0.6 ? 'grass_tall' : 'grass'
          grid.setGround(c, r, grassType)
        }
        grid.setCollision(c, r, false)
        grid.setHeight(c, r, 0)
      }
    }

    // === STEP 2: Walls for interior maps ===
    if (preset.walls?.enabled && preset.type === 'interior') {
      const thickness = preset.walls.thickness
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const isWall = c < thickness || c >= cols - thickness ||
                         r < thickness || r >= rows - thickness
          if (isWall) {
            grid.setHeight(c, r, 3)
            grid.setCollision(c, r, true)
            grid.placeAsset(['█'], c, r, {
              type: 'wall', blocking: true, color: '#555566', height: 3
            })
          }
        }
      }
    }

    // === STEP 3: Water features ===
    if (preset.water.type === 'river') {
      const riverSide = Math.floor(Math.random() * 4)
      let rx = riverSide === 0 ? 0 : riverSide === 1 ? cols - 1 : Math.floor(Math.random() * cols)
      let ry = riverSide === 2 ? 0 : riverSide === 3 ? rows - 1 : Math.floor(Math.random() * rows)

      for (let i = 0; i < Math.max(cols, rows); i++) {
        for (let w = -1; w <= 1; w++) {
          if (rx + w >= 0 && rx + w < cols && ry >= 0 && ry < rows) {
            grid.setGround(rx + w, ry, 'water')
          }
        }
        rx += Math.floor(Math.random() * 3) - 1 + (rx < cx ? 0.3 : -0.3)
        ry += Math.floor(Math.random() * 3) - 1 + (ry < cy ? 0.3 : -0.3)
        rx = Math.max(0, Math.min(cols - 1, Math.floor(rx)))
        ry = Math.max(0, Math.min(rows - 1, Math.floor(ry)))
        if (rx <= 0 || rx >= cols - 1 || ry <= 0 || ry >= rows - 1) break
      }
    }

    if (preset.water.type === 'lake' || preset.water.type === 'river') {
      const lakeX = Math.floor(Math.random() * (cols - 12)) + 6
      const lakeY = Math.floor(Math.random() * (rows - 12)) + 6
      const lakeR = 3 + Math.floor(Math.random() * 4)
      for (let r = -lakeR; r <= lakeR; r++) {
        for (let c = -lakeR; c <= lakeR; c++) {
          if (c * c + r * r < lakeR * lakeR) {
            const px = lakeX + c
            const py = lakeY + r
            if (px >= 0 && px < cols && py >= 0 && py < rows) {
              grid.setGround(px, py, 'water')
            }
          }
        }
      }
    }

    if (preset.water.type === 'moat') {
      // Randomize moat shape slightly
      const moatDist = Math.min(cols, rows) * (0.30 + Math.random() * 0.1)
      const moatOffsetX = Math.floor(Math.random() * 6) - 3
      const moatOffsetY = Math.floor(Math.random() * 6) - 3
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const dx = Math.abs(c - (cx + moatOffsetX))
          const dy = Math.abs(r - (cy + moatOffsetY))
          const chebyshev = Math.max(dx, dy)
          // Add noise to moat edges
          const noise = smoothNoise(c, r, 4) * 2
          if (chebyshev >= moatDist - 2 + noise && chebyshev <= moatDist + 1 + noise) {
            grid.setGround(c, r, 'water')
          }
        }
      }
    }

    // === STEP 4: Generate roads based on pattern ===
    // Randomize road positions significantly
    let roadX = cx + Math.floor(Math.random() * 10) - 5
    let roadY = cy + Math.floor(Math.random() * 10) - 5
    const roadWidth = preset.roads.width

    if (preset.roads.enabled && preset.roads.pattern !== 'none') {
      if (preset.roads.pattern === 'cross') {
        // Horizontal road
        for (let c = 3; c < cols - 3; c++) {
          for (let w = 0; w < roadWidth; w++) {
            const r = roadY + w
            if (r >= 0 && r < rows && grid.ground[r]?.[c] !== 'water') {
              grid.setGround(c, r, 'road')
            }
          }
        }
        // Vertical road
        for (let r = 3; r < rows - 3; r++) {
          for (let w = 0; w < roadWidth; w++) {
            const c = roadX + w
            if (c >= 0 && c < cols && grid.ground[r]?.[c] !== 'water') {
              grid.setGround(c, r, 'road')
            }
          }
        }
      } else if (preset.roads.pattern === 'grid') {
        // Randomize grid spacing and offset
        const baseSpacing = preset.size === 'large' ? 15 : preset.size === 'medium' ? 12 : 10
        const gridSpacing = baseSpacing + Math.floor(Math.random() * 4) - 2
        const offsetX = Math.floor(Math.random() * (gridSpacing / 2))
        const offsetY = Math.floor(Math.random() * (gridSpacing / 2))

        // Horizontal roads
        for (let row = offsetY + gridSpacing; row < rows - 5; row += gridSpacing) {
          for (let c = 3; c < cols - 3; c++) {
            for (let w = 0; w < roadWidth; w++) {
              const r = row + w
              if (r < rows && grid.ground[r]?.[c] !== 'water') {
                grid.setGround(c, r, 'road')
              }
            }
          }
        }
        // Vertical roads
        for (let col = offsetX + gridSpacing; col < cols - 5; col += gridSpacing) {
          for (let r = 3; r < rows - 3; r++) {
            for (let w = 0; w < roadWidth; w++) {
              const c = col + w
              if (c < cols && grid.ground[r]?.[c] !== 'water') {
                grid.setGround(c, r, 'road')
              }
            }
          }
        }
        roadX = offsetX + gridSpacing
        roadY = offsetY + gridSpacing
      } else if (preset.roads.pattern === 'winding') {
        // Winding path - randomly horizontal or vertical
        const isHorizontal = Math.random() > 0.5
        if (isHorizontal) {
          let px = 3
          let py = 5 + Math.floor(Math.random() * (rows - 12))
          while (px < cols - 4) {
            for (let w = 0; w < roadWidth; w++) {
              if (py + w >= 0 && py + w < rows && grid.ground[py + w]?.[px] !== 'water') {
                grid.setGround(px, py + w, 'road')
              }
            }
            px++
            py += Math.floor(Math.random() * 3) - 1
            py = Math.max(4, Math.min(rows - 5, py))
          }
          roadY = py
          roadX = cx
        } else {
          let px = 5 + Math.floor(Math.random() * (cols - 12))
          let py = 3
          while (py < rows - 4) {
            for (let w = 0; w < roadWidth; w++) {
              if (px + w >= 0 && px + w < cols && grid.ground[py]?.[px + w] !== 'water') {
                grid.setGround(px + w, py, 'road')
              }
            }
            py++
            px += Math.floor(Math.random() * 3) - 1
            px = Math.max(4, Math.min(cols - 5, px))
          }
          roadX = px
          roadY = cy
        }
      } else if (preset.roads.pattern === 'single') {
        // Single road - randomly horizontal or vertical
        const isHorizontal = Math.random() > 0.5
        const offset = Math.floor(Math.random() * 10) - 5
        if (isHorizontal) {
          const roadRow = cy + offset
          for (let c = 3; c < cols - 3; c++) {
            for (let w = 0; w < roadWidth; w++) {
              const r = roadRow + w
              if (r >= 0 && r < rows && grid.ground[r]?.[c] !== 'water') {
                grid.setGround(c, r, 'road')
              }
            }
          }
          roadY = roadRow
        } else {
          const roadCol = cx + offset
          for (let r = 3; r < rows - 3; r++) {
            for (let w = 0; w < roadWidth; w++) {
              const c = roadCol + w
              if (c >= 0 && c < cols && grid.ground[r]?.[c] !== 'water') {
                grid.setGround(c, r, 'road')
              }
            }
          }
          roadX = roadCol
        }
      }

      // Add bridges over water crossings
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (grid.ground[r]?.[c] === 'water') {
            const adjRoad = [-1, 0, 1].some(dr =>
              [-1, 0, 1].some(dc =>
                grid.ground[r + dr]?.[c + dc] === 'road'
              )
            )
            if (adjRoad) {
              grid.setGround(c, r, 'bridge')
            }
          }
        }
      }
    }

    // === STEP 5: Plaza/town center ===
    const plazaOffset = Math.floor(Math.random() * 4) - 2
    const plazaSize = 10 + Math.floor(Math.random() * 4)
    const townX = roadX - Math.floor(plazaSize / 2) + plazaOffset
    const townY = roadY - Math.floor(plazaSize / 2) + plazaOffset
    if (preset.buildings.hasPlaza && preset.roads.enabled) {
      grid.fillGround(townX, townY, plazaSize, plazaSize, 'plaza')
      // Center fountain/well with random position
      const fountainOffset = Math.floor(plazaSize / 2) - 1
      const fountainX = townX + fountainOffset + Math.floor(Math.random() * 2)
      const fountainY = townY + fountainOffset + Math.floor(Math.random() * 2)
      grid.fillGround(fountainX, fountainY, 2, 2, 'water')
      // Lamps at random corners
      const lampPositions = [
        { x: townX + 1, y: townY + 1 },
        { x: townX + plazaSize - 2, y: townY + 1 },
        { x: townX + 1, y: townY + plazaSize - 2 },
        { x: townX + plazaSize - 2, y: townY + plazaSize - 2 },
      ]
      // Place 2-4 lamps randomly
      const numLamps = 2 + Math.floor(Math.random() * 3)
      const shuffledLamps = lampPositions.sort(() => Math.random() - 0.5)
      for (let i = 0; i < numLamps && i < shuffledLamps.length; i++) {
        grid.placeAsset(['!'], shuffledLamps[i].x, shuffledLamps[i].y, { type: 'lamp', blocking: true, color: '#ffff44', height: 2 })
      }
    }

    // === STEP 6: Buildings (positioned around roads, never ON roads) ===
    const numBuildings = preset.buildings.count.min +
      Math.floor(Math.random() * (preset.buildings.count.max - preset.buildings.count.min + 1))

    if (numBuildings > 0) {
      const validSpots: Array<{ x: number; y: number }> = []

      if (preset.buildings.hasPlaza) {
        // Place around plaza corners with random offset
        const offsetRange = 2
        validSpots.push(
          { x: townX + 1 + Math.floor(Math.random() * offsetRange), y: townY + 1 + Math.floor(Math.random() * offsetRange) },
          { x: townX + 7 + Math.floor(Math.random() * offsetRange), y: townY + 1 + Math.floor(Math.random() * offsetRange) },
          { x: townX + 1 + Math.floor(Math.random() * offsetRange), y: townY + 7 + Math.floor(Math.random() * offsetRange) },
          { x: townX + 7 + Math.floor(Math.random() * offsetRange), y: townY + 7 + Math.floor(Math.random() * offsetRange) },
        )
      }

      // Randomize building search grid
      const buildingSpacing = 5 + Math.floor(Math.random() * 3)
      const buildingOffsetX = Math.floor(Math.random() * buildingSpacing)
      const buildingOffsetY = Math.floor(Math.random() * buildingSpacing)

      if (preset.roads.enabled) {
        // Find spots along roads (but not on them)
        for (let r = 5 + buildingOffsetY; r < rows - 8; r += buildingSpacing) {
          for (let c = 5 + buildingOffsetX; c < cols - 8; c += buildingSpacing) {
            // Add small random jitter to each spot
            const jitterX = Math.floor(Math.random() * 3) - 1
            const jitterY = Math.floor(Math.random() * 3) - 1
            const checkC = c + jitterX
            const checkR = r + jitterY

            const ground = grid.ground[checkR]?.[checkC]
            if (!isRoadGround(ground) && ground !== 'water' && ground !== 'plaza') {
              // Check if near a road
              const nearRoad = [-4, -3, -2, -1, 0, 1, 2, 3, 4].some(dr =>
                [-4, -3, -2, -1, 0, 1, 2, 3, 4].some(dc =>
                  isRoadGround(grid.ground[checkR + dr]?.[checkC + dc])
                )
              )
              if (nearRoad) {
                validSpots.push({ x: checkC, y: checkR })
              }
            }
          }
        }
      }

      // Always add some random spots for variety
      for (let i = 0; i < 30; i++) {
        const x = 5 + Math.floor(Math.random() * (cols - 12))
        const y = 5 + Math.floor(Math.random() * (rows - 12))
        const ground = grid.ground[y]?.[x]
        if (!isRoadGround(ground) && ground !== 'water' && ground !== 'plaza') {
          validSpots.push({ x, y })
        }
      }

      const colors = ['#aa7755', '#aa6644', '#997766', '#bb8866', '#8b7355', '#cc9977', '#886655']
      for (let i = 0; i < numBuildings && validSpots.length > 0; i++) {
        const spotIdx = Math.floor(Math.random() * validSpots.length)
        const spot = validSpots.splice(spotIdx, 1)[0]
        // Randomize building dimensions
        const buildingWidth = 2 + Math.floor(Math.random() * 3)  // 2-4
        const buildingDepth = 2 + Math.floor(Math.random() * 3)  // 2-4
        const buildingHeight = 2 + Math.floor(Math.random() * 3) // 2-4

        // Verify footprint doesn't overlap roads/water
        let canPlace = true
        for (let dy = 0; dy < buildingDepth && canPlace; dy++) {
          for (let dx = 0; dx < buildingWidth && canPlace; dx++) {
            const g = grid.ground[spot.y + dy]?.[spot.x + dx]
            if (isRoadGround(g) || g === 'water' || g === 'plaza' || g === undefined) canPlace = false
          }
        }
        if (!canPlace) continue

        const color = colors[Math.floor(Math.random() * colors.length)]
        for (let dy = 0; dy < buildingDepth; dy++) {
          for (let dx = 0; dx < buildingWidth; dx++) {
            if (spot.x + dx < cols && spot.y + dy < rows) {
              grid.setHeight(spot.x + dx, spot.y + dy, buildingHeight)
              grid.setCollision(spot.x + dx, spot.y + dy, true)
              grid.placeAsset(['█'], spot.x + dx, spot.y + dy, {
                type: 'building', blocking: true, color, height: buildingHeight
              })
            }
          }
        }
      }
    }

    // === STEP 7: Nature (trees, bushes, flowers, rocks) ===
    const { treeDensity, bushDensity, flowerDensity, rockDensity } = preset.nature

    for (let r = 2; r < rows - 2; r++) {
      for (let c = 2; c < cols - 2; c++) {
        const ground = grid.ground[r]?.[c]
        if (isRoadGround(ground) || ground === 'water' || ground === 'plaza') continue

        // Skip cells with existing assets
        const hasAsset = grid.assets.some(a => a.col === c && a.row === r)
        if (hasAsset) continue

        // Skip near town center if plaza
        if (preset.buildings.hasPlaza && c >= townX - 2 && c < townX + 14 && r >= townY - 2 && r < townY + 14) {
          continue
        }

        // Skip too close to roads
        if (preset.roads.enabled) {
          const tooCloseToRoad = [-2, -1, 0, 1, 2].some(dr =>
            [-2, -1, 0, 1, 2].some(dc =>
              isRoadGround(grid.ground[r + dr]?.[c + dc])
            )
          )
          if (tooCloseToRoad && Math.random() > 0.3) continue
        }

        const noise = smoothNoise(c, r, 6)

        // Trees: use noise for clustering
        if (treeDensity > 0 && noise > (1 - treeDensity * 0.8)) {
          if (Math.random() < treeDensity * 0.5) {
            grid.placeAsset(['@'], c, r, { type: 'tree', blocking: true, color: '#33cc33', height: 3 })
            grid.setCollision(c, r, true)
            continue
          }
        }

        // Bushes
        if (bushDensity > 0 && Math.random() < bushDensity * 0.15) {
          grid.placeAsset(['&'], c, r, { type: 'bush', blocking: true, color: '#22aa22', height: 1 })
          grid.setCollision(c, r, true)
          continue
        }

        // Flowers (not blocking)
        if (flowerDensity > 0 && Math.random() < flowerDensity * 0.1) {
          grid.placeAsset(['+'], c, r, {
            type: 'flower',
            color: Math.random() > 0.5 ? '#ff88cc' : '#ffaa44'
          })
          continue
        }

        // Rocks (near water)
        if (rockDensity > 0 && Math.random() < rockDensity * 0.08) {
          const nearWater = [-1, 0, 1].some(dy =>
            [-1, 0, 1].some(dx => grid.ground[r + dy]?.[c + dx] === 'water')
          )
          if (nearWater || Math.random() < 0.3) {
            grid.placeAsset(['o'], c, r, { type: 'rock', blocking: true, color: '#888888' })
            grid.setCollision(c, r, true)
          }
        }
      }
    }

    // === STEP 8: Set collisions for all blocking elements ===
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const ground = grid.ground[r]?.[c]
        // Water is blocking
        if (ground === 'water') {
          grid.setCollision(c, r, true)
        }
      }
    }

    // === STEP 9: NPCs ===
    if (preset.npcs.enabled) {
      const npcCount = preset.npcs.count.min +
        Math.floor(Math.random() * (preset.npcs.count.max - preset.npcs.count.min + 1))
      let npcsPlaced = 0

      // Try plaza/town center first
      if (preset.buildings.hasPlaza) {
        for (let attempts = 0; attempts < 20 && npcsPlaced < npcCount; attempts++) {
          const nx = townX + 2 + Math.floor(Math.random() * 8)
          const ny = townY + 2 + Math.floor(Math.random() * 8)
          const ground = grid.ground[ny]?.[nx]
          const hasAsset = grid.assets.some(a => a.col === nx && a.row === ny)

          if ((ground === 'plaza' || ground === 'road') && !hasAsset) {
            grid.placeAsset(['☺'], nx, ny, { type: 'npc', blocking: true, color: '#ffdd00' })
            npcsPlaced++
          }
        }
      }

      // Place remaining on roads or walkable ground
      for (let attempts = 0; attempts < 50 && npcsPlaced < npcCount; attempts++) {
        const nx = 4 + Math.floor(Math.random() * (cols - 8))
        const ny = 4 + Math.floor(Math.random() * (rows - 8))
        const ground = grid.ground[ny]?.[nx]
        const hasAsset = grid.assets.some(a => a.col === nx && a.row === ny)
        const isCollision = grid.collision[ny]?.[nx]

        if (!isCollision && !hasAsset && ground !== 'water') {
          grid.placeAsset(['☺'], nx, ny, { type: 'npc', blocking: true, color: '#ffdd00' })
          npcsPlaced++
        }
      }
    }

    // Move player to valid spawn
    const spawnX = preset.buildings.hasPlaza ? townX + 6 : cx
    const spawnY = preset.buildings.hasPlaza ? townY + 6 : cy
    movePlayerToValidSpawn(spawnX, spawnY)
    setSelectedCells(new Set())
  }

  // Export layers for use with other game engines or tileset replacement
  const exportLayers = () => {
    const grid = gridRef.current
    if (!grid) return

    const cols = grid.cols
    const rows = grid.rows

    // Layer 1: Ground characters (for tileset mapping)
    const groundLayer: string[][] = []
    const groundTypes: string[][] = []
    for (let r = 0; r < rows; r++) {
      groundLayer[r] = []
      groundTypes[r] = []
      for (let c = 0; c < cols; c++) {
        const type = grid.ground[r]?.[c] || 'grass'
        groundTypes[r][c] = type
        // Map ground type to character
        const charMap: Record<string, string> = {
          grass: '.', water: '~', road: '=', plaza: '#', bridge: '|'
        }
        groundLayer[r][c] = charMap[type] || '.'
      }
    }

    // Layer 2: Height map
    const heightLayer: number[][] = []
    for (let r = 0; r < rows; r++) {
      heightLayer[r] = []
      for (let c = 0; c < cols; c++) {
        heightLayer[r][c] = grid.getHeight(c, r)
      }
    }

    // Layer 3: Collision map (0 = walkable, 1 = blocked)
    const collisionLayer: number[][] = []
    for (let r = 0; r < rows; r++) {
      collisionLayer[r] = []
      for (let c = 0; c < cols; c++) {
        const groundType = grid.ground[r]?.[c]
        const blocked = groundType === 'water' || grid.isBlocked(c, r) ? 1 : 0
        collisionLayer[r][c] = blocked
      }
    }

    // Layer 4-6: Asset layers by category
    const buildingsLayer: Array<{ col: number; row: number; char: string; tileKey?: string; height?: number }> = []
    const natureLayer: Array<{ col: number; row: number; char: string; tileKey?: string; height?: number }> = []
    const decorationsLayer: Array<{ col: number; row: number; char: string; tileKey?: string; height?: number }> = []
    const npcsLayer: Array<{ col: number; row: number; char: string; tileKey?: string }> = []

    for (const asset of grid.assets) {
      const assetData = {
        col: asset.col,
        row: asset.row,
        char: asset.art[0] || '?',
        tileKey: asset.tileKey,
        height: asset.heightLevel,
      }

      switch (asset.type) {
        case 'building':
          buildingsLayer.push(assetData)
          break
        case 'tree':
        case 'flower':
          natureLayer.push(assetData)
          break
        case 'npc':
          npcsLayer.push({ col: asset.col, row: asset.row, char: asset.art[0] || '☺', tileKey: asset.tileKey })
          break
        default:
          decorationsLayer.push(assetData)
      }
    }

    // Full combined character grid (for visual reference)
    const fullGrid: string[][] = []
    for (let r = 0; r < rows; r++) {
      fullGrid[r] = [...groundLayer[r]]
    }
    for (const asset of grid.assets) {
      if (asset.row >= 0 && asset.row < rows && asset.col >= 0 && asset.col < cols) {
        fullGrid[asset.row][asset.col] = asset.art[0] || '?'
      }
    }

    const exportData = {
      metadata: {
        name: templateName || 'Untitled',
        cols,
        rows,
        viewType,
        exportedAt: new Date().toISOString(),
        version: '1.0',
      },
      tileMapping: {
        ground: { '.': 'grass', '~': 'water', '=': 'road', '#': 'plaza', '|': 'bridge' },
        assets: {
          '@': 'tree', '*': 'bush', '$': 'crate', '!': 'lamp', '+': 'flower',
          'o': 'rock', '█': 'wall', '▀': 'roof', '░': 'floor', '☺': 'npc',
          '▓': 'tower', '┤': 'trunk', '♠': 'foliage',
        },
      },
      layers: {
        ground: groundLayer,
        groundTypes,
        height: heightLayer,
        collision: collisionLayer,
        buildings: buildingsLayer,
        nature: natureLayer,
        decorations: decorationsLayer,
        npcs: npcsLayer,
        full: fullGrid,
      },
      spawn: {
        col: Math.floor(playerRef.current.x / grid.cellSize),
        row: Math.floor(playerRef.current.z / grid.cellSize),
      },
      connectors,
    }

    // Download as JSON
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${templateName || 'level'}-layers.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const playerRef = useRef<PlayerState>({
    x: VILLAGE_CONFIG.spawnCol * VILLAGE_CONFIG.cellSize,
    z: VILLAGE_CONFIG.spawnRow * VILLAGE_CONFIG.cellSize,
    facing: 'down',
    moving: false,
    frame: 0,
  })
  const keysRef = useRef<Record<string, boolean>>({})

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Setup canvas
    canvas.width = window.innerWidth
    canvas.height = window.innerHeight

    // Create minimal empty grid - actual content loaded via URL params
    // Don't create random village here, let loadTemplate or generateRandomMap handle it
    gridRef.current = new IsometricGrid({
      cols: VILLAGE_CONFIG.cols,
      rows: VILLAGE_CONFIG.rows,
      cellSize: VILLAGE_CONFIG.cellSize,
      isoScale: VILLAGE_CONFIG.isoScale,
    })

    // Validate initial spawn point
    const grid = gridRef.current
    const spawnCol = VILLAGE_CONFIG.spawnCol
    const spawnRow = VILLAGE_CONFIG.spawnRow

    // Find valid spawn near configured spawn point
    let validCol = spawnCol
    let validRow = spawnRow

    // Spiral search for valid spawn
    outer: for (let radius = 0; radius < Math.max(grid.cols, grid.rows); radius++) {
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          if (radius > 0 && Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue
          const c = spawnCol + dx
          const r = spawnRow + dy
          if (c >= 0 && c < grid.cols && r >= 0 && r < grid.rows) {
            const groundType = grid.ground[r]?.[c]
            if (groundType !== 'water' && !grid.isBlocked(c, r)) {
              validCol = c
              validRow = r
              break outer
            }
          }
        }
      }
    }

    playerRef.current.x = validCol * grid.cellSize + grid.cellSize / 2
    playerRef.current.z = validRow * grid.cellSize + grid.cellSize / 2

    // Input handling
    const handleKeyDown = (e: KeyboardEvent) => {
      keysRef.current[e.key] = true
    }
    const handleKeyUp = (e: KeyboardEvent) => {
      keysRef.current[e.key] = false
    }
    const handleWheel = (e: WheelEvent) => {
      // Allow zoom in top view OR 2D view mode
      if (topViewMode || viewTypeRef.current === '2d') {
        e.preventDefault()
        const delta = e.deltaY > 0 ? -0.1 : 0.1
        setTopViewZoom(z => Math.max(0.5, Math.min(4.0, z + delta)))
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    canvas.addEventListener('wheel', handleWheel, { passive: false })

    // Game loop
    let animFrame: number
    let lastTime = 0
    let animTimer = 0

    const gameLoop = (time: number) => {
      const dt = time - lastTime
      lastTime = time
      animTimer += dt

      const grid = gridRef.current
      const player = playerRef.current
      const keys = keysRef.current

      if (!grid) return

      // Update player - slower speed for 16px cells
      const speed = 80 * (dt / 1000)
      player.moving = false

      let newX = player.x
      let newZ = player.z

      // Use simple grid movement for top view OR 2D view type
      // Use diagonal movement only for isometric view type in game view
      const use2DMovement = topViewMode || viewTypeRef.current === '2d'

      if (use2DMovement) {
        // 2D/Top view: simple grid movement (up=north, down=south, etc.)
        if (keys['ArrowUp'] || keys['w']) {
          newZ -= speed
          player.facing = 'up'
          player.moving = true
        }
        if (keys['ArrowDown'] || keys['s']) {
          newZ += speed
          player.facing = 'down'
          player.moving = true
        }
        if (keys['ArrowLeft'] || keys['a']) {
          newX -= speed
          player.facing = 'left'
          player.moving = true
        }
        if (keys['ArrowRight'] || keys['d']) {
          newX += speed
          player.facing = 'right'
          player.moving = true
        }
      } else {
        // Isometric view: diagonal movement
        const diagSpeed = speed * 0.707
        if (keys['ArrowUp'] || keys['w']) {
          newX -= diagSpeed
          newZ -= diagSpeed
          player.facing = 'up'
          player.moving = true
        }
        if (keys['ArrowDown'] || keys['s']) {
          newX += diagSpeed
          newZ += diagSpeed
          player.facing = 'down'
          player.moving = true
        }
        if (keys['ArrowLeft'] || keys['a']) {
          newX -= diagSpeed
          newZ += diagSpeed
          player.facing = 'left'
          player.moving = true
        }
        if (keys['ArrowRight'] || keys['d']) {
          newX += diagSpeed
          newZ -= diagSpeed
          player.facing = 'right'
          player.moving = true
        }
      }

      // Collision check
      if (!grid.isWorldBlocked(newX, newZ)) {
        player.x = newX
        player.z = newZ
      }

      // Bounds
      player.x = Math.max(0, Math.min(player.x, grid.cols * grid.cellSize))
      player.z = Math.max(0, Math.min(player.z, grid.rows * grid.cellSize))

      // Animation frame
      if (player.moving && animTimer > 150) {
        player.frame = (player.frame + 1) % 2
        animTimer = 0
      }

      // Render - movement works in all views
      if (flowViewMode) {
        // Flow view is handled by React overlay, just clear canvas
        ctx.fillStyle = '#0a0a12'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
      } else if (topViewMode) {
        renderTopView(ctx, canvas.width, canvas.height, grid, player, zoomRef.current, selectedCellsRef.current, connectorsRef.current, connectorModeRef.current, camOffsetRef.current)
      } else if (viewTypeRef.current === '2d') {
        render2D(ctx, canvas.width, canvas.height, grid, player, time, zoomRef.current, camOffsetRef.current)
      } else {
        render(ctx, canvas.width, canvas.height, grid, player, time, camOffsetRef.current)
      }

      // Movement works in top view too (grid-aligned for clarity)
      // In top view, we move in screen directions (up=up, down=down, etc.)

      animFrame = requestAnimationFrame(gameLoop)
    }

    animFrame = requestAnimationFrame(gameLoop)

    return () => {
      cancelAnimationFrame(animFrame)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      canvas.removeEventListener('wheel', handleWheel)
    }
  }, [])

  // ═══════════════════════════════════════════════════════════════════
  // TEMPLATE MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════

  // Load saved templates list
  const loadTemplateList = async () => {
    try {
      const { templates } = await listTemplates({ limit: 50 })
      setSavedTemplates(templates)
    } catch (error) {
      console.error('Failed to load templates:', error)
    }
  }

  // Save current map as template
  const saveCurrentTemplate = async () => {
    const grid = gridRef.current
    if (!grid || !templateName.trim()) return

    // Check template limit for new templates
    if (!currentTemplateId && savedTemplates.length >= maxTemplates) {
      alert(`Template limit reached (${maxTemplates}). Delete an existing template or update the current one.`)
      return
    }

    setIsSaving(true)
    try {
      const { groundData, heightData, assetsData } = serializeGrid(grid)

      if (currentTemplateId) {
        // Update existing
        await updateTemplate(currentTemplateId, {
          name: templateName,
          groundData,
          heightData,
          assetsData,
          connectors,
          cols: grid.cols,
          rows: grid.rows,
          cellSize: grid.cellSize,
          isoScale: grid.isoScale,
          spawnCol: Math.floor(playerRef.current.x / grid.cellSize),
          spawnRow: Math.floor(playerRef.current.z / grid.cellSize),
        })
      } else {
        // Create new
        const created = await createTemplate({
          name: templateName,
          groundData,
          heightData,
          assetsData,
          connectors,
          cols: grid.cols,
          rows: grid.rows,
          cellSize: grid.cellSize,
          isoScale: grid.isoScale,
          spawnCol: Math.floor(playerRef.current.x / grid.cellSize),
          spawnRow: Math.floor(playerRef.current.z / grid.cellSize),
        })
        setCurrentTemplateId(created.id)
      }

      await loadTemplateList()
      alert('Template saved!')
    } catch (error) {
      console.error('Failed to save template:', error)
      alert('Failed to save template')
    } finally {
      setIsSaving(false)
    }
  }

  // Load a template
  const loadTemplate = async (id: string) => {
    setIsLoading(true)
    try {
      const template = await getTemplate(id)
      const grid = gridRef.current
      if (!grid) return

      // Resize grid if needed
      if (template.cols !== grid.cols || template.rows !== grid.rows) {
        resizeGrid(template.cols, template.rows)
      }

      // Deserialize into grid
      deserializeToGrid(template, gridRef.current!)

      // Move player to valid spawn point (validate saved spawn or find nearby valid)
      movePlayerToValidSpawn(template.spawnCol, template.spawnRow)

      // Load connectors
      setConnectors(template.connectors || [])

      setCurrentTemplateId(template.id)
      setTemplateName(template.name)
      setShowTemplateList(false)
    } catch (error) {
      console.error('Failed to load template:', error)
      alert('Failed to load template')
    } finally {
      setIsLoading(false)
    }
  }

  // Delete a template
  const handleDeleteTemplate = async (id: string) => {
    if (!confirm('Delete this template?')) return

    try {
      await deleteTemplate(id)
      if (currentTemplateId === id) {
        setCurrentTemplateId(null)
        setTemplateName('')
      }
      await loadTemplateList()
    } catch (error) {
      console.error('Failed to delete template:', error)
      alert('Failed to delete template')
    }
  }

  // Load templates on mount
  useEffect(() => {
    loadTemplateList()
  }, [])

  // Handle URL params for initialization
  useEffect(() => {
    if (!router.isReady || initialized || !gridRef.current) return

    const { id, new: isNew } = router.query

    if (id && typeof id === 'string') {
      // Load existing template by ID
      loadTemplate(id)
      setInitialized(true)
    } else if (isNew === '1') {
      // Generate random map only when explicitly creating new
      generateRandomMap()
      setTemplateName(`Template ${new Date().toLocaleDateString()}`)
      setInitialized(true)
    } else {
      // No ID and not creating new - redirect to template list
      router.replace('/personal-projects/game-engine')
    }
  }, [router.isReady, router.query, initialized])

  return (
    <>
      <Head>
        <title>{templateName || 'New Template'} - Nebulith</title>
      </Head>
      <main className="fixed inset-0 overflow-hidden bg-black">
        <canvas
          ref={canvasRef}
          className="block w-full h-full cursor-grab"
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseUp}
          onContextMenu={handleContextMenu}
          style={{ cursor: isPanning ? 'grabbing' : 'default' }}
        />

        {/* Flow View Overlay */}
        {showFlowView && currentTemplateId && (
          <FlowViewOverlay
            currentTemplate={{ id: currentTemplateId, name: templateName }}
            connectors={connectors}
            allTemplates={savedTemplates}
            onSelectTemplate={(id) => {
              flowViewMode = false
              setShowFlowView(false)
              loadTemplate(id)
            }}
          />
        )}

        {/* Navigation */}
        <nav className="fixed top-4 left-4 bg-black/90 p-3 text-white font-mono text-sm rounded flex gap-2 z-20">
          <Link href="/personal-projects/game-engine" className="px-3 py-1 bg-gray-700 rounded hover:bg-gray-600">
            ← Templates
          </Link>
          <Link href="/" className="px-3 py-1 bg-gray-700 rounded hover:bg-gray-600">CV</Link>
        </nav>

        {/* Tileset Palette - visible in TOP or DEBUG view, hidden in FLOW */}
        {(showTopView || showDebug) && !showFlowView && (
          <div
            ref={sidebarRef}
            className="fixed left-4 top-20 bg-black/95 text-white font-mono text-sm rounded max-h-[80vh] overflow-y-auto z-10 flex"
            style={{ width: sidebarWidth }}
          >
            <div className="flex-1 p-3 overflow-y-auto">
            {/* Header with zoom controls */}
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-yellow-400 font-bold text-base">TILESET</h3>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setSidebarZoom(z => Math.max(0.5, z - 0.1))}
                  className="w-6 h-6 bg-gray-700 hover:bg-gray-600 rounded text-xs font-bold"
                >−</button>
                <span className="text-xs text-gray-400 w-8 text-center">{Math.round(sidebarZoom * 100)}%</span>
                <button
                  onClick={() => setSidebarZoom(z => Math.min(2.0, z + 0.1))}
                  className="w-6 h-6 bg-gray-700 hover:bg-gray-600 rounded text-xs font-bold"
                >+</button>
              </div>
            </div>

            {/* View Type Selector */}
            <div className="mb-3 p-2 bg-gray-800 rounded">
              <p className="text-gray-400 text-xs mb-1">View Type</p>
              <div className="flex gap-1">
                <button
                  onClick={() => setViewType('isometric')}
                  className={`flex-1 px-2 py-1 rounded text-xs ${viewType === 'isometric' ? 'bg-purple-600' : 'bg-gray-700 hover:bg-gray-600'}`}
                >Isometric</button>
                <button
                  onClick={() => setViewType('2d')}
                  className={`flex-1 px-2 py-1 rounded text-xs ${viewType === '2d' ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'}`}
                >2D</button>
              </div>
            </div>

            {/* Height Tool - Compact horizontal bar */}
            <div className={`mb-3 p-2 rounded ${heightEditMode ? 'bg-cyan-900/50 ring-1 ring-cyan-500' : 'bg-gray-800'}`}>
              <div className="flex items-center gap-2">
                <span className="text-cyan-400 text-xs font-bold">H:</span>
                <button
                  onClick={() => placeHeight(Math.max(0, selectedHeight - 1))}
                  className="w-5 h-5 rounded bg-gray-700 hover:bg-gray-600 text-xs font-bold"
                >-</button>
                <div className="flex gap-0.5">
                  {[0, 1, 2, 3, 4, 5].map(h => (
                    <button
                      key={h}
                      onClick={() => placeHeight(h)}
                      className={`w-5 h-5 rounded text-xs font-bold ${
                        selectedHeight === h && heightEditMode
                          ? 'bg-cyan-500 text-white'
                          : 'bg-gray-700 hover:bg-gray-600'
                      }`}
                    >
                      {h}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => placeHeight(Math.min(9, selectedHeight + 1))}
                  className="w-5 h-5 rounded bg-gray-700 hover:bg-gray-600 text-xs font-bold"
                >+</button>
              </div>
            </div>

            {/* Ground Tiles */}
            <div className="mb-3">
              <p className="text-gray-400 mb-1 text-xs font-bold">Ground</p>
              <div className="flex flex-wrap gap-1">
                <TileSwatch char="." name="Grass" bg="#1a5522" fg="#33aa33" zoom={sidebarZoom}
                  onClick={() => placeTile({ char: '.', type: 'ground', groundType: 'grass' })}
                  selected={selectedTile?.char === '.' && selectedTile?.type === 'ground'} />
                <TileSwatch char="~" name="Water" bg="#1155aa" fg="#55bbff" zoom={sidebarZoom}
                  onClick={() => placeTile({ char: '~', type: 'ground', groundType: 'water' })}
                  selected={selectedTile?.char === '~' && selectedTile?.type === 'ground'} />
                <TileSwatch char="=" name="Road" bg="#7a6644" fg="#ccbb88" zoom={sidebarZoom}
                  onClick={() => placeTile({ char: '=', type: 'ground', groundType: 'road' })}
                  selected={selectedTile?.char === '=' && selectedTile?.type === 'ground'} />
                <TileSwatch char="#" name="Plaza" bg="#aa9966" fg="#eeddbb" zoom={sidebarZoom}
                  onClick={() => placeTile({ char: '#', type: 'ground', groundType: 'plaza' })}
                  selected={selectedTile?.char === '#' && selectedTile?.type === 'ground'} />
                <TileSwatch char="|" name="Bridge" bg="#664422" fg="#bb8844" zoom={sidebarZoom}
                  onClick={() => placeTile({ char: '|', type: 'ground', groundType: 'bridge' })}
                  selected={selectedTile?.char === '|' && selectedTile?.type === 'ground'} />
              </div>
            </div>

            {/* Nature Parts */}
            <div className="mb-3">
              <p className="text-green-400 mb-1 text-xs font-bold">Nature</p>
              <div className="flex flex-wrap gap-1">
                <TileSwatch char={TILES.trunk.char} name="Trunk" bg={TILES.trunk.bg} fg={TILES.trunk.fg} zoom={sidebarZoom}
                  onClick={() => placeTile({ char: TILES.trunk.char, type: 'asset', tileKey: 'trunk' })} />
                <TileSwatch char={TILES.trunk_thick.char} name="Thick" bg={TILES.trunk_thick.bg} fg={TILES.trunk_thick.fg} zoom={sidebarZoom}
                  onClick={() => placeTile({ char: TILES.trunk_thick.char, type: 'asset', tileKey: 'trunk_thick' })} />
                <TileSwatch char={TILES.foliage.char} name="Foliage" bg={TILES.foliage.bg} fg={TILES.foliage.fg} zoom={sidebarZoom}
                  onClick={() => placeTile({ char: TILES.foliage.char, type: 'asset', tileKey: 'foliage' })} />
                <TileSwatch char={TILES.foliage_light.char} name="Light" bg={TILES.foliage_light.bg} fg={TILES.foliage_light.fg} zoom={sidebarZoom}
                  onClick={() => placeTile({ char: TILES.foliage_light.char, type: 'asset', tileKey: 'foliage_light' })} />
                <TileSwatch char={TILES.foliage_dark.char} name="Dark" bg={TILES.foliage_dark.bg} fg={TILES.foliage_dark.fg} zoom={sidebarZoom}
                  onClick={() => placeTile({ char: TILES.foliage_dark.char, type: 'asset', tileKey: 'foliage_dark' })} />
                <TileSwatch char={TILES.stump.char} name="Stump" bg={TILES.stump.bg} fg={TILES.stump.fg} zoom={sidebarZoom}
                  onClick={() => placeTile({ char: TILES.stump.char, type: 'asset', tileKey: 'stump' })} />
              </div>
            </div>

            {/* Building Parts */}
            <div className="mb-3">
              <p className="text-orange-400 mb-1 text-xs font-bold">Building</p>
              <div className="flex flex-wrap gap-1">
                <TileSwatch char={TILES.wall.char} name="Wall" bg={TILES.wall.bg} fg={TILES.wall.fg} zoom={sidebarZoom}
                  onClick={() => placeTile({ char: TILES.wall.char, type: 'asset', tileKey: 'wall' })} />
                <TileSwatch char={TILES.wall_stone.char} name="Stone" bg={TILES.wall_stone.bg} fg={TILES.wall_stone.fg} zoom={sidebarZoom}
                  onClick={() => placeTile({ char: TILES.wall_stone.char, type: 'asset', tileKey: 'wall_stone' })} />
                <TileSwatch char={TILES.window.char} name="Window" bg={TILES.window.bg} fg={TILES.window.fg} zoom={sidebarZoom}
                  onClick={() => placeTile({ char: TILES.window.char, type: 'asset', tileKey: 'window' })} />
                <TileSwatch char={TILES.door.char} name="Door" bg={TILES.door.bg} fg={TILES.door.fg} zoom={sidebarZoom}
                  onClick={() => placeTile({ char: TILES.door.char, type: 'asset', tileKey: 'door' })} />
                <TileSwatch char={TILES.roof_flat.char} name="Roof" bg={TILES.roof_flat.bg} fg={TILES.roof_flat.fg} zoom={sidebarZoom}
                  onClick={() => placeTile({ char: TILES.roof_flat.char, type: 'asset', tileKey: 'roof_flat' })} />
                <TileSwatch char={TILES.roof_peak.char} name="Peak" bg={TILES.roof_peak.bg} fg={TILES.roof_peak.fg} zoom={sidebarZoom}
                  onClick={() => placeTile({ char: TILES.roof_peak.char, type: 'asset', tileKey: 'roof_peak' })} />
                <TileSwatch char={TILES.column.char} name="Column" bg={TILES.column.bg} fg={TILES.column.fg} zoom={sidebarZoom}
                  onClick={() => placeTile({ char: TILES.column.char, type: 'asset', tileKey: 'column' })} />
                <TileSwatch char={TILES.floor.char} name="Floor" bg={TILES.floor.bg} fg={TILES.floor.fg} zoom={sidebarZoom}
                  onClick={() => placeTile({ char: TILES.floor.char, type: 'asset', tileKey: 'floor' })} />
              </div>
            </div>

            {/* Decoration Parts */}
            <div className="mb-3">
              <p className="text-pink-400 mb-1 text-xs font-bold">Decorations</p>
              <div className="flex flex-wrap gap-1">
                <TileSwatch char={TILES.lamp.char} name="Lamp" bg={TILES.lamp.bg} fg={TILES.lamp.fg} zoom={sidebarZoom}
                  onClick={() => placeTile({ char: TILES.lamp.char, type: 'asset', tileKey: 'lamp' })} />
                <TileSwatch char={TILES.crate.char} name="Crate" bg={TILES.crate.bg} fg={TILES.crate.fg} zoom={sidebarZoom}
                  onClick={() => placeTile({ char: TILES.crate.char, type: 'asset', tileKey: 'crate' })} />
                <TileSwatch char={TILES.barrel.char} name="Barrel" bg={TILES.barrel.bg} fg={TILES.barrel.fg} zoom={sidebarZoom}
                  onClick={() => placeTile({ char: TILES.barrel.char, type: 'asset', tileKey: 'barrel' })} />
                <TileSwatch char={TILES.flower.char} name="Flower" bg={TILES.flower.bg} fg={TILES.flower.fg} zoom={sidebarZoom}
                  onClick={() => placeTile({ char: TILES.flower.char, type: 'asset', tileKey: 'flower' })} />
                <TileSwatch char={TILES.rock.char} name="Rock" bg={TILES.rock.bg} fg={TILES.rock.fg} zoom={sidebarZoom}
                  onClick={() => placeTile({ char: TILES.rock.char, type: 'asset', tileKey: 'rock' })} />
                <TileSwatch char={TILES.fence_h.char} name="Fence" bg={TILES.fence_h.bg} fg={TILES.fence_h.fg} zoom={sidebarZoom}
                  onClick={() => placeTile({ char: TILES.fence_h.char, type: 'asset', tileKey: 'fence_h' })} />
                <TileSwatch char={TILES.sign.char} name="Sign" bg={TILES.sign.bg} fg={TILES.sign.fg} zoom={sidebarZoom}
                  onClick={() => placeTile({ char: TILES.sign.char, type: 'asset', tileKey: 'sign' })} />
                <TileSwatch char={TILES.npc.char} name="NPC" bg={TILES.npc.bg} fg={TILES.npc.fg} zoom={sidebarZoom}
                  onClick={() => placeTile({ char: TILES.npc.char, type: 'asset', tileKey: 'npc' })} />
              </div>
            </div>

            {/* Composite Assets */}
            <div className="mb-4 border-t border-gray-700 pt-3">
              <p className="text-cyan-400 mb-2 font-bold" style={{ fontSize: 12 * sidebarZoom }}>Composite Assets</p>
              <div className="flex flex-wrap gap-1">
                {[
                  { key: 'tree_small', icon: '@', name: 'Tree S', bg: 'bg-green-900', fg: 'text-green-400' },
                  { key: 'tree_medium', icon: '@', name: 'Tree M', bg: 'bg-green-900', fg: 'text-green-500' },
                  { key: 'tree_large', icon: '@', name: 'Tree L', bg: 'bg-green-900', fg: 'text-green-600' },
                  { key: 'bush', icon: '*', name: 'Bush', bg: 'bg-green-900', fg: 'text-green-300' },
                  { key: 'house_small', icon: '⌂', name: 'House', bg: 'bg-orange-900', fg: 'text-orange-400' },
                  { key: 'tower', icon: '▓', name: 'Tower', bg: 'bg-gray-800', fg: 'text-gray-400' },
                  { key: 'lamppost', icon: '!', name: 'Lamp', bg: 'bg-yellow-900', fg: 'text-yellow-400' },
                  { key: 'well', icon: '◯', name: 'Well', bg: 'bg-blue-900', fg: 'text-blue-400' },
                ].map(item => (
                  <button
                    key={item.key}
                    onClick={() => placeCompositeAsset(item.key)}
                    className={`${item.bg} hover:opacity-80 rounded flex flex-col items-center justify-center transition-all flex-shrink-0 ${
                      selectedComposite === item.key ? 'ring-2 ring-cyan-400' : ''
                    }`}
                    style={{
                      width: 56 * sidebarZoom,
                      height: 56 * sidebarZoom,
                      minWidth: 56 * sidebarZoom,
                    }}
                    title={item.name}
                  >
                    <span className={`${item.fg} font-bold leading-none`} style={{ fontSize: 20 * sidebarZoom }}>{item.icon}</span>
                    <span className="text-gray-300 leading-none mt-1" style={{ fontSize: 9 * sidebarZoom }}>{item.name}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Template Generators */}
            <div className="border-t border-gray-700 pt-3 mb-3">
              <p className="text-purple-400 mb-2 font-bold" style={{ fontSize: 12 * sidebarZoom }}>Generate Map</p>
              {Object.entries(PRESET_CATEGORIES).map(([theme, cat]) => {
                const presetsForTheme = Object.values(TEMPLATE_PRESETS).filter(p => p.theme === theme)
                if (presetsForTheme.length === 0) return null
                return (
                  <div key={theme} className="mb-2">
                    <p className="text-gray-500 text-xs mb-1" style={{ fontSize: 9 * sidebarZoom }}>{cat.label}</p>
                    <div className="flex flex-wrap gap-1">
                      {presetsForTheme.map(preset => (
                        <button
                          key={preset.id}
                          onClick={() => generateRandomMap(preset.id)}
                          className={`${cat.color} hover:opacity-80 rounded transition-all`}
                          style={{ padding: `${4 * sidebarZoom}px ${8 * sidebarZoom}px`, fontSize: 10 * sidebarZoom }}
                          title={preset.description}
                        >
                          {preset.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
              <p className="text-gray-500 mt-1" style={{ fontSize: 9 * sidebarZoom }}>
                Pipeline: grid → roads → buildings → nature → NPCs</p>
            </div>
          </div>

          {/* Resize handle */}
          <div
            className="w-2 cursor-ew-resize bg-gray-700 hover:bg-gray-500 transition-colors flex-shrink-0"
            onMouseDown={() => setIsResizingSidebar(true)}
          />
        </div>
        )}

        {/* Top-right: View Controls (scales with sidebarZoom) */}
        <div
          className="fixed bg-black/90 text-white font-mono rounded z-20"
          style={{
            top: isMobile ? 8 : 16,
            right: isMobile ? 8 : 16,
            padding: (isMobile ? 8 : 12) * sidebarZoom,
          }}
        >
          <div className="flex items-center gap-2 mb-2">
            <h2 className="text-yellow-400 font-bold" style={{ fontSize: (isMobile ? 12 : 14) * sidebarZoom }}>NEBULITH</h2>
            {!isMobile && <span className="text-gray-500" style={{ fontSize: 12 * sidebarZoom }}>WASD: Move</span>}
          </div>

          {/* View mode buttons */}
          <div className="flex gap-1 flex-wrap">
            <button
              onClick={() => { topViewMode = false; debugMode = false; flowViewMode = false; setShowTopView(false); setShowDebug(false); setShowFlowView(false) }}
              className={`rounded ${!showTopView && !showDebug && !showFlowView ? (viewType === '2d' ? 'bg-blue-600' : 'bg-yellow-600') : 'bg-gray-700 hover:bg-gray-600'}`}
              style={{ padding: `${4 * sidebarZoom}px ${8 * sidebarZoom}px`, fontSize: 12 * sidebarZoom }}
            >
              {viewType === '2d' ? '2D' : 'ISO'}
            </button>
            <button
              onClick={() => { topViewMode = true; flowViewMode = false; setShowTopView(true); setShowFlowView(false) }}
              className={`rounded ${showTopView && !showFlowView ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'}`}
              style={{ padding: `${4 * sidebarZoom}px ${8 * sidebarZoom}px`, fontSize: 12 * sidebarZoom }}
            >
              TOP
            </button>
            <button
              onClick={() => { debugMode = !debugMode; setShowDebug(!showDebug) }}
              className={`rounded ${showDebug ? 'bg-red-600' : 'bg-gray-700 hover:bg-gray-600'}`}
              style={{ padding: `${4 * sidebarZoom}px ${8 * sidebarZoom}px`, fontSize: 12 * sidebarZoom }}
            >
              DEBUG
            </button>
            <button
              onClick={() => { flowViewMode = !flowViewMode; setShowFlowView(!showFlowView); if (!flowViewMode) { topViewMode = false; setShowTopView(false) } }}
              className={`rounded ${showFlowView ? 'bg-purple-600' : 'bg-gray-700 hover:bg-gray-600'}`}
              style={{ padding: `${4 * sidebarZoom}px ${8 * sidebarZoom}px`, fontSize: 12 * sidebarZoom }}
            >
              FLOW
            </button>
            <button
              onClick={() => setShowControlsPanel(!showControlsPanel)}
              className={`rounded ${showControlsPanel ? 'bg-cyan-600' : 'bg-gray-700 hover:bg-gray-600'}`}
              style={{ padding: `${4 * sidebarZoom}px ${8 * sidebarZoom}px`, fontSize: 12 * sidebarZoom }}
            >
              {showControlsPanel ? '−' : '+'} CTRL
            </button>
          </div>
        </div>

        {/* Right-side Controls Panel (scales with sidebarZoom) */}
        {showControlsPanel && (showTopView || showDebug) && !showFlowView && (
          <div
            className="fixed bg-black/95 text-white font-mono rounded overflow-y-auto z-10"
            style={{
              top: isMobile ? 'auto' : 96 * sidebarZoom,
              bottom: isMobile ? 8 : 'auto',
              right: isMobile ? 8 : 16,
              left: isMobile ? 8 : 'auto',
              width: isMobile ? 'auto' : 256 * sidebarZoom,
              maxHeight: isMobile ? '50vh' : '70vh',
              padding: (isMobile ? 8 : 12) * sidebarZoom,
              fontSize: 12 * sidebarZoom,
            }}
          >
            {/* Grid Size */}
            <div className="mb-3 border-t border-gray-700 pt-3">
              <p className="text-gray-400 mb-2 font-bold" style={{ fontSize: 12 * sidebarZoom }}>
                Grid {viewType === '2d' ? '(W×H)' : '(Cols×Rows)'}
              </p>
              <div className="flex gap-2 items-center mb-2">
                <input
                  type="number"
                  value={gridSize.cols}
                  onChange={(e) => setGridSize(s => ({ ...s, cols: parseInt(e.target.value) || 10 }))}
                  className={`bg-gray-800 rounded text-center ${isMobile ? 'w-10 text-[10px] p-1' : 'w-12 text-xs p-1'}`}
                  min="10" max="100"
                />
                <span className={`text-gray-400 ${isMobile ? 'text-[10px]' : 'text-xs'}`}>×</span>
                <input
                  type="number"
                  value={gridSize.rows}
                  onChange={(e) => setGridSize(s => ({ ...s, rows: parseInt(e.target.value) || 10 }))}
                  className={`bg-gray-800 rounded text-center ${isMobile ? 'w-10 text-[10px] p-1' : 'w-12 text-xs p-1'}`}
                  min="10" max="100"
                />
                <button
                  onClick={() => resizeGrid(gridSize.cols, gridSize.rows)}
                  className={`bg-red-800 hover:bg-red-700 rounded ${isMobile ? 'px-2 py-1 text-[10px]' : 'px-2 py-1 text-xs'}`}
                >
                  Apply
                </button>
              </div>
            </div>

            {/* Save/Load */}
            <div className="mb-3 border-t border-gray-700 pt-3">
              <p className={`text-blue-400 mb-2 font-bold ${isMobile ? 'text-[10px]' : 'text-xs'}`}>Save / Load</p>
              <input
                type="text"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="Template name..."
                className={`w-full bg-gray-800 rounded mb-2 ${isMobile ? 'p-1 text-[10px]' : 'p-2 text-xs'}`}
              />
              <div className="flex gap-1 flex-wrap">
                <button
                  onClick={saveCurrentTemplate}
                  disabled={isSaving || !templateName.trim()}
                  className={`flex-1 bg-green-700 hover:bg-green-600 disabled:bg-gray-700 disabled:text-gray-500 rounded font-bold ${isMobile ? 'px-2 py-1 text-[10px]' : 'px-2 py-1 text-xs'}`}
                >
                  {isSaving ? '...' : currentTemplateId ? 'Update' : 'Save'}
                </button>
                <button
                  onClick={() => setShowTemplateList(!showTemplateList)}
                  className={`flex-1 bg-blue-800 hover:bg-blue-700 rounded ${isMobile ? 'px-2 py-1 text-[10px]' : 'px-2 py-1 text-xs'}`}
                >
                  Load ({savedTemplates.length})
                </button>
              </div>
              {showTemplateList && (
                <div className="mt-2 max-h-24 overflow-y-auto space-y-1">
                  {savedTemplates.map(t => (
                    <div key={t.id} className={`flex items-center gap-1 rounded ${currentTemplateId === t.id ? 'bg-blue-900' : 'bg-gray-800 hover:bg-gray-700'} ${isMobile ? 'p-1 text-[10px]' : 'p-1 text-xs'}`}>
                      <button onClick={() => loadTemplate(t.id)} className="flex-1 text-left truncate" disabled={isLoading}>
                        {t.name}
                      </button>
                      <button onClick={() => handleDeleteTemplate(t.id)} className="text-red-400 hover:text-red-300 px-1">✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Export Layers */}
            <div className="mb-3 border-t border-gray-700 pt-3">
              <p className={`text-orange-400 mb-2 font-bold ${isMobile ? 'text-[10px]' : 'text-xs'}`}>Export Layers</p>
              <p className={`text-gray-500 mb-2 ${isMobile ? 'text-[8px]' : 'text-[10px]'}`}>
                Export for tileset replacement: ground, collision, height, buildings, nature, decorations, NPCs
              </p>
              <button
                onClick={exportLayers}
                className={`w-full bg-orange-700 hover:bg-orange-600 rounded font-bold ${isMobile ? 'px-2 py-1 text-[10px]' : 'px-2 py-1 text-xs'}`}
              >
                Export JSON Layers
              </button>
            </div>

            {/* Connectors */}
            <div className="border-t border-gray-700 pt-3">
              <div className="flex items-center justify-between mb-2">
                <p className={`text-purple-400 font-bold ${isMobile ? 'text-[10px]' : 'text-xs'}`}>Connectors</p>
                <button
                  onClick={() => { setConnectorMode(!connectorMode); setEditingConnector(null) }}
                  className={`rounded ${isMobile ? 'px-2 py-1 text-[10px]' : 'px-2 py-1 text-xs'} ${connectorMode ? 'bg-purple-600' : 'bg-gray-700 hover:bg-gray-600'}`}
                >
                  {connectorMode ? 'Exit' : 'Edit'}
                </button>
              </div>

              {connectorMode && (
                <p className={`text-gray-400 mb-2 ${isMobile ? 'text-[10px]' : 'text-xs'}`}>Click cell to add connector</p>
              )}

              {editingConnector && (
                <div className={`bg-gray-800 rounded mb-2 ${isMobile ? 'p-2' : 'p-2'}`}>
                  <p className={`text-yellow-400 mb-1 ${isMobile ? 'text-[10px]' : 'text-xs'}`}>
                    ({editingConnector.col}, {editingConnector.row})
                  </p>
                  <select
                    value={connectorForm.targetTemplateId || ''}
                    onChange={e => setConnectorForm(f => ({ ...f, targetTemplateId: e.target.value }))}
                    className={`w-full bg-gray-700 rounded mb-1 ${isMobile ? 'p-1 text-[10px]' : 'p-1 text-xs'}`}
                  >
                    <option value="">Target template...</option>
                    {savedTemplates.filter(t => t.id !== currentTemplateId).map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                  <select
                    value={connectorForm.interaction || 'walk'}
                    onChange={e => setConnectorForm(f => ({ ...f, interaction: e.target.value as Connector['interaction'] }))}
                    className={`w-full bg-gray-700 rounded mb-1 ${isMobile ? 'p-1 text-[10px]' : 'p-1 text-xs'}`}
                  >
                    <option value="walk">Walk</option>
                    <option value="interact">Interact</option>
                    <option value="auto">Auto</option>
                  </select>
                  <div className="flex gap-1">
                    <button onClick={saveConnector} disabled={!connectorForm.targetTemplateId} className={`flex-1 bg-green-700 hover:bg-green-600 disabled:bg-gray-700 rounded ${isMobile ? 'p-1 text-[10px]' : 'p-1 text-xs'}`}>Save</button>
                    <button onClick={() => deleteConnector(editingConnector.col, editingConnector.row)} className={`bg-red-800 hover:bg-red-700 rounded ${isMobile ? 'p-1 text-[10px]' : 'p-1 text-xs'}`}>Del</button>
                    <button onClick={() => setEditingConnector(null)} className={`bg-gray-700 hover:bg-gray-600 rounded ${isMobile ? 'p-1 text-[10px]' : 'p-1 text-xs'}`}>X</button>
                  </div>
                </div>
              )}

              {connectors.length > 0 && (
                <div className="space-y-1 max-h-20 overflow-y-auto">
                  {connectors.map(c => (
                    <div
                      key={`${c.col},${c.row}`}
                      className={`flex items-center justify-between bg-gray-800 rounded cursor-pointer hover:bg-gray-700 ${isMobile ? 'p-1 text-[10px]' : 'p-1 text-xs'}`}
                      onClick={() => { setConnectorForm(c); setEditingConnector({ col: c.col, row: c.row }); setConnectorMode(true) }}
                    >
                      <span>({c.col},{c.row})→{c.targetTemplateName?.slice(0,8) || '?'}</span>
                      <span className="text-purple-400">{c.interaction}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Debug Legend */}
        {showDebug && !showTopView && !showControlsPanel && (
          <div className={`fixed ${isMobile ? 'bottom-2 right-2' : 'bottom-4 right-4'} bg-black/90 text-white font-mono rounded ${isMobile ? 'p-2 text-[10px]' : 'p-3 text-xs'}`}>
            <h3 className="text-red-400 font-bold mb-1">DEBUG</h3>
            <p><span className="text-red-400">■</span> Blocked</p>
            <p><span className="text-green-400">■</span> Walkable</p>
          </div>
        )}
      </main>
    </>
  )
}

// Render function - ASCII art on isometric diamond tiles
function render(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  grid: IsometricGrid,
  player: PlayerState,
  time: number,
  camOffset: { x: number; y: number } = { x: 0, y: 0 }
) {
  // Clear
  ctx.fillStyle = '#1a1a2e'
  ctx.fillRect(0, 0, w, h)

  const cellSize = grid.cellSize
  const isoScale = grid.isoScale

  // Camera follows player + pan offset
  const camX = player.x - camOffset.x
  const camZ = player.z - camOffset.y

  // Tile dimensions - slightly overlapping to eliminate gaps
  const tileW = cellSize * isoScale * 0.71  // Half-width of diamond
  const tileH = cellSize * isoScale * 0.36  // Half-height of diamond
  const heightStep = cellSize * isoScale * 0.4  // Height per elevation level

  // Convert world to screen (center of diamond tile)
  const toScreen = (col: number, row: number) => {
    const wx = col * cellSize - camX
    const wz = row * cellSize - camZ
    return {
      x: w / 2 + (wx - wz) * isoScale * 0.71,
      y: h / 2 + (wx + wz) * isoScale * 0.36
    }
  }

  // ─── GROUND TILES (ASCII on diamonds) ─────────────────────────────

  const tilesX = Math.ceil(w / 28) + 12
  const tilesZ = Math.ceil(h / 18) + 12
  const startCol = Math.floor(camX / cellSize) - Math.floor(tilesX / 2)
  const startRow = Math.floor(camZ / cellSize) - Math.floor(tilesZ / 2)

  // Font for ground characters
  const groundFontSize = Math.max(12, tileH * 1.1)
  ctx.font = `bold ${groundFontSize}px ${ASCII_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  for (let rz = 0; rz < tilesZ; rz++) {
    for (let rx = 0; rx < tilesX; rx++) {
      const col = startCol + rx
      const row = startRow + rz

      if (col < 0 || col >= grid.cols || row < 0 || row >= grid.rows) continue

      const p = toScreen(col, row)
      if (p.x < -tileW * 2 || p.x > w + tileW * 2 || p.y < -tileH * 2 || p.y > h + tileH * 2) continue

      const tileType = grid.ground[row]?.[col] || 'grass'
      const colors = GROUND_COLORS[tileType as keyof typeof GROUND_COLORS] || GROUND_COLORS.grass

      // Noise-based color variation (same as 2D view)
      const noiseVal = Math.sin(col * 0.3 + row * 0.5) * Math.cos(col * 0.7 - row * 0.2)
      const colorIdx = noiseVal > 0 ? 0 : 1

      const char = colors.char[colorIdx % colors.char.length]
      const fg = colors.fg[colorIdx % colors.fg.length]
      const bg = colors.bg[colorIdx % colors.bg.length]

      // Get cell height
      const cellHeight = grid.getHeight(col, row)
      const heightOffset = cellHeight * heightStep

      // Draw diamond tile with background
      const drawY = p.y - heightOffset

      // If elevated, draw front faces first
      if (cellHeight > 0) {
        // Left face (darker)
        ctx.fillStyle = darkenColor(bg, 0.5)
        ctx.beginPath()
        ctx.moveTo(p.x - tileW, drawY)
        ctx.lineTo(p.x, drawY + tileH)
        ctx.lineTo(p.x, p.y + tileH)
        ctx.lineTo(p.x - tileW, p.y)
        ctx.closePath()
        ctx.fill()

        // Right face (medium)
        ctx.fillStyle = darkenColor(bg, 0.7)
        ctx.beginPath()
        ctx.moveTo(p.x + tileW, drawY)
        ctx.lineTo(p.x, drawY + tileH)
        ctx.lineTo(p.x, p.y + tileH)
        ctx.lineTo(p.x + tileW, p.y)
        ctx.closePath()
        ctx.fill()
      }

      // Top face (diamond) - always draw
      ctx.fillStyle = bg
      ctx.beginPath()
      ctx.moveTo(p.x, drawY - tileH)
      ctx.lineTo(p.x + tileW, drawY)
      ctx.lineTo(p.x, drawY + tileH)
      ctx.lineTo(p.x - tileW, drawY)
      ctx.closePath()
      ctx.fill()

      // ASCII character on top with subtle animation
      const flicker = tileType.includes('grass') ? Math.sin(time * 0.001 + col * 0.3 + row * 0.4) * 0.1 + 1 : 1
      ctx.globalAlpha = 0.85 + 0.15 * flicker
      ctx.fillStyle = fg
      ctx.fillText(char, p.x, drawY)
      ctx.globalAlpha = 1
    }
  }

  // ─── ASSETS + PLAYER (ASCII art stacked in isometric space) ────────

  const visibleAssets = grid.getVisibleAssets(
    Math.floor(camX / cellSize),
    Math.floor(camZ / cellSize),
    30, 20
  )

  // Sort all objects by depth (back to front)
  const allObjects: { col: number; row: number; isPlayer?: boolean; asset?: GridAsset }[] = [
    ...visibleAssets.map(a => ({ col: a.col, row: a.row, asset: a })),
    {
      col: player.x / cellSize,
      row: player.z / cellSize,
      isPlayer: true
    }
  ].sort((a, b) => (a.col + a.row) - (b.col + b.row))

  // Render each object with ASCII art style
  for (const obj of allObjects) {
    const p = toScreen(obj.col, obj.row)
    const cellHeight = grid.getHeight(Math.floor(obj.col), Math.floor(obj.row))
    const heightOffset = cellHeight * heightStep

    if (obj.isPlayer) {
      drawIsoPlayer(ctx, p.x, p.y - heightOffset, tileW, tileH, player, time)
    } else if (obj.asset) {
      drawIsoAssetAscii(ctx, p.x, p.y - heightOffset, obj.asset, tileW, tileH, time)
    }
  }

  // ─── DEBUG MODE ────────────────────────────────────────────────────

  if (debugMode) {
    renderDebugOverlays(ctx, w, h, grid, player, (wx, wz) => toScreen(wx / cellSize, wz / cellSize), cellSize)
  }

  // ─── UI ───────────────────────────────────────────────────────────

  ctx.fillStyle = '#ffffff'
  ctx.font = `14px ${ASCII_FONT}`
  ctx.textAlign = 'left'
  ctx.fillText(`Pos: ${Math.floor(player.x)}, ${Math.floor(player.z)}`, 10, 30)
  ctx.fillText(`Grid: ${Math.floor(player.x / cellSize)}, ${Math.floor(player.z / cellSize)}`, 10, 50)

  if (debugMode) {
    ctx.fillStyle = '#ff4444'
    ctx.fillText('DEBUG MODE', 10, 70)
  }
}

// Draw player as ASCII art in isometric view (matching 2D style)
function drawIsoPlayer(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tileW: number,
  tileH: number,
  player: PlayerState,
  time: number
) {
  const playerArt = getPlayerArt(player)
  const lineHeight = tileH * 1.4
  const fontSize = tileH * 1.2

  // Breathing animation
  const breathe = Math.sin(time * 0.004) * 2

  ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // Draw each line from bottom to top
  for (let i = 0; i < playerArt.length; i++) {
    const line = playerArt[playerArt.length - 1 - i]
    const lineY = y - i * lineHeight - lineHeight * 0.5 - breathe

    // Shadow/outline for visibility
    ctx.fillStyle = '#000000'
    ctx.fillText(line, x + 1, lineY + 1)

    // Yellow player color
    ctx.fillStyle = '#ffdd00'
    ctx.fillText(line, x, lineY)
  }
}

// Draw asset as ASCII art in isometric view (matching 2D style)
function drawIsoAssetAscii(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  asset: GridAsset,
  tileW: number,
  tileH: number,
  time: number
) {
  const lineHeight = tileH * 1.3
  const fontSize = tileH * 1.1
  const flicker = Math.sin(time * 0.003 + x * 0.01 + y * 0.02) * 0.15 + 1

  ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  if (asset.type === 'tree') {
    // Tree: trunk + layered canopy (like 2D view)
    const layers = [
      { text: '0', color: '#ad8621', bg: '#5a4510' },  // Trunk bottom
      { text: 'W', color: '#c9a030', bg: '#6a5520' },  // Trunk top
      { text: '(&)', color: `rgba(26, 182, 26, ${0.7 + 0.3 * flicker})`, bg: 'rgba(0, 100, 0, 0.9)' },
      { text: '(@&@)', color: `rgba(50, 205, 50, ${0.8 + 0.2 * flicker})`, bg: 'rgba(0, 130, 0, 0.85)' },
      { text: '(@&@&@)', color: `rgba(34, 200, 34, ${0.85 + 0.15 * flicker})`, bg: 'rgba(0, 110, 0, 0.8)' },
    ]
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i]
      const layerY = y - i * lineHeight - lineHeight * 0.5
      const layerFontSize = i < 2 ? fontSize * 0.9 : fontSize * (0.7 + (i - 2) * 0.05)
      ctx.font = `bold ${layerFontSize}px ${ASCII_FONT}`

      // Background shape
      const textWidth = ctx.measureText(layer.text).width
      ctx.fillStyle = layer.bg
      ctx.fillRect(x - textWidth / 2 - 2, layerY - lineHeight / 2, textWidth + 4, lineHeight)

      // Text
      ctx.fillStyle = layer.color
      ctx.fillText(layer.text, x, layerY)
    }

  } else if (asset.type === 'building') {
    // Building: walls + door + windows + roof (like 2D view)
    const layers = [
      { text: '▌', color: '#553b17', bg: '#b48441' },  // Door
      { text: '▒', color: `rgba(255, 255, 0, ${0.3 + 0.2 * flicker})`, bg: '#b48441' },  // Window
      { text: '▒', color: `rgba(255, 255, 0, ${0.4 + 0.2 * flicker})`, bg: '#a07030' },  // Window
      { text: '/\\', color: `rgba(255, 99, 71, ${0.8 + 0.2 * flicker})`, bg: '#cc3030' },  // Roof bottom
      { text: '▲', color: `rgba(255, 80, 60, ${0.85 + 0.15 * flicker})`, bg: '#aa2020' },  // Roof top
    ]
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i]
      const layerY = y - i * lineHeight - lineHeight * 0.5
      const layerWidth = (i < 3 ? tileW * 2 : tileW * (2.4 - (i - 3) * 0.3))

      // Background
      ctx.fillStyle = layer.bg
      ctx.fillRect(x - layerWidth / 2, layerY - lineHeight / 2, layerWidth, lineHeight)

      // Character
      ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
      ctx.fillStyle = layer.color
      ctx.fillText(layer.text, x, layerY)
    }

  } else if (asset.type === 'lamp' || asset.type === 'lantern') {
    // Lamp post with glowing top
    const glow = 0.5 + 0.5 * flicker
    const layers = [
      { text: '|', color: '#666666', bg: '#333333' },
      { text: '|', color: '#777777', bg: '#444444' },
      { text: 'o', color: `rgba(255, 220, 50, ${glow})`, bg: `rgba(100, 80, 0, ${glow})` },
    ]
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i]
      const layerY = y - i * lineHeight - lineHeight * 0.5

      ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
      ctx.fillStyle = layer.bg
      const textWidth = ctx.measureText(layer.text).width
      ctx.fillRect(x - textWidth / 2 - 2, layerY - lineHeight / 2, textWidth + 4, lineHeight)

      ctx.fillStyle = layer.color
      ctx.fillText(layer.text, x, layerY)
    }

  } else if (asset.type === 'bush') {
    // Small bush
    const layers = [
      { text: '*', color: `rgba(80, 200, 80, ${0.8 + 0.2 * flicker})`, bg: 'rgba(0, 100, 0, 0.85)' },
      { text: '**', color: `rgba(60, 180, 60, ${0.85 + 0.15 * flicker})`, bg: 'rgba(0, 90, 0, 0.8)' },
    ]
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i]
      const layerY = y - i * lineHeight - lineHeight * 0.5

      ctx.font = `bold ${fontSize * 0.9}px ${ASCII_FONT}`
      ctx.fillStyle = layer.bg
      const textWidth = ctx.measureText(layer.text).width
      ctx.fillRect(x - textWidth / 2 - 2, layerY - lineHeight / 2, textWidth + 4, lineHeight)

      ctx.fillStyle = layer.color
      ctx.fillText(layer.text, x, layerY)
    }

  } else if (asset.type === 'npc') {
    // NPC character (similar to player but different color)
    const layers = [
      { text: '/=\\', color: '#4466cc', bg: '#223366' },
      { text: '<O>', color: '#ffccaa', bg: '#886644' },
    ]
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i]
      const layerY = y - i * lineHeight - lineHeight * 0.5

      ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
      ctx.fillStyle = '#000000'
      ctx.fillText(layer.text, x + 1, layerY + 1)
      ctx.fillStyle = layer.color
      ctx.fillText(layer.text, x, layerY)
    }

  } else if (asset.type === 'flower') {
    // Small flower
    ctx.font = `bold ${fontSize * 0.8}px ${ASCII_FONT}`
    const layerY = y - lineHeight * 0.3
    ctx.fillStyle = asset.color || '#ff88cc'
    ctx.fillText('+', x, layerY)

  } else if (asset.type === 'rock' || asset.type === 'decoration') {
    // Rock/decoration
    ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
    const layerY = y - lineHeight * 0.5
    ctx.fillStyle = '#555555'
    ctx.fillRect(x - tileW / 2, layerY - lineHeight / 2, tileW, lineHeight)
    ctx.fillStyle = '#999999'
    ctx.fillText('O', x, layerY)

  } else {
    // Default: show the asset's art character
    const char = asset.art[0] || '?'
    const layerY = y - lineHeight * 0.5
    ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
    ctx.fillStyle = darkenColor(asset.color || '#888888', 0.4)
    const textWidth = ctx.measureText(char).width
    ctx.fillRect(x - textWidth / 2 - 2, layerY - lineHeight / 2, textWidth + 4, lineHeight)
    ctx.fillStyle = asset.color || '#ffffff'
    ctx.fillText(char, x, layerY)
  }
}

// 2D Render function - RPG-style 3/4 top-down view (like Pokemon/Zelda)
function render2D(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  grid: IsometricGrid,
  player: PlayerState,
  time: number,
  zoom: number = 1.0,
  camOffset: { x: number; y: number } = { x: 0, y: 0 }
) {
  // Clear with sky/background color
  ctx.fillStyle = '#1a1a2e'
  ctx.fillRect(0, 0, w, h)

  const cellSize = grid.cellSize
  const baseTileSize = 24
  const tileW = baseTileSize * zoom // Tile width in pixels
  const tileH = baseTileSize * zoom // Tile height in pixels
  const heightScale = 16 * zoom // Pixels per height unit (objects extend upward)

  // Camera follows player (centered) + pan offset
  const camCol = player.x / cellSize - camOffset.x / tileW
  const camRow = player.z / cellSize - camOffset.y / tileH

  // Convert grid position to screen
  const toScreen = (col: number, row: number) => ({
    x: w / 2 + (col - camCol) * tileW,
    y: h / 2 + (row - camRow) * tileH
  })

  // Calculate visible range
  const tilesX = Math.ceil(w / tileW) + 4
  const tilesY = Math.ceil(h / tileH) + 4
  const startCol = Math.floor(camCol) - Math.floor(tilesX / 2)
  const startRow = Math.floor(camRow) - Math.floor(tilesY / 2)

  // ─── GROUND LAYER ─────────────────────────────────────────────────
  for (let row = startRow; row < startRow + tilesY; row++) {
    for (let col = startCol; col < startCol + tilesX; col++) {
      if (col < 0 || col >= grid.cols || row < 0 || row >= grid.rows) continue

      const p = toScreen(col + 0.5, row + 0.5)
      if (p.x < -tileW || p.x > w + tileW || p.y < -tileH || p.y > h + tileH) continue

      const tileType = grid.ground[row]?.[col] || 'grass'
      const colors = GROUND_COLORS[tileType as keyof typeof GROUND_COLORS] || GROUND_COLORS.grass

      // Use noise-based variation for natural look (not checkerboard)
      // Create larger patches using position-based pseudo-noise
      const noiseVal = Math.sin(col * 0.3 + row * 0.5) * Math.cos(col * 0.7 - row * 0.2)
      const colorIdx = noiseVal > 0 ? 0 : 1 // Smooth patches instead of checkerboard

      const char = colors.char[colorIdx % colors.char.length]
      const fg = colors.fg[colorIdx % colors.fg.length]
      const bg = colors.bg[colorIdx % colors.bg.length]

      // Draw ground tile
      ctx.fillStyle = bg
      ctx.fillRect(p.x - tileW / 2, p.y - tileH / 2, tileW, tileH)

      // Draw ground character with slight animation
      const grassFlicker = tileType.includes('grass') ? Math.sin(time * 0.001 + col * 0.3 + row * 0.4) * 0.1 + 1 : 1
      ctx.fillStyle = fg
      ctx.globalAlpha = 0.85 + 0.15 * grassFlicker
      ctx.font = `bold ${tileH * 0.7}px ${ASCII_FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(char, p.x, p.y)
      ctx.globalAlpha = 1

      // Height creates elevated platforms - draw "front face" if height > 0
      const cellHeight = grid.getHeight(col, row)
      if (cellHeight > 0) {
        const elevH = cellHeight * heightScale
        // Top surface (slightly brighter)
        ctx.fillStyle = bg
        ctx.fillRect(p.x - tileW / 2, p.y - tileH / 2 - elevH, tileW, tileH)
        ctx.fillStyle = fg
        ctx.fillText(char, p.x, p.y - elevH)
        // Front face (darker)
        ctx.fillStyle = darkenColor(bg, 0.6)
        ctx.fillRect(p.x - tileW / 2, p.y + tileH / 2 - elevH, tileW, elevH)
      }
    }
  }

  // ─── OBJECTS LAYER (sorted by row for depth) ─────────────────────
  // Collect all drawable objects: assets + player
  const drawables: Array<{
    row: number
    col: number
    type: 'asset' | 'player'
    asset?: GridAsset
  }> = []

  // Add assets
  const visibleAssets = grid.getVisibleAssets(
    Math.floor(camCol), Math.floor(camRow), tilesX, tilesY
  )
  for (const asset of visibleAssets) {
    drawables.push({ row: asset.row, col: asset.col, type: 'asset', asset })
  }

  // Add player
  const playerCol = player.x / cellSize
  const playerRow = player.z / cellSize
  drawables.push({ row: playerRow, col: playerCol, type: 'player' })

  // Sort by row (things further up screen drawn first = behind)
  drawables.sort((a, b) => a.row - b.row)

  // Draw each object
  for (const obj of drawables) {
    const p = toScreen(obj.col + 0.5, obj.row + 0.5)
    const groundHeight = grid.getHeight(Math.floor(obj.col), Math.floor(obj.row))
    const elevOffset = groundHeight * heightScale

    if (obj.type === 'player') {
      // Draw player using ASCII art sprite - grounded at cell bottom
      const playerArt = getPlayerArt(player)
      const baseY = p.y + tileH * 0.5 - elevOffset

      // Draw each line of the ASCII art, stacking upward from baseY
      const fontSize = tileH * 0.7
      const lineHeight = fontSize * 0.9
      ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'

      // Draw each line from bottom to top (no background)
      for (let i = 0; i < playerArt.length; i++) {
        const line = playerArt[playerArt.length - 1 - i] // Reverse order (bottom to top)
        const lineY = baseY - (i + 0.5) * lineHeight
        ctx.fillStyle = '#ffdd00'
        ctx.fillText(line, p.x, lineY)
      }

    } else if (obj.asset) {
      const asset = obj.asset

      // Get proper height for 2D RPG view based on asset type
      let heightTiles = 1
      if (asset.type === 'tree') heightTiles = 3
      else if (asset.type === 'building') heightTiles = 4
      else if (asset.type === 'lamp') heightTiles = 2

      // Base at bottom of cell - tiles stack upward
      const baseY = p.y + tileH * 0.5 - elevOffset

      ctx.font = `bold ${tileH * 0.8}px ${ASCII_FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'

      // Draw based on asset type - VIBRANT test-ascii style (Crash Bandicoot palette)
      // Animation flicker based on time
      const flicker = Math.sin(time * 0.003 + obj.col * 0.5 + obj.row * 0.7) * 0.15 + 1

      if (asset.type === 'tree') {
        // Layered tree like test-ascii: (@), (@&@), (@&@&@) expanding down
        // Trunk with golden-brown colors
        const trunkChars = ['W', '0', 'W']
        for (let h = 0; h < 2; h++) {
          const tileTop = baseY - (h + 1) * tileH
          ctx.fillStyle = `rgba(173, 134, 33, 0.96)` // Golden brown
          ctx.fillRect(p.x - tileW * 0.35, tileTop, tileW * 0.7, tileH)
          ctx.fillStyle = `rgba(243, 191, 54, ${0.7 + 0.3 * flicker})` // Bright gold
          ctx.fillText(trunkChars[h] || '0', p.x, tileTop + tileH * 0.5)
        }
        // Layered canopy - vibrant greens with @&() characters
        const layers = [
          { chars: '(&)', width: 1.2, bg: 'rgba(0, 130, 0, 0.9)', fg: `rgba(26, 182, 26, ${0.7 + 0.3 * flicker})` },
          { chars: '(@&@)', width: 1.6, bg: 'rgba(0, 158, 0, 0.85)', fg: `rgba(50, 205, 50, ${0.8 + 0.2 * flicker})` },
          { chars: '(@&@&@)', width: 2.0, bg: 'rgba(0, 130, 0, 0.8)', fg: `rgba(34, 200, 34, ${0.85 + 0.15 * flicker})` },
        ]
        for (let h = 0; h < layers.length; h++) {
          const layer = layers[h]
          const tileTop = baseY - (h + 3) * tileH
          ctx.fillStyle = layer.bg
          ctx.fillRect(p.x - tileW * layer.width * 0.5, tileTop, tileW * layer.width, tileH)
          ctx.fillStyle = layer.fg
          ctx.font = `bold ${tileH * 0.65}px ${ASCII_FONT}`
          ctx.fillText(layer.chars, p.x, tileTop + tileH * 0.5)
        }
        ctx.font = `bold ${tileH * 0.8}px ${ASCII_FONT}`

      } else if (asset.type === 'building') {
        // Pagoda/temple style like test-ascii - red roofs, golden trim
        const wallH = 3
        const roofH = 2
        // Walls - warm brown/tan
        for (let h = 0; h < wallH; h++) {
          const tileTop = baseY - (h + 1) * tileH
          ctx.fillStyle = `rgba(180, 132, 65, 0.85)` // Temple brown
          ctx.fillRect(p.x - tileW * 0.5, tileTop, tileW, tileH)
          if (h === 0) {
            ctx.fillStyle = 'rgba(85, 59, 23, 0.85)' // Dark door
            ctx.fillText('▌', p.x, tileTop + tileH * 0.5)
          } else {
            ctx.fillStyle = `rgba(255, 255, 0, ${0.3 + 0.2 * flicker})` // Glowing window
            ctx.fillText('▒', p.x, tileTop + tileH * 0.5)
          }
        }
        // Roof - rich reds with eaves extending out
        for (let h = 0; h < roofH; h++) {
          const tileTop = baseY - (wallH + h + 1) * tileH
          const roofWidth = 1.4 - h * 0.2
          ctx.fillStyle = h === 0 ? 'rgba(200, 30, 30, 0.95)' : 'rgba(160, 0, 0, 0.9)'
          ctx.fillRect(p.x - tileW * roofWidth * 0.5, tileTop, tileW * roofWidth, tileH)
          ctx.fillStyle = `rgba(255, 99, 71, ${0.8 + 0.2 * flicker})` // Tomato red
          ctx.fillText(h === 0 ? '/\\' : '▲', p.x, tileTop + tileH * 0.5)
        }

      } else if (asset.type === 'lamp') {
        // Animated lantern - yellow glow that flickers
        ctx.fillStyle = '#333333'
        ctx.fillRect(p.x - tileW * 0.12, baseY - tileH * 2, tileW * 0.24, tileH * 2)
        ctx.fillStyle = '#555555'
        ctx.fillText('|', p.x, baseY - tileH * 0.5)
        // Glowing lamp top
        ctx.fillStyle = `rgba(255, 255, 0, ${0.6 + 0.4 * flicker})`
        ctx.fillRect(p.x - tileW * 0.25, baseY - tileH * 2.4, tileW * 0.5, tileH * 0.5)
        ctx.fillStyle = `rgba(255, 200, 50, ${0.7 + 0.3 * flicker})`
        ctx.fillText('o', p.x, baseY - tileH * 2.2)

      } else {
        // Default - still use vibrant colors with animation
        const tileFg = asset.color || '#ffffff'
        const tileBg = asset.bgColor || darkenColor(tileFg, 0.3)
        const char = asset.art[0] || '?'
        ctx.fillStyle = tileBg
        ctx.fillRect(p.x - tileW * 0.5, baseY - tileH, tileW, tileH)
        ctx.fillStyle = tileFg
        ctx.fillText(char, p.x, baseY - tileH * 0.5)
      }
    }
  }

  // ─── DEBUG OVERLAY ─────────────────────────────────────────────────
  if (debugMode) {
    ctx.globalAlpha = 0.6
    // Draw collision overlay
    for (let row = startRow; row < startRow + tilesY; row++) {
      for (let col = startCol; col < startCol + tilesX; col++) {
        if (col < 0 || col >= grid.cols || row < 0 || row >= grid.rows) continue
        const p = toScreen(col + 0.5, row + 0.5)
        const isCollision = grid.collision[row]?.[col]
        const cellHeight = grid.getHeight(col, row)

        if (isCollision) {
          ctx.fillStyle = 'rgba(255, 50, 50, 0.4)'
          ctx.fillRect(p.x - tileW / 2, p.y - tileH / 2, tileW, tileH)
        }

        // Show height numbers
        if (cellHeight > 0) {
          ctx.fillStyle = '#ffff00'
          ctx.font = `bold ${tileH * 0.4}px ${ASCII_FONT}`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(String(cellHeight), p.x, p.y)
        }
      }
    }
    ctx.globalAlpha = 1

    // Grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'
    ctx.lineWidth = 1
    for (let row = startRow; row < startRow + tilesY; row++) {
      for (let col = startCol; col < startCol + tilesX; col++) {
        const p = toScreen(col + 0.5, row + 0.5)
        ctx.strokeRect(p.x - tileW / 2, p.y - tileH / 2, tileW, tileH)
      }
    }
  }

  // ─── UI ───────────────────────────────────────────────────────────
  ctx.fillStyle = '#ffffff'
  ctx.font = `14px ${ASCII_FONT}`
  ctx.textAlign = 'left'
  ctx.fillText(`Pos: ${Math.floor(player.x)}, ${Math.floor(player.z)}`, 10, 30)
  ctx.fillStyle = debugMode ? '#ff6666' : '#4488ff'
  ctx.fillText(debugMode ? '2D DEBUG MODE' : '2D RPG MODE', 10, 50)
}

// Get player sprite based on state
function getPlayerArt(player: PlayerState): string[] {
  if (!player.moving) return playerSprite.idle

  const f = player.frame
  switch (player.facing) {
    case 'right': return f === 0 ? playerSprite.right1 : playerSprite.right2
    case 'left': return f === 0 ? playerSprite.left1 : playerSprite.left2
    case 'up': return f === 0 ? playerSprite.up1 : playerSprite.up2
    case 'down': return f === 0 ? playerSprite.down1 : playerSprite.down2
  }
}

// Auto-generate dark background from color
function darkenColor(hex: string, factor: number = 0.25): string {
  // Handle rgb() format
  if (hex.startsWith('rgb')) {
    const match = hex.match(/(\d+)/g)
    if (match) {
      const [r, g, b] = match.map(Number)
      return `rgb(${Math.floor(r * factor)}, ${Math.floor(g * factor)}, ${Math.floor(b * factor)})`
    }
    return hex
  }
  // Handle hex format
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgb(${Math.floor(r * factor)}, ${Math.floor(g * factor)}, ${Math.floor(b * factor)})`
}

// Draw ASCII art at position - ALWAYS draws background for visibility
function drawAscii(
  ctx: CanvasRenderingContext2D,
  art: string[],
  x: number,
  y: number,
  color: string,
  scale: number = 1.0,
  bgColor?: string
) {
  const fontSize = 14 * scale
  ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
  ctx.textAlign = 'left'

  const lineHeight = fontSize * 0.95
  const charWidth = fontSize * 0.6

  // Anchor at bottom center
  const startY = y - (art.length * lineHeight)
  const maxWidth = Math.max(...art.map(l => l.length))
  const startX = x - (maxWidth * charWidth) / 2

  // Use provided bgColor or auto-generate dark version
  const actualBg = bgColor || darkenColor(color)

  for (let i = 0; i < art.length; i++) {
    const line = art[i]
    const lineY = startY + i * lineHeight

    for (let j = 0; j < line.length; j++) {
      const char = line[j]
      if (char === ' ') continue

      const charX = startX + j * charWidth

      // Background - ALWAYS draw for visibility
      ctx.fillStyle = actualBg
      ctx.fillRect(charX - 1, lineY - fontSize * 0.75, charWidth + 1, lineHeight)

      // Character
      ctx.fillStyle = color
      ctx.fillText(char, charX, lineY)
    }
  }
}

// Draw isometric 3D asset matching 2D vibrant style
function drawIsoAsset(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  asset: GridAsset,
  cellSize: number,
  isoScale: number,
  time: number
) {
  const blockW = cellSize * isoScale * 0.7
  const blockH = cellSize * isoScale * 0.35
  const blockTall = cellSize * isoScale * 0.5

  // Animation flicker
  const flicker = Math.sin(time * 0.003 + x * 0.01 + y * 0.02) * 0.15 + 1

  // Helper: draw isometric block
  const drawBlock = (bx: number, by: number, width: number, top: string, left: string, right: string) => {
    const hw = blockW * width * 0.5
    // Top face
    ctx.fillStyle = top
    ctx.beginPath()
    ctx.moveTo(bx, by - blockH)
    ctx.lineTo(bx + hw, by)
    ctx.lineTo(bx, by + blockH)
    ctx.lineTo(bx - hw, by)
    ctx.closePath()
    ctx.fill()
    // Left face
    ctx.fillStyle = left
    ctx.beginPath()
    ctx.moveTo(bx - hw, by)
    ctx.lineTo(bx, by + blockH)
    ctx.lineTo(bx, by + blockH + blockTall)
    ctx.lineTo(bx - hw, by + blockTall)
    ctx.closePath()
    ctx.fill()
    // Right face
    ctx.fillStyle = right
    ctx.beginPath()
    ctx.moveTo(bx + hw, by)
    ctx.lineTo(bx, by + blockH)
    ctx.lineTo(bx, by + blockH + blockTall)
    ctx.lineTo(bx + hw, by + blockTall)
    ctx.closePath()
    ctx.fill()
  }

  if (asset.type === 'tree') {
    // Trunk (2 blocks)
    for (let h = 0; h < 2; h++) {
      const by = y - h * blockTall
      drawBlock(x, by, 0.4, '#ad8621', '#7a5c17', '#c9a030')
    }
    // Canopy (3 layers, expanding outward)
    const layers = [
      { w: 0.8, top: '#1ab61a', left: '#0d7a0d', right: '#22cc22' },
      { w: 1.2, top: '#22cc22', left: '#119911', right: '#2dd82d' },
      { w: 1.6, top: '#1ec01e', left: '#0e880e', right: '#28d428' },
    ]
    for (let h = 0; h < layers.length; h++) {
      const layer = layers[h]
      const by = y - (h + 2) * blockTall
      // Animated brightness
      const bright = flicker
      const top = adjustColorBrightness(layer.top, bright)
      const left = adjustColorBrightness(layer.left, bright * 0.8)
      const right = adjustColorBrightness(layer.right, bright)
      drawBlock(x, by, layer.w, top, left, right)
    }
    // Top highlight
    ctx.fillStyle = `rgba(100, 255, 100, ${0.3 * flicker})`
    ctx.font = `bold ${blockTall * 0.6}px ${ASCII_FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('@', x, y - 4.5 * blockTall)

  } else if (asset.type === 'building') {
    // Walls (3 blocks)
    for (let h = 0; h < 3; h++) {
      const by = y - h * blockTall
      drawBlock(x, by, 1.0, '#b48441', '#8a6330', '#cca060')
    }
    // Window on middle block
    ctx.fillStyle = `rgba(255, 255, 100, ${0.4 + 0.3 * flicker})`
    ctx.font = `bold ${blockTall * 0.5}px ${ASCII_FONT}`
    ctx.textAlign = 'center'
    ctx.fillText('▒', x, y - 1.5 * blockTall)
    // Roof (2 layers, red)
    for (let h = 0; h < 2; h++) {
      const by = y - (h + 3) * blockTall
      const width = 1.3 - h * 0.2
      const bright = 1 - h * 0.15
      drawBlock(x, by, width,
        adjustColorBrightness('#cc3030', bright),
        adjustColorBrightness('#991010', bright),
        adjustColorBrightness('#dd4545', bright))
    }
    // Roof peak decoration
    ctx.fillStyle = `rgba(255, 100, 80, ${0.7 + 0.3 * flicker})`
    ctx.fillText('▲', x, y - 5 * blockTall)

  } else if (asset.type === 'lamp' || asset.type === 'lantern') {
    // Post
    ctx.fillStyle = '#555555'
    ctx.fillRect(x - blockW * 0.08, y - blockTall * 2, blockW * 0.16, blockTall * 2)
    // Glowing lantern
    const glow = 0.5 + 0.5 * flicker
    ctx.fillStyle = `rgba(255, 220, 50, ${glow})`
    ctx.beginPath()
    ctx.arc(x, y - blockTall * 2.3, blockW * 0.25, 0, Math.PI * 2)
    ctx.fill()
    // Light rays
    ctx.fillStyle = `rgba(255, 255, 150, ${glow * 0.3})`
    ctx.beginPath()
    ctx.arc(x, y - blockTall * 2.3, blockW * 0.4, 0, Math.PI * 2)
    ctx.fill()

  } else if (asset.type === 'npc') {
    // Simple character - 2 blocks
    drawBlock(x, y, 0.6, '#4466cc', '#3355aa', '#5577dd')
    drawBlock(x, y - blockTall, 0.5, '#ffccaa', '#ddaa88', '#ffddbb')
    // Face
    ctx.fillStyle = '#000'
    ctx.font = `bold ${blockTall * 0.4}px ${ASCII_FONT}`
    ctx.textAlign = 'center'
    ctx.fillText('◡', x, y - blockTall * 1.2)

  } else if (asset.type === 'bush') {
    drawBlock(x, y, 0.8,
      adjustColorBrightness('#22aa22', flicker),
      adjustColorBrightness('#118811', flicker),
      adjustColorBrightness('#28c828', flicker))
    ctx.fillStyle = `rgba(80, 200, 80, ${0.5 * flicker})`
    ctx.font = `bold ${blockTall * 0.5}px ${ASCII_FONT}`
    ctx.textAlign = 'center'
    ctx.fillText('*', x, y - blockH)

  } else if (asset.type === 'rock' || asset.type === 'decoration') {
    drawBlock(x, y, 0.6, '#888888', '#555555', '#999999')

  } else if (asset.type === 'flower') {
    // Small decorative flower
    ctx.fillStyle = asset.color || '#ff88cc'
    ctx.font = `bold ${blockTall * 0.6}px ${ASCII_FONT}`
    ctx.textAlign = 'center'
    ctx.fillText('+', x, y - blockH * 0.5)

  } else {
    // Default: simple colored block
    const color = asset.color || '#888888'
    drawBlock(x, y, 0.8,
      color,
      adjustColorBrightness(color, 0.6),
      adjustColorBrightness(color, 0.85))
    // Draw character on top
    ctx.fillStyle = '#fff'
    ctx.font = `bold ${blockTall * 0.5}px ${ASCII_FONT}`
    ctx.textAlign = 'center'
    ctx.fillText(asset.art[0] || '?', x, y - blockH)
  }
}

// Draw block-based character (1 wide x 3 tall blocks) with animation
function drawBlockCharacter(
  ctx: CanvasRenderingContext2D,
  screenX: number,
  screenY: number,
  cellSize: number,
  isoScale: number,
  facing: 'up' | 'down' | 'left' | 'right',
  time: number = 0
) {
  const blockW = cellSize * isoScale * 0.7
  const blockH = cellSize * isoScale * 0.35
  const blockTall = cellSize * isoScale * 0.5

  // Subtle breathing animation
  const breathe = Math.sin(time * 0.004) * 0.03 + 1

  // Vibrant character colors (matching 2D style)
  const colors = {
    legs: { fill: '#3355cc', dark: '#2244aa', light: '#4466dd' },
    body: { fill: '#ffdd00', dark: '#ccaa00', light: '#ffee44' },
    head: { fill: '#ffccaa', dark: '#ddaa88', light: '#ffddbb' },
  }

  const parts = [
    { y: 0, ...colors.legs },
    { y: 1, ...colors.body },
    { y: 2 * breathe, ...colors.head },
  ]

  for (const part of parts) {
    const py = screenY - part.y * blockTall

    // Top face
    ctx.fillStyle = part.light
    ctx.beginPath()
    ctx.moveTo(screenX, py - blockH)
    ctx.lineTo(screenX + blockW * 0.5, py)
    ctx.lineTo(screenX, py + blockH)
    ctx.lineTo(screenX - blockW * 0.5, py)
    ctx.closePath()
    ctx.fill()

    // Left side (darker)
    ctx.fillStyle = part.dark
    ctx.beginPath()
    ctx.moveTo(screenX - blockW * 0.5, py)
    ctx.lineTo(screenX, py + blockH)
    ctx.lineTo(screenX, py + blockH + blockTall * 0.4)
    ctx.lineTo(screenX - blockW * 0.5, py + blockTall * 0.4)
    ctx.closePath()
    ctx.fill()

    // Right side (medium)
    ctx.fillStyle = part.fill
    ctx.beginPath()
    ctx.moveTo(screenX + blockW * 0.5, py)
    ctx.lineTo(screenX, py + blockH)
    ctx.lineTo(screenX, py + blockH + blockTall * 0.4)
    ctx.lineTo(screenX + blockW * 0.5, py + blockTall * 0.4)
    ctx.closePath()
    ctx.fill()
  }

  // Face/direction on head
  const headY = screenY - 2 * breathe * blockTall - blockH * 0.3
  ctx.fillStyle = '#000000'
  ctx.font = `bold ${blockTall * 0.5}px ${ASCII_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  let dirChar = 'v'
  switch (facing) {
    case 'up': dirChar = '^'; break
    case 'down': dirChar = 'v'; break
    case 'left': dirChar = '<'; break
    case 'right': dirChar = '>'; break
  }
  ctx.fillText(dirChar, screenX, headY)
}

// Helper to adjust color brightness
function adjustColorBrightness(hex: string, factor: number): string {
  const match = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i)
  if (!match) return hex
  const r = Math.min(255, Math.floor(parseInt(match[1], 16) * factor))
  const g = Math.min(255, Math.floor(parseInt(match[2], 16) * factor))
  const b = Math.min(255, Math.floor(parseInt(match[3], 16) * factor))
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

// Debug overlay rendering
function renderDebugOverlays(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  grid: IsometricGrid,
  player: PlayerState,
  toScreen: (wx: number, wz: number) => { x: number; y: number },
  cellSize: number
) {
  const tilesX = Math.ceil(w / 32) + 10
  const tilesZ = Math.ceil(h / 20) + 10
  const startCol = Math.floor(player.x / cellSize) - tilesX / 2
  const startRow = Math.floor(player.z / cellSize) - tilesZ / 2

  ctx.font = `bold 10px ${ASCII_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // Pass 1: Draw collision overlay (red tint on blocked cells)
  for (let rz = 0; rz < tilesZ; rz++) {
    for (let rx = 0; rx < tilesX; rx++) {
      const col = Math.floor(startCol + rx)
      const row = Math.floor(startRow + rz)

      if (col < 0 || col >= grid.cols || row < 0 || row >= grid.rows) continue

      const worldX = col * cellSize
      const worldZ = row * cellSize
      const p = toScreen(worldX, worldZ)

      if (p.x < -50 || p.x > w + 50 || p.y < -50 || p.y > h + 50) continue

      const isBlocked = grid.isBlocked(col, row)
      const tileW = cellSize * grid.isoScale * 0.7
      const tileH = cellSize * grid.isoScale * 0.35

      if (isBlocked) {
        // Red overlay for collision
        ctx.fillStyle = 'rgba(255, 0, 0, 0.4)'
        ctx.beginPath()
        ctx.moveTo(p.x, p.y - tileH)
        ctx.lineTo(p.x + tileW, p.y)
        ctx.lineTo(p.x, p.y + tileH)
        ctx.lineTo(p.x - tileW, p.y)
        ctx.closePath()
        ctx.fill()
      }

      // Grid coordinates
      ctx.fillStyle = isBlocked ? '#ffaaaa' : '#aaffaa'
      ctx.fillText(`${col},${row}`, p.x, p.y)
    }
  }

  // Pass 2: Asset type labels
  const visibleAssets = grid.getVisibleAssets(
    Math.floor(player.x / cellSize),
    Math.floor(player.z / cellSize),
    30, 20
  )

  ctx.font = `bold 11px ${ASCII_FONT}`

  for (const asset of visibleAssets) {
    const worldX = asset.col * cellSize
    const worldZ = asset.row * cellSize
    const p = toScreen(worldX, worldZ)

    // Color by type
    let labelColor = '#ffffff'
    let labelBg = 'rgba(0, 0, 0, 0.7)'
    switch (asset.type) {
      case 'building':
        labelColor = '#ffaa00'
        labelBg = 'rgba(100, 60, 0, 0.8)'
        break
      case 'tree':
        labelColor = '#44ff44'
        labelBg = 'rgba(0, 60, 0, 0.8)'
        break
      case 'water':
      case 'fountain':
        labelColor = '#44aaff'
        labelBg = 'rgba(0, 40, 80, 0.8)'
        break
      case 'decoration':
      case 'crate':
      case 'lamp':
        labelColor = '#ffff44'
        labelBg = 'rgba(60, 60, 0, 0.8)'
        break
      case 'flower':
        labelColor = '#ff88ff'
        labelBg = 'rgba(60, 0, 60, 0.8)'
        break
    }

    // Draw label background
    const label = asset.type.toUpperCase()
    const metrics = ctx.measureText(label)
    const labelY = p.y - 30

    ctx.fillStyle = labelBg
    ctx.fillRect(p.x - metrics.width / 2 - 3, labelY - 8, metrics.width + 6, 16)

    ctx.fillStyle = labelColor
    ctx.fillText(label, p.x, labelY)

    // Connection line
    ctx.strokeStyle = labelColor
    ctx.setLineDash([2, 2])
    ctx.beginPath()
    ctx.moveTo(p.x, labelY + 8)
    ctx.lineTo(p.x, p.y - 5)
    ctx.stroke()
    ctx.setLineDash([])
  }

  // Player label
  const playerP = toScreen(player.x, player.z)
  ctx.fillStyle = 'rgba(80, 60, 0, 0.8)'
  ctx.fillRect(playerP.x - 25, playerP.y - 50, 50, 16)
  ctx.fillStyle = '#ffdd00'
  ctx.fillText('PLAYER', playerP.x, playerP.y - 42)
}

// Top-down 2D blueprint view - flat, no height, just positions
function renderTopView(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  grid: IsometricGrid,
  player: PlayerState,
  zoom: number = 1.0,
  selectedCells: Set<string> = new Set(),
  connectors: Connector[] = [],
  connectorMode: boolean = false,
  camOffset: { x: number; y: number } = { x: 0, y: 0 }
) {
  // Clear
  ctx.fillStyle = '#0a0a10'
  ctx.fillRect(0, 0, w, h)

  // Calculate tile size with zoom
  const baseTileSize = 16
  const tileSize = baseTileSize * zoom

  // Center on player position + pan offset
  const cellSize = grid.cellSize
  const playerCol = player.x / cellSize
  const playerRow = player.z / cellSize

  // Offset so player is centered + camera pan
  const offsetX = w / 2 - playerCol * tileSize + camOffset.x
  const offsetY = h / 2 - playerRow * tileSize + camOffset.y

  const fontSize = Math.max(8, tileSize * 0.6)
  ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // Calculate visible range
  const startCol = Math.max(0, Math.floor(-offsetX / tileSize) - 1)
  const endCol = Math.min(grid.cols, Math.ceil((w - offsetX) / tileSize) + 1)
  const startRow = Math.max(0, Math.floor(-offsetY / tileSize) - 1)
  const endRow = Math.min(grid.rows, Math.ceil((h - offsetY) / tileSize) + 1)

  // Build a map of assets by position for quick lookup
  const assetMap: Record<string, GridAsset> = {}
  for (const asset of grid.assets) {
    assetMap[`${asset.col},${asset.row}`] = asset
  }

  // Draw each cell - show ground OR asset (asset takes priority)
  for (let row = startRow; row < endRow; row++) {
    for (let col = startCol; col < endCol; col++) {
      const x = offsetX + col * tileSize
      const y = offsetY + row * tileSize
      const key = `${col},${row}`
      const asset = assetMap[key]

      let char: string
      let fg: string
      let bg: string

      if (asset) {
        // Asset on this cell - show asset icon
        switch (asset.type) {
          case 'building':
            char = '█'; fg = '#ffaa55'; bg = '#442211'; break
          case 'tree':
            char = '@'; fg = '#33cc33'; bg = '#0a220a'; break
          case 'water':
          case 'fountain':
            char = '~'; fg = '#55ccff'; bg = '#112233'; break
          case 'decoration':
          case 'crate':
            char = '$'; fg = '#ddaa55'; bg = '#332211'; break
          case 'lamp':
            char = '!'; fg = '#ffff55'; bg = '#333300'; break
          case 'flower':
            char = '+'; fg = '#ff88cc'; bg = '#220a11'; break
          case 'npc':
            char = '☺'; fg = '#ffdd00'; bg = '#333311'; break
          default:
            char = '?'; fg = '#888888'; bg = '#111111'; break
        }
      } else {
        // Ground tile
        const tileType = grid.ground[row]?.[col] || 'grass'
        const colors = GROUND_COLORS[tileType as keyof typeof GROUND_COLORS] || GROUND_COLORS.grass
        char = colors.char[0]
        fg = colors.fg[0]
        bg = colors.bg[0]
      }

      // Draw cell
      ctx.fillStyle = bg
      ctx.fillRect(x, y, tileSize - 1, tileSize - 1)

      ctx.fillStyle = fg
      ctx.fillText(char, x + tileSize / 2, y + tileSize / 2)

      // Height indicator (show in corner if height > 0)
      const cellHeight = grid.getHeight(col, row)
      if (cellHeight > 0 && tileSize > 10) {
        // Draw height badge in top-right corner
        const badgeSize = Math.max(10, tileSize * 0.4)
        ctx.fillStyle = '#00ccff'
        ctx.fillRect(x + tileSize - badgeSize - 2, y + 1, badgeSize, badgeSize)
        ctx.fillStyle = '#000000'
        ctx.font = `bold ${Math.max(8, badgeSize * 0.8)}px ${ASCII_FONT}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(cellHeight.toString(), x + tileSize - badgeSize / 2 - 2, y + badgeSize / 2 + 1)
        // Reset font
        ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
      }

      // Selection highlight
      if (selectedCells.has(`${col},${row}`)) {
        ctx.strokeStyle = '#ffff00'
        ctx.lineWidth = 2
        ctx.strokeRect(x + 1, y + 1, tileSize - 3, tileSize - 3)
      }

      // Debug: show cell coordinates
      if (debugMode && tileSize > 12) {
        ctx.font = `${Math.max(6, tileSize * 0.35)}px ${ASCII_FONT}`
        ctx.fillStyle = 'rgba(255,255,255,0.7)'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
        ctx.fillText(`${col},${row}`, x + 1, y + 1)
      }
    }
  }

  // Grid lines (subtle)
  if (tileSize > 10) {
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'
    ctx.lineWidth = 1
    for (let col = startCol; col <= endCol; col++) {
      const x = offsetX + col * tileSize
      ctx.beginPath()
      ctx.moveTo(x, offsetY + startRow * tileSize)
      ctx.lineTo(x, offsetY + endRow * tileSize)
      ctx.stroke()
    }
    for (let row = startRow; row <= endRow; row++) {
      const y = offsetY + row * tileSize
      ctx.beginPath()
      ctx.moveTo(offsetX + startCol * tileSize, y)
      ctx.lineTo(offsetX + endCol * tileSize, y)
      ctx.stroke()
    }
  }

  // Draw player position (1x1 cell footprint)
  const playerCellCol = Math.floor(player.x / cellSize)
  const playerCellRow = Math.floor(player.z / cellSize)
  const px = offsetX + playerCellCol * tileSize
  const py = offsetY + playerCellRow * tileSize

  // Player cell background
  ctx.fillStyle = '#ffdd00'
  ctx.fillRect(px, py, tileSize - 1, tileSize - 1)

  // Direction arrow
  ctx.fillStyle = '#000000'
  ctx.font = `bold ${tileSize * 0.7}px ${ASCII_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  let dirChar = 'v'
  switch (player.facing) {
    case 'up': dirChar = '^'; break
    case 'down': dirChar = 'v'; break
    case 'left': dirChar = '<'; break
    case 'right': dirChar = '>'; break
  }
  ctx.fillText(dirChar, px + tileSize / 2, py + tileSize / 2)

  // Draw connectors
  for (const connector of connectors) {
    const cx = offsetX + connector.col * tileSize
    const cy = offsetY + connector.row * tileSize

    // Portal/connector appearance
    ctx.fillStyle = 'rgba(180, 80, 255, 0.6)'
    ctx.fillRect(cx, cy, tileSize - 1, tileSize - 1)

    // Draw portal symbol
    ctx.fillStyle = '#ffffff'
    ctx.font = `bold ${tileSize * 0.6}px ${ASCII_FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('◊', cx + tileSize / 2, cy + tileSize / 2)

    // Draw pulsing border in connector mode
    if (connectorMode) {
      ctx.strokeStyle = '#ff88ff'
      ctx.lineWidth = 2
      ctx.strokeRect(cx, cy, tileSize - 1, tileSize - 1)
    }

    // Label (if room)
    if (tileSize > 20 && connector.targetTemplateName) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'
      ctx.fillRect(cx - 5, cy - 12, tileSize + 10, 12)
      ctx.fillStyle = '#ff88ff'
      ctx.font = `bold 9px ${ASCII_FONT}`
      ctx.textAlign = 'center'
      ctx.fillText(connector.targetTemplateName.slice(0, 10), cx + tileSize / 2, cy - 5)
    }
  }

  // UI
  ctx.fillStyle = debugMode ? '#ff6666' : '#55aaff'
  ctx.font = `bold 16px ${ASCII_FONT}`
  ctx.textAlign = 'center'
  ctx.fillText(debugMode ? 'TOP VIEW + DEBUG' : 'TOP VIEW', w / 2, 20)

  ctx.fillStyle = '#888'
  ctx.font = `12px ${ASCII_FONT}`
  ctx.fillText(`WASD move | Scroll zoom (${zoom.toFixed(1)}x) | Click to select`, w / 2, 38)

  // Selection info
  if (selectedCells.size > 0) {
    ctx.fillStyle = '#ffff00'
    ctx.fillText(`${selectedCells.size} cell${selectedCells.size > 1 ? 's' : ''} selected`, w / 2, 54)
  }

  ctx.fillStyle = '#666'
  ctx.font = `12px ${ASCII_FONT}`
  ctx.fillText(`${grid.cols}x${grid.rows} grid | Cell: ${playerCellCol},${playerCellRow}`, w / 2, h - 15)
}
