// Reusable modal + entity-inspector modal bodies (identity/stats, movement,
// attacks) and the quest-offer body. Moved out of the page (stage 4);
// props-driven presentational components.
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { Connector } from '@/lib/api'
import { ABILITY_REGISTRY, ABILITY_TINT, type AbilityAnimation } from '@/game/abilities'
import { ENEMY_ATTACK_PRESETS, addEnemyAttack, buildAttackPattern, defaultEnemyAttack, enemyAttackFromAbility, normalizeAttackPattern, removeEnemyAttack, setAttackPatternMode, updateEnemyAttack } from '@/game/patterns'
import { rewardSummary } from '@/game/runtime/quest'
import { type AttackMode, type AttackPattern, type AttackPatternMode, type EnemyAttack, type Entity, type Quest } from '@/game/types'
import { QuestObjectives } from '@/components/game/hud'
import { TileControls, type TileControlModel } from '@/components/game/editorChrome'

/** Right-sidebar inspector for a clicked entity: edit its name / enemy-type, toggle
 *  whether it's hittable (a non-hittable enemy becomes passive scenery), see its
 *  stats + patrol, and delete it. Presentational — actions bubble to the editor. */
/** The accent name every panel (Modal + FloatingPanel) shares — one place so a new colour is added once. */
export type PanelAccent = 'orange' | 'cyan' | 'purple' | 'blue' | 'yellow' | 'red'

/** Accent → border ring class. Shared by the centered Modal and the floating panel so they read as one family. */
const ACCENT_RING: Record<PanelAccent, string> = {
  orange: 'border-orange-500/40', cyan: 'border-cyan-500/40', purple: 'border-purple-500/40',
  blue: 'border-blue-500/40', yellow: 'border-yellow-500/40', red: 'border-red-500/40',
}
/** Accent → header text class. */
const ACCENT_HEAD: Record<PanelAccent, string> = {
  orange: 'text-orange-300', cyan: 'text-cyan-300', purple: 'text-purple-300',
  blue: 'text-blue-300', yellow: 'text-yellow-300', red: 'text-red-300',
}

