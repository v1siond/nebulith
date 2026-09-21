/**
 * TilePose, the per-tile positioning data that lives in the backend tileset (deviations-only).
 *
 * ONE transform, read by every renderer: a held weapon (anchor = the hand), a ground/prop tile
 * (anchor = the cell centre), and, via `muzzle`, where a projectile leaves a weapon. `dx/dy/rot/scale`
 * are deliberately the SAME fields `cellAnimation.AnimTransform` uses (rot in radians), so a Phase-2
 * animation keyframe is this exact shape. Absent pose or field = default → `applyPose` is a no-op, so an
 * unposed tile renders byte-identically to before this system existed.
 */
export interface TilePose {
  /** Offset from the anchor along the facing axis, as a fraction of one tile unit (+ = forward/right). */
  dx?: number
  /** Offset from the anchor, fraction of one tile unit (+ = down). */
  dy?: number
  /** Rotation in RADIANS (AnimTransform parity; the editor slider works in degrees). */
  rot?: number
  /** Mirror horizontally, applied together with the facing direction (flip XOR left-facing). */
  flip?: boolean
  /** Uniform size multiplier (1 = native). */
  scale?: number
  /** WEAPONS ONLY: fraction along the shot's path where the projectile exits the weapon (null = melee). */
  muzzle?: number | null
  /** Base colour override (hex); null/absent = the tile's own `color`. */
  color?: string | null
}

/**
 * DOES THIS POSE MOVE ANYTHING?
 *
 * A placement states its pose now rather than leaving it absent, so `if (asset.pose)` stopped meaning
 * "this tile is nudged" and started meaning "this tile exists". Every renderer that asked that question
 * then took the transform branch for the whole map: a save, a transform push and a pop per tile per
 * frame, for an identity transform.
 *
 * The rule the whole engine now needs: a stated default must read exactly like silence. So the question
 * is asked of the VALUES.
 */
export function poseDeviates(pose?: TilePose | null): boolean {
  if (!pose) return false

  return (
    (pose.dx ?? 0) !== 0 ||
    (pose.dy ?? 0) !== 0 ||
    (pose.rot ?? 0) !== 0 ||
    pose.flip === true ||
    (pose.scale ?? 1) !== 1 ||
    typeof pose.color === 'string'
  )
}

/**
 * THE POSE, STATED IN FULL.
 *
 * The identity values, with whatever was authored on top. A stamped tile used to carry `{dy: -0.11}`
 * and the same tile read back off the wire carried all five fields, so the two were never comparable
 * and a map could differ after a reload without anything noticing.
 *
 * Free to do now: `poseDeviates` asks the values, so a full pose of identity numbers costs no transform.
 */
export function statedPose(pose?: TilePose | null): TilePose {
  const out: TilePose = {
    dx: pose?.dx ?? 0,
    dy: pose?.dy ?? 0,
    rot: pose?.rot ?? 0,
    flip: pose?.flip === true,
    scale: pose?.scale ?? 1,
  }
  // The two that are genuinely nullable: a melee weapon has no muzzle and most tiles override no colour.
  if (typeof pose?.muzzle === 'number') out.muzzle = pose.muzzle
  if (typeof pose?.color === 'string') out.color = pose.color

  return out
}

/** The spatial fields resolved to concrete numbers, absent pose/field → identity. */
export interface ResolvedPose {
  dx: number
  dy: number
  rot: number
  flip: boolean
  scale: number
}

export function resolvePose(pose?: TilePose | null): ResolvedPose {
  return {
    dx: pose?.dx ?? 0,
    dy: pose?.dy ?? 0,
    rot: pose?.rot ?? 0,
    flip: pose?.flip ?? false,
    scale: pose?.scale ?? 1,
  }
}

/**
 * Apply a tile's pose to `ctx`, which the caller has ALREADY translated to the anchor (hand / cell centre)
 * and `save`d. Order: mirror (flip XOR left-facing) → rotate → offset (dx,dy × `unit` px) → uniform scale.
 * The caller then draws the glyph/image at the origin and `restore`s. `unit` = pixels-per-tile-unit for
 * the active view. An absent/identity pose emits no transform ops, so the render is unchanged.
 */
export function applyPose(ctx: CanvasRenderingContext2D, pose: TilePose | null | undefined, facingDir: number, unit: number): void {
  const p = resolvePose(pose)
  if (p.flip !== facingDir < 0) ctx.scale(-1, 1) // mirror when exactly one of {flip, left-facing} holds
  if (p.rot !== 0) ctx.rotate(p.rot)
  if (p.dx !== 0 || p.dy !== 0) ctx.translate(p.dx * unit, p.dy * unit)
  if (p.scale !== 1) ctx.scale(p.scale, p.scale)
}
