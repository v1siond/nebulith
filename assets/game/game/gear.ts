/**
 * GEAR — a READER over the backend item catalog (§3.14b #1, closed 2026-09-08).
 *
 * This file used to BE the catalog: 6 weapons, 10 armour pieces and 5 consumables with complete stat blocks
 * (`baseDamage: 12, baseDefense: 2, strengthBonus: 3, reachCells: 1`) plus the two starter kits, ~105 lines
 * of game data in the frontend with nothing validating it. Alexander, 2026-09-08: *"all hardcoded data of
 * the frontend moved to the elixir backend … pretty much everything that is DATA or depends on DATA"*.
 *
 * The rows now live in nebulith's `items` table and arrive via `GET /api/items` (`game/itemCatalog.ts`).
 * What stays here is the NAMED ACCESS the game already used — `sword()`, `starterWarriorGear()` — so every
 * call site keeps its shape while the numbers come from the catalog.
 *
 * Each accessor returns a FRESH object (the catalog clones), so callers never share a mutable reference and
 * can equip the same item into two slots without aliasing. An accessor for a slug the catalog does not
 * serve returns `undefined` rather than a stand-in: an invented sword would read as a real one.
 */
import { itemBySlug, itemCatalog, starterKit } from './itemCatalog'
import type { Item } from './types'

// ── weapons ─────────────────────────────────────────────────────────
export const sword = (): Item | undefined => itemBySlug('wpn_sword')
export const axe = (): Item | undefined => itemBySlug('wpn_axe')
export const bow = (): Item | undefined => itemBySlug('wpn_bow')
export const gun = (): Item | undefined => itemBySlug('wpn_gun')
export const staff = (): Item | undefined => itemBySlug('wpn_staff')
export const shield = (): Item | undefined => itemBySlug('wpn_shield')

// ── armor / clothes (covers every GearSlot) ─────────────────────────
export const ironHelmet = (): Item | undefined => itemBySlug('arm_helmet_iron')
export const ironChest = (): Item | undefined => itemBySlug('arm_chest_iron')
export const leatherChest = (): Item | undefined => itemBySlug('arm_chest_leather')
export const ironGloves = (): Item | undefined => itemBySlug('arm_gloves_iron')
export const leatherGloves = (): Item | undefined => itemBySlug('arm_gloves_leather')
export const ironBoots = (): Item | undefined => itemBySlug('arm_boots_iron')
export const leatherBoots = (): Item | undefined => itemBySlug('arm_boots_leather')
export const dodgeRing = (): Item | undefined => itemBySlug('arm_ring_dodge')
export const focusRing = (): Item | undefined => itemBySlug('arm_ring_focus')
export const amulet = (): Item | undefined => itemBySlug('arm_neck_amulet')

// ── consumables / special items ─────────────────────────────────────
export const healthPotion = (): Item | undefined => itemBySlug('itm_potion_hp')
export const manaPotion = (): Item | undefined => itemBySlug('itm_potion_mana')
export const rageTonic = (): Item | undefined => itemBySlug('itm_tonic_rage')
export const bomb = (): Item | undefined => itemBySlug('itm_bomb')
export const teleportScroll = (): Item | undefined => itemBySlug('itm_scroll_teleport')

/**
 * Everything the catalog serves, in its order.
 *
 * A FUNCTION, not a const: the catalog arrives over the network, so a module-level array would be captured
 * empty at import time and stay empty forever. Every reader calls this when it renders.
 */
export const gearCatalog = (): Item[] => itemCatalog()

/**
 * A starter kit's items.
 *
 * Which items a kit contains is DATA — each row names the kits it belongs to (`starter_kits`) — so the
 * warrior's sword-and-shield is a catalog fact rather than a second hardcoded list here.
 */
export const starterWarriorGear = (): Item[] => starterKit('warrior')
export const starterMageGear = (): Item[] => starterKit('magician')
