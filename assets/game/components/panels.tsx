// Editor sidebar cards + inventory/equipment modal + tooltips: the quest-authoring
// card, the per-entity equipment panel (bag/equip/abilities), the player stats
// panel, item/ability tooltips, the ability browse modal, the quest log, and the
// inventory card. Moved out of the page (stage 4); props-driven presentational.
import { useEffect, useState } from 'react'
import { ABILITY_REGISTRY, ABILITY_SLOTS, ABILITY_TINT, type AbilityBinding, type AbilityDef, type AbilitySlot, assignAbility, bindingForSlot, rebindAbility, removeAbility } from '@/game/abilities'
import { GEAR_CATALOG } from '@/game/gear'
import { addToBag, allowedSlots, equip as equipToSlot, loadoutBonuses, setShortcut, setSpecial, unequip as unequipSlot } from '@/game/loadout'
import { progress } from '@/game/quests'
import { BARE_HANDS } from '@/game/runtime/combat'
import { DEFAULT_PLAYER_NAME } from '@/game/runtime/player'
import { type QuestDraft } from '@/game/runtime/questDraft'
import { type Armor, type ConsumableEffect, type Entity, EQUIP_SLOTS, type EquipSlot, type Inventory, type Item, type Loadout, type ObjectiveKind, type Quest, type Stats, type TalentPath, type Weapon } from '@/game/types'
import { weaponReach } from '@/game/weapons'
import { Card } from '@/components/game/controls'
import { QuestObjectives } from '@/components/game/hud'

// ── Quest authoring card (editor sidebar) ────────────────────────────

/** Tailwind colour for each quest state badge in the authored-quest list. */
export const QUEST_STATE_BADGE: Record<Quest['state'], string> = {
  available: 'bg-gray-600 text-gray-100',
  active: 'bg-sky-600 text-white',
  completed: 'bg-amber-500 text-black',
  turned_in: 'bg-emerald-600 text-white',
}

export const QUEST_FIELD_CLASS = 'w-full rounded bg-gray-800 p-1.5 text-xs'

export const OBJECTIVE_TARGET_LABEL: Record<ObjectiveKind, string> = { kill: 'Enemy type', travel: 'Cell "col,row"', find: 'Target NPC' }
export const OBJECTIVE_TARGET_PLACEHOLDER: Record<ObjectiveKind, string> = { kill: 'goblin', travel: '10,5', find: '' }

export interface QuestAuthoringCardProps {
  npcs: Entity[]
  quests: Quest[]
  draft: QuestDraft
  playerXp: number
  onDraftChange: (next: QuestDraft) => void
  onSave: () => void
}

/**
 * Editor panel to author ONE kill-quest and link it to a placed NPC (spec §10):
 * pick a giver, set a title + kill objective (enemy type × count) + a reward
 * (xp or item). Lists already-authored quests with their lifecycle state. Purely
 * presentational — all quest logic lives in the page/module; this only edits the
 * draft and fires onSave.
 */
