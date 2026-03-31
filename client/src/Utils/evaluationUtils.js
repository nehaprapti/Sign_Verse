/**
 * SignVerse Evaluation Engine - Pose Comparison Utilities
 *
 * Provides reusable functions for comparing expected vs actual avatar
 * bone rotations, computing per-joint error metrics, and determining
 * pass/fail verdicts against configurable tolerances.
 */

// ---------------------------------------------------------------------------
// Tolerance constants (degrees).  Keep configurable via import.
// ---------------------------------------------------------------------------

export const DEFAULT_AVG_TOLERANCE_DEG = 5;
export const DEFAULT_MAX_TOLERANCE_DEG = 10;

// ---------------------------------------------------------------------------
// Angle helpers
// ---------------------------------------------------------------------------

/**
 * Convert radians to degrees.
 */
export const radToDeg = (rad) => (rad * 180) / Math.PI;

/**
 * Convert degrees to radians.
 */
export const degToRad = (deg) => (deg * Math.PI) / 180;

/**
 * Compute the shortest-arc angular delta between two angles (both in radians).
 * Returns the absolute delta in **degrees**, correctly handling wrap-around
 * (e.g. 179° vs -179° → 2°).
 */
export const normalizeAngleDeltaDeg = (a, b) => {
  let delta = a - b;

  // Normalize into (-π, π]
  while (delta > Math.PI) {
    delta -= Math.PI * 2;
  }
  while (delta < -Math.PI) {
    delta += Math.PI * 2;
  }

  return Math.abs(radToDeg(delta));
};

// ---------------------------------------------------------------------------
// Joint-level comparison
// ---------------------------------------------------------------------------

/**
 * Compare a single rotation vector {x, y, z} (in radians) and return per-axis
 * error in degrees.  Returns null when both inputs are missing.
 */
export const compareRotation = (expected, actual) => {
  if (!expected && !actual) {
    return null;
  }

  const safeExpected = expected || { x: 0, y: 0, z: 0 };
  const safeActual = actual || { x: 0, y: 0, z: 0 };

  const dx = normalizeAngleDeltaDeg(safeExpected.x, safeActual.x);
  const dy = normalizeAngleDeltaDeg(safeExpected.y, safeActual.y);
  const dz = normalizeAngleDeltaDeg(safeExpected.z, safeActual.z);

  return {
    x: dx,
    y: dy,
    z: dz,
    maxAxis: Math.max(dx, dy, dz),
    avgAxis: (dx + dy + dz) / 3,
  };
};

// ---------------------------------------------------------------------------
// Pose-level comparison
// ---------------------------------------------------------------------------

/**
 * Compare an expected full pose snapshot against an actual snapshot read back
 * from the avatar runtime.
 *
 * Both snapshots follow the shape:
 *   { leftHand: { arm, forearm, hand, fingers: { ... } },
 *     rightHand: { arm, forearm, hand, fingers: { ... } } }
 *
 * Returns an object:
 *   {
 *     joints: [ { name, errorDeg: { x, y, z, maxAxis, avgAxis } } ],
 *     averageErrorDegrees: Number,
 *     maxErrorDegrees: Number,
 *     failedJoints: [ { name, errorDeg } ],   // joints exceeding tolerance
 *   }
 */
