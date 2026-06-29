/**
 * ABILITIES — the data-driven model behind the combat ability system (see docs/ability-system.md).
 *
 * The engine seeds a library of ability ANIMATIONS; an ability is composed by attaching one of them
 * to data (category, cooldown, requirements, effect magnitudes). Entities equip up to 4, bound to
 * keys 1–4. Pure module: no rendering, no React — the play loop reads these + the cooldown helper.
 *
 * The engine seeds a database of abilities spanning every category (offensive melee/ranged, defensive,
 * protection, debuff, healing); the inventory's "browse abilities" modal lists them and assigns one
 * into a slot. Adding/editing an ability is one const + one line in ABILITY_REGISTRY — the lookup and
 * loadout helpers stay untouched, so the editor + progress system can plug in later without reshaping
 * this.
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

// ── the ability REGISTRY (the database) ──────────────────────────────────────────────
// The engine seeds these; the author assigns them into slots and (later) edits/adds more.
// Adding a new ability is just one const + one line in ABILITY_REGISTRY — no other wiring.
// Keep VARIETY: at least one per category so there's something real to assign.

/** Offensive melee — the blade burns red-orange and bites for fire damage. */
export const FIRE_SLASH: AbilityDef = {
  id: 'fire-slash',
  name: 'Fire Slash',
  description: 'A blazing melee slash — the blade burns red-orange and bites for fire damage.',
  category: 'offensive',
  animation: 'fire-slash',
  cooldownMs: 6000,
  effect: { damage: 18 },
}

/** Offensive ranged — a heavy piercing bolt that hits harder than the basic shot. */
export const POWER_SHOT: AbilityDef = {
  id: 'power-shot',
  name: 'Power Shot',
  description: 'A drawn-back piercing bolt — slower to ready, but it punches through for big damage.',
  category: 'offensive',
  animation: 'piercing-shot',
  cooldownMs: 8000,
  effect: { damage: 26 },
}

/** Defensive — a brief shield-flash window that soaks incoming damage. */
export const GUARD: AbilityDef = {
  id: 'guard',
  name: 'Guard',
  description: 'Raise a flash-guard for a few seconds, cutting the damage you take.',
  category: 'defensive',
  animation: 'guard-flash',
  cooldownMs: 12000,
  effect: { shieldMs: 4000 },
}

/** Debuff — an icy slash that chills the target, slowing it for a few seconds. */
export const FROST: AbilityDef = {
  id: 'frost',
  name: 'Frost',
  description: 'An icy slash that chills the target — it crawls (slowed) for a few seconds.',
  category: 'debuff',
  animation: 'ice-slash',
  cooldownMs: 9000,
  effect: { damage: 8, debuff: { kind: 'slow', durationMs: 3000, magnitude: 0.4 } },
}

/** Offensive melee — a wide two-handed swing that cleaves for heavy physical damage. */
export const CLEAVE: AbilityDef = {
  id: 'cleave',
  name: 'Cleave',
  description: 'A wide, two-handed swing that cleaves through for heavy physical damage.',
  category: 'offensive',
  animation: 'cleave',
  cooldownMs: 7000,
  effect: { damage: 22 },
}

/** Offensive ranged (magic) — a fast arcane bolt that snaps out for steady damage. */
export const ARCANE_BOLT: AbilityDef = {
  id: 'arcane-bolt',
  name: 'Arcane Bolt',
  description: 'A quick bolt of raw arcane force — short cooldown, reliable ranged damage.',
  category: 'offensive',
  animation: 'bolt',
  cooldownMs: 5000,
  effect: { damage: 20 },
}

/** Offensive (magic burst) — a violet nova that detonates around you for big damage. */
export const NOVA_BURST: AbilityDef = {
  id: 'nova-burst',
  name: 'Nova Burst',
  description: 'A violet nova that detonates around you — slow to charge, hits hard.',
  category: 'offensive',
  animation: 'nova',
  cooldownMs: 14000,
  effect: { damage: 30 },
}

/** Offensive (magic) — a forked bolt of lightning that arcs into the target. */
export const CHAIN_LIGHTNING: AbilityDef = {
  id: 'chain-lightning',
  name: 'Chain Lightning',
  description: 'A forked bolt of lightning that arcs into the target for strong shock damage.',
  category: 'offensive',
  animation: 'lightning',
  cooldownMs: 11000,
  effect: { damage: 24 },
}

/** Protection — a heavy bulwark that holds a long damage-soak window (longer than Guard). */
export const BULWARK: AbilityDef = {
  id: 'bulwark',
  name: 'Bulwark',
  description: 'Brace behind a heavy bulwark — a long window that soaks most incoming damage.',
  category: 'protection',
  animation: 'guard-flash',
  cooldownMs: 16000,
  effect: { shieldMs: 6000 },
}

