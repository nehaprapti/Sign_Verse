/**
 * Unit tests for the SignVerse Evaluation Engine utilities.
 *
 * Run with:  npm test -- --watchAll=false --testPathPattern=evaluationUtils
 */

import {
  radToDeg,
  degToRad,
  normalizeAngleDeltaDeg,
  compareRotation,
  computePoseError,
  evaluatePoseAgainstTolerance,
  buildEvaluationSummary,
  validateMoveListSchema,
  DEFAULT_AVG_TOLERANCE_DEG,
  DEFAULT_MAX_TOLERANCE_DEG,
} from './evaluationUtils';

// ---------------------------------------------------------------------------
// radToDeg / degToRad
// ---------------------------------------------------------------------------

describe('radToDeg', () => {
  it('converts 0 radians to 0 degrees', () => {
    expect(radToDeg(0)).toBe(0);
  });

  it('converts π radians to 180 degrees', () => {
    expect(radToDeg(Math.PI)).toBeCloseTo(180, 5);
  });

  it('converts π/2 radians to 90 degrees', () => {
    expect(radToDeg(Math.PI / 2)).toBeCloseTo(90, 5);
  });

  it('handles negative radians', () => {
    expect(radToDeg(-Math.PI)).toBeCloseTo(-180, 5);
  });
});

describe('degToRad', () => {
  it('converts 180 degrees to π radians', () => {
    expect(degToRad(180)).toBeCloseTo(Math.PI, 5);
  });

  it('round-trips with radToDeg', () => {
    const original = 42.7;
    expect(radToDeg(degToRad(original))).toBeCloseTo(original, 5);
  });
});

// ---------------------------------------------------------------------------
// normalizeAngleDeltaDeg
// ---------------------------------------------------------------------------

describe('normalizeAngleDeltaDeg', () => {
  it('returns 0 for identical angles', () => {
    expect(normalizeAngleDeltaDeg(0.5, 0.5)).toBeCloseTo(0, 5);
  });

  it('computes correct small delta', () => {
    // 10° ≈ 0.17453 rad
    const a = degToRad(30);
    const b = degToRad(40);
    expect(normalizeAngleDeltaDeg(a, b)).toBeCloseTo(10, 2);
  });

  it('handles wrap-around near ±180° correctly (classic edge case)', () => {
    // 179° vs -179° should give 2°, not 358°
    const a = degToRad(179);
    const b = degToRad(-179);
    expect(normalizeAngleDeltaDeg(a, b)).toBeCloseTo(2, 1);
  });

  it('handles negative wrap-around', () => {
    const a = degToRad(-170);
    const b = degToRad(170);
    expect(normalizeAngleDeltaDeg(a, b)).toBeCloseTo(20, 1);
  });

  it('returns positive value regardless of sign', () => {
    const a = degToRad(10);
    const b = degToRad(50);
    const result = normalizeAngleDeltaDeg(a, b);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeCloseTo(40, 2);
  });
});

// ---------------------------------------------------------------------------
// compareRotation
// ---------------------------------------------------------------------------

describe('compareRotation', () => {
  it('returns null when both inputs are missing', () => {
    expect(compareRotation(null, null)).toBeNull();
    expect(compareRotation(undefined, undefined)).toBeNull();
  });

  it('returns zero error for identical rotations', () => {
    const rotation = { x: 0.5, y: -0.3, z: 1.0 };
    const result = compareRotation(rotation, rotation);
    expect(result.x).toBeCloseTo(0, 5);
    expect(result.y).toBeCloseTo(0, 5);
    expect(result.z).toBeCloseTo(0, 5);
    expect(result.maxAxis).toBeCloseTo(0, 5);
    expect(result.avgAxis).toBeCloseTo(0, 5);
  });

  it('treats missing rotation as zero', () => {
    const rotation = { x: degToRad(10), y: 0, z: 0 };
    const result = compareRotation(rotation, null);
    expect(result.x).toBeCloseTo(10, 1);
  });

  it('computes per-axis error in degrees', () => {
    const expected = { x: degToRad(20), y: degToRad(30), z: degToRad(40) };
    const actual = { x: degToRad(25), y: degToRad(25), z: degToRad(42) };
    const result = compareRotation(expected, actual);
    expect(result.x).toBeCloseTo(5, 1);
    expect(result.y).toBeCloseTo(5, 1);
    expect(result.z).toBeCloseTo(2, 1);
    expect(result.maxAxis).toBeCloseTo(5, 1);
    expect(result.avgAxis).toBeCloseTo(4, 0);
  });
});

