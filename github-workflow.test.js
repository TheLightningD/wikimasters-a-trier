const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const workflow = fs.readFileSync('.github/workflows/live.yml', 'utf8');
const installer = fs.readFileSync('installer-runner-github.ps1', 'utf8');
assert.match(workflow, /runs-on:\s*\[self-hosted, windows, x64, wikimasters\]/);
assert.match(workflow, /wishlist-local\.ps1[^\n]*-Full/);
assert.doesNotMatch(workflow, /ubuntu-latest|secrets\.WIKIMASTERS_|pull_request:|\n\s*push:/);
assert.match(installer, /actions\/runner\/releases\/latest/);
assert.match(installer, /--labels wikimasters/);
assert.match(installer, /Get-FileHash[\s\S]*SHA256/);
assert.match(installer, /ACTIONS_RUNNER_HOOK_JOB_STARTED/);
assert.match(installer, /GITHUB_WORKFLOW_REF/);
assert.match(installer, /live\.yml@refs\/heads\/main/);
assert.doesNotMatch(installer, /runasservice|svc\.cmd/);
assert.equal(fs.existsSync('installer-runner-github.ps1'), true);
assert.equal(fs.existsSync('installer-runner-github.cmd'), true);
assert.equal(fs.existsSync('demarrer-runner-github.cmd'), true);
assert.match(fs.readFileSync('wishlist-local.ps1', 'utf8'), /\[switch\]\$CollectionOnly/);

if (process.platform === 'win32') {
  const hook = installer.match(/\$hook = @'\r?\n([\s\S]*?)\r?\n'@/)?.[1];
  assert.ok(hook, 'hook de sécurité introuvable');
  const hookPath = path.join(os.tmpdir(), 'wikimasters-runner-hook-test.ps1');
  fs.writeFileSync(hookPath, hook);
  const allowed = spawnSync('powershell.exe', ['-NoProfile', '-File', hookPath], { env: {
    ...process.env,
    GITHUB_REPOSITORY: 'TheLightningD/wikimasters-a-trier',
    GITHUB_WORKFLOW_REF: 'TheLightningD/wikimasters-a-trier/.github/workflows/live.yml@refs/heads/main',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_EVENT_NAME: 'schedule'
  }});
  const denied = spawnSync('powershell.exe', ['-NoProfile', '-File', hookPath], { env: {
    ...process.env,
    GITHUB_REPOSITORY: 'TheLightningD/wikimasters-a-trier',
    GITHUB_WORKFLOW_REF: 'TheLightningD/wikimasters-a-trier/.github/workflows/run.yml@refs/pull/1/merge',
    GITHUB_REF: 'refs/pull/1/merge',
    GITHUB_EVENT_NAME: 'pull_request'
  }});
  fs.rmSync(hookPath, { force: true });
  assert.equal(allowed.status, 0, allowed.stderr.toString());
  assert.notEqual(denied.status, 0);
}

console.log('github workflow: ok');
