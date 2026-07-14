// Stub for the `debug` package.
//
// @mtproto/core does `createDebug('mtproto-core')` and then `.extend('main')`
// on the result. The real package picks a browser or node build at import time;
// in the Workers runtime it resolves to one whose `.extend` is missing, so the
// module throws on startup:
//   Uncaught TypeError: baseDebug.extend is not a function
//
// The library only ever calls the logger and extends it, so a no-op with that
// shape is all that's needed. Swap console.log in below if you need traces.

function createDebug(namespace) {
  const log = function (...args) {
    // Silent by default. Uncomment to trace MTProto internals in `wrangler tail`:
    // console.log('[' + namespace + ']', ...args);
  };
  log.namespace = namespace;
  log.enabled = false;
  log.extend = (sub, delimiter = ':') => createDebug(namespace + delimiter + sub);
  log.destroy = () => true;
  return log;
}

createDebug.enable = () => {};
createDebug.disable = () => '';
createDebug.enabled = () => false;
createDebug.humanize = (n) => String(n);
createDebug.names = [];
createDebug.skips = [];
createDebug.formatters = {};

export default createDebug;
