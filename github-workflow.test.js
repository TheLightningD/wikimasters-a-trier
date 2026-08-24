const assert = require('node:assert/strict');
const fs = require('node:fs');

const workflow = fs.readFileSync('.github/workflows/live.yml', 'utf8');
assert.match(workflow, /runs-on:\s*ubuntu-latest/);
assert.match(workflow, /if:\s*github\.ref == 'refs\/heads\/main'/);
assert.match(workflow, /WIKIMASTERS_SESSION_B64:\s*\$\{\{ secrets\.WIKIMASTERS_SESSION_B64 \}\}/);
assert.match(workflow, /session-state\.js restore/);
assert.match(workflow, /session-state\.js save/);
assert.match(workflow, /session-publish\/session\.enc/);
assert.doesNotMatch(workflow, /\.session-publish/);
assert.match(workflow, /reset_session/);
assert.match(workflow, /HTTP_CODE=.*curl/);
assert.match(workflow, /wikimasters-session/);
assert.match(workflow, /permissions:\s*\n\s*contents:\s*read/);
assert.match(workflow, /sauvegarde-session:[\s\S]*permissions:\s*\n\s*contents:\s*write/);
assert.match(workflow, /needs\.ouverture\.outputs\.session_ready == 'true'/);
assert.match(workflow, /persist-credentials:\s*false/);
assert.doesNotMatch(workflow, /self-hosted|secrets\.WIKIMASTERS_(?:EMAIL|PASSWORD)/);
assert.equal(fs.existsSync('exporter-session-github.js'), true);
assert.equal(fs.existsSync('exporter-session-github.cmd'), true);

console.log('github workflow: ok');
