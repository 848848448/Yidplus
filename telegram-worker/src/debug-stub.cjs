// Stub for the `debug` package. CommonJS on purpose — see below.
//
// @mtproto/core does `const createDebug = require('debug')` and then calls it.
// The real package picks a browser or node build at import time; in the Workers
// runtime the one it picks has no `.extend`, so the module throws at startup.
//
// This file must be CJS: an ESM stub hands `require()` back a module namespace
// object ({ default: fn }) rather than the function, which fails a step later
// with "createDebug2 is not a function". `module.exports = fn` is what makes
// require('debug') return the callable directly.
//
// The library only ever calls the logger and extends it, so a no-op with that
// shape is enough.

function createDebug(namespace) {
  const log = function () {
    // Silent by default. Uncomment to trace MTProto internals in `wrangler tail`:
    // console.log('[' + namespace + ']', ...arguments);
  };
  log.namespace = namespace;
  log.enabled = false;
  log.extend = function (sub, delimiter) {
    return createDebug(namespace + (delimiter || ':') + sub);
  };
  log.destroy = function () { return true; };
  return log;
}

createDebug.enable = function () {};
createDebug.disable = function () { return ''; };
createDebug.enabled = function () { return false; };
createDebug.humanize = function (n) { return String(n); };
createDebug.names = [];
createDebug.skips = [];
createDebug.formatters = {};
createDebug.default = createDebug;

module.exports = createDebug;
