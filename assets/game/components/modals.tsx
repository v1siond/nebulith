// Reusable modal + entity-inspector modal bodies (identity/stats, movement,
// attacks) and the quest-offer body. Moved out of the page (stage 4);
// props-driven presentational components.
import { useEffect } from 'react'
import { ABILITY_REGISTRY, ABILITY_TINT, type AbilityAnimation } from '@/game/abilities'
import { ENEMY_ATTACK_PRESETS, addEnemyAttack, addMovementStep, buildAttackPattern, buildStepList, clearWaypoints, defaultEnemyAttack, enemyAttackFromAbility, normalizeAttackPattern, removeEnemyAttack, removeMovementStep, setAttackPatternMode, setMovementMode, setStepDelay, updateEnemyAttack, updateMovementStep } from '@/game/patterns'
import { rewardSummary } from '@/game/runtime/quest'
import { type AttackMode, type AttackPattern, type AttackPatternMode, type Direction, type EnemyAttack, type Entity, type MovementPattern, type Quest } from '@/game/types'
import { QuestObjectives } from '@/components/game/hud'

/** Right-sidebar inspector for a clicked entity: edit its name / enemy-type, toggle
 *  whether it's hittable (a non-hittable enemy becomes passive scenery), see its
 *  stats + patrol, and delete it. Presentational — actions bubble to the editor. */
