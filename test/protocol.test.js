import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Suite, request, rawRequest } from './helpers.js';

const suite = new Suite('HTTP protocol');
const { serve } = await import('../dist/index.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const staticDir = path.join(root, 'test', 'fixtures', 'protocol');
fs.mkdirSync(staticDir, { recursive: true });
fs.writeFileSync(path.join(staticDir, 'index.html'), '<h1>root</h1>');
fs.writeFileSync(path.join(staticDir, 'style.css'), 'body{}');
fs.writeFileSync(path.join(staticDir, 'app.js'), 'console.log(1)');
fs.writeFileSync(path.join(staticDir, 'data.json'), '{"a":1}');
fs.writeFileSync(path.join(staticDir, 'photo.png'), 'PNG');

const server = await serve(0, {
  cors: true,
  static: staticDir,
  'GET /': () => ({ ok: true }),
  'GET /text': () => 'plain text',
  'GET /html': () => ({ status: 200, headers: { 'Content-Type': 'text/html' }, body: '<p>html</p>' }),
  'GET /binary': () => Buffer.from([1, 2, 3, 4]),
  'GET /empty': () => ({ status: 204 }),
  'POST /echo': ({ body }) => ({ received: body }),
  'GET /query': ({ query }) => query,
  'GET /params/:id/:other': ({ params }) => params
});

suite.section('The methods');

await suite.test('A GET answers 200 with the body', async () => {
  const response = await request(`${server.url}/`);
  suite.equal(response.status, 200, 'Unexpected status');
  suite.deepEqual(response.json, { ok: true }, 'Unexpected body');
});

await suite.test('A HEAD answers like the GET but without a body', async () => {
  const response = await request(`${server.url}/`, { method: 'HEAD' });
  suite.equal(response.status, 200, 'Unexpected status');
  suite.equal(response.text, '', 'The HEAD response has a body');
});

await suite.test('An unknown method answers 405 with the Allow header', async () => {
  const response = await request(`${server.url}/`, { method: 'PUT' });
  suite.equal(response.status, 405, 'Unexpected status');
  suite.assert(response.headers.get('allow')?.includes('GET'), 'The Allow header is missing');
});

await suite.test('A POST reaches the handler', async () => {
  const response = await request(`${server.url}/echo`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ a: 1 })
  });
  suite.equal(response.status, 200, 'Unexpected status');
  suite.deepEqual(response.json.received, { a: 1 }, 'Unexpected body');
});

suite.section('CORS');

await suite.test('The preflight answers 204 with the allowed methods', async () => {
  const response = await request(`${server.url}/`, { method: 'OPTIONS' });
  suite.equal(response.status, 204, 'Unexpected status');
  suite.equal(response.headers.get('access-control-allow-origin'), '*', 'The origin is missing');
  suite.assert(
    response.headers.get('access-control-allow-methods')?.includes('POST'),
    'The allowed methods are missing'
  );
});

await suite.test('The normal responses carry the CORS header', async () => {
  const response = await request(`${server.url}/`);
  suite.equal(response.headers.get('access-control-allow-origin'), '*', 'The origin is missing');
});

suite.section('The bodies');

await suite.test('A string body is sent as plain text', async () => {
  const response = await request(`${server.url}/text`);
  suite.equal(response.text, 'plain text', 'Unexpected body');
  suite.assert(
    response.headers.get('content-type')?.includes('text/plain'),
    `Unexpected content type: ${response.headers.get('content-type')}`
  );
});

await suite.test('The content type of the user is respected', async () => {
  const response = await request(`${server.url}/html`);
  suite.equal(response.headers.get('content-type'), 'text/html', 'Unexpected content type');
  suite.equal(response.text, '<p>html</p>', 'Unexpected body');
});

await suite.test('A binary body is sent untouched', async () => {
  const response = await fetch(`${server.url}/binary`);
  const buffer = Buffer.from(await response.arrayBuffer());
  suite.deepEqual([...buffer], [1, 2, 3, 4], 'Unexpected body');
});

await suite.test('A 204 has no body', async () => {
  const response = await request(`${server.url}/empty`);
  suite.equal(response.status, 204, 'Unexpected status');
  suite.equal(response.text, '', 'The response has a body');
});

await suite.test('An empty body is accepted', async () => {
  const response = await request(`${server.url}/echo`, { method: 'POST' });
  suite.equal(response.status, 200, 'Unexpected status');
});

