# SignVerse Evaluation Engine - Codebase Clarification and Implementation Plan

## 1. Objective
Build an evaluation engine that runs before final JSON save, loads the generated move-list JSON into the avatar, replays all marked poses, and verifies whether each marked pose was actually rendered correctly.

## 2. Current Codebase Clarification

### 2.1 Authoring and Marking (Simulate)
- Main authoring flow is in `src/Pages/Simulate.js`.
- Marked poses are assembled and managed in state (`markedPoses`, `poseName`, capture from current avatar state).
- Existing playback of marked poses is already present on the Simulate page.
- Save Move List JSON already exports the current move list and stores it in browser localStorage.

### 2.2 Import and Playback (Convert)
- Convert page (`src/Pages/Convert.js`) already accepts JSON import.
- Convert page can load pose snapshots and replay them on the avatar.
- Simulate and Convert share the same localStorage move-list key, so JSON generated from Simulate can already be consumed by Convert.

### 2.3 Gap Identified
- There is no dedicated automated verification step that:
  1. round-trips the generated JSON,
  2. loads it back into avatar runtime,
  3. replays each pose,
  4. computes comparison error against expected marked data,
  5. reports pass/fail per pose before final save.

## 3. Required Evaluation Engine Behavior
1. User clicks Save Move List JSON.
2. App generates JSON payload from current marked poses.
3. Before final save, app runs evaluation:
   - parse/load JSON payload,
   - replay each pose on avatar,
   - compare actual runtime bone rotations vs expected values.
4. Show clear evaluation result:
   - per-pose pass/fail,
   - error metric,
   - overall pass/fail summary.
5. If pass: proceed with final save and storage.
6. If fail: show mismatch details and allow user to decide Save Anyway or Cancel.

## 4. Implementation Plan

### Phase 1 - Add Evaluation Data Model in Simulate
Add new state in `src/Pages/Simulate.js`:
- `evaluationStatus` (idle, running, passed, failed)
- `evaluationResults` (array of per-pose results)
- `evaluationSummary` (overall metrics)
- `isEvaluationModalOpen` (optional, if using modal presentation)

Per-pose result shape:
- poseName
- expectedPoseIndex
- averageErrorDegrees
- maxErrorDegrees
- pass (boolean)
- failedJoints (optional list)

### Phase 2 - Create JSON Round-Trip Evaluation Function
In Simulate page, add function `evaluateMoveListBeforeSave(moveListJson)`:
1. Parse/validate schema.
2. Convert JSON entries into normalized pose snapshots.
3. Sequentially apply each pose to avatar using the same runtime method used by existing playback.
4. Wait for settle interval per pose.
5. Read current avatar joint rotations.
6. Compare current vs expected per joint.
7. Store per-pose metrics and pass/fail.
8. Build summary and return result object.

### Phase 3 - Add Pose Comparison Utility
Create reusable utilities (either inside Simulate or in a new file like `src/Utils/evaluationUtils.js`):
- `normalizeAngleDeltaDeg(a, b)`
- `computePoseError(expectedPose, actualPose)`
- `evaluatePoseAgainstTolerance(errorResult, toleranceDeg)`

Suggested default tolerances:
- average joint delta <= 5 degrees
- max joint delta <= 10 degrees

Keep tolerance configurable via constants.

### Phase 4 - Integrate Evaluation into Save Button Flow
Update Save Move List JSON handler in Simulate:
1. Build JSON payload (existing behavior).
2. Start evaluation state (`running`).
3. Run `evaluateMoveListBeforeSave(...)`.
4. Render result to user.
5. Branch:
   - Pass -> execute existing download + localStorage save.
   - Fail -> show report and require explicit Save Anyway action.

### Phase 5 - UI for Verification Output
In Simulate page UI:
- Add evaluation panel near existing status area.
- Show runtime status text while evaluating.
- Show compact result table/list for poses.
- Show overall summary:
  - total poses
  - passed poses
  - failed poses
  - tolerance used

Optional:
- Add a Replay Failed Poses action.

### Phase 6 - Optional Upload-and-Evaluate Tool
Add optional button in Simulate:
- Upload external move-list JSON.
- Run the same evaluation pipeline.
- Show pass/fail without saving.

This helps validate JSON files before using Convert.

## 5. Validation and Verification Checklist
1. Save flow triggers evaluation every time.
2. Avatar visibly replays all poses from generated JSON.
3. Evaluation report appears and is readable.
4. Pass path still saves JSON exactly as before.
5. Fail path blocks automatic save and offers Save Anyway.
6. Convert import/playback remains unaffected.
7. No console/runtime errors during repeated evaluations.

## 6. Non-Functional Requirements
- Preserve existing pose capture and playback behavior.
- Keep evaluation deterministic (fixed timing and ordering).
- Avoid introducing heavy dependencies.
- Keep UI responsive during long pose lists.

## 7. Risks and Mitigations
- Timing jitter while reading runtime rotations:
  - Mitigation: fixed settle delay and optional second sample average.
- Angle wrap-around error (e.g., 179 vs -179):
  - Mitigation: normalized shortest-angle comparison utility.
- Different bone naming between expected and actual maps:
  - Mitigation: canonical joint-name normalization layer.

## 8. Definition of Done
- Evaluation runs automatically before final save.
- JSON is loaded and replayed through avatar runtime during evaluation.
- Per-pose and overall verification result is shown.
- User can trust whether marked points were correctly represented.
- Existing Simulate and Convert behaviors remain stable.

## 9. Proposed Next Execution Step
On approval, implement Phase 1 to Phase 5 directly in `src/Pages/Simulate.js` first, then extract utility functions to `src/Utils/evaluationUtils.js` if needed for maintainability.
