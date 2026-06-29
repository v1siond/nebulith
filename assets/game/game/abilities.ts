/**
 * ABILITIES — the data-driven model behind the combat ability system (see docs/ability-system.md).
 *
 * The engine seeds a library of ability ANIMATIONS; an ability is composed by attaching one of them
 * to data (category, cooldown, requirements, effect magnitudes). Entities equip up to 4, bound to
 * keys 1–4. Pure module: no rendering, no React — the play loop reads these + the cooldown helper.
 *
 * v1 ships ONE seeded ability (Fire Slash) + the model/helpers, so the database/editor + progress
 * system can plug in later without reshaping this.
 */

export type AbilityCategory = 'offensive' | 'defensive' | 'debuff' | 'protection' | 'healing'

/** The fixed library of animations the engine ships — an author attaches one to an ability. */
export type AbilityAnimation =
  | 'fire-slash' | 'ice-slash' | 'cleave' // melee
  | 'bolt' | 'piercing-shot' // ranged
  | 'nova' | 'lightning' // magic
  | 'heal-glow' | 'guard-flash' // support / defense

export interface AbilityEffect {
  damage?: number
  healing?: number
  /** protection: a damage-reduction window in ms. */
  shieldMs?: number
  debuff?: { kind: 'slow' | 'poison' | 'weaken'; durationMs: number; magnitude: number }
}

/** Gates on use. Unmet `level` is treated as ALLOWED until the progress system lands (see docs). */
export interface AbilityRequirement {
  level?: number
  weaponKind?: string
}

export interface AbilityDef {
  id: string
  name: string
  description: string
  category: AbilityCategory
  animation: AbilityAnimation
  cooldownMs: number
  requirements?: AbilityRequirement
  effect: AbilityEffect
}

/** Per-animation visual tint (the blade/bolt color) — the render reads this to recolor the swing. */
export const ABILITY_TINT: Record<AbilityAnimation, string> = {
  'fire-slash': '#ff7a2a', // red-orange
  'ice-slash': '#7fd0ff',
  cleave: '#e6ebf3',
  bolt: '#ffe9a8',
  'piercing-shot': '#cfd8e3',
  nova: '#c08cff',
  lightning: '#7ad7ff',
  'heal-glow': '#8effa0',
  'guard-flash': '#9fd3ff',
}

// ── seeded defaults (engine ships these; the editor authors more later) ──────────────

export const FIRE_SLASH: AbilityDef = {
  id: 'fire-slash',
  name: 'Fire Slash',
  description: 'A blazing melee slash — the blade burns red-orange and bites for fire damage.',
  category: 'offensive',
  animation: 'fire-slash',
  cooldownMs: 6000,
  effect: { damage: 18 },
}

export const SEEDED_ABILITIES: readonly AbilityDef[] = [FIRE_SLASH]

// ── loadout: up to 4 abilities on keys 1–4 (rebindable) ──────────────────────────────

export type AbilitySlot = 1 | 2 | 3 | 4
export interface AbilityBinding {
  slot: AbilitySlot
  key: string // the trigger key (default = the slot number); rebindable
  ability: AbilityDef
}

/** The default player loadout — v1 has just Fire Slash on slot/key 1. */
export const DEFAULT_ABILITY_LOADOUT: readonly AbilityBinding[] = [
  { slot: 1, key: '1', ability: FIRE_SLASH },
]

/** Off cooldown? (first use always allowed.) Pure. */
export function abilityReady(ability: AbilityDef, lastUsedAt: number | undefined, now: number): boolean {
  if (lastUsedAt == null) return true
  return now - lastUsedAt >= ability.cooldownMs
}

/** Does the entity meet an ability's requirements? Unmet level is allowed until the progress system
 *  exists (documented). Weapon requirement is enforced when set. Pure. */
export function meetsRequirements(ability: AbilityDef, ctx: { level?: number; weaponKind?: string }): boolean {
  const req = ability.requirements
  if (!req) return true
  if (req.weaponKind && ctx.weaponKind !== req.weaponKind) return false
  // level gate intentionally NOT enforced yet — see docs/ability-system.md (progress system).
  return true
}

/** Find the binding triggered by a key in a loadout, or undefined. Pure. */
export function bindingForKey(loadout: readonly AbilityBinding[], key: string): AbilityBinding | undefined {
  return loadout.find(b => b.key === key)
}