// ---------------------------------------------------------------------------
// computePoseError
// ---------------------------------------------------------------------------

describe('computePoseError', () => {
  const makeSnapshot = (armX = 0, handX = 0) => ({
    leftHand: {
      arm: { x: armX, y: 0, z: 0 },
      forearm: { x: 0, y: 0, z: 0 },
      hand: { x: handX, y: 0, z: 0 },
      fingers: {},
    },
    rightHand: {
      arm: { x: 0, y: 0, z: 0 },
      forearm: { x: 0, y: 0, z: 0 },
      hand: { x: 0, y: 0, z: 0 },
      fingers: {},
    },
  });

  it('returns zero error for identical snapshots', () => {
    const snapshot = makeSnapshot(0.5, 0.3);
    const result = computePoseError(snapshot, snapshot);
    expect(result.averageErrorDegrees).toBe(0);
    expect(result.maxErrorDegrees).toBe(0);
    expect(result.failedJoints).toHaveLength(0);
  });

  it('detects error above threshold', () => {
    const expected = makeSnapshot(degToRad(20), 0);
    const actual = makeSnapshot(degToRad(35), 0); // 15° off on arm X
    const result = computePoseError(expected, actual, 10);
    expect(result.maxErrorDegrees).toBeGreaterThan(10);
    expect(result.failedJoints.length).toBeGreaterThan(0);
  });

  it('handles empty snapshots gracefully', () => {
    const result = computePoseError({}, {});
    expect(result.joints).toHaveLength(0);
    expect(result.averageErrorDegrees).toBe(0);
    expect(result.maxErrorDegrees).toBe(0);
  });

  it('includes finger joints in comparison', () => {
    const expected = {
      leftHand: {
        arm: { x: 0, y: 0, z: 0 },
        forearm: { x: 0, y: 0, z: 0 },
        hand: { x: 0, y: 0, z: 0 },
        fingers: {
          index1: { x: degToRad(30), y: 0, z: 0 },
          index2: { x: degToRad(45), y: 0, z: 0 },
        },
      },
      rightHand: {},
    };

    const actual = {
      leftHand: {
        arm: { x: 0, y: 0, z: 0 },
        forearm: { x: 0, y: 0, z: 0 },
        hand: { x: 0, y: 0, z: 0 },
        fingers: {
          index1: { x: degToRad(30), y: 0, z: 0 },
          index2: { x: degToRad(60), y: 0, z: 0 }, // 15° off
        },
      },
      rightHand: {},
    };

    const result = computePoseError(expected, actual, 10);
    const failedNames = result.failedJoints.map((j) => j.name);
    expect(failedNames).toContain('L_index2');
  });
});

// ---------------------------------------------------------------------------
// evaluatePoseAgainstTolerance
// ---------------------------------------------------------------------------

