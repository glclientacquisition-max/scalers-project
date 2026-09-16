// Reasoning-down lifeboat: keep the line, take a real name if they already said it.

const {
  callerNameFromUtterance,
  pickLlmRecoveryLine,
  pickLlmRecoverySaved,
} = require('./dynamicSpeech');

/**
 * @param {{ userText?: string, alreadyOffered?: boolean, language?: string }} opts
 * @returns {{ spoken: string, name: string, saved: boolean }}
 */
function planLlmRecovery(opts = {}) {
  const name = callerNameFromUtterance(opts.userText);
  if (name) {
    return {
      spoken: pickLlmRecoverySaved({ language: opts.language }),
      name,
      saved: true,
    };
  }
  return {
    spoken: pickLlmRecoveryLine({
      language: opts.language,
      alreadyOffered: opts.alreadyOffered,
    }),
    name: '',
    saved: false,
  };
}

module.exports = {
  planLlmRecovery,
};
