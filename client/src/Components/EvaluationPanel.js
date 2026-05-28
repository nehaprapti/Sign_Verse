import React from 'react';

/**
 * EvaluationPanel – renders the evaluation engine results inside the
 * Simulate page.  Supports all four status modes: idle, running, passed,
 * failed.  Includes per-pose detail rows and overall summary.
 */
function EvaluationPanel({
  evaluationStatus,
  evaluationResults,
  evaluationSummary,
  onSaveAnyway,
  onCancel,
  onReplayFailed,
  onDismiss,
}) {
  if (evaluationStatus === 'idle') {
    return null;
  }

  // ── Running ──────────────────────────────────────────────────────────────

  if (evaluationStatus === 'running') {
    return (
      <div className='eval-panel eval-panel-running'>
        <div className='eval-panel-header'>
          <span className='eval-icon eval-icon-spin'>⏳</span>
          <span className='eval-title'>Evaluating Move List…</span>
        </div>
        <p className='eval-subtitle'>
          Replaying poses and comparing against marked data. Please wait.
        </p>
        <div className='eval-progress-bar'>
          <div className='eval-progress-bar-fill' />
        </div>
      </div>
    );
  }

  // ── Passed ───────────────────────────────────────────────────────────────

  if (evaluationStatus === 'passed') {
    return (
      <div className='eval-panel eval-panel-passed'>
        <div className='eval-panel-header'>
          <span className='eval-icon'>✅</span>
          <span className='eval-title'>Evaluation Passed</span>
        </div>

        {evaluationSummary && (
          <div className='eval-summary'>
            <div className='eval-summary-row'>
              <span>Total Poses</span>
              <strong>{evaluationSummary.totalPoses}</strong>
            </div>
            <div className='eval-summary-row'>
              <span>Passed</span>
              <strong className='eval-pass-text'>{evaluationSummary.passedPoses}</strong>
            </div>
            <div className='eval-summary-row'>
              <span>Avg Tolerance</span>
              <strong>≤ {evaluationSummary.avgToleranceUsed}°</strong>
            </div>
            <div className='eval-summary-row'>
              <span>Max Tolerance</span>
              <strong>≤ {evaluationSummary.maxToleranceUsed}°</strong>
            </div>
          </div>
        )}

        {evaluationResults && evaluationResults.length > 0 && (
          <div className='eval-results-list'>
            <p className='eval-results-title'>Per-Pose Results</p>
            {evaluationResults.map((result, index) => (
              <div key={index} className='eval-result-row eval-result-pass'>
                <span className='eval-result-name'>
                  {result.pass ? '✅' : '❌'} {result.poseName}
                </span>
                <span className='eval-result-metric'>
                  avg {result.averageErrorDegrees.toFixed(1)}° · max {result.maxErrorDegrees.toFixed(1)}°
                </span>
              </div>
            ))}
          </div>
        )}

        <button className='btn btn-outline-dark btn-style w-100 eval-dismiss-btn' onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    );
  }

  // ── Failed ───────────────────────────────────────────────────────────────

  if (evaluationStatus === 'failed') {
    const failedResults = (evaluationResults || []).filter((r) => !r.pass);

    return (
      <div className='eval-panel eval-panel-failed'>
        <div className='eval-panel-header'>
          <span className='eval-icon'>⚠️</span>
          <span className='eval-title'>Evaluation Failed</span>
        </div>

        {evaluationSummary && (
          <div className='eval-summary'>
            <div className='eval-summary-row'>
              <span>Total Poses</span>
              <strong>{evaluationSummary.totalPoses}</strong>
            </div>
            <div className='eval-summary-row'>
              <span>Passed</span>
              <strong className='eval-pass-text'>{evaluationSummary.passedPoses}</strong>
            </div>
            <div className='eval-summary-row'>
              <span>Failed</span>
              <strong className='eval-fail-text'>{evaluationSummary.failedPoses}</strong>
            </div>
            <div className='eval-summary-row'>
              <span>Avg Tolerance</span>
              <strong>≤ {evaluationSummary.avgToleranceUsed}°</strong>
            </div>
            <div className='eval-summary-row'>
              <span>Max Tolerance</span>
              <strong>≤ {evaluationSummary.maxToleranceUsed}°</strong>
            </div>
          </div>
        )}

        {evaluationResults && evaluationResults.length > 0 && (
          <div className='eval-results-list'>
            <p className='eval-results-title'>Per-Pose Results</p>
            {evaluationResults.map((result, index) => (
              <div
                key={index}
                className={`eval-result-row ${result.pass ? 'eval-result-pass' : 'eval-result-fail'}`}
              >
                <span className='eval-result-name'>
                  {result.pass ? '✅' : '❌'} {result.poseName}
                </span>
                <span className='eval-result-metric'>
                  avg {result.averageErrorDegrees.toFixed(1)}° · max {result.maxErrorDegrees.toFixed(1)}°
                </span>
                {!result.pass && result.failedJoints && result.failedJoints.length > 0 && (
                  <div className='eval-failed-joints'>
                    {result.failedJoints.slice(0, 5).map((fj, fIdx) => (
                      <span key={fIdx} className='eval-failed-joint-tag'>
                        {fj.name} ({fj.errorDeg.maxAxis.toFixed(1)}°)
                      </span>
                    ))}
                    {result.failedJoints.length > 5 && (
                      <span className='eval-failed-joint-tag'>+{result.failedJoints.length - 5} more</span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className='eval-actions'>
          <button className='btn btn-brown btn-style eval-action-btn' onClick={onSaveAnyway}>
            Save Anyway
          </button>
          <button className='btn btn-outline-danger btn-style eval-action-btn' onClick={onCancel}>
            Cancel Save
          </button>
        </div>

        {failedResults.length > 0 && onReplayFailed && (
          <button className='btn btn-outline-dark btn-style w-100 eval-replay-btn' onClick={onReplayFailed}>
            Replay Failed Poses
          </button>
        )}
      </div>
    );
  }

  return null;
}

export default EvaluationPanel;
