const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const root = __dirname;
const storageStatePath = path.join(os.tmpdir(), 'wikimasters-storage-state-test.json');
const storageStateOutput = path.join(os.tmpdir(), 'wikimasters-storage-state-output-test.json');
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const file = path.join(root, pathname === '/' || pathname === '/pulls' ? 'test.html' : pathname.slice(1));
  if (!fs.existsSync(file)) { response.writeHead(404).end(); return; }
  response.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : 'text/html');
  fs.createReadStream(file).pipe(response);
});

const run = (port, query, extraEnv = {}) => new Promise(resolve => {
  const child = spawn(process.execPath, ['worker.js'], {
    cwd: root,
    env: {
      ...process.env,
      GITHUB_ACTIONS: 'false',
      GITHUB_STEP_SUMMARY: '',
      WM_URL: `http://127.0.0.1:${port}/pulls?${query}`,
      WM_COLLECTION_URL: `http://127.0.0.1:${port}/collection.html`,
      WIKIMASTERS_EMAIL: 'test@example.com',
      WIKIMASTERS_PASSWORD: 'secret-test',
      SCAN_COLLECTION: 'true',
      WM_PRETTY_OUTPUT: 'true',
      WM_LOGIN_TIMEOUT: '1500',
      WM_CLOUDFLARE_WAIT_MS: '200',
      ...extraEnv
    }
  });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  child.on('close', code => resolve({ code, output }));
});

server.listen(0, '127.0.0.1', async () => {
  try {
    const success = await run(server.address().port, 'persistent-next=1&delayed-next=1&challenge=1&quick-check=1');
    assert.equal(success.code, 0, success.output);
    assert.match(success.output, /"packs":2,"cards":6/);
    assert.match(success.output, /Ouverture des boosters en cours/);
    assert.match(success.output, /Étiquetage de la collection en cours/);
    assert.match(success.output, /Nettoyage de la collection en cours/);
    assert.match(success.output, /Vérification manuelle du site terminée/);

    fs.writeFileSync(storageStatePath, JSON.stringify({ cookies: [{
      name: 'sb-test-auth-token', value: 'valid', domain: '127.0.0.1', path: '/',
      expires: Math.floor(Date.now() / 1000) + 3600, httpOnly: false, secure: false, sameSite: 'Lax'
    }], origins: [] }));
    const session = await run(server.address().port, 'challenge=1', {
      WM_STORAGE_STATE_PATH: storageStatePath,
      WM_STORAGE_STATE_OUT: storageStateOutput
    });
    assert.equal(session.code, 0, session.output);
    assert.match(session.output, /"packs":2,"cards":6/);
    assert.equal(fs.existsSync(storageStateOutput), true);

    fs.rmSync(storageStateOutput, { force: true });
    const sessionFailure = await run(server.address().port, 'challenge=1', {
      WM_STORAGE_STATE_PATH: storageStatePath,
      WM_STORAGE_STATE_OUT: storageStateOutput,
      WM_COLLECTION_URL: `http://127.0.0.1:${server.address().port}/collection.html?failure=1`
    });
    assert.notEqual(sessionFailure.code, 0, sessionFailure.output);
    assert.equal(fs.existsSync(storageStateOutput), true);

    const automaticCloudflare = await run(server.address().port, 'challenge=1&cloudflare-auto=1', { WM_CLOUDFLARE_WAIT_MS: '1500' });
    assert.equal(automaticCloudflare.code, 0, automaticCloudflare.output);
    assert.match(automaticCloudflare.output, /Validation Cloudflare automatique terminée/);

    const stuck = await run(server.address().port, 'challenge=1&login-stuck=1');
    assert.notEqual(stuck.code, 0, stuck.output);
    assert.match(stuck.output, /Connexion non confirmée/);

    const cloudflare = await run(server.address().port, 'challenge=1&cloudflare=1');
    assert.notEqual(cloudflare.code, 0, cloudflare.output);
    assert.match(cloudflare.output, /Validation Cloudflare requise/);
    const failureHtml = fs.readFileSync(path.join(root, 'failure.html'), 'utf8');
    assert.doesNotMatch(failureHtml, /test@example\.com|secret-test/);

    const manualCloudflare = await run(server.address().port, 'challenge=1&cloudflare=1', { WM_MANUAL_LOGIN_HANDOFF: 'true' });
    assert.equal(manualCloudflare.code, 42, manualCloudflare.output);
    assert.match(manualCloudflare.output, /PAUSE : Connexion manuelle Cloudflare requise/);
    console.log('pack navigation: ok');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    fs.rmSync(storageStatePath, { force: true });
    fs.rmSync(storageStateOutput, { force: true });
    server.close();
  }
});
