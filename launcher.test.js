const assert = require('node:assert/strict');
const fs = require('node:fs');

for (const file of ['ouvrir-et-trier.cmd', 'synchroniser-echanges.cmd']) {
  const bytes = fs.readFileSync(file);
  const text = bytes.toString('utf8');
  assert.equal((text.match(/\n/g) || []).length, (text.match(/\r\n/g) || []).length, `${file} doit utiliser uniquement CRLF pour cmd.exe`);
}

console.log('launchers: ok');
