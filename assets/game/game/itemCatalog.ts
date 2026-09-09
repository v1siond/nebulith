/**
 * THE ITEM CATALOG, from the backend (`GET /api/items`) — §3.14b's #1 violation, closed.
 *
 * `game/gear.ts` used to DECLARE the catalog: 6 weapons, 10 armour pieces and 5 consumables with complete
 * stat blocks (`baseDamage: 12, baseDefense: 2, strengthBonus: 3, reachCells: 1`) plus the two starter
 * kits, in a file nothing validated. Alexander, 2026-09-08: *"all hardcoded data of the frontend moved to
 * the elixir backend … pretty much everything that is DATA or depends on DATA"*.
 *
 * This module owns the load and the shape conversion; `gear.ts` became a reader over it. The rule that
 * makes it honest: an EMPTY catalog is empty. Nothing here invents a fallback sword — a failed load means
 * the bag has no items to offer, exactly as an unreachable tileset means no tiles, and the UI says so.
 */
import { NEBULITH_API } from '@/lib/nebulithApi'
import type { Item, Weapon, Armor, ConsumableEffect, GearSlot, WeaponKind, ArmorKind } from './types'

/** One row as `/api/items` serves it. `stats` is the block, shaped by `slot`. */
interface ApiItem {
  slug: string
  name: string
  slot: 'weapon' | 'armor' | 'consumable'
  kind: string | null
  stats: Record<string, unknown>
  starterKits: string[]
}

/** The loaded catalog, and which kits each item belongs to. Empty until the backend answers. */
let CATALOG: readonly Item[] = []
let KITS: Readonly<Record<string, readonly string[]>> = {}

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)

/** A served row → the `Item` the loadout system already speaks. One conversion point. */
function toItem(row: ApiItem): Item | null {
  if (row.slot === 'weapon') {
    const weapon: Weapon = {
      id: row.slug,
      kind: (row.kind ?? 'sword') as WeaponKind,
      name: row.name,
      baseDamage: num(row.stats.baseDamage),
      baseMagic: num(row.stats.baseMagic),
      baseDefense: num(row.stats.baseDefense),
      strengthBonus: num(row.stats.strengthBonus),
      intBonus: num(row.stats.intBonus),
      school: str(row.stats.school, 'physical') as Weapon['school'],
      range: str(row.stats.range, 'melee') as Weapon['range'],
      hands: num(row.stats.hands, 1) as Weapon['hands'],
      reachCells: num(row.stats.reachCells, 1),
      ...(typeof row.stats.blockChance === 'number' ? { blockChance: row.stats.blockChance } : {}),
    }
    return { id: row.slug, name: row.name, slot: 'weapon', weapon }
  }

  if (row.slot === 'armor') {
    const armor: Armor = {
      id: row.slug,
      kind: (row.kind ?? 'leather') as ArmorKind,
      name: row.name,
      defenseBonus: num(row.stats.defenseBonus),
      strengthBonus: num(row.stats.strengthBonus),
      intBonus: num(row.stats.intBonus),
      slot: str(row.stats.slot, 'chest') as GearSlot,
      ...(typeof row.stats.dodgeBonus === 'number' ? { dodgeBonus: row.stats.dodgeBonus } : {}),
    }
    return { id: row.slug, name: row.name, slot: 'armor', armor }
  }

  if (row.slot === 'consumable') {
    return { id: row.slug, name: row.name, slot: 'consumable', effect: row.stats as ConsumableEffect }
  }

  // A slot the frontend does not know how to build is DROPPED, not guessed at — a half-built item would
  // read as a real one in the bag.
  return null
}

/** Install a served payload (also the seam tests use, so they need no network). */
export function installItemCatalog(rows: readonly ApiItem[]): void {
  const items: Item[] = []
  const kits: Record<string, string[]> = {}
  for (const row of rows) {
    const item = toItem(row)
    if (!item) continue
    items.push(item)
    kits[item.id] = row.starterKits ?? []
  }
  CATALOG = items
  KITS = kits
}

export async function loadItemCatalog(): Promise<number> {
  try {
    const res = await fetch(`${NEBULITH_API}/items`, { headers: { accept: 'application/json' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = (await res.json()) as { data?: ApiItem[] }
    installItemCatalog(body.data ?? [])
    return CATALOG.length
  } catch (error) {
    // Say it and stay empty. A fallback catalog would put items in the bag the backend does not have.
    console.warn('Failed to load the item catalog', error)
    return 0
  }
}

/**
 * Every item the catalog serves. FRESH copies each call — the loadout system moves items between slots by
 * reference, and handing out the cached object would alias one item into two places.
 */
export function itemCatalog(): Item[] {
  return CATALOG.map(cloneItem)
}

/** One item by its slug, or undefined when the catalog has no such row. */
export function itemBySlug(slug: string): Item | undefined {
  const found = CATALOG.find(i => i.id === slug)
  return found ? cloneItem(found) : undefined
}

/** The items a starter kit contains, in catalog order. */
export function starterKit(kit: string): Item[] {
  return CATALOG.filter(i => KITS[i.id]?.includes(kit)).map(cloneItem)
}

/**
 * A DEEP copy of one item.
 *
 * `Item` is a discriminated union, so the nested block is named differently per variant — and the copy has
 * to be deep: the loadout system moves items between slots by reference, so two slots holding the same
 * `weapon` object would edit each other.
 */
function cloneItem(item: Item): Item {
  if (item.slot === 'weapon') return { ...item, weapon: { ...item.weapon } }
  if (item.slot === 'armor') return { ...item, armor: { ...item.armor } }
  return { ...item, effect: { ...item.effect } }
}
