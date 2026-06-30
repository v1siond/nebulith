// Play-view HUD overlays (DOM, not canvas): vitals/resource bars, the ability bar
// with cooldown sweep, and the active-quest tracker + objective checklist.
// Moved out of the page (stage 4); props-driven and self-contained.
import { useEffect, useState } from 'react'
import { ABILITY_SLOTS, ABILITY_TINT, type AbilityBinding, abilityReady, bindingForSlot } from '@/game/abilities'
import { isComplete, progress } from '@/game/quests'
import { type PlayerHud } from '@/game/runtime/combat'
import type { Objective, Quest } from '@/game/types'

/** Human label for a kill objective's progress, e.g. "goblin 3/5". */
export function objectiveLabel(objective: Objective): string {
  return `${objective.target} ${objective.current}/${objective.required}`
}

// ── Combat HUD (DOM overlay; the canvas can't easily do crisp text bars) ──

/** Clamp a value/cap pair to a 0–100 percentage string for a CSS width var. */
export function barPercent(value: number, cap: number): string {
  if (cap <= 0) return '0%'
  const pct = Math.max(0, Math.min(100, (value / cap) * 100))
  return `${pct}%`
}

export interface CombatBarProps {
  label: string
  value: number
  cap: number
  /** Tailwind bg utility for the fill (kept out of the data shape). */
  fillClass: string
}

/** One labelled resource bar. The only dynamic value is the fill width, which
 *  rides a CSS custom property (`--fill`) — not a literal style magic number. */
export function CombatBar({ label, value, cap, fillClass }: CombatBarProps) {
  const fillVar = { '--fill': barPercent(value, cap) } as React.CSSProperties
  return (
    <div className="flex items-center gap-2">
      <span className="w-12 shrink-0 text-[10px] uppercase tracking-wide text-gray-300">{label}</span>
      <div className="relative h-3 flex-1 overflow-hidden rounded-sm bg-black/70 ring-1 ring-white/10">
        <div className={`h-full w-[var(--fill)] ${fillClass} transition-[width] duration-150`} style={fillVar} />
      </div>
      <span className="w-14 shrink-0 text-right text-[10px] tabular-nums text-gray-300">
        {Math.round(value)}/{Math.round(cap)}
      </span>
    </div>
  )
}

/** Bottom-left player vitals overlay: HP, rage, mana. Reads the mirrored HUD state. */
export function CombatHud({ hud }: { hud: PlayerHud }) {
  return (
    <div
      className="fixed bottom-4 left-4 z-20 w-64 rounded-md bg-black/80 p-3 font-mono text-white shadow-lg ring-1 ring-white/10"
      role="status"
      aria-label="Player vitals"
    >
      <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-amber-300">Vitals</div>
      <div className="flex flex-col gap-1.5">
        <CombatBar label="HP" value={hud.hp} cap={hud.maxHp} fillClass="bg-emerald-500" />
        <CombatBar label="Rage" value={hud.rage} cap={hud.rageCap} fillClass="bg-rose-500" />
        <CombatBar label="Mana" value={hud.mana} cap={hud.manaCap} fillClass="bg-sky-500" />
      </div>
      <div className="mt-2 text-[10px] text-gray-400">F attack · G special</div>
    </div>
  )
}

/**
 * Play-view ABILITY BAR: the 4 assigned slots (keys 1–4) with a cooldown sweep. The slots reflect
 * the live loadout (re-renders on assign/remove); the sweep reads the SAME last-used clock the play
 * loop stamps on fire (`lastUsedRef`) against `performance.now()` — that clock shares the rAF time
 * origin the loop uses, so the math lines up. A dark overlay fills the slot from the bottom and
 * shrinks as it cools; the icon dims while cooling and brightens (full color) when ready.
 */