/** Reusable modal — dark gaming panel; click the backdrop or press Esc to close. */
export function Modal({ title, accent = 'orange', onClose, children, wide, anchor }: {
  title: string
  accent?: PanelAccent
  onClose: () => void
  children: React.ReactNode
  wide?: boolean
  /** World-anchored screen point (px): when set, the panel floats ABOVE it (its
   *  bottom edge sitting at anchor.y) instead of centering. Off-screen → centered. */
  anchor?: { x: number; y: number } | null
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const ring = ACCENT_RING[accent]
  const head = ACCENT_HEAD[accent]
  // Anchored: float the panel above the world point (translate up + center on x);
  // otherwise fall back to the centered flex layout.
  const panelPos = anchor
    ? 'absolute -translate-x-1/2 -translate-y-full'
    : ''
  const panelStyle = anchor ? { left: anchor.x, top: anchor.y } : undefined
  return (
    <div
      className={`fixed inset-0 z-40 ${anchor ? '' : 'flex items-center justify-center'} bg-black/70 p-4 font-mono`}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={`${panelPos} flex max-h-[85vh] w-full ${wide ? 'max-w-2xl' : 'max-w-md'} flex-col overflow-hidden rounded-xl border ${ring} bg-gray-950 text-white shadow-2xl shadow-black/60`}
        style={panelStyle}
        onClick={e => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-white/10 bg-black/40 px-4 py-3">
          <h3 className={`text-sm font-bold uppercase tracking-widest ${head}`}>{title}</h3>
          <button onClick={onClose} aria-label="Close" className="rounded px-2 py-1 text-gray-400 hover:bg-white/10 hover:text-white">✕</button>
        </header>
        <div className="overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  )
}

/** A screen point / size (px). */
interface XY { x: number; y: number }
interface WH { w: number; h: number }

const FLOATING_MIN: WH = { w: 260, h: 200 } // small enough to tuck aside, big enough to grab

/** Keep at least the header grabbable: clamp so the panel can never be dragged fully off-screen. */
function clampToViewport(pos: XY, size: WH): XY {
  if (typeof window === 'undefined') return pos
  const maxX = window.innerWidth - 80 // leave a sliver + the ✕ reachable
  const maxY = window.innerHeight - 40
  return { x: Math.max(8 - (size.w - 80), Math.min(pos.x, maxX)), y: Math.max(8, Math.min(pos.y, maxY)) }
}

/**
 * FLOATING PANEL — a NON-BLOCKING sibling of {@link Modal} for settings you edit while watching the thing
 * change: it has NO full-screen backdrop (so the canvas behind stays pannable and the edited tile stays
 * visible + clickable), you DRAG it aside by its header, and RESIZE it from the bottom-right grip. Same dark
 * accent chrome + Esc-to-close as Modal, but positioned `fixed` at an (x,y) the user can move. Live-updating
 * is inherent: the body is just children (e.g. TileControls) whose writers already fan out to the selection,
 * and because the panel never covers the whole screen the edit's effect is visible immediately.
 *
 * `role="dialog"` WITHOUT `aria-modal` — it is deliberately non-modal (the rest of the page stays live).
 */
export function FloatingPanel({ title, accent = 'cyan', onClose, children, initialPos, initialSize, onGeometryChange }: {
  title: string
  accent?: PanelAccent
  onClose: () => void
  children: React.ReactNode
  /** where the panel first appears; defaults to the top-right so it doesn't cover the centred selection. */
  initialPos?: XY
  initialSize?: WH
  /** Fired once at the END of a drag or resize with the final `{x,y,w,h}` — the page persists it as a
   *  backend editor setting (debounced), so the panel reopens where the user left it. */
  onGeometryChange?: (geometry: { x: number; y: number; w: number; h: number }) => void
}) {
  const [size, setSize] = useState<WH>(() => initialSize ?? { w: 340, h: 440 })
  const [pos, setPos] = useState<XY>(() => {
    if (initialPos) return initialPos
    if (typeof window === 'undefined') return { x: 24, y: 96 }
    return { x: window.innerWidth - (initialSize?.w ?? 340) - 24, y: 96 }
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Drag by the header: capture the grab origin, then follow the pointer on WINDOW listeners (not the panel's
  // own) so the drag keeps tracking even when the cursor races out over the canvas. Removed on mouse-up, which
  // also reports the FINAL geometry so the page can persist it (the gesture tracks `latest` to avoid stale state).
  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault()
    const origin = { mx: e.clientX, my: e.clientY, x: pos.x, y: pos.y }
    let latest = pos
    const onMove = (ev: MouseEvent) => {
      latest = clampToViewport({ x: origin.x + (ev.clientX - origin.mx), y: origin.y + (ev.clientY - origin.my) }, size)
      setPos(latest)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      onGeometryChange?.({ x: latest.x, y: latest.y, w: size.w, h: size.h })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // Resize from the bottom-right grip — same window-listener pattern; clamp to a sane minimum so it can't
  // collapse to nothing. Reports the FINAL geometry on release, mirroring the drag path.
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const origin = { mx: e.clientX, my: e.clientY, w: size.w, h: size.h }
    let latest = size
    const onMove = (ev: MouseEvent) => {
      latest = {
        w: Math.max(FLOATING_MIN.w, origin.w + (ev.clientX - origin.mx)),
        h: Math.max(FLOATING_MIN.h, origin.h + (ev.clientY - origin.my)),
      }
      setSize(latest)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      onGeometryChange?.({ x: pos.x, y: pos.y, w: latest.w, h: latest.h })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div
      className={`fixed z-50 flex flex-col overflow-hidden rounded-xl border ${ACCENT_RING[accent]} bg-gray-950 font-mono text-white shadow-2xl shadow-black/60`}
      style={{ left: pos.x, top: pos.y, width: size.w, height: size.h }}
      role="dialog"
      aria-label={title}
    >
      <header
        onMouseDown={startDrag}
        data-drag-handle
        className="flex shrink-0 cursor-move select-none items-center justify-between border-b border-white/10 bg-black/40 px-4 py-3"
      >
        <h3 className={`text-sm font-bold uppercase tracking-widest ${ACCENT_HEAD[accent]}`}>{title}</h3>
        <button
          onMouseDown={e => e.stopPropagation()}
          onClick={onClose}
          aria-label="Close"
          className="rounded px-2 py-1 text-gray-400 hover:bg-white/10 hover:text-white"
        >
          ✕
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      {/* bottom-right resize grip */}
      <div
        onMouseDown={startResize}
        data-resize-handle
        aria-label="Resize panel"
        role="separator"
        className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize"
        style={{ background: 'linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.35) 50%)' }}
      />
    </div>
  )
}

/** The five combat stats every unit carries, in display order — a table, so a new stat is one row here. */
const UNIT_STATS: ReadonlyArray<readonly ['maxHp' | 'defense' | 'strength' | 'intelligence' | 'dodge', string]> = [
  ['maxHp', 'HP'],
  ['defense', 'DEF'],
  ['strength', 'STR'],
  ['intelligence', 'INT'],
  ['dodge', 'DODGE%'],
]

/**
 * The unit's STATS body — the contents of the card's "⛊ Stats…" button, hosted in a draggable/resizable
 * FloatingPanel (Alexander: "stats would be a button that shows a draggable, movable, resizable modal where
 * we control all those extra unit settings").
 *
 * What is deliberately NOT here: **Name** and **Size** stay as rows on the tile card (identity you retune
 * inline), and **"Blocks movement" is gone** — a unit's collision is the card's ONE `Blocked / Walkable`
 * toggle, the same control every tile uses. Everything else a unit uniquely owns lives here: the enemy's
 * kill-quest tag, the five combat stats, hittable, and the respawn timer.
 */
export function UnitStatsBody({ entity, onPatch }: {
  entity: Entity
  onPatch: (patch: Partial<Entity>) => void
}) {
  const hittable = entity.hittable ?? entity.kind === 'enemy'
  const isEnemy = entity.kind === 'enemy'
  return (
    <div className="space-y-2 text-xs">
      {isEnemy && (
        <label className="block">
          <span className="mb-0.5 block text-[10px] text-gray-400">Enemy type (kill-quest tag)</span>
          <input value={entity.enemyType ?? ''} onChange={e => onPatch({ enemyType: e.target.value })} aria-label="Enemy type" className="w-full rounded bg-gray-800 p-1 text-xs" />
        </label>
      )}
      <div>
        <span className="mb-0.5 block text-[10px] text-gray-400">Stats (editable)</span>
        <div className="grid grid-cols-2 gap-1">
          {UNIT_STATS.map(([stat, label]) => (
            <label key={stat} className="flex items-center gap-1 text-[10px] text-gray-400">
              <span className="w-12 shrink-0">{label}</span>
              <input
                type="number"
                value={entity.baseStats[stat] ?? 0}
                onChange={e => onPatch({ baseStats: { ...entity.baseStats, [stat]: Number(e.target.value) } })}
                aria-label={`${entity.kind} ${label}`}
                className="w-full rounded bg-gray-800 p-1 text-xs"
              />
            </label>
          ))}
        </div>
      </div>
      <label className="flex items-center gap-2 text-gray-300">
        <input type="checkbox" checked={hittable} onChange={e => onPatch({ hittable: e.target.checked })} aria-label="Hittable" />
        Hittable (can be attacked)
      </label>
      {isEnemy && (
        <label className="flex items-center gap-2 text-[10px] text-gray-400">
          <span className="w-28 shrink-0">Respawn (s · 0 = never)</span>
          <input
            type="number"
            min={0}
            value={Math.round((entity.respawnMs ?? 0) / 1000)}
            onChange={e => onPatch({ respawnMs: Math.max(0, Number(e.target.value)) * 1000 })}
            aria-label="Respawn seconds"
            className="w-full rounded bg-gray-800 p-1 text-xs"
          />
        </label>
      )}
    </div>
  )
}

/** The unit-only EXTRAS folded into the ONE shared tile card: the two identity ROWS a unit keeps inline
 *  (name + size) plus the entry-point buttons a tile never has — STATS (the draggable modal), the INVENTORY
 *  (player), quests (NPC) and attacks (enemy). Driven by the selected entity + the SAME patch writer the rest
 *  of the card uses, so every edit lands on one source of truth. */
export interface UnitControlModel {
  entity: Entity
  onPatch: (patch: Partial<Entity>) => void
  /** the discrete SIZE preset (1×/2×/3× — a boss scales its stats too, not just the figure). Absent → the
   *  size row hides (the raw scale is still editable via the settings sliders). */
  onSize?: (size: number) => void
  /** open the unit's STATS modal (HP/DEF/STR/INT/DODGE% + hittable + respawn) — absent → no button. */
  onOpenStats?: () => void
  /** open the unit's inventory & abilities (the player carries one) — absent → no button. */
  onOpenInventory?: () => void
  /** open the NPC's quest authoring — absent → no button. */
  onOpenQuests?: () => void
  /** open the enemy's attacks / abilities editor — absent → no button. */
  onOpenAttacks?: () => void
}

/** The two identity ROWS that stay INLINE on the card — the unit's NAME and its discrete SIZE preset (a boss
 *  is bigger AND tougher; `resizeEntityById` rescales the stat block by the same ratio). The old FIGURE
 *  (neutral/male/female/old/child/alien/robot) row is GONE: a unit is a tile, so its art is swapped with the
 *  card's regular "Replace tile" button, which lists the character tiles like any other tile. */
function UnitIdentityRows({ entity, onPatch, onSize }: { entity: Entity; onPatch: (patch: Partial<Entity>) => void; onSize?: (size: number) => void }) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-2 text-[11px]">
        <span className="w-12 shrink-0 text-gray-400">Name</span>
        <input value={entity.name ?? ''} onChange={e => onPatch({ name: e.target.value })} aria-label="Entity name" className="min-w-0 flex-1 rounded bg-gray-800 p-1 text-xs" />
      </label>
      {onSize && (
        <div className="flex items-center gap-1 text-[11px]">
          <span className="w-12 shrink-0 text-gray-400">Size</span>
          {[1, 2, 3].map(sz => (
            <button
              key={sz}
              type="button"
              onClick={() => onSize(sz)}
              title={sz > 1 ? `${sz}× — a boss: bigger figure + ~${sz}× stats` : 'normal size'}
              aria-pressed={(entity.size ?? 1) === sz}
              className={`rounded px-2 py-0.5 font-bold transition-colors ${(entity.size ?? 1) === sz ? 'bg-cyan-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
            >
              {sz}×
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** The unit-only section of the shared card — the name/size rows + the entry-point buttons a tile never has:
 *  stats (every unit), inventory (player), quests (NPC), attacks (enemy). Each button opens its own draggable
 *  modal. Rendered ONLY for a unit; a tile passes no unit model so this never shows. */
export function UnitSettingsSection({ unit }: { unit: UnitControlModel }) {
  const { entity, onPatch, onSize, onOpenStats, onOpenInventory, onOpenQuests, onOpenAttacks } = unit
  const btn = 'w-full rounded bg-gray-700 px-2 py-1.5 text-left text-xs font-bold transition-colors hover:bg-gray-600'
  const hasEntries = onOpenStats || onOpenInventory || onOpenQuests || onOpenAttacks
  return (
    <div className="space-y-2">
      <p className="text-[9px] font-bold uppercase tracking-wider text-gray-500">— unit · {entity.kind} —</p>
      <UnitIdentityRows entity={entity} onPatch={onPatch} onSize={onSize} />
      {hasEntries && (
        <div className="space-y-1 border-t border-white/10 pt-2">
          {onOpenStats && <button type="button" className={btn} onClick={onOpenStats}>⛊ Stats…</button>}
          {onOpenInventory && <button type="button" className={btn} onClick={onOpenInventory}>🎒 Inventory &amp; abilities…</button>}
          {onOpenQuests && <button type="button" className={btn} onClick={onOpenQuests}>❒ Quests…</button>}
          {onOpenAttacks && <button type="button" className={btn} onClick={onOpenAttacks}>⚔ Attacks / abilities…</button>}
        </div>
      )}
    </div>
  )
}

/** The ONE settings-panel body the FloatingPanel hosts for BOTH a tile and a unit. The SAME
 *  {@link TileControls} (colour / scale / pose) drives the top, so a unit's settings look + work exactly like
 *  a tile's; a unit ALSO passes `unit`, appending the unit-only extras (name/size + its modal buttons). A tile
 *  passes no `unit`, so those never show. One shared component — no forked parallel copy. */
export function SettingsPanelBody({ tile, unit }: { tile: TileControlModel; unit?: UnitControlModel }) {
  return (
    <div className="space-y-3">
      <TileControls tile={tile} />
      {unit && (
        <div className="border-t border-white/10 pt-3">
          <UnitSettingsSection unit={unit} />
        </div>
      )}
    </div>
  )
}

/** The seeded animation ids (drive the swing/bolt tint) — for the per-attack tint picker. */
export const ATTACK_ANIMATION_OPTIONS = Object.keys(ABILITY_TINT) as AbilityAnimation[]

/** One attack row in the pattern editor: melee/ranged + damage + cooldown + tint + remove. */
export function EnemyAttackRow({ attack, index, onChange, onRemove }: {
  attack: EnemyAttack
  index: number
  onChange: (patch: Partial<EnemyAttack>) => void
  onRemove: () => void
}) {
  const tint = attack.animation ? ABILITY_TINT[attack.animation] : '#9aa4b2'
  return (
    <div className="rounded border border-gray-700 p-1.5">
      <div className="mb-1 flex items-center gap-1">
        <span className="text-[11px] font-bold" style={{ color: tint }}>
          {attack.name ?? `Attack ${index + 1}`}
        </span>
        <span className="text-[10px] text-gray-500">{attack.mode}</span>
        <button
          onClick={onRemove}
          aria-label={`Remove attack ${index + 1}`}
          className="ml-auto rounded bg-gray-700 px-2 text-[11px] hover:bg-red-700"
        >
          ×
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <select
          value={attack.mode}
          onChange={e => onChange({ mode: e.target.value as AttackMode })}
          aria-label={`Attack ${index + 1} mode`}
          className="rounded bg-gray-800 p-1 text-[11px]"
        >
          <option value="melee">Melee (adjacent)</option>
          <option value="ranged">Ranged (reach)</option>
        </select>
        <label className="flex items-center gap-1 text-[10px] text-gray-400">
          <span className="shrink-0">dmg</span>
          <input
            type="number"
            min={0}
            value={attack.damage}
            onChange={e => onChange({ damage: Number(e.target.value) })}
            aria-label={`Attack ${index + 1} damage`}
            className="w-14 rounded bg-gray-800 p-1 text-[11px]"
          />
        </label>
        <label className="flex items-center gap-1 text-[10px] text-gray-400">
          <span className="shrink-0">CD ms</span>
          <input
            type="number"
            value={attack.cooldownMs}
            onChange={e => onChange({ cooldownMs: Number(e.target.value) })}
            aria-label={`Attack ${index + 1} cooldown ms`}
            className="w-16 rounded bg-gray-800 p-1 text-[11px]"
          />
        </label>
        <select
          value={attack.animation ?? ''}
          onChange={e => onChange({ animation: (e.target.value || undefined) as AbilityAnimation | undefined })}
          aria-label={`Attack ${index + 1} animation`}
          className="rounded bg-gray-800 p-1 text-[11px]"
          style={{ color: tint }}
        >
          <option value="">(default tint)</option>
          {ATTACK_ANIMATION_OPTIONS.map(a => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      </div>
    </div>
  )
}

/**
 * Attack-pattern editor for enemies (Attacks modal body) — the enemy mirror of the movement
 * editor. The author builds an ordered LIST of attacks (add presets / registry abilities / blank
 * melee + ranged), tunes each one's damage / cooldown / tint, and picks the traversal mode
 * (sequential cycles the list, random picks one) — exactly how movement steps are authored. The
 * pattern rides the entity record, so it saves with the template.
 */
export function EntityAttackBody({ entity, onPatch }: {
  entity: Entity
  onPatch: (patch: Partial<Entity>) => void
}) {
  // entity.attack may be absent (engine default) or a legacy single-attack save → normalize for
  // display, but only AFTER the author has opted into a pattern (absent stays "Default").
  const pattern = entity.attack ? normalizeAttackPattern(entity.attack) : undefined

  const setPattern = (next: AttackPattern) =>
    onPatch({ attack: next.attacks.length > 0 ? next : undefined })

  return (
    <div className="text-xs">
      <span className="mb-0.5 block text-[10px] text-gray-400">Attack pattern</span>
      <select
        value={pattern ? pattern.mode : 'default'}
        onChange={e => {
          const mode = e.target.value
          if (mode === 'default') {
            onPatch({ attack: undefined })
            return
          }
          const next = pattern
            ? setAttackPatternMode(pattern, mode as AttackPatternMode)
            : buildAttackPattern(mode as AttackPatternMode)
          onPatch({ attack: next })
        }}
        aria-label="Attack pattern mode"
        className="w-full rounded bg-gray-800 p-1 text-xs"
      >
        <option value="default">Default (single melee)</option>
        <option value="sequential">Sequential (cycle attacks in order)</option>
        <option value="random">Random (pick an attack each swing)</option>
      </select>

      {pattern && (
        <div className="mt-1 space-y-1">
          {pattern.attacks.map((attack, i) => (
            <EnemyAttackRow
              key={i}
              attack={attack}
              index={i}
              onChange={patch => setPattern(updateEnemyAttack(pattern, i, patch))}
              onRemove={() => setPattern(removeEnemyAttack(pattern, i))}
            />
          ))}

          <div className="flex flex-wrap items-center gap-1">
            <button
              onClick={() => onPatch({ attack: addEnemyAttack(pattern, defaultEnemyAttack()) })}
              className="rounded bg-gray-700 px-2 py-1 text-[10px] hover:bg-gray-600"
            >
              + Melee
            </button>
            <button
              onClick={() => onPatch({ attack: addEnemyAttack(pattern, ENEMY_ATTACK_PRESETS[2]) })}
              className="rounded bg-gray-700 px-2 py-1 text-[10px] hover:bg-gray-600"
            >
              + Ranged
            </button>
            <select
              value=""
              onChange={e => {
                const v = e.target.value
                if (!v) return
                if (v.startsWith('preset:')) {
                  const preset = ENEMY_ATTACK_PRESETS[Number(v.slice('preset:'.length))]
                  if (preset) onPatch({ attack: addEnemyAttack(pattern, preset) })
                  return
                }
                const ability = ABILITY_REGISTRY.find(a => a.id === v.slice('ability:'.length))
                if (ability) onPatch({ attack: addEnemyAttack(pattern, enemyAttackFromAbility(ability)) })
              }}
              aria-label="Add attack from preset or ability"
              className="rounded bg-gray-800 p-1 text-[10px]"
            >
              <option value="">+ From library…</option>
              <optgroup label="Presets">
                {ENEMY_ATTACK_PRESETS.map((p, i) => (
                  <option key={i} value={`preset:${i}`}>{p.name}</option>
                ))}
              </optgroup>
              <optgroup label="Abilities">
                {ABILITY_REGISTRY.filter(a => (a.effect.damage ?? 0) > 0).map(a => (
                  <option key={a.id} value={`ability:${a.id}`}>{a.name}</option>
                ))}
              </optgroup>
            </select>
          </div>

          <p className="text-[10px] text-gray-500">
            {pattern.attacks.length} attack{pattern.attacks.length === 1 ? '' : 's'} · {pattern.mode} · melee strikes adjacent, ranged fires within reach
          </p>
        </div>
      )}
      {!pattern && (
        <p className="mt-1 text-[10px] text-gray-500">No pattern: a single strength-only melee swing. Pick Sequential / Random to build a multi-attack list.</p>
      )}
    </div>
  )
}

/**
 * Quest OFFER body — the modal contents shown when a player talks to a giver whose
 * quest is still `available`. Renders the title, story, objectives and rewards, with
 * Accept (runs the engine's acceptQuest → active) and Reject (close only — the quest
 * stays `available`, so the giver can be re-asked later). Rendered inside the reusable
 * Modal, anchored above the giver entity.
 */
export function QuestGiveBody({ quest, onAccept, onReject }: {
  quest: Quest
  onAccept: () => void
  onReject: () => void
}) {
  return (
    <div className="space-y-3 text-xs">
      <h4 className="text-sm font-bold text-amber-300">{quest.title}</h4>
      {quest.description && <p className="leading-relaxed text-gray-300">{quest.description}</p>}
      <div>
        <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">Objectives</p>
        <QuestObjectives quest={quest} />
      </div>
      <div>
        <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">Rewards</p>
        <ul className="flex flex-col gap-0.5">
          {quest.rewards.length === 0 && <li className="text-gray-500">—</li>}
          {quest.rewards.map((reward, i) => (
            <li key={i} className="text-emerald-300">{rewardSummary(reward)}</li>
          ))}
        </ul>
      </div>
      <div className="flex gap-2 pt-1">
        <button onClick={onAccept} className="flex-1 rounded bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-600">
          Accept
        </button>
        <button onClick={onReject} className="flex-1 rounded bg-gray-700 px-3 py-1.5 text-xs font-bold text-gray-200 hover:bg-gray-600">
          Reject
        </button>
      </div>
    </div>
  )
}

/**
 * CONNECTORS authoring flow — hosted in a draggable {@link FloatingPanel} opened from a right-sidebar button
 * (its entry moved OFF the left tool-rail; user: "move the connectors to a button in the right sidebar, which
 * would open a connectors draggable/movable modal like the settings one"). The controls are IDENTICAL to the
 * old left-card + right-inspector form — an Edit/Exit toggle for click-to-add mode, the list of saved
 * connectors, and (when one is being edited) its target / when / spawn-cell form + Save/Delete. Presentational:
 * every edit flows up through the page's handlers, so the connector data + behaviour are unchanged.
 */
export interface ConnectorsPanelProps {
  /** click-to-add authoring is armed (canvas clicks add/edit connectors). */
  connectorMode: boolean
  /** toggle authoring on/off without closing the panel (the old card's Edit/Exit). */
  onToggleMode: () => void
  /** the connector being edited (its keystone cell), or null. */
  editing: { col: number; row: number } | null
  /** human label for the edited connector (a coord, or "N cells"). */
  editingLabel: string
  form: Partial<Connector>
  setForm: Dispatch<SetStateAction<Partial<Connector>>>
  /** teleport targets (already excludes the current template). */
  templates: ReadonlyArray<{ id: string; name: string }>
  onNewTarget: () => void
  onSave: () => void
  onDelete: () => void
  onCancel: () => void
  connectors: readonly Connector[]
  /** load a saved connector into the editor. */
  onSelectConnector: (c: Connector) => void
}

export function ConnectorsPanelBody(p: ConnectorsPanelProps) {
  const actionType = p.form.action?.type ?? 'teleport'
  const label = 'mb-1 mt-2 text-[10px] font-bold uppercase tracking-wide text-purple-300'
  const input = 'w-full rounded bg-gray-800 p-1 text-xs'
  const saveDisabled = !p.form.targetTemplateId && !p.form.action
  return (
    <div className="space-y-2 text-xs">
      <button
        onClick={p.onToggleMode}
        aria-pressed={p.connectorMode}
        className={`w-full rounded px-2 py-1.5 text-xs font-bold transition-colors ${p.connectorMode ? 'bg-purple-600 text-white' : 'bg-gray-700 hover:bg-gray-600'}`}
      >
        {p.connectorMode ? '● Authoring on — Exit' : 'Edit connectors'}
      </button>

      {p.editing ? (
        <div className="space-y-1 rounded border border-purple-500/20 bg-black/40 p-2">
          <p className="text-[10px] font-bold text-purple-300">Editing {p.editingLabel}</p>
          <p className={label}>Target</p>
          <select
            value={actionType}
            onChange={e => {
              const t = e.target.value
              p.setForm(f => ({
                ...f,
                action:
                  t === 'teleport' ? undefined
                  : t === 'collect' ? { type: 'collect', itemId: '', qty: 1 }
                  : t === 'content' ? { type: 'content', sectionId: '' }
                  : { type: 'goto_region', col: f.spawnCol ?? 0, row: f.spawnRow ?? 0 },
              }))
            }}
            aria-label="Trigger action"
            className={input}
          >
            <option value="teleport">Go to template (teleport)</option>
            <option value="goto_region">Move within stage (uses Arrive-at)</option>
            <option value="collect">Collect item</option>
            <option value="content">Reveal content</option>
          </select>
          {p.form.action?.type === 'collect' && (
            <input
              type="text"
              placeholder="Item id to grant"
              aria-label="Item id to collect"
              value={p.form.action.itemId}
              onChange={e => p.setForm(f => ({ ...f, action: { type: 'collect', itemId: e.target.value, qty: 1 } }))}
              className={input}
            />
          )}
          {p.form.action?.type === 'content' && (
            <input
              type="text"
              placeholder="Section id to reveal"
              aria-label="Section id to reveal"
              value={p.form.action.sectionId}
              onChange={e => p.setForm(f => ({ ...f, action: { type: 'content', sectionId: e.target.value } }))}
              className={input}
            />
          )}
          {actionType === 'teleport' && (
            <div className="flex items-center gap-1">
              <select
                value={p.form.targetTemplateId || ''}
                onChange={e => p.setForm(f => ({ ...f, targetTemplateId: e.target.value }))}
                aria-label="Target template"
                className="flex-1 rounded bg-gray-800 p-1 text-xs"
              >
                <option value="">Target template…</option>
                {p.templates.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={p.onNewTarget}
                title="Create a new template to connect to"
                className="whitespace-nowrap rounded bg-blue-700 px-2 py-1 text-xs font-bold hover:bg-blue-600"
              >
                ＋ New
              </button>
            </div>
          )}

          <p className={label}>When</p>
          <select
            value={p.form.interaction || 'walk'}
            onChange={e => p.setForm(f => ({ ...f, interaction: e.target.value as Connector['interaction'] }))}
            aria-label="How the player triggers this connector"
            className={input}
          >
            <option value="walk">Walk onto it</option>
            <option value="interact">Press E on it</option>
            <option value="auto">Auto on enter</option>
          </select>

          <p className={label}>Spawn cell</p>
          <div className="flex items-center gap-1">
            <span className="whitespace-nowrap text-gray-400">Arrive at</span>
            <input
              type="number"
              min={0}
              aria-label="Spawn column in target template"
              value={p.form.spawnCol ?? 0}
              onChange={e => p.setForm(f => ({ ...f, spawnCol: Math.max(0, parseInt(e.target.value, 10) || 0) }))}
              className="w-14 rounded bg-gray-800 p-1 text-xs"
            />
            <span className="text-gray-500">,</span>
            <input
              type="number"
              min={0}
              aria-label="Spawn row in target template"
              value={p.form.spawnRow ?? 0}
              onChange={e => p.setForm(f => ({ ...f, spawnRow: Math.max(0, parseInt(e.target.value, 10) || 0) }))}
              className="w-14 rounded bg-gray-800 p-1 text-xs"
            />
            <span className="whitespace-nowrap text-gray-400">in target</span>
          </div>

          <div className="flex gap-1 pt-1">
            <button onClick={p.onSave} disabled={saveDisabled} className="flex-1 rounded bg-green-700 px-2 py-1.5 text-xs font-bold hover:bg-green-600 disabled:bg-gray-700">Save</button>
            <button onClick={p.onDelete} className="rounded bg-red-800 px-2 py-1.5 text-xs hover:bg-red-700">Del</button>
            <button onClick={p.onCancel} className="rounded bg-gray-700 px-2 py-1.5 text-xs hover:bg-gray-600">Cancel</button>
          </div>
        </div>
      ) : (
        <p className="text-[10px] leading-tight text-gray-500">
          {p.connectorMode ? 'Click a cell in Top view to start a connector.' : 'Turn on Edit, then click a cell in Top view to add one.'}
        </p>
      )}

      {p.connectors.length > 0 && (
        <div className="space-y-1">
          <p className={label}>Saved connectors</p>
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {p.connectors.map((c, i) => (
              <button
                key={`${c.cells[0]?.col},${c.cells[0]?.row},${i}`}
                type="button"
                className="flex w-full items-center justify-between rounded bg-gray-800 p-1 text-left text-xs hover:bg-gray-700"
                onClick={() => p.onSelectConnector(c)}
              >
                <span>({c.cells[0]?.col},{c.cells[0]?.row}){c.cells.length > 1 ? ` +${c.cells.length - 1}` : ''}→{c.targetTemplateName?.slice(0, 8) || '?'}</span>
                <span className="text-purple-400">{c.interaction}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {p.connectors.length === 0 && !p.editing && <p className="text-[10px] text-gray-500">No connectors yet.</p>}
    </div>
  )
}
