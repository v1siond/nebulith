/**
 * Standard Animation Keyframes for Skeleton-based Animation
 *
 * Based on animation principles and biomechanics.
 * Coordinates are in normalized 0-1 space.
 *
 * Pixellab skeleton labels:
 * NOSE, NECK, LEFT/RIGHT SHOULDER, LEFT/RIGHT ELBOW, LEFT/RIGHT ARM (wrist),
 * LEFT/RIGHT HIP, LEFT/RIGHT KNEE, LEFT/RIGHT LEG (ankle),
 * LEFT/RIGHT EYE, LEFT/RIGHT EAR
 */

export type SkeletonPoint = {
  x: number
  y: number
  label: string
  z_index?: number
}

export type PoseOffset = {
  [label: string]: { x: number; y: number }
}

/**
 * Apply pose offsets to a base skeleton
 */
export function applyPoseToSkeleton(
  baseSkeleton: SkeletonPoint[],
  poseOffset: PoseOffset
): SkeletonPoint[] {
  return baseSkeleton.map(point => {
    const offset = poseOffset[point.label.toUpperCase()] || { x: 0, y: 0 }
    return {
      ...point,
      x: Math.max(0, Math.min(1, point.x + offset.x)),
      y: Math.max(0, Math.min(1, point.y + offset.y)),
    }
  })
}

/**
 * Generate keyframes for an animation action
 * Returns 3 poses that Pixellab will interpolate into 4 frames
 */
export function getAnimationKeyframes(
  baseSkeleton: SkeletonPoint[],
  action: string
): SkeletonPoint[][] {
  const poses = ANIMATION_POSES[action] || ANIMATION_POSES.idle
  return poses.map(pose => applyPoseToSkeleton(baseSkeleton, pose))
}

/**
 * Standard animation poses
 * Each animation has 3 key poses that define the motion
 *
 * Run cycle phases:
 * 1. Contact - front foot hits ground, back foot lifting
 * 2. Pass - legs pass each other, airborne moment
 * 3. Contact (opposite) - other foot hits ground
 */