export function AbilityBar({ loadout, lastUsedRef }: {
  loadout: readonly AbilityBinding[]
  lastUsedRef: React.MutableRefObject<Map<string, number>>
}) {
  // Repaint a few times a second so the sweep animates — cooldowns are seconds long, so ~16 fps is
  // plenty smooth and far cheaper than a per-frame rAF. The clock itself comes from performance.now.
  const [, repaint] = useState(0)
  useEffect(() => {
    const id = setInterval(() => repaint(t => (t + 1) % 1_000_000), 60)
    return () => clearInterval(id)
  }, [])
  const now = typeof performance !== 'undefined' ? performance.now() : 0
  return (
    <div
      className="fixed bottom-16 left-1/2 z-20 flex -translate-x-1/2 gap-1.5 rounded-md bg-black/80 p-1.5 font-mono shadow-lg ring-1 ring-white/10"
      role="group"
      aria-label="Ability bar"
    >
      {ABILITY_SLOTS.map(slot => {
        const ability = bindingForSlot(loadout, slot)?.ability
        const tint = ability ? ABILITY_TINT[ability.animation] : '#555'
        const lastUsed = ability ? lastUsedRef.current.get(ability.id) : undefined
        const ready = !ability || abilityReady(ability, lastUsed, now)
        const remaining = ability && lastUsed != null ? Math.max(0, ability.cooldownMs - (now - lastUsed)) : 0
        const fillPct = ability && ability.cooldownMs > 0 ? (remaining / ability.cooldownMs) * 100 : 0
        const abbrev = ability ? ability.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : '—'
        return (
          <div
            key={slot}
            title={ability ? `${ability.name} · ${(ability.cooldownMs / 1000).toFixed(0)}s` : `Slot ${slot} — empty`}
            className="relative h-11 w-11 overflow-hidden rounded border bg-black/70"
            style={{ borderColor: ability ? tint : 'rgba(255,255,255,0.15)' }}
          >
            {/* cooldown sweep: a dark overlay that fills the slot then shrinks to 0 as it cools */}
            {!ready && <div className="absolute inset-x-0 bottom-0 bg-black/70" style={{ height: `${fillPct}%` }} />}
            <span className="absolute left-0.5 top-0 text-[9px] font-bold text-gray-300">{slot}</span>
            <span
              className="flex h-full items-center justify-center text-[13px] font-bold"
              style={{ color: tint, opacity: ready ? 1 : 0.55 }}
            >
              {abbrev}
            </span>
            {!ready && (
              <span className="absolute inset-0 flex items-center justify-center text-[12px] font-bold tabular-nums text-white">
                {Math.ceil(remaining / 1000)}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

/**
 * Top-center active-quest tracker: title, kill progress, and a "ready to turn in"
 * cue when complete. Reads the active quest from React state (the loop mirrors
 * quests into state). Returns null when no quest is active, so it never shows
 * empty chrome.
 */
/** Objective checklist (✓/•) shared by the quest HUD, the offer modal and the quest log. */
export function QuestObjectives({ quest }: { quest: Quest }) {
  return (
    <ul className="flex flex-col gap-0.5">
      {quest.objectives.map((objective) => (
        <li key={`${objective.kind}:${objective.target}`} className="flex items-center gap-2 text-[11px]">
          <span aria-hidden className={objective.done ? 'text-emerald-400' : 'text-gray-500'}>
            {objective.done ? '✓' : '•'}
          </span>
          <span className={objective.done ? 'text-emerald-300 line-through' : 'text-gray-200'}>
            {objectiveLabel(objective)}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function QuestHud({ quest }: { quest: Quest | null }) {
  if (!quest) return null
  const { completed, total } = progress(quest)
  const done = isComplete(quest)
  return (
    <div
      className="fixed left-1/2 top-20 z-20 w-72 -translate-x-1/2 rounded-md bg-black/80 p-3 font-mono text-white shadow-lg ring-1 ring-amber-400/30"
      role="status"
      aria-label="Active quest"
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="truncate text-[11px] font-bold uppercase tracking-wider text-amber-300">{quest.title}</span>
        <span className="ml-2 shrink-0 text-[10px] tabular-nums text-gray-400">{completed}/{total}</span>
      </div>
      <QuestObjectives quest={quest} />
      {done && (
        <div className="mt-2 rounded bg-amber-500/20 px-2 py-1 text-center text-[10px] font-bold text-amber-200">
          Return to the giver (E) to turn in
        </div>
      )}
    </div>
  )
}
