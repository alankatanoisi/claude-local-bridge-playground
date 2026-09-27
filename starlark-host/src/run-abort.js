'use strict';

// One controller belongs to one run. Aborting it wakes network calls and tells
// the worker pool to stop taking jobs from its queue.
function createRunController() {
  return new AbortController();
}

function checkAbort(signal) {
  signal?.throwIfAborted();
}

function installRunSignals(controller) {
  const handlers = new Map();
  for (const [name, exitCode] of [
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ]) {
    const handler = () => {
      // Do not call process.exit(): outstanding budget cleanup must finish.
      process.exitCode = exitCode;
      controller.abort(new Error(name));
    };
    handlers.set(name, handler);
    process.on(name, handler);
  }
  // Embedded callers must not accumulate process-wide signal listeners.
  return () => {
    for (const [name, handler] of handlers) process.removeListener(name, handler);
  };
}

// A matrix can contain an ordinary failed run followed by a run interrupted
// with Ctrl-C (SIGINT) or SIGTERM. The signal handler has already chosen the
// informative shell exit code, 130 or 143. A generic "some run failed" code
// must not replace that more specific explanation at the end of the command.
function applyFailedRunExitCode(failedRuns, signal) {
  if (failedRuns > 0 && !signal?.aborted) process.exitCode = 1;
}

module.exports = { applyFailedRunExitCode, checkAbort, createRunController, installRunSignals };
