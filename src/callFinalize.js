'use strict';

// One terminal event for a call: status and duration on the row, then the
// finalize work (resolution and summary, first-forward judge, text-back).
// Built as a factory so the orchestration is testable without server.js.
//
// VOICE_ENDED_CALL_GUARD=on (off by default; src/speech/endedCalls.js): finalize runs
// once per call. While a media session for the sid is open here, webhooks
// write status/duration only and leave finalize to the media close. A row
// already marked finalized (another replica, or before a restart) is not
// finalized again. updateCallStatus never shortens a longer duration.
// Off (unset, the default): the CALL_FINALIZE_ONCE behaviour from #692, unchanged.

function createCallFinalizer(deps) {
  const {
    db,
    endedCalls,
    persistCallResolution,
    persistFirstForwardAcceptance,
    maybeSendMissedTextback,
    finalizeOnceEnabled,
    finalizeDecision,
    log = console,
  } = deps;

  function textback(source, callSid, call) {
    if (!call || typeof maybeSendMissedTextback !== 'function') return;
    Promise.resolve()
      .then(() => maybeSendMissedTextback({ callSid, call }))
      .catch((err) => log.warn(`[${source}] missed text-back failed:`, err?.message || err));
  }

  return async function markCallTerminal({
    callSid,
    status,
    durationSeconds,
    source,
    turns,
    provisional = false,
  }) {
    if (!callSid) {
      log.warn(`[${source}] termination detected but no callSid — skipping DB update`);
      return null;
    }
    // Claim before any await, so two closers in this process cannot both run.
    const guardOn = endedCalls.endedCallGuardEnabled();
    const turn = guardOn
      ? endedCalls.finalizeTurn(callSid, { source, provisional, status, durationSeconds })
      : 'run';
    try {
      const updated = await db.updateCallStatus({ callSid, status, durationSeconds });
      log.log(`[${source}] marked call ${callSid} status=${status}`, {
        durationSeconds: durationSeconds ?? null,
        found: Boolean(updated),
      });
      if (guardOn) {
        let skipReason = '';
        if (turn === 'defer') skipReason = 'media session still open; its close finalizes';
        else if (turn === 'skip') skipReason = 'already finalized in this process';
        else if (endedCalls.rowAlreadyFinalized(updated, { source })) skipReason = 'call row already finalized';
        if (skipReason) {
          log.log(
            `[${source}] finalize skipped ${callSid} (${skipReason}) duration_kept=${updated?.duration_seconds ?? 'null'}`
          );
          // A later failed/no_answer flip may still owe the missed-call text;
          // the text-back keeps its own once-only marker.
          textback(source, callSid, updated);
          return updated;
        }
      } else {
        const decision = finalizeDecision({
          enabled: finalizeOnceEnabled(),
          won: updated?.finalizeWinner,
          hasTurns: Array.isArray(turns) && turns.length > 0,
        });
        if (decision !== 'run') {
          log.log(`[${source}] finalize skipped ${callSid} (another webhook won) decision=${decision}`);
          if (decision === 'review_only') {
            await persistCallResolution(callSid, source, { turns, callStatus: status, writeResolution: false });
          }
          return updated;
        }
      }
      // Best-effort outcome while Brain state may still be in memory.
      await persistCallResolution(callSid, source, { turns, callStatus: status });
      // Guard on: the judge reads the longest duration known, not this event's own.
      await persistFirstForwardAcceptance(
        callSid,
        guardOn
          ? Math.max(Number(updated?.duration_seconds) || 0, Number(durationSeconds) || 0)
          : durationSeconds
      );
      if (guardOn && updated) {
        try {
          await db.mergeCallSummaryMeta({
            callSid,
            patch: endedCalls.finalizedMetaPatch({ source, provisional }),
          });
        } catch (err) {
          log.warn(`[${source}] finalized marker failed:`, err?.message || err);
        }
      }
      // Fire-and-forget: SMS latency must not hold the webhook open.
      textback(source, callSid, updated);
      return updated;
    } catch (err) {
      log.error(`[${source}] updateCallStatus failed:`, err?.message || err);
      return null;
    }
  };
}

module.exports = { createCallFinalizer };
