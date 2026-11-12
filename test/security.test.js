import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { serve } from '../dist/index.js';

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

/**
 * Creates a certificate authority and a server certificate signed by it.
 */
function createCertificates(directory) {
  const openssl = process.env.OPENSSL_PATH;

  if (!openssl || !fs.existsSync(openssl)) {
    return null;
  }

  const run = (args) => execFileSync(openssl, args, { cwd: directory, stdio: 'ignore' });

  run(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '2', '-subj', '/CN=Rupress Test CA']);
  run(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'server.key', '-out', 'server.csr', '-subj', '/CN=localhost']);
  fs.writeFileSync(path.join(directory, 'ext.cnf'), 'subjectAltName=DNS:localhost,IP:127.0.0.1');
  run(['x509', '-req', '-in', 'server.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'server.pem', '-days', '2', '-extfile', 'ext.cnf']);

  return {
    ca: fs.readFileSync(path.join(directory, 'ca.pem'), 'utf8'),
    key: fs.readFileSync(path.join(directory, 'server.key')),
    cert: fs.readFileSync(path.join(directory, 'server.pem'))
  };
}

async function runTests() {
  console.log('\n--- Authentication with API keys ---');

  const server = await serve(0, {
    security: {
      auth: {
        apiKeys: {
          'key-alice': { name: 'alice', permissions: ['posts:read'] },
          'key-admin': { name: 'admin', permissions: ['admin', 'posts:read'] }
        },
        allowAnonymous: false
      }
    },

    'GET /public': () => ({ public: true }),

    '/admin': {
      auth: { permissions: ['admin'] },
      GET: ({ user }) => ({ secret: true, user })
    },

    '/reader': {
      auth: { anyOf: ['posts:read', 'editor'] },
      GET: ({ user }) => ({ ok: true, user })
    }
  });

  const call = (requestPath, headers = {}) =>
    fetch(`${server.url}${requestPath}`, { headers }).then(async (res) => ({
      status: res.status,
      body: await res.json()
    }));

  await check('A request without credentials is rejected', async () => {
    const res = await call('/public');
    assert(res.status === 401, `Unexpected status: ${res.status}`);
  });

  await check('An unknown API key is rejected', async () => {
    const res = await call('/public', { 'x-api-key': 'not-a-key' });
    assert(res.status === 401, `Unexpected status: ${res.status}`);
  });

  await check('A valid API key is accepted', async () => {
    const res = await call('/public', { 'x-api-key': 'key-alice' });
    assert(res.status === 200, `Unexpected status: ${res.status}`);
  });

  await check('The identity is available in the context', async () => {
    const res = await call('/public', { 'x-api-key': 'key-alice' });
    assert(res.body.public === true, 'The handler did not run');
  });

  await check('The route permissions are enforced', async () => {
    const res = await call('/admin', { 'x-api-key': 'key-alice' });
    assert(res.status === 403, `Unexpected status: ${res.status}`);
  });

  await check('An identity with the permissions is accepted', async () => {
    const res = await call('/admin', { 'x-api-key': 'key-admin' });
    assert(res.status === 200, `Unexpected status: ${res.status}`);
    assert(res.body.user.name === 'admin', 'The identity was not exposed');
    assert(res.body.user.permissions.includes('admin'), 'The permissions were not exposed');
  });

  await check('The anyOf permissions are enforced', async () => {
    const res = await call('/reader', { 'x-api-key': 'key-alice' });
    assert(res.status === 200, `Unexpected status: ${res.status}`);
  });

  await check('The anonymous identity is null', async () => {
    const anonymous = await serve(0, {
      security: { auth: { apiKeys: { 'key-alice': 'alice' }, allowAnonymous: true } },
      'GET /me': ({ user }) => ({ user })
    });

    const res = await fetch(`${anonymous.url}/me`);
    const data = await res.json();
    assert(data.user === null, `Unexpected identity: ${JSON.stringify(data.user)}`);
  });

  console.log('\n--- The rate limit by key (users behind the same NAT) ---');

  const limited = await serve(0, {
    security: {
      rateLimit: { max: 2, windowSecs: 60, keyBy: 'x-api-key' }
    },
    'GET /limited': () => ({ ok: true })
  });

  const limitedCall = (key) =>
    fetch(`${limited.url}/limited`, { headers: { 'x-api-key': key } }).then((res) => res.status);

  await check('Every key has its own quota', async () => {
    const first = await limitedCall('client-a');
    const second = await limitedCall('client-a');
    const third = await limitedCall('client-a');
    const other = await limitedCall('client-b');

    assert(first === 200, `Unexpected status: ${first}`);
    assert(second === 200, `Unexpected status: ${second}`);
    assert(third === 429, `The limit was not applied: ${third}`);
    assert(other === 200, `The quota is shared between clients: ${other}`);
  });

  await check('The first header present identifies the client', async () => {
    const multi = await serve(0, {
      security: { rateLimit: { max: 1, windowSecs: 60, keyBy: ['x-api-key', 'authorization'] } },
      'GET /r': () => ({ ok: true })
    });

    const call = (headers) => fetch(`${multi.url}/r`, { headers }).then((res) => res.status);

    assert((await call({ 'x-api-key': 'a' })) === 200, 'The first request failed');
    assert((await call({ 'x-api-key': 'a' })) === 429, 'The limit was not applied');
    assert((await call({ authorization: 'Bearer b' })) === 200, 'The quota is shared');
  });

  console.log('\n--- The HTTPS proxy ---');

  const certificates = createCertificates(fs.mkdtempSync(path.join(os.tmpdir(), 'rupress-tls-')));

  if (!certificates) {
    console.log('  ⊘ The TLS tests are skipped (openssl is not available)');
  } else {
    const upstream = https.createServer(
      { key: certificates.key, cert: certificates.cert },
      (req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ from: 'https-upstream', url: req.url }));
      }
    );
    await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
const upstreamPort = upstream.address().port;

    await check('An untrusted certificate is rejected', async () => {
      const strict = await serve(0, { proxy: { '*': 'https://localhost:' + upstreamPort } });
      const res = await fetch(`${strict.url}/x`);
      assert(res.status === 502, `Unexpected status: ${res.status}`);
    });

    await check('The upstream is reached with the trusted certificate', async () => {
      const trusted = await serve(0, {
        security: { tls: { ca: certificates.ca } },
        proxy: { '*': 'https://localhost:' + upstreamPort }
      });
      const res = await fetch(`${trusted.url}/x`);
      assert(res.status === 200, `Unexpected status: ${res.status}`);
      const data = await res.json();
      assert(data.from === 'https-upstream', 'The upstream did not answer');
    });

    await check('The verification can be disabled for development', async () => {
      const insecure = await serve(0, {
        security: { tls: { insecure: true } },
        proxy: { '*': 'https://localhost:' + upstreamPort }
      });
      const res = await fetch(`${insecure.url}/y`);
      assert(res.status === 200, `Unexpected status: ${res.status}`);
    });

    upstream.close();
  }

  console.log(`\n========================================`);
  console.log(`Summary: ${passCount} passed, ${failCount} failed.`);
  console.log(`========================================\n`);

  process.exit(failCount > 0 ? 1 : 0);
}

runTests();