/** Debuff — a venom-tipped shot: light damage now, poison ticking after. */
export const POISON_DART: AbilityDef = {
  id: 'poison-dart',
  name: 'Poison Dart',
  description: 'A venom-tipped shot — light hit up front, then poison eats away at the target.',
  category: 'debuff',
  animation: 'piercing-shot',
  cooldownMs: 8000,
  effect: { damage: 6, debuff: { kind: 'poison', durationMs: 5000, magnitude: 4 } },
}

/** Debuff — an enfeebling pulse that weakens the target's hits for a while. */
export const ENFEEBLE: AbilityDef = {
  id: 'enfeeble',
  name: 'Enfeeble',
  description: 'A draining pulse that weakens the target — its blows land softer for a while.',
  category: 'debuff',
  animation: 'nova',
  cooldownMs: 10000,
  effect: { debuff: { kind: 'weaken', durationMs: 6000, magnitude: 0.3 } },
}

/** Healing — a burst of restorative light that mends a solid chunk of HP. */
export const MEND: AbilityDef = {
  id: 'mend',
  name: 'Mend',
  description: 'A burst of restorative light — mends a solid chunk of your health.',
  category: 'healing',
  animation: 'heal-glow',
  cooldownMs: 10000,
  effect: { healing: 25 },
}

/** Healing — a quick, low-cooldown top-up of health when you need it fast. */
export const RENEW: AbilityDef = {
  id: 'renew',
  name: 'Renew',
  description: 'A quick top-up of health on a short cooldown — small, but always ready.',
  category: 'healing',
  animation: 'heal-glow',
  cooldownMs: 7000,
  effect: { healing: 14 },
}

/** The seeded ability database the UI reads to populate the browse-abilities modal. Add/update =
 *  edit a def + this list; the lookup + loadout helpers stay untouched. Spans every category. */
export const ABILITY_REGISTRY: readonly AbilityDef[] = [
  FIRE_SLASH, CLEAVE, // offensive melee
  POWER_SHOT, ARCANE_BOLT, NOVA_BURST, CHAIN_LIGHTNING, // offensive ranged / magic
  GUARD, // defensive
  BULWARK, // protection
  FROST, POISON_DART, ENFEEBLE, // debuff
  MEND, RENEW, // healing
]

/** Look an ability up by id (round-trips with ABILITY_REGISTRY). Pure. */
export function getAbility(id: string): AbilityDef | undefined {
  return ABILITY_REGISTRY.find(a => a.id === id)
}

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

// ── editing a loadout: assign / remove abilities by slot (the configurable bit) ────────

/** Every slot, in HUD + key order — what the inventory UI and the action bar iterate. */
export const ABILITY_SLOTS: readonly AbilitySlot[] = [1, 2, 3, 4]

/** The binding occupying a slot, or undefined. Pure. */
export function bindingForSlot(loadout: readonly AbilityBinding[], slot: AbilitySlot): AbilityBinding | undefined {
  return loadout.find(b => b.slot === slot)
}

/** Put an ability into a slot (key defaults to the slot number), replacing any current
 *  occupant. Returns a NEW loadout (slot-ordered); input untouched. Pure. */
export function assignAbility(
  loadout: readonly AbilityBinding[],
  slot: AbilitySlot,
  ability: AbilityDef,
): AbilityBinding[] {
  const rest = loadout.filter(b => b.slot !== slot)
  return [...rest, { slot, key: String(slot), ability }].sort((a, b) => a.slot - b.slot)
}

/** Take whatever ability is in a slot back out. Returns a NEW loadout; input untouched. Pure. */
export function removeAbility(loadout: readonly AbilityBinding[], slot: AbilitySlot): AbilityBinding[] {
  return loadout.filter(b => b.slot !== slot)
}

/** Rebind the trigger KEY of the binding in `slot` (abilities are user-keyed; they default to
 *  1–4 but the player can map any key). If another binding already holds `key`, the two SWAP keys
 *  so every binding keeps a unique trigger — that's what keeps the ability and special-action sets
 *  from silently colliding. No-op if the slot is empty. Returns a NEW slot-ordered loadout; input
 *  untouched. Pure. */
export function rebindAbility(
  loadout: readonly AbilityBinding[],
  slot: AbilitySlot,
  key: string,
): AbilityBinding[] {
  const target = loadout.find(b => b.slot === slot)
  if (!target || target.key === key) return [...loadout].sort((a, b) => a.slot - b.slot)
  const oldKey = target.key
  return loadout
    .map(b => {
      if (b.slot === slot) return { ...b, key }
      if (b.key === key) return { ...b, key: oldKey } // swap so keys stay unique
      return b
    })
    .sort((a, b) => a.slot - b.slot)
}