export const computePoseError = (expectedSnapshot, actualSnapshot, maxJointToleranceDeg = DEFAULT_MAX_TOLERANCE_DEG) => {
  const joints = [];

  const sides = [
    { key: 'leftHand', label: 'L' },
    { key: 'rightHand', label: 'R' },
  ];

  for (const side of sides) {
    const expectedHand = expectedSnapshot?.[side.key] || {};
    const actualHand = actualSnapshot?.[side.key] || {};

    // Compare arm, forearm, hand rotations
    for (const part of ['arm', 'forearm', 'hand']) {
      const error = compareRotation(expectedHand[part], actualHand[part]);
      if (error) {
        joints.push({ name: `${side.label}_${part}`, errorDeg: error });
      }
    }

    // Compare finger joints
    const expectedFingers = expectedHand.fingers || {};
    const actualFingers = actualHand.fingers || {};
    const fingerJointNames = new Set([
      ...Object.keys(expectedFingers),
      ...Object.keys(actualFingers),
    ]);

    for (const jointName of fingerJointNames) {
      const error = compareRotation(expectedFingers[jointName], actualFingers[jointName]);
      if (error) {
        joints.push({ name: `${side.label}_${jointName}`, errorDeg: error });
      }
    }
  }

  if (joints.length === 0) {
    return {
      joints: [],
      averageErrorDegrees: 0,
      maxErrorDegrees: 0,
      failedJoints: [],
    };
  }

  const allAvgErrors = joints.map((j) => j.errorDeg.avgAxis);
  const allMaxErrors = joints.map((j) => j.errorDeg.maxAxis);

  const averageErrorDegrees = allAvgErrors.reduce((s, v) => s + v, 0) / allAvgErrors.length;
  const maxErrorDegrees = Math.max(...allMaxErrors);

  const failedJoints = joints.filter((j) => j.errorDeg.maxAxis > maxJointToleranceDeg);

  return {
    joints,
    averageErrorDegrees: Number(averageErrorDegrees.toFixed(2)),
    maxErrorDegrees: Number(maxErrorDegrees.toFixed(2)),
    failedJoints,
  };
};

// ---------------------------------------------------------------------------
// Tolerance verdict
// ---------------------------------------------------------------------------

/**
 * Evaluate a pose error result against tolerance thresholds.
 *
 * @param {Object} errorResult - output of computePoseError
 * @param {number} avgToleranceDeg - max allowed average error (degrees)
 * @param {number} maxToleranceDeg - max allowed single-joint error (degrees)
 * @returns {boolean} true when the pose passes within tolerance
 */
export const evaluatePoseAgainstTolerance = (
  errorResult,
  avgToleranceDeg = DEFAULT_AVG_TOLERANCE_DEG,
  maxToleranceDeg = DEFAULT_MAX_TOLERANCE_DEG,
) => {
  if (!errorResult) {
    return false;
  }

  return (
    errorResult.averageErrorDegrees <= avgToleranceDeg &&
    errorResult.maxErrorDegrees <= maxToleranceDeg
  );
};

// ---------------------------------------------------------------------------
// Summary builder
// ---------------------------------------------------------------------------

/**
 * Build a summary object from an array of per-pose evaluation results.
 *
 * Each element of `poseResults` should be:
 *   {
 *     poseName, expectedPoseIndex, averageErrorDegrees, maxErrorDegrees,
 *     pass, failedJoints
 *   }
 *
 * Returns:
 *   { totalPoses, passedPoses, failedPoses, overallPass,
 *     avgToleranceUsed, maxToleranceUsed, results }
 */
export const buildEvaluationSummary = (
  poseResults,
  avgToleranceDeg = DEFAULT_AVG_TOLERANCE_DEG,
  maxToleranceDeg = DEFAULT_MAX_TOLERANCE_DEG,
) => {
  const totalPoses = poseResults.length;
  const passedPoses = poseResults.filter((r) => r.pass).length;
  const failedPoses = totalPoses - passedPoses;

  return {
    totalPoses,
    passedPoses,
    failedPoses,
    overallPass: failedPoses === 0,
    avgToleranceUsed: avgToleranceDeg,
    maxToleranceUsed: maxToleranceDeg,
    results: poseResults,
  };
};

// ---------------------------------------------------------------------------
// JSON schema validation helper
// ---------------------------------------------------------------------------

/**
 * Validate that a parsed JSON payload contains the expected move-list schema.
 * Returns { valid: boolean, error?: string }.
 */
export const validateMoveListSchema = (payload) => {
  if (!payload || typeof payload !== 'object') {
    return { valid: false, error: 'Payload is not a valid object.' };
  }

  if (!payload.move && !payload.word) {
    return { valid: false, error: 'Missing "move" or "word" field.' };
  }

  if (!Array.isArray(payload.poses) || payload.poses.length === 0) {
    return { valid: false, error: 'Missing or empty "poses" array.' };
  }

  for (let i = 0; i < payload.poses.length; i++) {
    const pose = payload.poses[i];
    if (!pose.snapshot) {
      return { valid: false, error: `Pose at index ${i} missing "snapshot".` };
    }
  }

  return { valid: true };
};
