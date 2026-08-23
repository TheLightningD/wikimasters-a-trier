const noTimeout = new Set(['inventory-count', 'inventory', 'wishlist-apply']);
const longModes = new Set(['collection', 'cleanup']);
module.exports = (mode, env = process.env) => {
  const override = Number(env.WM_AUTOMATION_TIMEOUT_MS);
  if (override > 0) return override;
  return noTimeout.has(mode) ? 0 : longModes.has(mode) ? 900000 : 180000;
};