describe('evaluatePoseAgainstTolerance', () => {
  it('returns true when error is within tolerance', () => {
    const errorResult = { averageErrorDegrees: 2.5, maxErrorDegrees: 4.9 };
    expect(evaluatePoseAgainstTolerance(errorResult, 5, 10)).toBe(true);
  });

  it('returns false when average exceeds tolerance', () => {
    const errorResult = { averageErrorDegrees: 6.0, maxErrorDegrees: 4.0 };
    expect(evaluatePoseAgainstTolerance(errorResult, 5, 10)).toBe(false);
  });

  it('returns false when max exceeds tolerance', () => {
    const errorResult = { averageErrorDegrees: 3.0, maxErrorDegrees: 11.0 };
    expect(evaluatePoseAgainstTolerance(errorResult, 5, 10)).toBe(false);
  });

  it('returns false for null input', () => {
    expect(evaluatePoseAgainstTolerance(null)).toBe(false);
  });

  it('uses default tolerances when none provided', () => {
    const errorResult = {
      averageErrorDegrees: DEFAULT_AVG_TOLERANCE_DEG - 1,
      maxErrorDegrees: DEFAULT_MAX_TOLERANCE_DEG - 1,
    };
    expect(evaluatePoseAgainstTolerance(errorResult)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildEvaluationSummary
// ---------------------------------------------------------------------------

describe('buildEvaluationSummary', () => {
  it('calculates correct pass/fail counts', () => {
    const poseResults = [
      { poseName: 'Pose 1', pass: true, averageErrorDegrees: 1, maxErrorDegrees: 2 },
      { poseName: 'Pose 2', pass: false, averageErrorDegrees: 8, maxErrorDegrees: 12 },
      { poseName: 'Pose 3', pass: true, averageErrorDegrees: 3, maxErrorDegrees: 5 },
    ];

    const summary = buildEvaluationSummary(poseResults, 5, 10);
    expect(summary.totalPoses).toBe(3);
    expect(summary.passedPoses).toBe(2);
    expect(summary.failedPoses).toBe(1);
    expect(summary.overallPass).toBe(false);
    expect(summary.avgToleranceUsed).toBe(5);
    expect(summary.maxToleranceUsed).toBe(10);
  });

  it('returns overallPass = true when all pass', () => {
    const poseResults = [
      { poseName: 'P1', pass: true },
      { poseName: 'P2', pass: true },
    ];
    const summary = buildEvaluationSummary(poseResults);
    expect(summary.overallPass).toBe(true);
  });

  it('handles empty results', () => {
    const summary = buildEvaluationSummary([]);
    expect(summary.totalPoses).toBe(0);
    expect(summary.passedPoses).toBe(0);
    expect(summary.failedPoses).toBe(0);
    expect(summary.overallPass).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateMoveListSchema
// ---------------------------------------------------------------------------

describe('validateMoveListSchema', () => {
  it('rejects null/undefined', () => {
    expect(validateMoveListSchema(null).valid).toBe(false);
    expect(validateMoveListSchema(undefined).valid).toBe(false);
  });

  it('rejects missing move field', () => {
    const result = validateMoveListSchema({ poses: [{ snapshot: {} }] });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/move/i);
  });

  it('rejects missing poses array', () => {
    const result = validateMoveListSchema({ move: 'HELLO' });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/poses/i);
  });

  it('rejects empty poses array', () => {
    const result = validateMoveListSchema({ move: 'HELLO', poses: [] });
    expect(result.valid).toBe(false);
  });

  it('rejects pose without snapshot', () => {
    const result = validateMoveListSchema({
      move: 'HELLO',
      poses: [{ name: 'Pose 1' }],
    });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/snapshot/i);
  });

  it('accepts valid payload with move field', () => {
    const result = validateMoveListSchema({
      move: 'HELLO',
      poses: [
        { name: 'Pose 1', snapshot: { leftHand: {}, rightHand: {} } },
      ],
    });
    expect(result.valid).toBe(true);
  });

  it('accepts valid payload with word field (backward compat)', () => {
    const result = validateMoveListSchema({
      word: 'WORLD',
      poses: [
        { name: 'P1', snapshot: {} },
        { name: 'P2', snapshot: {} },
      ],
    });
    expect(result.valid).toBe(true);
  });
});
