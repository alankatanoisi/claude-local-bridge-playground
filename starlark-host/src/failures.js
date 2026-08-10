'use strict';

class FaultInjector {
  constructor(profile = 'none') {
    this.profile = profile;
  }

  ruleFor(index, attempt) {
    if (this.profile !== 'mixed' || attempt !== 1) return null;
    return ['transient_before_call', 'timeout_after_response', 'malformed_after_response', 'permanent_before_call'][
      index % 4
    ];
  }

  beforeCall(index, attempt) {
    const rule = this.ruleFor(index, attempt);
    if (rule === 'transient_before_call') return failure(rule, true, false);
    if (rule === 'permanent_before_call') return failure(rule, false, false);
    return null;
  }

  afterCall(index, attempt, response) {
    const rule = this.ruleFor(index, attempt);
    if (rule === 'timeout_after_response') return failure(rule, true, true, response);
    if (rule === 'malformed_after_response') {
      return { ...response, text: response.text.slice(0, Math.max(1, Math.floor(response.text.length / 3))) };
    }
    return response;
  }
}

function failure(code, retryable, charged, hiddenResponse) {
  return {
    injectedFailure: true,
    error: { code, retryable, message: `deliberate failure injection: ${code}` },
    charged,
    hiddenResponse,
  };
}

module.exports = { FaultInjector };
