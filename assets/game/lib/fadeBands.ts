/**
 * HOW FAR A THING FADES NEAR THE HERO, served by the backend.
 *
 * These four numbers were `export const` in `engine/render/roofReveal.ts`. The report that moved them:
 * *"we have like a range transparency on the units/elements but I don't see any place to manage or edit
 * it"*. There was nowhere because a value invented in React has no row to point a control at, which is
 * law 7 (*the backend decides values, the frontend renders them*) and law 12 (*the frontend sets no
 * limits*) predicting the same missing panel.
 *
 * They live on `game_settings`, beside the map ceiling and the discovery radius, and travel with the map
 * so the editor gets them without having to know which game it is in. A map that belongs to no game gets
 * the COLUMN's own defaults from the backend, not a copy of them kept here.
 *
 * `roofReveal` stays pure and takes them as an argument. This module is the one place that holds what
 * was served, and the renderers read it through a function at draw time rather than freezing it into a
 * module-level const at import time.
 */

/** The four, in the column spellings the backend serves. */
export interface FadeBands {
  /** Beyond this many cells a thing is fully solid. */
  fade_radius: number
  /** Within this many it holds FLAT at its most transparent. */
  fade_full_radius: number
  /** How opaque the close band draws. */
  fade_alpha: number
  /** How opaque a shell draws while the hero is standing inside it. */
  interior_alpha: number
}

let served: FadeBands | null = null

/**
 * The four out of any payload that carries them, as numbers, or null when one is missing.
 *
 * Decimals arrive as strings (Postgres numeric, serialised exactly), so the conversion happens once,
 * here, rather than in a draw loop. A HALF-STATED set is null rather than partly filled, because
 * completing it would take a literal and a literal is the thing being removed. One parser, so the panel's
 * state and the renderer's values cannot read the same row differently.
 */
export function bandsFrom(
  payload: Partial<Record<keyof FadeBands, unknown>> | null | undefined,
): FadeBands | null {
  if (!payload) return null

  const bands = {
    fade_radius: Number(payload.fade_radius),
    fade_full_radius: Number(payload.fade_full_radius),
    fade_alpha: Number(payload.fade_alpha),
    interior_alpha: Number(payload.interior_alpha),
  }

  if (Object.values(bands).some((n) => !Number.isFinite(n))) return null

  return bands
}

/** Installs what a payload carried. A payload missing any of the four changes nothing. */
export function installFadeBands(payload: Partial<Record<keyof FadeBands, unknown>> | null | undefined): void {
  const bands = bandsFrom(payload)
  if (!bands) return

  served = bands
  if (typeof window !== 'undefined') {
    ;(window as unknown as { __nebulithFadeBands?: FadeBands }).__nebulithFadeBands = bands
  }
}

/**
 * The bands as served, or null before a map has loaded.
 *
 * Null means NOTHING FADES, which every caller implements by drawing solid. That is the honest answer
 * and it is visible: a rule that has not arrived is not applied. The alternative is this file holding
 * the four numbers as a "meanwhile", which is where they started.
 */
export function fadeBands(): FadeBands | null {
  return served
}

/** Forget them, so a test starts from nothing rather than from the last test's map. */
export function clearFadeBands(): void {
  served = null
}
