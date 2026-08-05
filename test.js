const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = __dirname;
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const file = path.join(root, pathname === '/' ? 'test.html' : pathname.slice(1));
  if (!fs.existsSync(file)) { response.writeHead(404).end(); return; }
  response.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : 'text/html');
  fs.createReadStream(file).pipe(response);
});

server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  const run = extraEnv => new Promise(resolve => {
    const child = spawn(process.execPath, ['worker.js'], {
      cwd: root,
      env: {
        ...process.env,
        WM_URL: `http://127.0.0.1:${port}/test.html`,
        WM_COLLECTION_URL: `http://127.0.0.1:${port}/collection.html`,
        SCAN_COLLECTION: 'true',
        ...extraEnv
      }
    });
    let output = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    child.on('close', code => resolve({ code, output }));
  });

  const success = await run();
  const failure = await run({ COLLECTION_ONLY: 'true', WM_COLLECTION_URL: `http://127.0.0.1:${port}/collection.html?failure=1` });
  server.close();
  if (success.code !== 0 || !success.output.includes('"packs":2') || !success.output.includes('"collection":{"packs":0,"cards":2}') || !success.output.includes('"cleanup":{"packs":0,"cards":2}') || !success.output.includes('"target-only":["à trier"]') || !success.output.includes('"target-other":["favori"]') || !success.output.includes('"target-others":["favori","rare"]') || !success.output.includes('"other-only":["favori"]') || !success.output.includes('"testVerified":6') || failure.code === 0 || !failure.output.includes('Retrait « à trier » non confirmé')) {
    console.error(success.output.trim(), failure.output.trim());
    process.exit(1);
  }
  console.log(success.output.trim());
  console.log('Retrait non confirmé: échec explicite vérifié');
});
