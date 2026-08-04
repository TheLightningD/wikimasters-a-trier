const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = __dirname;
const server = http.createServer((request, response) => {
  const file = path.join(root, request.url === '/' ? 'test.html' : request.url.slice(1));
  if (!fs.existsSync(file)) { response.writeHead(404).end(); return; }
  response.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : 'text/html');
  fs.createReadStream(file).pipe(response);
});

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  const child = spawn(process.execPath, ['worker.js'], {
    cwd: root,
    env: {
      ...process.env,
      WM_URL: `http://127.0.0.1:${port}/test.html`,
      WM_COLLECTION_URL: `http://127.0.0.1:${port}/collection.html`,
      SCAN_COLLECTION: 'true'
    }
  });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  child.on('close', code => {
    server.close();
    if (code !== 0 || !output.includes('"packs":2') || !output.includes('"collection":{"packs":0,"cards":2}') || !output.includes('"testVerified":6')) {
      console.error(output.trim());
      process.exit(1);
    }
    console.log(output.trim());
  });
});