/** Reusable modal — dark gaming panel; click the backdrop or press Esc to close. */
export function Modal({ title, accent = 'orange', onClose, children, wide, anchor }: {
  title: string
  accent?: 'orange' | 'cyan' | 'purple' | 'blue' | 'yellow' | 'red'
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
  const ring = {
    orange: 'border-orange-500/40', cyan: 'border-cyan-500/40', purple: 'border-purple-500/40',
    blue: 'border-blue-500/40', yellow: 'border-yellow-500/40', red: 'border-red-500/40',
  }[accent]
  const head = {
    orange: 'text-orange-300', cyan: 'text-cyan-300', purple: 'text-purple-300',
    blue: 'text-blue-300', yellow: 'text-yellow-300', red: 'text-red-300',
  }[accent]
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

/** Identity + editable stats for the selected entity (Stats modal body). */
export function EntityIdentityStatsBody({ entity, onPatch }: {
  entity: Entity
  onPatch: (patch: Partial<Entity>) => void
}) {
  const hittable = entity.hittable ?? entity.kind === 'enemy'
  return (
    <div className="space-y-2 text-xs">
      <label className="block">
        <span className="mb-0.5 block text-[10px] text-gray-400">Name</span>
        <input value={entity.name ?? ''} onChange={e => onPatch({ name: e.target.value })} aria-label="Entity name" className="w-full rounded bg-gray-800 p-1 text-xs" />
      </label>
      {entity.kind === 'enemy' && (
        <label className="block">
          <span className="mb-0.5 block text-[10px] text-gray-400">Enemy type (kill-quest tag)</span>
          <input value={entity.enemyType ?? ''} onChange={e => onPatch({ enemyType: e.target.value })} aria-label="Enemy type" className="w-full rounded bg-gray-800 p-1 text-xs" />
        </label>
      )}
      <div>
        <span className="mb-0.5 block text-[10px] text-gray-400">Stats (editable)</span>
        <div className="grid grid-cols-2 gap-1">
          {([
            ['maxHp', 'HP'],
            ['defense', 'DEF'],
            ['strength', 'STR'],
            ['intelligence', 'INT'],
            ['dodge', 'DODGE%'],
          ] as const).map(([stat, label]) => (
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
      <label className="flex items-center gap-2 text-gray-300">
        <input type="checkbox" checked={entity.blocksMovement ?? false} onChange={e => onPatch({ blocksMovement: e.target.checked })} aria-label="Blocks movement" />
        Blocks movement
      </label>
      {entity.kind === 'enemy' && (
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

/** Step-list movement editor (Movement modal body). */
export function EntityMovementBody({ entity, onPatch, waypointMode, onToggleWaypointMode }: {
  entity: Entity
  onPatch: (patch: Partial<Entity>) => void
  waypointMode: boolean
  onToggleWaypointMode: () => void
}) {
  return (
    <div className="text-xs">
      <span className="mb-0.5 block text-[10px] text-gray-400">Movement pattern</span>
      <select
        value={entity.movement ? entity.movement.mode : 'none'}
        onChange={e => {
          const mode = e.target.value
          if (mode === 'none') {
            onPatch({ movement: undefined })
            return
          }
          const next = entity.movement
            ? setMovementMode(entity.movement, mode as MovementPattern['mode'])
            : buildStepList(mode as MovementPattern['mode'])
          onPatch({ movement: next })
        }}
        aria-label="Movement mode"
        className="w-full rounded bg-gray-800 p-1 text-xs"
      >
        <option value="none">Stationary</option>
        <option value="sequential">Sequential (run steps in order)</option>
        <option value="random">Random (pick a step each cycle)</option>
      </select>
      {entity.movement && (
        <div className="mt-1 space-y-1">
          {(entity.movement.steps ?? []).map((s, i) => (
            <div key={i} className="flex items-center gap-1">
              <select
                value={s.dir}
                onChange={e => onPatch({ movement: updateMovementStep(entity.movement!, i, { dir: e.target.value as Direction }) })}
                aria-label={`Step ${i + 1} direction`}
                className="rounded bg-gray-800 p-1 text-[11px]"
              >
                <option value="up">↑ up</option>
                <option value="down">↓ down</option>
                <option value="left">← left</option>
                <option value="right">→ right</option>
              </select>
              <input
                type="number"
                min={1}
                value={s.cells}
                onChange={e => onPatch({ movement: updateMovementStep(entity.movement!, i, { cells: Number(e.target.value) }) })}
                aria-label={`Step ${i + 1} cells`}
                className="w-14 rounded bg-gray-800 p-1 text-[11px]"
              />
              <span className="text-[10px] text-gray-500">cells</span>
              <button
                onClick={() => onPatch({ movement: removeMovementStep(entity.movement!, i) })}
                aria-label={`Remove step ${i + 1}`}
                className="ml-auto rounded bg-gray-700 px-2 text-[11px] hover:bg-red-700"
              >
                ×
              </button>
            </div>
          ))}
          <div className="flex items-center gap-1">
            <button
              onClick={() => onPatch({ movement: addMovementStep(entity.movement!) })}
              className="flex-1 rounded bg-gray-700 px-2 py-1 text-[10px] hover:bg-gray-600"
            >
              + Add step
            </button>
            <label className="flex items-center gap-1 text-[10px] text-gray-400">
              <span className="shrink-0">delay ms</span>
              <input
                type="number"
                min={0}
                value={entity.movement.delayMs ?? 1200}
                onChange={e => onPatch({ movement: setStepDelay(entity.movement!, Number(e.target.value)) })}
                aria-label="Step delay ms"
                className="w-16 rounded bg-gray-800 p-1 text-[11px]"
              />
            </label>
          </div>
          <p className="text-[10px] text-gray-500">
            {(entity.movement.steps ?? []).length} steps · {entity.movement.mode} · a wall stops a run early
          </p>
          <div className="mt-1 flex gap-1">
            <button
              onClick={onToggleWaypointMode}
              aria-pressed={waypointMode}
              className={`flex-1 rounded px-2 py-1 text-[10px] ${waypointMode ? 'bg-cyan-600 text-white' : 'bg-gray-700 hover:bg-gray-600'}`}
            >
              {waypointMode ? 'Click cells… (done)' : 'Advanced: click-path'}
            </button>
            <button
              onClick={() => onPatch({ movement: clearWaypoints(entity.movement) })}
              className="rounded bg-gray-700 px-2 py-1 text-[10px] hover:bg-gray-600"
            >
              Clear path
            </button>
          </div>
          {(entity.movement.waypoints?.length ?? 0) >= 2 && (
            <p className="mt-0.5 text-[10px] text-amber-400">A click-path ({entity.movement.waypoints.length} pts) is set — it overrides the steps above.</p>
          )}
          {waypointMode && (
            <p className="mt-0.5 text-[10px] text-cyan-400">Click cells in Top view to add waypoints.</p>
          )}
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
