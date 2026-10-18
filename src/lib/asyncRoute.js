'use strict';

/**
 * Express 4 does not catch a rejected async handler, so a provider error on
 * an async route became an unhandled rejection. Wrap it: log, reply 500.
 * @param {string} label
 * @param {(req: any, res: any, next: Function) => unknown} handler
 */
function asyncRoute(label, handler) {
  return (req, res, next) => {
    Promise.resolve()
      .then(() => handler(req, res, next))
      .catch((err) => {
        console.error(`[${label}] failed:`, err?.message || err);
        if (!res.headersSent) res.status(500).json({ ok: false, error: 'internal_error' });
      });
  };
}

module.exports = { asyncRoute };