export const ANIMATION_POSES: Record<string, PoseOffset[]> = {
  // RUNNING - 4-frame looping cycle
  // API takes 3 poses → generates 4 frames with interpolation
  // For smooth loop: pose3 should transition back to pose1
  running: [
    // Pose 1: Right foot contact - left leg pushing off
    {
      'LEFT LEG': { x: -0.10, y: 0.02 },      // Back foot pushing
      'LEFT KNEE': { x: -0.05, y: -0.01 },
      'RIGHT LEG': { x: 0.06, y: -0.02 },     // Front foot landing
      'RIGHT KNEE': { x: 0.03, y: -0.04 },
      'LEFT ARM': { x: 0.06, y: -0.05 },      // Opposite arm forward
      'LEFT ELBOW': { x: 0.03, y: -0.03 },
      'RIGHT ARM': { x: -0.05, y: 0.01 },     // Arm back
      'RIGHT ELBOW': { x: -0.02, y: 0 },
      'LEFT HIP': { x: -0.01, y: 0 },
      'RIGHT HIP': { x: 0.01, y: 0 },
      'NECK': { x: 0.01, y: -0.01 },
      'NOSE': { x: 0.01, y: -0.01 },
    },
    // Pose 2: Left foot contact - right leg pushing off (MIRROR of pose 1)
    {
      'LEFT LEG': { x: 0.06, y: -0.02 },      // Front foot landing
      'LEFT KNEE': { x: 0.03, y: -0.04 },
      'RIGHT LEG': { x: -0.10, y: 0.02 },     // Back foot pushing
      'RIGHT KNEE': { x: -0.05, y: -0.01 },
      'LEFT ARM': { x: -0.05, y: 0.01 },      // Arm back
      'LEFT ELBOW': { x: -0.02, y: 0 },
      'RIGHT ARM': { x: 0.06, y: -0.05 },     // Opposite arm forward
      'RIGHT ELBOW': { x: 0.03, y: -0.03 },
      'LEFT HIP': { x: 0.01, y: 0 },
      'RIGHT HIP': { x: -0.01, y: 0 },
      'NECK': { x: 0.01, y: -0.01 },
      'NOSE': { x: 0.01, y: -0.01 },
    },
    // Pose 3: Back toward pose 1 (3/4 through cycle) - helps smooth loop
    {
      'LEFT LEG': { x: -0.06, y: 0.01 },      // Moving back
      'LEFT KNEE': { x: -0.03, y: -0.02 },
      'RIGHT LEG': { x: 0.04, y: -0.01 },     // Moving forward
      'RIGHT KNEE': { x: 0.02, y: -0.03 },
      'LEFT ARM': { x: 0.04, y: -0.03 },      // Arms transitioning
      'LEFT ELBOW': { x: 0.02, y: -0.02 },
      'RIGHT ARM': { x: -0.03, y: 0 },
      'RIGHT ELBOW': { x: -0.01, y: 0 },
      'LEFT HIP': { x: -0.005, y: 0 },
      'RIGHT HIP': { x: 0.005, y: 0 },
      'NECK': { x: 0.01, y: -0.01 },
      'NOSE': { x: 0.01, y: -0.01 },
    },
  ],

  // WALKING - Smaller movements, one foot always on ground
  walking: [
    // Pose 1: Right foot forward, heel strike
    {
      'LEFT LEG': { x: -0.06, y: 0.01 },
      'LEFT KNEE': { x: -0.03, y: 0 },
      'RIGHT LEG': { x: 0.05, y: -0.01 },
      'RIGHT KNEE': { x: 0.02, y: -0.02 },
      'LEFT ARM': { x: 0.04, y: -0.02 },
      'LEFT ELBOW': { x: 0.02, y: -0.01 },
      'RIGHT ARM': { x: -0.04, y: 0.01 },
      'RIGHT ELBOW': { x: -0.02, y: 0 },
      'NECK': { x: 0, y: 0 },
    },
    // Pose 2: Passing position
    {
      'LEFT LEG': { x: 0, y: -0.01 },
      'LEFT KNEE': { x: 0, y: -0.02 },
      'RIGHT LEG': { x: 0, y: -0.01 },
      'RIGHT KNEE': { x: 0, y: -0.02 },
      'LEFT ARM': { x: 0, y: -0.01 },
      'LEFT ELBOW': { x: 0, y: 0 },
      'RIGHT ARM': { x: 0, y: -0.01 },
      'RIGHT ELBOW': { x: 0, y: 0 },
      'NECK': { x: 0, y: 0.005 },
    },
    // Pose 3: Left foot forward
    {
      'LEFT LEG': { x: 0.05, y: -0.01 },
      'LEFT KNEE': { x: 0.02, y: -0.02 },
      'RIGHT LEG': { x: -0.06, y: 0.01 },
      'RIGHT KNEE': { x: -0.03, y: 0 },
      'LEFT ARM': { x: -0.04, y: 0.01 },
      'LEFT ELBOW': { x: -0.02, y: 0 },
      'RIGHT ARM': { x: 0.04, y: -0.02 },
      'RIGHT ELBOW': { x: 0.02, y: -0.01 },
      'NECK': { x: 0, y: 0 },
    },
  ],

  // IDLE - Subtle breathing/shifting weight
  idle: [
    // Neutral
    {
      'LEFT ARM': { x: 0, y: 0 },
      'RIGHT ARM': { x: 0, y: 0 },
      'NECK': { x: 0, y: 0 },
    },
    // Breathe in - chest expands slightly
    {
      'LEFT ARM': { x: -0.01, y: -0.01 },
      'RIGHT ARM': { x: 0.01, y: -0.01 },
      'LEFT SHOULDER': { x: -0.005, y: -0.01 },
      'RIGHT SHOULDER': { x: 0.005, y: -0.01 },
      'NECK': { x: 0, y: -0.01 },
      'NOSE': { x: 0, y: -0.01 },
    },
    // Breathe out
    {
      'LEFT ARM': { x: 0, y: 0.005 },
      'RIGHT ARM': { x: 0, y: 0.005 },
      'NECK': { x: 0, y: 0.005 },
    },
  ],

  // ATTACKING - Wind up, strike, follow through
  attacking: [
    // Wind up - pull arm back
    {
      'RIGHT ARM': { x: -0.15, y: -0.08 },
      'RIGHT ELBOW': { x: -0.10, y: -0.06 },
      'RIGHT SHOULDER': { x: -0.02, y: -0.02 },
      'LEFT ARM': { x: 0.04, y: 0.02 },
      'LEFT ELBOW': { x: 0.02, y: 0.01 },
      'LEFT LEG': { x: -0.03, y: 0 },
      'RIGHT LEG': { x: 0.04, y: 0 },
      'NECK': { x: -0.02, y: 0 },
      'NOSE': { x: -0.03, y: 0 },
    },
    // Strike - arm extends forward rapidly
    {
      'RIGHT ARM': { x: 0.18, y: 0.02 },
      'RIGHT ELBOW': { x: 0.12, y: 0 },
      'RIGHT SHOULDER': { x: 0.03, y: 0 },
      'LEFT ARM': { x: -0.06, y: 0 },
      'LEFT ELBOW': { x: -0.04, y: 0 },
      'LEFT LEG': { x: 0.04, y: 0 },
      'RIGHT LEG': { x: -0.02, y: 0.01 },
      'NECK': { x: 0.03, y: -0.01 },
      'NOSE': { x: 0.05, y: -0.01 },
    },
    // Follow through
    {
      'RIGHT ARM': { x: 0.10, y: 0.06 },
      'RIGHT ELBOW': { x: 0.06, y: 0.04 },
      'LEFT ARM': { x: -0.02, y: 0.02 },
      'LEFT ELBOW': { x: -0.01, y: 0.01 },
      'LEFT LEG': { x: 0.02, y: 0 },
      'RIGHT LEG': { x: -0.01, y: 0 },
      'NECK': { x: 0.02, y: 0 },
      'NOSE': { x: 0.03, y: 0 },
    },
  ],

  // JUMPING - Crouch, launch, airborne
  jumping: [
    // Crouch - prepare to jump
    {
      'LEFT LEG': { x: -0.02, y: 0.06 },
      'LEFT KNEE': { x: -0.04, y: 0.04 },
      'RIGHT LEG': { x: 0.02, y: 0.06 },
      'RIGHT KNEE': { x: 0.04, y: 0.04 },
      'LEFT HIP': { x: -0.01, y: 0.03 },
      'RIGHT HIP': { x: 0.01, y: 0.03 },
      'LEFT ARM': { x: -0.04, y: 0.04 },
      'RIGHT ARM': { x: 0.04, y: 0.04 },
      'NECK': { x: 0, y: 0.04 },
      'NOSE': { x: 0, y: 0.04 },
    },
    // Airborne - arms up, legs tucked or extended
    {
      'LEFT LEG': { x: -0.03, y: -0.10 },
      'LEFT KNEE': { x: -0.02, y: -0.08 },
      'RIGHT LEG': { x: 0.03, y: -0.08 },
      'RIGHT KNEE': { x: 0.02, y: -0.06 },
      'LEFT HIP': { x: 0, y: -0.04 },
      'RIGHT HIP': { x: 0, y: -0.04 },
      'LEFT ARM': { x: 0.06, y: -0.12 },
      'LEFT ELBOW': { x: 0.04, y: -0.10 },
      'RIGHT ARM': { x: -0.06, y: -0.12 },
      'RIGHT ELBOW': { x: -0.04, y: -0.10 },
      'NECK': { x: 0, y: -0.08 },
      'NOSE': { x: 0, y: -0.10 },
    },
    // Landing - legs absorbing impact
    {
      'LEFT LEG': { x: -0.02, y: 0.03 },
      'LEFT KNEE': { x: -0.03, y: 0.02 },
      'RIGHT LEG': { x: 0.02, y: 0.03 },
      'RIGHT KNEE': { x: 0.03, y: 0.02 },
      'LEFT HIP': { x: 0, y: 0.02 },
      'RIGHT HIP': { x: 0, y: 0.02 },
      'LEFT ARM': { x: -0.02, y: 0.02 },
      'RIGHT ARM': { x: 0.02, y: 0.02 },
      'NECK': { x: 0, y: 0.02 },
    },
  ],
}

/**
 * Get available animation types
 */
export const ANIMATION_TYPES = Object.keys(ANIMATION_POSES)