await suite.test('A chunked body is assembled', async () => {
  const answer = await new Promise((resolve) => {
    const req = http.request({
      port: server.port,
      path: '/echo',
      method: 'POST',
      host: '127.0.0.1',
      headers: { 'transfer-encoding': 'chunked', 'content-type': 'application/json' }
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.write('{"a":');
    req.write('1}');
    req.end();
  });

  suite.equal(answer.status, 200, 'Unexpected status');
  suite.assert(answer.body.includes('"a":1'), `Unexpected body: ${answer.body}`);
});

await suite.test('A 100-continue handshake is answered', async () => {
  const answer = await new Promise((resolve) => {
    const req = http.request({
      port: server.port,
      path: '/echo',
      method: 'POST',
      host: '127.0.0.1',
      headers: { 'content-type': 'application/json', 'expect': '100-continue' }
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });

    req.on('error', () => resolve({ status: 0, body: '' }));
    req.on('continue', () => req.end('{"b":2}'));

    // Only the headers are sent: the body goes after the "100 Continue".
    req.flushHeaders();
  });

  suite.equal(answer.status, 200, 'Unexpected status');
  suite.assert(answer.body.includes('"b":2'), `Unexpected body: ${answer.body}`);
});

suite.section('The query string and the parameters');

await suite.test('The query string is decoded', async () => {
  const response = await request(`${server.url}/query?name=John%20Doe&city=Valle%2Bdas`);
  suite.deepEqual(response.json, { name: 'John Doe', city: 'Valle+das' }, 'Unexpected query');
});

await suite.test('A parameter without a value is empty', async () => {
  const response = await request(`${server.url}/query?flag`);
  suite.equal(response.json.flag, '', 'Unexpected query');
});

await suite.test('The route parameters are decoded', async () => {
  const response = await request(`${server.url}/params/John%20Doe/42`);
  suite.deepEqual(response.json, { id: 'John Doe', other: '42' }, 'Unexpected params');
});

suite.section('The static files');

await suite.test('The MIME types are correct', async () => {
  const cases = [
    ['/index.html', 'text/html'],
    ['/style.css', 'text/css'],
    ['/app.js', 'application/javascript'],
    ['/data.json', 'application/json'],
    ['/photo.png', 'image/png']
  ];

  for (const [file, type] of cases) {
    const response = await request(`${server.url}${file}`);
    suite.equal(response.status, 200, `The file "${file}" was not served`);
    suite.assert(
      response.headers.get('content-type')?.includes(type),
      `The content type of "${file}" is ${response.headers.get('content-type')}, expected ${type}`
    );
  }
});

await suite.test('The hidden files are not served', async () => {
  const response = await request(`${server.url}/.env`);
  suite.equal(response.status, 404, 'The hidden file was served');
});

await suite.test('The security headers are applied', async () => {
  const response = await request(`${server.url}/`);
  suite.equal(response.headers.get('x-content-type-options'), 'nosniff', 'Missing header');
  suite.equal(response.headers.get('x-frame-options'), 'SAMEORIGIN', 'Missing header');
  suite.assert(response.headers.get('referrer-policy'), 'Missing header');
});

suite.section('The robustness of the connection');

await suite.test('Several requests reuse the same connection', async () => {
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  const first = await request(`${server.url}/`, { agent });
  const second = await request(`${server.url}/`, { agent });

  suite.equal(first.status, 200, 'Unexpected status');
  suite.equal(second.status, 200, 'Unexpected status');
  agent.destroy();
});

await suite.test('A malformed request is answered with 400', async () => {
  const answer = await rawRequest(server.port, 'GARBAGE\r\n\r\n');
  suite.assert(answer.includes('400'), `Unexpected answer: ${answer.split('\r\n')[0]}`);
});

await suite.test('A flood of headers is answered with 431', async () => {
  const headers = Array.from({ length: 300 }, (_, index) => `X-H${index}: v`).join('\r\n');
  const answer = await rawRequest(server.port, `GET / HTTP/1.1\r\nHost: x\r\n${headers}\r\n\r\n`);
  suite.assert(answer.includes('431'), `Unexpected answer: ${answer.split('\r\n')[0]}`);
});

await suite.test('A huge header is answered with 431', async () => {
  const answer = await rawRequest(server.port, `GET / HTTP/1.1\r\nHost: x\r\nX-Big: ${'a'.repeat(100000)}\r\n\r\n`);
  suite.assert(answer.includes('431'), `Unexpected answer: ${answer.split('\r\n')[0]}`);
});

await suite.test('A huge URL is answered with 431', async () => {
  const answer = await rawRequest(server.port, `GET /${'a'.repeat(100000)} HTTP/1.1\r\nHost: x\r\n\r\n`);
  suite.assert(answer.includes('431'), `Unexpected answer: ${answer.split('\r\n')[0]}`);
});

await suite.test('The concurrent requests are all answered', async () => {
  // The rate limit is disabled so the concurrency is the only variable.
  const unlimited = await serve(0, {
    security: { rateLimit: false },
    'GET /': () => ({ ok: true })
  });

  const responses = await Promise.all(
    Array.from({ length: 100 }, () => request(`${unlimited.url}/`))
  );

  const ok = responses.filter((response) => response.status === 200).length;
  suite.equal(ok, 100, 'Some requests were not answered');
});

await suite.test('The rate limit answers 429 to the requests that exceed the quota', async () => {
  const limited = await serve(0, {
    security: { rateLimit: { max: 5, windowSecs: 60 } },
    'GET /': () => ({ ok: true })
  });

  const responses = await Promise.all(
    Array.from({ length: 10 }, () => request(`${limited.url}/`))
  );

  const limited_ = responses.filter((response) => response.status === 429);
  const ok = responses.filter((response) => response.status === 200);

  suite.equal(ok.length, 5, 'Unexpected number of accepted requests');
  suite.equal(limited_.length, 5, 'Unexpected number of rejected requests');
  suite.assert(limited_[0]?.headers.get('retry-after'), 'The Retry-After header is missing');
});

suite.finish();
