const assert = require('node:assert/strict');
const { sanitizeState, encryptState, decryptState } = require('./session-state');

const state = {
  cookies: [
    { name: 'sb-project-auth-token.0', value: 'access-refresh-part-0', domain: 'www.wiki-masters.com', path: '/', expires: 2000000000 },
    { name: 'sb-project-auth-token.1', value: 'access-refresh-part-1', domain: 'www.wiki-masters.com', path: '/', expires: 2000000000 },
    { name: 'tracking', value: 'discard-me', domain: 'example.com', path: '/' },
    { name: 'sb-evil-auth-token.0', value: 'discard-me-too', domain: 'evilwiki-masters.com', path: '/' }
  ],
  origins: [{ origin: 'https://example.com', localStorage: [{ name: 'x', value: 'discard-me' }] }]
};
const sanitized = sanitizeState(state);
assert.deepEqual(sanitized.cookies.map(cookie => cookie.name), ['sb-project-auth-token.0', 'sb-project-auth-token.1']);
assert.deepEqual(sanitized.origins, []);

const bootstrap = Buffer.from(JSON.stringify(sanitized)).toString('base64');
const encrypted = encryptState(sanitized, bootstrap);
assert.match(encrypted, /^v1\./);
assert.doesNotMatch(encrypted, /access-refresh/);
assert.deepEqual(decryptState(encrypted, bootstrap), sanitized);
assert.throws(() => decryptState(encrypted, `${bootstrap}wrong`), /déchiffrer|authentifier/i);
assert.throws(() => encryptState(sanitized, ''), /absent|court/i);

console.log('session state: ok');