export function QuestAuthoringCard({ npcs, quests, draft, playerXp, onDraftChange, onSave }: QuestAuthoringCardProps) {
  const patch = (partial: Partial<QuestDraft>) => onDraftChange({ ...draft, ...partial })

  return (
    <Card title="Quests" accent="orange">
      <p className="mb-2 text-[10px] text-gray-500">
        Place an NPC, link it as a quest-giver, then play: press E by the NPC to accept,
        slay the enemies, return and press E to turn in.
      </p>

      <label className="mb-2 block">
        <span className="mb-1 block text-xs font-bold text-orange-300">Quest-giver NPC</span>
        <select
          value={draft.giverId}
          onChange={e => patch({ giverId: e.target.value })}
          aria-label="Quest-giver NPC"
          className={QUEST_FIELD_CLASS}
        >
          <option value="">— pick a placed NPC —</option>
          {npcs.map(npc => (
            <option key={npc.id} value={npc.id}>
              {npc.name?.trim() || `NPC @ ${npc.col},${npc.row}`}
            </option>
          ))}
        </select>
      </label>

      <label className="mb-2 block">
        <span className="mb-1 block text-xs font-bold text-orange-300">Title</span>
        <input
          type="text"
          value={draft.title}
          onChange={e => patch({ title: e.target.value })}
          placeholder="Cull the goblins"
          aria-label="Quest title"
          className={QUEST_FIELD_CLASS}
        />
      </label>

      <div className="mb-2">
        <span className="mb-1 block text-xs font-bold text-orange-300">Objective</span>
        <select
          value={draft.objectiveKind}
          onChange={e => patch({ objectiveKind: e.target.value as ObjectiveKind, target: '' })}
          aria-label="Objective kind"
          className={`${QUEST_FIELD_CLASS} mb-1`}
        >
          <option value="kill">Slay enemies</option>
          <option value="travel">Travel to a cell</option>
          <option value="find">Find an NPC</option>
        </select>
        <div className="grid grid-cols-3 gap-2">
          <label className="col-span-2 block">
            <span className="mb-1 block text-[10px] text-gray-400">{OBJECTIVE_TARGET_LABEL[draft.objectiveKind]}</span>
            {draft.objectiveKind === 'find' ? (
              <select value={draft.target} onChange={e => patch({ target: e.target.value })} aria-label="Target NPC" className={QUEST_FIELD_CLASS}>
                <option value="">— pick NPC —</option>
                {npcs.map(n => <option key={n.id} value={n.id}>{n.name?.trim() || `NPC @ ${n.col},${n.row}`}</option>)}
              </select>
            ) : (
              <input
                type="text"
                value={draft.target}
                onChange={e => patch({ target: e.target.value })}
                placeholder={OBJECTIVE_TARGET_PLACEHOLDER[draft.objectiveKind]}
                aria-label="Objective target"
                className={QUEST_FIELD_CLASS}
              />
            )}
          </label>
          {draft.objectiveKind === 'kill' && (
            <label className="block">
              <span className="mb-1 block text-[10px] text-gray-400">Count</span>
              <input
                type="number"
                min={1}
                value={draft.count}
                onChange={e => patch({ count: Number(e.target.value) })}
                aria-label="Objective count"
                className={QUEST_FIELD_CLASS}
              />
            </label>
          )}
        </div>
      </div>

      <div className="mb-2">
        <span className="mb-1 block text-xs font-bold text-orange-300">Reward</span>
        <div className="mb-2 grid grid-cols-2 gap-1">
          <RewardKindButton label="XP" active={draft.rewardKind === 'xp'} onClick={() => patch({ rewardKind: 'xp' })} />
          <RewardKindButton label="Item" active={draft.rewardKind === 'item'} onClick={() => patch({ rewardKind: 'item' })} />
        </div>
        {draft.rewardKind === 'xp' ? (
          <input
            type="number"
            min={0}
            value={draft.rewardXp}
            onChange={e => patch({ rewardXp: Number(e.target.value) })}
            aria-label="Reward XP amount"
            className={QUEST_FIELD_CLASS}
          />
        ) : (
          <input
            type="text"
            value={draft.rewardItemId}
            onChange={e => patch({ rewardItemId: e.target.value })}
            placeholder="reward-item id"
            aria-label="Reward item id"
            className={QUEST_FIELD_CLASS}
          />
        )}
      </div>

      <button
        onClick={onSave}
        className="w-full rounded bg-orange-600 px-2 py-1.5 text-xs font-bold text-black transition-colors hover:bg-orange-500"
      >
        Link quest to giver
      </button>

      <div className="mt-3 border-t border-white/10 pt-2">
        <div className="mb-1 flex items-center justify-between text-[10px] text-gray-400">
          <span>{quests.length} quest{quests.length === 1 ? '' : 's'}</span>
          <span className="tabular-nums text-amber-300">{playerXp} XP</span>
        </div>
        <ul className="flex flex-col gap-1">
          {quests.map(quest => (
            <li key={quest.id} className="flex items-center justify-between gap-2 rounded bg-black/40 px-2 py-1">
              <span className="truncate text-[11px] text-gray-200">{quest.title}</span>
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${QUEST_STATE_BADGE[quest.state]}`}>
                {quest.state.replace('_', ' ')}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  )
}

/** A reward-kind toggle (XP / Item) in the Quests card. */
export function RewardKindButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`rounded px-2 py-1 text-xs font-bold transition-colors ${
        active ? 'bg-orange-600 text-black' : 'bg-gray-700 text-gray-200 hover:bg-gray-600'
      }`}
    >
      {label}
    </button>
  )
}

export const SLOT_LABEL: Record<EquipSlot, string> = {
  helmet: 'Helmet', chest: 'Chest', gloves: 'Gloves', boots: 'Boots',
  weapon1: 'Weapon 1', weapon2: 'Weapon 2', ring1: 'Ring 1', ring2: 'Ring 2', neck: 'Neck',
}

/** Pull a bag item out (slot nulled). */
export function takeFromBag(loadout: Loadout, index: number): Loadout {
  const bag = [...loadout.bag]
  bag[index] = null
  return { ...loadout, bag }
}

/** Click a bag item → equip it (first allowed slot, swapping any occupant back to the
 *  bag), or if it's a consumable drop it in the first free special slot. */
export function useBagItem(loadout: Loadout, index: number): Loadout {
  const item = loadout.bag[index]
  if (!item) return loadout
  const slots = allowedSlots(item)
  if (slots.length === 0) {
    const free = loadout.special.findIndex(s => s === null)
    if (free < 0) return loadout
    return setSpecial(takeFromBag(loadout, index), free, item)
  }
  const target = slots.find(s => !(s in loadout.equipped)) ?? slots[0]
  const displaced = loadout.equipped[target] ?? null
  let next = equipToSlot(takeFromBag(loadout, index), item, target)
  if (displaced) next = addToBag(next, displaced)
  return next
}

// ── item hover tooltips (#51): read the real numbers off each item def ──
/** Stat lines for a weapon. Shields lead with block%; everything else shows the
 *  damage / reach / hands / school that drives a swing. */
export function weaponTooltipStats(w: Weapon): string[] {
  if (w.kind === 'shield') {
    const lines = [`Block ${w.blockChance ?? 0}%`, `Defense ${w.baseDefense}`]
    if (w.strengthBonus) lines.push(`Strength +${w.strengthBonus}`)
    if (w.intBonus) lines.push(`Intelligence +${w.intBonus}`)
    return lines
  }
  const dmg = w.school === 'magical' ? w.baseMagic : w.baseDamage
  const lines = [
    `Damage ${dmg}`,
    `Reach ${weaponReach(w)} (${w.range})`,
    `${w.hands === 2 ? 'Two-handed' : 'One-handed'} · ${w.school}`,
  ]
  if (w.strengthBonus) lines.push(`Strength +${w.strengthBonus}`)
  if (w.intBonus) lines.push(`Intelligence +${w.intBonus}`)
  if (w.baseDefense) lines.push(`Defense +${w.baseDefense}`)
  return lines
}

/** Stat lines for a piece of armor: its defense value plus any worn bonuses. */
export function armorTooltipStats(a: Armor): string[] {
  const lines = [`Armor ${a.defenseBonus}`]
  if (a.strengthBonus) lines.push(`Strength +${a.strengthBonus}`)
  if (a.intBonus) lines.push(`Intelligence +${a.intBonus}`)
  if (a.dodgeBonus) lines.push(`Dodge +${a.dodgeBonus}%`)
  return lines
}

/** Stat lines for a consumable / special item: what it restores, or a plain note
 *  for throwables (bomb / scroll) whose behaviour fires in the play loop. */
export function consumableTooltipStats(effect: ConsumableEffect): string[] {
  const lines: string[] = []
  if (effect.hp) lines.push(`Restore ${effect.hp} HP`)
  if (effect.mana) lines.push(`Restore ${effect.mana} Mana`)
  if (effect.rage) lines.push(`Restore ${effect.rage} Rage`)
  if (lines.length === 0) lines.push('Special item')
  return lines
}

/** The hover-tooltip stat lines for ANY item (dispatch on its slot). */
export function itemTooltipStats(item: Item): string[] {
  if (item.slot === 'weapon') return weaponTooltipStats(item.weapon)
  if (item.slot === 'armor') return armorTooltipStats(item.armor)
  return consumableTooltipStats(item.effect)
}

/** Floating, cursor-anchored item tooltip (dark mono panel, matches the editor UI).
 *  Pinned with `position: fixed` to the live cursor and clamped to the viewport so it
 *  never clips off an edge; pointer-events-none so it never eats the hover/click. */
export function ItemTooltip({ item, x, y }: { item: Item; x: number; y: number }) {
  const lines = itemTooltipStats(item)
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1920
  const vh = typeof window !== 'undefined' ? window.innerHeight : 1080
  const left = Math.max(8, Math.min(x + 14, vw - 192))
  const top = Math.max(8, Math.min(y + 14, vh - (lines.length * 15 + 44)))
  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-50 w-44 rounded border border-cyan-500/50 bg-gray-900/95 px-2 py-1.5 font-mono text-[10px] text-gray-300 shadow-xl"
      style={{ left, top }}
    >
      <div className="mb-0.5 truncate text-[11px] font-bold text-cyan-300">{item.name}</div>
      {lines.map((line, i) => <div key={i}>{line}</div>)}
    </div>
  )
}

/** Tooltip stat lines for an ability (category / cooldown / effect) — mirrors itemTooltipStats. */
export function abilityTooltipLines(a: AbilityDef): string[] {
  const lines = [`Category: ${a.category}`, `Cooldown ${(a.cooldownMs / 1000).toFixed(1)}s`]
  if (a.effect.damage) lines.push(`Damage ${a.effect.damage}`)
  if (a.effect.healing) lines.push(`Healing ${a.effect.healing}`)
  if (a.effect.shieldMs) lines.push(`Shield ${(a.effect.shieldMs / 1000).toFixed(1)}s`)
  if (a.effect.debuff) lines.push(`${a.effect.debuff.kind} ${(a.effect.debuff.durationMs / 1000).toFixed(1)}s`)
  return lines
}

/** Compact one-line effect summary for an ability card (browse modal): the headline number. */
export function abilityEffectLabel(a: AbilityDef): string {
  const e = a.effect
  if (e.healing) return `+${e.healing} HP`
  if (e.shieldMs) return `shield ${(e.shieldMs / 1000).toFixed(0)}s`
  const parts: string[] = []
  if (e.damage) parts.push(`${e.damage} dmg`)
  if (e.debuff) parts.push(e.debuff.kind)
  return parts.join(' · ') || '—'
}

/** Floating ability tooltip — same cursor-anchored dark panel as ItemTooltip (#51), tinted to the
 *  ability's animation color so a Fire Slash reads orange, a Frost reads blue, etc. */
export function AbilityTooltip({ ability, x, y }: { ability: AbilityDef; x: number; y: number }) {
  const lines = abilityTooltipLines(ability)
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1920
  const vh = typeof window !== 'undefined' ? window.innerHeight : 1080
  const left = Math.max(8, Math.min(x + 14, vw - 192))
  const top = Math.max(8, Math.min(y + 14, vh - (lines.length * 15 + 44)))
  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-50 w-44 rounded border border-fuchsia-500/50 bg-gray-900/95 px-2 py-1.5 font-mono text-[10px] text-gray-300 shadow-xl"
      style={{ left, top }}
    >
      <div className="mb-0.5 truncate text-[11px] font-bold" style={{ color: ABILITY_TINT[ability.animation] }}>{ability.name}</div>
      {lines.map((line, i) => <div key={i}>{line}</div>)}
    </div>
  )
}

// ── live player/entity stats panel (#52) ────────────────────────────
/** One labelled stat readout in the stats grid. */
export function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-white/10 bg-black/40 px-2 py-1">
      <div className="text-[8px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className="text-[12px] font-bold tabular-nums text-gray-100">{value}</div>
    </div>
  )
}

/**
 * Live stats for the entity whose loadout is open — the SAME source the combat HUD
 * reads from: base stats folded with the equipped gear's bonuses (loadoutBonuses)
 * and the equipped weapon. Equipping/unequipping re-renders this with new totals, so
 * the numbers move as you change gear (sword → attack up, shield → block up, etc.).
 */
export function PlayerStatsPanel({ baseStats, loadout, hp }: {
  baseStats: Stats
  loadout: Loadout
  hp: { current: number; max: number }
}) {
  const b = loadoutBonuses(loadout)
  const weapons = [loadout.equipped.weapon1, loadout.equipped.weapon2].flatMap(i =>
    i && i.slot === 'weapon' ? [i.weapon] : [],
  )
  const weapon = weapons.find(w => w.kind !== 'shield') ?? weapons[0] ?? BARE_HANDS
  // Effective stats = base + worn gear (mirrors the play-loop's playerStatsRef wiring).
  const strength = baseStats.strength + b.strength
  const intelligence = baseStats.intelligence + b.intelligence
  const defense = baseStats.defense + b.defense
  const dodge = (baseStats.dodge ?? 0) + b.dodge
  // Regular-hit damage per the combat formula (physical scales str, magical scales int).
  const attack = weapon.school === 'magical' ? weapon.baseMagic + intelligence : weapon.baseDamage + strength
  return (
    <div className="mb-3 rounded-lg border border-amber-500/30 bg-black/40 p-2">
      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">Stats — live totals (incl. gear)</p>
      <div className="grid grid-cols-4 gap-1">
        <StatChip label="HP" value={`${hp.current}/${hp.max}`} />
        <StatChip label="Attack" value={`${attack} ${weapon.school === 'magical' ? '✦' : '⚔'}`} />
        <StatChip label="Defense" value={`${defense}`} />
        <StatChip label="Reach" value={`${weaponReach(weapon)} ${weapon.range === 'ranged' ? 'rng' : 'mel'}`} />
        <StatChip label="Dodge" value={`${dodge}%`} />
        <StatChip label="Block" value={`${b.block}%`} />
        <StatChip label="Strength" value={`${strength}`} />
        <StatChip label="Intelligence" value={`${intelligence}`} />
      </div>
      <p className="mt-1 truncate text-[9px] text-gray-500">Weapon: {weapon.name}</p>
    </div>
  )
}

/** Hover-handler bundle for an ability button (drives the #51-style floating tooltip). */
export type AbilityTipProps = {
  onMouseEnter: (e: React.MouseEvent) => void
  onMouseMove: (e: React.MouseEvent) => void
  onMouseLeave: () => void
}

/** First ability slot with no binding — the default target for the "Browse abilities" button. */
export function firstEmptyAbilitySlot(loadout: readonly AbilityBinding[]): AbilitySlot {
  return ABILITY_SLOTS.find(s => !bindingForSlot(loadout, s)) ?? 1
}

/** A clickable trigger-key badge: click → the parent enters key-capture mode and rebinds on the next
 *  keypress; while capturing it pulses "press…". Shared by special-action + ability slots so BOTH
 *  sets read as user-keyed and remappable. */
export function KeyCaptureBadge({ keyLabel, capturing, onClick, ariaLabel, tone }: {
  keyLabel: string
  capturing: boolean
  onClick: () => void
  ariaLabel: string
  tone: 'amber' | 'fuchsia'
}) {
  const toneCls = tone === 'amber' ? 'bg-amber-700 hover:bg-amber-600' : 'bg-fuchsia-700 hover:bg-fuchsia-600'
  return (
    <button
      onClick={onClick}
      aria-label={ariaLabel}
      title="Click, then press a key to rebind"
      className={`rounded px-1.5 text-[10px] font-bold leading-tight ${capturing ? 'animate-pulse bg-white/30 text-white ring-1 ring-white' : toneCls}`}
    >
      {capturing ? 'press…' : keyLabel.toUpperCase()}
    </button>
  )
}

/**
 * External "browse abilities" modal (#51-style cards) — lists the WHOLE registry (name, category,
 * cooldown, effect) and assigns the picked ability into the chosen slot. Slot tabs across the top
 * select the target; assigning keeps the modal open so several slots can be filled in one visit.
 * Sits above the inventory panel (z-40); its hover tooltips render in the parent at z-50.
 */
export function AbilityBrowseModal({ loadout, targetSlot, onPickSlot, onAssign, onClose, tipProps }: {
  loadout: readonly AbilityBinding[]
  targetSlot: AbilitySlot
  onPickSlot: (s: AbilitySlot) => void
  onAssign: (slot: AbilitySlot, ability: AbilityDef) => void
  onClose: () => void
  tipProps: (a: AbilityDef) => AbilityTipProps
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-4 font-mono" role="dialog" aria-label="Browse abilities" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-fuchsia-500/50 bg-gray-900 p-4 text-white shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold text-fuchsia-300">Browse Abilities</h2>
          <button onClick={onClose} className="rounded bg-gray-700 px-2 py-1 text-xs hover:bg-gray-600" aria-label="Close ability browser">✕</button>
        </div>
        <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">Assign to slot</p>
        <div className="mb-3 grid grid-cols-4 gap-1">
          {ABILITY_SLOTS.map(slot => {
            const ability = bindingForSlot(loadout, slot)?.ability
            const active = slot === targetSlot
            return (
              <button
                key={slot}
                onClick={() => onPickSlot(slot)}
                aria-label={`Target slot ${slot}${active ? ' (selected)' : ''}`}
                className={`rounded border px-1.5 py-1 text-center text-[10px] ${active ? 'border-fuchsia-400 bg-fuchsia-900/60' : 'border-white/10 bg-black/40 hover:bg-white/5'}`}
              >
                <span className="block font-bold">Slot {slot}</span>
                <span className="block truncate text-[9px]" style={{ color: ability ? ABILITY_TINT[ability.animation] : '#6b7280' }}>{ability ? ability.name : 'empty'}</span>
              </button>
            )
          })}
        </div>
        <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">Abilities ({ABILITY_REGISTRY.length})</p>
        <div className="grid grid-cols-2 gap-1.5">
          {ABILITY_REGISTRY.map(a => (
            <button
              key={a.id}
              onClick={() => onAssign(targetSlot, a)}
              {...tipProps(a)}
              className="rounded border border-white/10 bg-gray-800 px-2 py-1.5 text-left hover:border-fuchsia-500/60 hover:bg-fuchsia-900/40"
            >
              <span className="block truncate text-[11px] font-bold" style={{ color: ABILITY_TINT[a.animation] }}>{a.name}</span>
              <span className="block truncate text-[9px] text-gray-400">{a.category} · {(a.cooldownMs / 1000).toFixed(0)}s cd</span>
              <span className="block truncate text-[9px] text-gray-300">{abilityEffectLabel(a)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export function EquipmentPanel({ label, loadout, baseStats, hp, onChange, onClose, abilityLoadout, onAbilityChange, nameValue, onNameChange }: {
  label: string
  loadout: Loadout
  baseStats: Stats
  hp: { current: number; max: number }
  onChange: (l: Loadout) => void
  onClose: () => void
  // Ability loadout (slot 1–4 → ability). Optional: only the player passes these in v1, so an
  // enemy's inventory shows gear only. When present, the Abilities section becomes editable.
  abilityLoadout?: readonly AbilityBinding[]
  onAbilityChange?: (l: readonly AbilityBinding[]) => void
  // Player only: the raw, EDITABLE name (empty = falls back to the default). When onNameChange is
  // passed the header name becomes an input so you can rename right from the inventory.
  nameValue?: string
  onNameChange?: (name: string) => void
}) {
  // Hovered item + live cursor pos for the stat tooltip (#51). Cleared on leave.
  const [hovered, setHovered] = useState<{ item: Item; x: number; y: number } | null>(null)
  const hideTip = () => setHovered(null)
  const moveTip = (e: React.MouseEvent) => setHovered(h => (h ? { ...h, x: e.clientX, y: e.clientY } : h))
  /** Hover-handler props for an item button; no-op object for empty slots. */
  const tipProps = (item: Item | null | undefined) =>
    item
      ? {
          onMouseEnter: (e: React.MouseEvent) => setHovered({ item, x: e.clientX, y: e.clientY }),
          onMouseMove: moveTip,
          onMouseLeave: hideTip,
        }
      : {}
  const unequipToBag = (slot: EquipSlot) => {
    const item = loadout.equipped[slot]
    if (item) onChange(addToBag(unequipSlot(loadout, slot), item))
  }
  const sendSpecialToBag = (i: number) => {
    const item = loadout.special[i]
    if (item) onChange(addToBag(setSpecial(loadout, i, null), item))
  }
  // Hovered ability tooltip (#51 style) — fed by the ability slots AND the browse modal's cards.
  const [hoveredAbility, setHoveredAbility] = useState<{ ability: AbilityDef; x: number; y: number } | null>(null)
  const abilityTipProps = (a: AbilityDef): AbilityTipProps => ({
    onMouseEnter: (e: React.MouseEvent) => setHoveredAbility({ ability: a, x: e.clientX, y: e.clientY }),
    onMouseMove: (e: React.MouseEvent) => setHoveredAbility(h => (h ? { ...h, x: e.clientX, y: e.clientY } : h)),
    onMouseLeave: () => setHoveredAbility(null),
  })
  // Browse-abilities modal: the slot it targets (null = closed). Opened from the abilities section.
  const [browseSlot, setBrowseSlot] = useState<AbilitySlot | null>(null)
  // Key-capture: which slot is being rebound (null = idle). Click a key badge → the NEXT keypress
  // remaps that slot. Special actions + abilities share this, so both read as user-keyed/remappable.
  const [capturing, setCapturing] = useState<{ kind: 'ability' | 'special'; index: number } | null>(null)
  useEffect(() => {
    if (!capturing) return
    const onKey = (e: KeyboardEvent) => {
      // Capture phase + stopImmediatePropagation: the press rebinds HERE and never reaches the play
      // loop's key map, so we don't fire the very action we're rebinding (or toggle the inventory).
      e.preventDefault()
      e.stopImmediatePropagation()
      if (e.key === 'Escape') { setCapturing(null); return }
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return // wait for a non-modifier key
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
      if (capturing.kind === 'ability' && abilityLoadout && onAbilityChange) {
        onAbilityChange(rebindAbility(abilityLoadout, capturing.index as AbilitySlot, key))
      } else if (capturing.kind === 'special') {
        onChange(setShortcut(loadout, capturing.index, key))
      }
      setCapturing(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [capturing, abilityLoadout, onAbilityChange, loadout, onChange])
  const capturingSpecial = (i: number) => capturing?.kind === 'special' && capturing.index === i
  const capturingAbility = (slot: AbilitySlot) => capturing?.kind === 'ability' && capturing.index === slot

  return (
    <>
      <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 p-4 font-mono" role="dialog" aria-label="Inventory" onClick={onClose}>
        <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-cyan-500/40 bg-gray-900 p-4 text-white shadow-2xl" onClick={e => e.stopPropagation()}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-1 text-sm font-bold text-cyan-400">
              Inventory —{' '}
              {onNameChange ? (
                <input
                  value={nameValue ?? ''}
                  onChange={e => onNameChange(e.target.value)}
                  placeholder={DEFAULT_PLAYER_NAME}
                  aria-label="Player name"
                  className="w-40 rounded bg-gray-800 px-1.5 py-0.5 text-sm font-bold text-cyan-300 outline-none focus:ring-1 focus:ring-cyan-500"
                />
              ) : (
                label
              )}
            </h2>
            <button onClick={onClose} className="rounded bg-gray-700 px-2 py-1 text-xs hover:bg-gray-600" aria-label="Close inventory">✕ (I)</button>
          </div>

          {/* ── Action slots: SPECIAL ACTIONS beside ABILITIES — two distinct, user-keyed sets ── */}
          <div className="mb-3 grid grid-cols-2 gap-3">
            {/* Special actions (consumables / throwables) — default keys 5–8, rebindable to any key. */}
            <section className="rounded-lg border border-amber-500/30 bg-black/40 p-2">
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">Special actions — own keys</p>
              <div className="grid grid-cols-2 gap-1">
                {loadout.special.map((item, i) => (
                  <div key={i} className="rounded border border-amber-600/40 bg-amber-900/20 p-1 text-center text-[11px]">
                    <KeyCaptureBadge
                      keyLabel={loadout.shortcuts[i]}
                      capturing={capturingSpecial(i)}
                      onClick={() => setCapturing({ kind: 'special', index: i })}
                      ariaLabel={`Rebind key for special slot ${i + 1}`}
                      tone="amber"
                    />
                    <button onClick={() => sendSpecialToBag(i)} disabled={!item} {...tipProps(item)} className="mt-0.5 block w-full truncate hover:text-amber-300">{item ? item.name : '—'}</button>
                  </div>
                ))}
              </div>
            </section>

            {/* Abilities — default keys 1–4, rebindable; assigned from the external browse modal. */}
            <section className="rounded-lg border border-fuchsia-500/30 bg-black/40 p-2">
              <div className="mb-1.5 flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-wider text-fuchsia-300">Abilities — own keys</p>
                {abilityLoadout && onAbilityChange && (
                  <button
                    onClick={() => setBrowseSlot(firstEmptyAbilitySlot(abilityLoadout))}
                    className="rounded bg-fuchsia-700 px-1.5 py-0.5 text-[9px] font-bold hover:bg-fuchsia-600"
                    aria-label="Browse abilities"
                  >
                    ＋ Browse
                  </button>
                )}
              </div>
              {abilityLoadout && onAbilityChange ? (
                <div className="grid grid-cols-2 gap-1">
                  {ABILITY_SLOTS.map(slot => {
                    const binding = bindingForSlot(abilityLoadout, slot)
                    const ability = binding?.ability
                    return (
                      <div
                        key={slot}
                        className="rounded border border-fuchsia-600/40 bg-fuchsia-900/20 p-1 text-center text-[11px]"
                        style={ability ? { borderColor: ABILITY_TINT[ability.animation] } : undefined}
                      >
                        <div className="flex items-center justify-center gap-1">
                          <KeyCaptureBadge
                            keyLabel={binding?.key ?? String(slot)}
                            capturing={capturingAbility(slot)}
                            onClick={() => setCapturing({ kind: 'ability', index: slot })}
                            ariaLabel={`Rebind key for ability slot ${slot}`}
                            tone="fuchsia"
                          />
                          {ability && (
                            <button
                              onClick={() => onAbilityChange(removeAbility(abilityLoadout, slot))}
                              className="rounded bg-black/40 px-1 text-[10px] text-fuchsia-200 hover:text-red-300"
                              aria-label={`Remove ability from slot ${slot}`}
                            >
                              ✕
                            </button>
                          )}
                        </div>
                        {ability ? (
                          <button
                            {...abilityTipProps(ability)}
                            onClick={() => setBrowseSlot(slot)}
                            className="mt-0.5 block w-full truncate font-bold hover:text-fuchsia-300"
                            style={{ color: ABILITY_TINT[ability.animation] }}
                          >
                            {ability.name}
                          </button>
                        ) : (
                          <button
                            onClick={() => setBrowseSlot(slot)}
                            className="mt-0.5 block w-full truncate text-gray-500 hover:text-fuchsia-300"
                            aria-label={`Assign ability to slot ${slot}`}
                          >
                            + Assign
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-[10px] text-gray-600">No abilities for this entity.</p>
              )}
            </section>
          </div>

          {/* ── Two-column body: LEFT = bag (inventory), RIGHT = character equipment + stats ── */}
          <div className="grid grid-cols-2 gap-3">
            {/* LEFT — the bag */}
            <section>
              <p className="mb-1 text-xs font-bold text-gray-400">Inventory — Bag ({loadout.bag.filter(Boolean).length}/{loadout.bag.length})</p>
              <div className="mb-3 grid grid-cols-4 gap-1">
                {loadout.bag.map((item, i) => (
                  <button key={i} onClick={() => onChange(useBagItem(loadout, i))} disabled={!item} {...tipProps(item)}
                    title={item ? `Equip / use ${item.name}` : ''}
                    className={`aspect-square rounded border p-1 text-[9px] leading-tight ${item ? 'border-white/20 bg-gray-800 hover:bg-gray-700' : 'border-white/5 bg-black/30 text-gray-700'}`}>
                    {item ? item.name.slice(0, 10) : ''}
                  </button>
                ))}
              </div>
              <details>
                <summary className="cursor-pointer text-xs text-gray-400">+ Add gear to bag</summary>
                <div className="mt-1 grid grid-cols-2 gap-1">
                  {GEAR_CATALOG.map(g => (
                    <button key={g.id} onClick={() => onChange(addToBag(loadout, g))} className="truncate rounded bg-gray-700 px-1 py-0.5 text-[10px] hover:bg-gray-600">{g.name}</button>
                  ))}
                </div>
              </details>
            </section>

            {/* RIGHT — character equipment + live stat totals */}
            <section>
              <PlayerStatsPanel baseStats={baseStats} loadout={loadout} hp={hp} />
              <p className="mb-1 text-xs font-bold text-gray-400">Equipment</p>
              <div className="grid grid-cols-2 gap-1">
                {EQUIP_SLOTS.map(slot => {
                  const item = loadout.equipped[slot]
                  return (
                    <button key={slot} onClick={() => unequipToBag(slot)} disabled={!item} {...tipProps(item)}
                      className={`rounded border px-2 py-1.5 text-left text-[11px] ${item ? 'border-cyan-600 bg-cyan-900/40 hover:bg-cyan-900/70' : 'border-white/10 bg-black/40 text-gray-600'}`}>
                      <span className="block text-[9px] uppercase text-gray-500">{SLOT_LABEL[slot]}</span>
                      <span className="block truncate">{item ? item.name : '—'}</span>
                    </button>
                  )
                })}
              </div>
            </section>
          </div>
        </div>
      </div>
      {browseSlot !== null && abilityLoadout && onAbilityChange && (
        <AbilityBrowseModal
          loadout={abilityLoadout}
          targetSlot={browseSlot}
          onPickSlot={setBrowseSlot}
          onAssign={(slot, ability) => onAbilityChange(assignAbility(abilityLoadout, slot, ability))}
          onClose={() => setBrowseSlot(null)}
          tipProps={abilityTipProps}
        />
      )}
      {hovered && <ItemTooltip item={hovered.item} x={hovered.x} y={hovered.y} />}
      {hoveredAbility && <AbilityTooltip ability={hoveredAbility.ability} x={hoveredAbility.x} y={hoveredAbility.y} />}
    </>
  )
}

/** Lifecycle groups the quest log renders, in player-facing order. */
export const QUEST_LOG_GROUPS: ReadonlyArray<{ state: Quest['state']; label: string; accent: string }> = [
  { state: 'available', label: 'Available', accent: 'text-gray-300' },
  { state: 'active', label: 'Active', accent: 'text-sky-300' },
  { state: 'completed', label: 'Completed', accent: 'text-amber-300' },
  { state: 'turned_in', label: 'Turned in', accent: 'text-emerald-300' },
]

/**
 * Quest LOG overlay — the player's quests grouped by lifecycle state, each with the
 * shared objective checklist + a progress count. Mirrors the inventory EquipmentPanel:
 * backdrop click or the ✕ button closes it (the page also wires Esc + the Q key).
 */
export function QuestLogPanel({ quests, onClose }: {
  quests: readonly Quest[]
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 p-4 font-mono" role="dialog" aria-label="Quest log" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-orange-500/40 bg-gray-900 p-4 text-white shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold text-orange-400">Quest Log</h2>
          <button onClick={onClose} className="rounded bg-gray-700 px-2 py-1 text-xs hover:bg-gray-600" aria-label="Close quest log">✕ (Q)</button>
        </div>
        {quests.length === 0 && <p className="text-xs text-gray-500">No quests yet. Find a quest-giver and press E to accept one.</p>}
        <div className="space-y-3">
          {QUEST_LOG_GROUPS.map(group => {
            const inGroup = quests.filter(q => q.state === group.state)
            if (inGroup.length === 0) return null
            return (
              <section key={group.state}>
                <p className={`mb-1 text-[10px] font-bold uppercase tracking-wider ${group.accent}`}>{group.label} ({inGroup.length})</p>
                <ul className="space-y-2">
                  {inGroup.map(quest => {
                    const { completed, total } = progress(quest)
                    return (
                      <li key={quest.id} className="rounded border border-white/10 bg-black/40 p-2">
                        <div className="mb-1 flex items-center justify-between">
                          <span className="truncate text-[11px] font-bold text-gray-100">{quest.title}</span>
                          <span className="ml-2 shrink-0 text-[10px] tabular-nums text-gray-400">{completed}/{total}</span>
                        </div>
                        <QuestObjectives quest={quest} />
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export function InventoryCard({ inventory, talentPath, onEquip, onUse, onSetClass }: {
  inventory: Inventory
  talentPath: TalentPath
  onEquip: (itemId: string) => void
  onUse: (itemId: string) => void
  onSetClass: (path: TalentPath) => void
}) {
  const classBtn = (path: TalentPath, label: string) =>
    `flex-1 rounded px-2 py-0.5 ${talentPath === path ? 'bg-cyan-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`
  return (
    <Card title="Inventory" accent="cyan">
      <div className="space-y-2 text-xs">
        <div>
          <span className="mb-1 block text-[10px] uppercase tracking-wider text-gray-400">Class</span>
          <div className="flex gap-1">
            <button onClick={() => onSetClass('warrior')} className={classBtn('warrior', 'Warrior')} aria-pressed={talentPath === 'warrior'}>Warrior</button>
            <button onClick={() => onSetClass('magician')} className={classBtn('magician', 'Magician')} aria-pressed={talentPath === 'magician'}>Magician</button>
          </div>
        </div>
        <div className="text-gray-300">
          <div>Weapon: <span className="text-cyan-300">{inventory.equippedWeapon?.name ?? '—'}</span></div>
          <div>Armor: <span className="text-cyan-300">{inventory.equippedArmor?.name ?? '—'}</span></div>
        </div>
        <ul className="space-y-1">
          {inventory.items.length === 0 && <li className="text-gray-500">No items</li>}
          {inventory.items.map(item => (
            <li key={item.id} className="flex items-center justify-between gap-2">
              <span className="truncate text-gray-200">
                {item.name} <span className="text-gray-500">({item.slot})</span>
              </span>
              {item.slot === 'consumable' ? (
                <button onClick={() => onUse(item.id)} className="shrink-0 rounded bg-emerald-700 px-2 py-0.5 hover:bg-emerald-600" aria-label={`Use ${item.name}`}>Use</button>
              ) : (
                <button onClick={() => onEquip(item.id)} className="shrink-0 rounded bg-cyan-700 px-2 py-0.5 hover:bg-cyan-600" aria-label={`Equip ${item.name}`}>Equip</button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Card>
  )
}
