const noTimeout = new Set(['inventory-count', 'inventory', 'wishlist-apply']);
const longModes = new Set(['collection', 'cleanup']);
module.exports = mode => noTimeout.has(mode) ? 0 : longModes.has(mode) ? 900000 : 180000;
