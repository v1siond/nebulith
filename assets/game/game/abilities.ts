/**
 * ABILITIES — the data-driven model behind the combat ability system (see docs/ability-system.md).
 *
 * The engine seeds a library of ability ANIMATIONS; an ability is composed by attaching one of them
 * to data (category, cooldown, requirements, effect magnitudes). Entities equip up to 4, bound to
 * keys 1–4. Pure module: no rendering, no React — the play loop reads these + the cooldown helper.
 *
 * The BACKEND serves the registry — abilities spanning every category (offensive melee/ranged, defensive,
 * protection, debuff, healing) — and the inventory's "browse abilities" modal lists them and assigns one
 * into a slot. Adding or editing an ability is a row in nebulith's `abilities` table (§3.14b #2); the
 * lookup and loadout helpers here stay untouched, so the editor + progress system can plug in later
 * without reshaping this.
 */
import { NEBULITH_API } from '@/lib/nebulithApi'

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

/** Every animation the engine ships — TYPE data (which animations exist), not a by-product of a colour
 *  table. The per-animation COLOUR is backend tile data: each of these labels is an FX tile row carrying the
 *  tint in its own `settings`, so `abilityTint()` reads it instead of the frontend re-declaring it
 *  (§3.14b #2 — the old `ABILITY_TINT` map duplicated nine hexes the API already served, identically in both
 *  styles and across every zone). */
export const ABILITY_ANIMATIONS: readonly AbilityAnimation[] = [
  'fire-slash', 'ice-slash', 'cleave',
  'bolt', 'piercing-shot',
  'nova', 'lightning',
  'heal-glow', 'guard-flash',
]

// ── the ability REGISTRY — BACKEND DATA (§3.14b #2) ──────────────────────────────────
/**
 * The registry used to be 13 `AbilityDef` constants right here — name, description, category, cooldown and
 * effect, all frontend literals. Alexander, 2026-09-08: *"all hardcoded data of the frontend moved to the
 * elixir backend … pretty much everything that is DATA or depends on DATA"*. The rows live in nebulith's
 * `abilities` table now and arrive via `GET /api/abilities`.
 *
 * The honesty rule is the same as the tile catalog's: an unloaded registry is EMPTY. Nothing here invents a
 * Fire Slash, so the browse modal shows what the backend has and says so when it has nothing.
 *
 * There is deliberately no colour: an ability names the FX TILE it plays (`animation`), and that tile row
 * carries the tint — which is what `abilityTint()` reads. The old `ABILITY_TINT` map duplicated nine hexes
 * the API already served.
 */
let REGISTRY: readonly AbilityDef[] = []

/** One row as `/api/abilities` serves it. */
interface ApiAbility {
  slug: string
  name: string
  description: string | null
  category: string
  animation: string | null
  cooldownMs: number
  effect: AbilityEffect
}

/** Install a served payload (also the seam tests use, so they need no network). */
export function installAbilityRegistry(rows: readonly ApiAbility[]): void {
  REGISTRY = rows.map(row => ({
    id: row.slug,
    name: row.name,
    description: row.description ?? '',
    category: row.category as AbilityDef['category'],
    animation: (row.animation ?? '') as AbilityAnimation,
    cooldownMs: row.cooldownMs,
    effect: row.effect ?? {},
  }))
}

export async function loadAbilityRegistry(): Promise<number> {
  try {
    const res = await fetch(`${NEBULITH_API}/abilities`, { headers: { accept: 'application/json' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = (await res.json()) as { data?: ApiAbility[] }
    installAbilityRegistry(body.data ?? [])
    return REGISTRY.length
  } catch (error) {
    console.warn('Failed to load the ability registry', error)
    return 0
  }
}

/**
 * Every ability the backend serves, in its order.
 *
 * A FUNCTION, not a const: the registry arrives over the network, so a module-level array captured at
 * import { NEBULITH_API } from '@/lib/nebulithApi'
import { NEBULITH_API } from '@/lib/nebulithApi'
import time would be empty forever. Every reader calls this when it renders.
 */
export function abilityRegistry(): readonly AbilityDef[] {
  return REGISTRY
}

/** Look an ability up by id. Undefined when the registry has no such row — never a stand-in. */
export function getAbility(id: string): AbilityDef | undefined {
  return REGISTRY.find(a => a.id === id)
}

// ── loadout: up to 4 abilities on keys 1–4 (rebindable) ──────────────────────────────

export type AbilitySlot = 1 | 2 | 3 | 4
export interface AbilityBinding {
  slot: AbilitySlot
  key: string // the trigger key (default = the slot number); rebindable
  ability: AbilityDef
}

/**
 * The default player loadout — slot/key 1 holds the registry's FIRST ability.
 *
 * A FUNCTION over the loaded registry, not a const naming `FIRE_SLASH`: the registry is backend data now
 * (§3.14b #2), so a hardcoded default would name an ability the catalog might not serve. An EMPTY registry
 * yields an EMPTY loadout — the player simply has no ability bound yet, which is the truth.
 */
export function defaultAbilityLoadout(): readonly AbilityBinding[] {
  const first = REGISTRY[0]
  return first ? [{ slot: 1, key: '1', ability: first }] : []
}

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
