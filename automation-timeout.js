const longModes = new Set(['collection', 'cleanup', 'inventory', 'wishlist-apply']);
module.exports = mode => longModes.has(mode) ? 900000 : 180000;
