const crypto = require('node:crypto');
const fs = require('node:fs');

const authCookie = cookie => {
  if (!cookie || typeof cookie.name !== 'string' || typeof cookie.domain !== 'string' || typeof cookie.value !== 'string' || !cookie.value) return false;
  const domain = cookie.domain.replace(/^\./, '').toLowerCase();
  return /^sb-[a-z0-9]+-auth-token(?:\.\d+)?$/i.test(cookie.name)
    && (domain === 'wiki-masters.com' || domain.endsWith('.wiki-masters.com'));
};

function sanitizeState(state) {
  const cookies = Array.isArray(state?.cookies) ? state.cookies.filter(authCookie) : [];
  if (!cookies.length) throw new Error('Session WikiMasters absente ou invalide.');
  return { cookies, origins: [] };
}

const deriveKey = secret => {
  if (!secret || secret.length < 32) throw new Error('Secret de session WikiMasters absent ou trop court.');
  return crypto.createHash('sha256').update(secret).digest();
};

function encryptState(state, secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(sanitizeState(state)), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

function decryptState(payload, secret) {
  try {
    const [version, ivValue, tagValue, encryptedValue] = String(payload || '').trim().split('.');
    if (version !== 'v1' || !ivValue || !tagValue || !encryptedValue) throw new Error('format');
    const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(secret), Buffer.from(ivValue, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    const plain = Buffer.concat([decipher.update(Buffer.from(encryptedValue, 'base64url')), decipher.final()]);
    return sanitizeState(JSON.parse(plain.toString('utf8')));
  } catch {
    throw new Error('Impossible de déchiffrer ou authentifier la session WikiMasters.');
  }
}

function restore(encryptedPath, outputPath, secret) {
  deriveKey(secret);
  const state = fs.existsSync(encryptedPath)
    ? decryptState(fs.readFileSync(encryptedPath, 'utf8'), secret)
    : sanitizeState(JSON.parse(Buffer.from(secret, 'base64').toString('utf8')));
  fs.writeFileSync(outputPath, `${JSON.stringify(state)}\n`, { mode: 0o600 });
}

function save(inputPath, encryptedPath, secret) {
  const state = sanitizeState(JSON.parse(fs.readFileSync(inputPath, 'utf8')));
  fs.writeFileSync(encryptedPath, `${encryptState(state, secret)}\n`, { mode: 0o600 });
}

if (require.main === module) {
  const [command, input, output] = process.argv.slice(2);
  const secret = process.env.WIKIMASTERS_SESSION_B64;
  try {
    if (command === 'restore' && input && output) restore(input, output, secret);
    else if (command === 'save' && input && output) save(input, output, secret);
    else throw new Error('Usage: node session-state.js restore|save <entrée> <sortie>');
    console.log(`session ${command}: ok`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { sanitizeState, encryptState, decryptState, restore, save };
