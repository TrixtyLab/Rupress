import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '../dist/index.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const spaDir = path.join(testDir, 'fixtures', 'spa');

fs.mkdirSync(path.join(spaDir, 'assets'), { recursive: true });
fs.writeFileSync(path.join(spaDir, 'index.html'), '<!doctype html><div id="root">SPA</div>');
fs.writeFileSync(path.join(spaDir, 'assets', 'index-a1B2c3D4.js'), 'console.log("app")');
fs.writeFileSync(path.join(spaDir, 'favicon.ico'), 'ICO');

let passCount = 0;
let failCount = 0;

function pass(name, detail = '') {
  console.log(`  ✓ ${name}${detail ? ` (${detail})` : ''}`);
  passCount++;
}

function fail(name, err) {
  console.error(`  ✗ ${name}:`, err.message);
  failCount++;
}

async function check(name, fn) {
  try {
    await fn();
    pass(name);
  } catch (err) {
    fail(name, err);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function get(url, options = {}) {
  return fetch(url, { redirect: 'manual', ...options });
}

async function runTests() {
  console.log('\n--- Production: static files + SPA fallback ---');

  const prod = await serve(0, {
    static: spaDir,
    spa: true,
    cache: { maxAge: 60, immutableMaxAge: 31536000 },
    'GET /api/hello': () => ({ from: 'rust' })
  });

  await check('The entry point is served from the root', async () => {
    const res = await get(`${prod.url}/`);
    assert(res.status === 200, `Unexpected status: ${res.status}`);
    assert((await res.text()).includes('SPA'), 'Unexpected body');
  });

  await check('The unknown routes serve the entry point (SPA)', async () => {
    const res = await get(`${prod.url}/some/client/route`);
    assert(res.status === 200, `Unexpected status: ${res.status}`);
    assert((await res.text()).includes('SPA'), 'The SPA fallback did not answer');
  });

  await check('The entry point is never cached', async () => {
    const res = await get(`${prod.url}/`);
    assert(res.headers.get('cache-control') === 'no-cache', `Unexpected cache-control: ${res.headers.get('cache-control')}`);
  });

  await check('The hashed assets are cached forever', async () => {
    const res = await get(`${prod.url}/assets/index-a1B2c3D4.js`);
    assert(res.status === 200, `Unexpected status: ${res.status}`);
    assert(
      res.headers.get('cache-control') === 'public, max-age=31536000, immutable',
      `Unexpected cache-control: ${res.headers.get('cache-control')}`
    );
  });

  await check('The rest of the files use the configured cache', async () => {
    const res = await get(`${prod.url}/favicon.ico`);
    assert(
      res.headers.get('cache-control') === 'public, max-age=60',
      `Unexpected cache-control: ${res.headers.get('cache-control')}`
    );
  });

  await check('The routes of the application have priority', async () => {
    const res = await get(`${prod.url}/api/hello`);
    assert(res.status === 200, `Unexpected status: ${res.status}`);
    assert((await res.json()).from === 'rust', 'The route did not answer');
  });

  console.log('\n--- Development: proxy to the Vite dev server ---');

  let upstreamHits = 0;
  const upstream = http.createServer((req, res) => {
    upstreamHits += 1;
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html>vite dev</html>');
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
const upstreamPort = upstream.address().port;

  const dev = await serve(0, {
    proxy: {
      '/@vite': 'http://127.0.0.1:' + upstreamPort,
      '/src': 'http://127.0.0.1:' + upstreamPort,
      '*': 'http://127.0.0.1:' + upstreamPort
    },
    'GET /api/hello': () => ({ from: 'rust' })
  });

  await check('The requests are delegated to the upstream', async () => {
    const res = await get(`${dev.url}/@vite/client`);
    assert(res.status === 200, `Unexpected status: ${res.status}`);
    assert((await res.text()).includes('vite dev'), 'The upstream did not answer');
  });

  await check('The catch-all prefix delegates everything', async () => {
    const res = await get(`${dev.url}/whatever`);
    assert((await res.text()).includes('vite dev'), 'The upstream did not answer');
  });

  await check('The routes of the application have priority over the proxy', async () => {
    const res = await get(`${dev.url}/api/hello`);
    assert((await res.json()).from === 'rust', 'The route did not answer');
  });

  await check('The upstream receives the requests', async () => {
    // The two delegated requests; the route of the application never reaches it.
    assert(upstreamHits === 2, `Unexpected number of hits: ${upstreamHits}`);
  });

  await check('A prefix only matches on a path boundary', async () => {
    const scoped = await serve(0, {
      proxy: { '/api': 'http://127.0.0.1:' + upstreamPort }
    });

    const before = upstreamHits;
    await fetch(`${scoped.url}/api/users`);
    await fetch(`${scoped.url}/apixyz`);

    assert(upstreamHits === before + 1, `The prefix captured a sibling path: ${upstreamHits - before} requests`);
  });

  console.log('\n--- WebSocket: the HMR tunnel ---');

  const wsUpstream = http.createServer();
  wsUpstream.on('upgrade', (req, socket) => {
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
        'Sec-WebSocket-Accept: test\r\n\r\n'
    );
    socket.on('data', (data) => socket.write(`ECHO:${data.toString()}`));
  });
  await new Promise((resolve) => wsUpstream.listen(0, '127.0.0.1', resolve));
const wsUpstreamPort = wsUpstream.address().port;

  const wsServer = await serve(0, {
    proxy: { '/': 'http://127.0.0.1:' + wsUpstreamPort }
  });

  await check('The WebSocket connection is tunnelled to the upstream', async () => {
    const result = await new Promise((resolve, reject) => {
      const socket = net.connect(wsServer.port, '127.0.0.1');
      let received = '';

      socket.on('connect', () => {
        socket.write(
          `GET / HTTP/1.1\r\nHost: 127.0.0.1:${wsServer.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
            'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n'
        );
      });

      socket.on('data', (data) => {
        received += data.toString();

        if (received.includes('\r\n\r\n') && !received.includes('hola-hmr')) {
          socket.write('hola-hmr');
          return;
        }

        if (received.includes('ECHO:')) {
          socket.destroy();
          resolve(received);
        }
      });

      socket.on('error', reject);
      setTimeout(() => {
        socket.destroy();
        reject(new Error('The tunnel did not answer in time'));
      }, 5000);
    });

    assert(result.includes('101 Switching Protocols'), 'The handshake was not answered');
    assert(result.includes('ECHO:hola-hmr'), 'The tunnel did not forward the data');

    // Nothing but the tunneled bytes may reach the client after the handshake.
    const payload = result.split('\r\n\r\n').slice(1).join('');
    assert(payload.startsWith('ECHO:'), `Unexpected bytes in the tunnel: ${JSON.stringify(payload)}`);
  });

  await check('A WebSocket without a proxy route is rejected', async () => {
    const plain = await serve(0, { 'GET /': () => ({ ok: true }) });

    const status = await new Promise((resolve) => {
      const socket = net.connect(plain.port, '127.0.0.1');
      socket.on('connect', () => {
        socket.write(
          'GET / HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
            'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n'
        );
      });
      socket.on('data', (data) => {
        const code = Number(String(data).split(' ')[1]);
        socket.destroy();
        resolve(code);
      });
      socket.on('error', () => resolve(0));
      setTimeout(() => {
        socket.destroy();
        resolve(0);
      }, 3000);
    });

    assert(status === 501, `Unexpected status: ${status}`);
  });

  await check('The refusal of the upstream is forwarded with its body', async () => {
    const rejecting = http.createServer();
    rejecting.on('upgrade', (req, socket) => {
      socket.write('HTTP/1.1 403 Forbidden\r\nContent-Length: 11\r\n\r\nno upgrades');
    });
    await new Promise((resolve) => rejecting.listen(0, '127.0.0.1', resolve));

    const proxyServer = await serve(0, {
      proxy: { '/': `http://127.0.0.1:${rejecting.address().port}` }
    });

    const answer = await new Promise((resolve) => {
      const socket = net.connect(proxyServer.port, '127.0.0.1');
      let received = '';

      socket.on('connect', () => {
        socket.write(
          'GET / HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
            'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n'
        );
      });

      socket.on('data', (data) => {
        received += data.toString();
        if (received.includes('no upgrades')) {
          socket.destroy();
          resolve(received);
        }
      });

      socket.on('error', () => resolve(received));
      setTimeout(() => {
        socket.destroy();
        resolve(received);
      }, 3000);
    });

    assert(answer.includes('403 Forbidden'), 'The status of the upstream was not forwarded');
    assert(answer.includes('no upgrades'), 'The body of the upstream was not forwarded');
  });

  console.log(`\n========================================`);
  console.log(`Summary: ${passCount} passed, ${failCount} failed.`);
  console.log(`========================================\n`);

  process.exit(failCount > 0 ? 1 : 0);
}

runTests();
