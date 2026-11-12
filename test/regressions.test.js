import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  serve,
  App,
  HttpError,
  HttpRedirect,
  HttpClientError,
  HttpServerError,
  ok
} from '../dist/index.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(testDir, 'fixtures');
const publicDir = path.join(fixturesDir, 'public');

fs.mkdirSync(publicDir, { recursive: true });
fs.writeFileSync(path.join(publicDir, 'index.html'), '<h1>index</h1>');
fs.writeFileSync(path.join(publicDir, 'my file.txt'), 'espacio');
fs.writeFileSync(path.join(fixturesDir, 'secret.txt'), 'TOP SECRET');

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

function raw(port, requestPath, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { port, path: requestPath, host: '127.0.0.1', method: options.method || 'GET', headers: options.headers },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
      }
    );
    req.on('error', reject);
    req.end(options.body);
  });
}

async function runTests() {
  const server = await serve(0, {
    static: publicDir,

    'GET /query': ({ query }) => query,

    'GET /params/:name': ({ params }) => params,

    'GET /invalid-status': () => ({ status: 9999, body: 'nope' }),

    'GET /weird-headers': () => ({
      status: 200,
      headers: { 'Content-Type': 'text/plain', 'X-Injected': 'value\r\nX-Evil: yes' },
      body: 'ok'
    }),

    'GET /not-modified': () => new HttpRedirect.NotModified(),

    'GET /data-status': () => ({
      status: 'online',
      engine: 'Rust-Hyper'
    }),

    'GET /boom': () => {
      throw new TypeError('Cannot read properties of undefined');
    }
  });

  console.log('\n--- Encoding of the query string and the parameters ---');

  await check('The query string is percent-decoded', async () => {
    const res = await raw(server.port, '/query?name=John%20Doe&city=Valle%2Bdas&flag');
    const data = JSON.parse(res.body);
    assert(data.name === 'John Doe', `Unexpected name: ${data.name}`);
    assert(data.city === 'Valle+das', `Unexpected city: ${data.city}`);
    assert(data.flag === '', `Unexpected flag: ${data.flag}`);
  });

  await check('The route parameters are percent-decoded', async () => {
    const res = await raw(server.port, '/params/John%20Doe');
    const data = JSON.parse(res.body);
    assert(data.name === 'John Doe', `Unexpected name: ${data.name}`);
  });

  console.log('\n--- Static files ---');

  await check('The static directory is served from the root', async () => {
    const res = await raw(server.port, '/index.html');
    assert(res.status === 200, `Unexpected status: ${res.status}`);
    assert(res.body.includes('index'), 'Unexpected body');
  });

  await check('The root path serves index.html', async () => {
    const res = await raw(server.port, '/');
    assert(res.status === 200, `Unexpected status: ${res.status}`);
  });

  await check('The static file names are decoded', async () => {
    const res = await raw(server.port, '/my%20file.txt');
    assert(res.status === 200, `Unexpected status: ${res.status}`);
    assert(res.body === 'espacio', 'Unexpected body');
  });

  await check('Path traversal is blocked', async () => {
    for (const attack of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/%2e%2e%2fsecret.txt']) {
      const res = await raw(server.port, attack);
      assert(res.status === 404, `Traversal not blocked (${attack}): ${res.status}`);
      assert(!res.body.includes('TOP SECRET'), 'The secret file was leaked');
    }
  });

  console.log('\n--- Response integrity ---');

  await check('An invalid status code is replaced by 500', async () => {
    const res = await raw(server.port, '/invalid-status');
    assert(res.status === 500, `Unexpected status: ${res.status}`);
  });

  await check('The header names are normalized to lowercase', async () => {
    const res = await raw(server.port, '/weird-headers');
    const contentTypes = res.headers['content-type'];
    assert(typeof contentTypes === 'string', 'The content type is not a single value');
    assert(res.headers['x-injected'] === undefined, 'The injected header was sent');
    assert(res.headers['x-evil'] === undefined, 'The header injection succeeded');
  });

  await check('304 Not Modified does not send a location header', async () => {
    const res = await raw(server.port, '/not-modified');
    assert(res.status === 304, `Unexpected status: ${res.status}`);
    assert(res.headers.location === undefined, 'A location header was sent');
  });

  await check('A data object with a status property is the body of the response', async () => {
    const res = await raw(server.port, '/data-status');
    assert(res.status === 200, `Unexpected status: ${res.status}`);
    const data = JSON.parse(res.body);
    assert(data.status === 'online', `Unexpected body: ${res.body}`);
    assert(data.engine === 'Rust-Hyper', `Unexpected body: ${res.body}`);
  });

  await check('Unexpected errors are reported in the console', async () => {
    const original = console.error;
    const lines = [];
    console.error = (...args) => lines.push(args.map(String).join(' '));

    try {
      const res = await raw(server.port, '/boom');
      assert(res.status === 500, `Unexpected status: ${res.status}`);
    } finally {
      console.error = original;
    }

    assert(
      lines.some((line) => line.includes('/boom')),
      'The error was not reported in the console'
    );
  });

  await check('The security headers are applied', async () => {
    const res = await raw(server.port, '/query');
    assert(res.headers['x-content-type-options'] === 'nosniff', 'Missing nosniff header');
    assert(res.headers['x-frame-options'] === 'SAMEORIGIN', 'Missing frame options header');
  });

  await check('The error envelope is consistent', async () => {
    const res = await raw(server.port, '/does-not-exist');
    const data = JSON.parse(res.body);
    assert(res.status === 404, `Unexpected status: ${res.status}`);
    assert(data.error === 'Not Found', 'Unexpected error title');
    assert(data.status === 404, 'Unexpected error status');
    assert(typeof data.timestamp === 'string', 'Missing timestamp');
    assert(typeof data.path === 'string', 'Missing path');
  });

  console.log('\n--- Configuration ---');

  await check('serve() resolves the real port when it is 0', async () => {
    const ephemeral = await serve(0, { 'GET /': () => ok({}) });
    assert(ephemeral.port > 0, `Unexpected port: ${ephemeral.port}`);
    assert(ephemeral.url.endsWith(`:${ephemeral.port}`), `Unexpected url: ${ephemeral.url}`);
    const res = await raw(ephemeral.port, '/');
    assert(res.status === 200, `Unexpected status: ${res.status}`);
  });

  await check('The rate limit is applied by App.security()', async () => {
    const app = new App();
    app.security({ rateLimit: { max: 1, windowSecs: 30 } });
    app.get('/limited', () => ok({}));
    const port = await app.listen(0, '127.0.0.1');

    const first = await raw(port, '/limited');
    const second = await raw(port, '/limited');

    assert(first.status === 200, `Unexpected first status: ${first.status}`);
    assert(second.status === 429, `The rate limit was not applied: ${second.status}`);
    assert(Number(second.headers['retry-after']) === 30, 'Unexpected retry-after header');

    const body = JSON.parse(second.body);
    assert(body.status === 429, 'The rate limit response is not the standard envelope');
  });

  await check('An invalid port is rejected', async () => {
    let thrown = null;
    try {
      await serve(70000, {});
    } catch (err) {
      thrown = err;
    }
    assert(thrown instanceof TypeError, 'The invalid port was not rejected');
  });

  await check('A missing static directory is rejected', async () => {
    let thrown = null;
    try {
      await serve(0, { static: path.join(fixturesDir, 'does-not-exist') });
    } catch (err) {
      thrown = err;
    }
    assert(thrown instanceof Error, 'The missing directory was not rejected');
  });

  console.log('\n--- Error helpers ---');

  await check('The static factories work with and without new', async () => {
    const direct = HttpError.NotFound('missing');
    const constructed = new HttpError.NotFound('missing');
    assert(direct.status === 404, 'Unexpected status');
    assert(constructed.status === 404, 'Unexpected status');
    assert(constructed instanceof HttpClientError, 'Unexpected prototype');
    assert(new HttpServerError(503).status === 503, 'Unexpected status');
  });

  console.log('\n--- Declarative validation of the fields ---');

  const validationServer = await serve(0, {
    '/posts/:id': {
      fields: {
        post: {
          title: { type: 'string', required: true }
        }
      },
      GET: ({ params }) => ({ postId: params.id }),
      POST: ({ params, body }) => ({ saved: true, content: body })
    },

    '/flat': {
      fields: {
        email: { type: 'email', required: true },
        age: { type: 'integer', required: true, min: 0, max: 150 },
        role: { type: 'string', enum: ['admin', 'user'], required: true },
        nickname: { type: 'string', required: false, default: 'anon' }
      },
      POST: ({ body }) => body
    },

    '/custom-status': {
      fields: {
        token: { type: 'string', required: true, status: 401 }
      },
      POST: ({ body }) => body
    },

    '/app-error': {
      fields: {
        anything: { type: 'string', required: false }
      },
      POST: () => {
        throw HttpError.Conflict('The application error always wins');
      }
    }
  });

  function post(port, requestPath, body) {
    return raw(port, requestPath, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
  }

  await check('A missing required field is rejected with 422', async () => {
    const res = await post(validationServer.port, '/posts/1', { post: {} });
    assert(res.status === 422, `Unexpected status: ${res.status}`);
    const data = JSON.parse(res.body);
    assert(data.message === 'Field post.title is required', `Unexpected message: ${data.message}`);
    assert(data.details.field === 'post.title', `Unexpected field: ${data.details?.field}`);
    assert(data.details.reason === 'required', `Unexpected reason: ${data.details?.reason}`);
  });

  await check('A valid payload reaches the handler', async () => {
    const res = await post(validationServer.port, '/posts/1', { post: { title: 'Hola' } });
    assert(res.status === 200, `Unexpected status: ${res.status}`);
    const data = JSON.parse(res.body);
    assert(data.saved === true, 'The handler did not run');
  });

  await check('The type of a field is validated', async () => {
    const res = await post(validationServer.port, '/flat', { email: 'not-an-email', age: 30, role: 'user' });
    assert(res.status === 422, `Unexpected status: ${res.status}`);
    const data = JSON.parse(res.body);
    assert(data.message.includes('email'), `Unexpected message: ${data.message}`);
    assert(data.details.expected === 'email', 'Unexpected expected type');
  });

  await check('The range of a field is validated', async () => {
    const res = await post(validationServer.port, '/flat', { email: 'a@b.com', age: 999, role: 'user' });
    assert(res.status === 422, `Unexpected status: ${res.status}`);
    const data = JSON.parse(res.body);
    assert(data.details.field === 'age', `Unexpected field: ${data.details?.field}`);
  });

  await check('The enumeration of a field is validated', async () => {
    const res = await post(validationServer.port, '/flat', { email: 'a@b.com', age: 30, role: 'root' });
    assert(res.status === 422, `Unexpected status: ${res.status}`);
    const data = JSON.parse(res.body);
    assert(data.details.field === 'role', `Unexpected field: ${data.details?.field}`);
  });

  await check('The default value of an optional field is applied', async () => {
    const res = await post(validationServer.port, '/flat', { email: 'a@b.com', age: 30, role: 'user' });
    assert(res.status === 200, `Unexpected status: ${res.status}`);
    const data = JSON.parse(res.body);
    assert(data.nickname === 'anon', `Unexpected nickname: ${data.nickname}`);
  });

  await check('Each field can delegate its own status code', async () => {
    const res = await post(validationServer.port, '/custom-status', {});
    assert(res.status === 401, `Unexpected status: ${res.status}`);
    const data = JSON.parse(res.body);
    assert(data.error === 'Unauthorized', `Unexpected error: ${data.error}`);
  });

  await check('The error thrown by the application is never replaced', async () => {
    const res = await post(validationServer.port, '/app-error', {});
    assert(res.status === 409, `Unexpected status: ${res.status}`);
    const data = JSON.parse(res.body);
    assert(data.message === 'The application error always wins', `Unexpected message: ${data.message}`);
  });

  await check('The schema does not affect the methods without body', async () => {
    const res = await raw(validationServer.port, '/posts/7');
    assert(res.status === 200, `Unexpected status: ${res.status}`);
  });

  console.log('\n--- Validation of the query string and the path parameters ---');
  const queryServer = await serve(0, {
    '/query': { query: { page: { type: 'integer', default: 1 } }, GET: ({ query }) => query },
    '/named': { fields: { status: { type: 'string', required: true } }, POST: ({ body }) => body },
    '/posts/:id': {
      fields: {
        post: { title: { type: 'string', required: true } }
      },
      query: {
        page: { type: 'integer', required: false, default: 1 },
        sort: { type: 'string', enum: ['asc', 'desc'], required: false, default: 'asc' }
      },
      params: {
        id: { type: 'integer', required: true }
      },
      GET: ({ params, query }) => ({ params, query }),
      POST: ({ params, body }) => ({ params, body })
    }
  });

  await check('The query string is validated in GET', async () => {
    const res = await raw(queryServer.port, '/posts/7?page=3&sort=desc');
    assert(res.status === 200, `Unexpected status: ${res.status}`);
    const data = JSON.parse(res.body);
    assert(data.query.page === 3, `The value was not coerced: ${JSON.stringify(data.query)}`);
    assert(data.query.sort === 'desc', 'Unexpected sort');
  });

  await check('The default values of the query are applied', async () => {
    const res = await raw(queryServer.port, '/posts/7');
    assert(res.status === 200, `Unexpected status: ${res.status}`);
    const data = JSON.parse(res.body);
    assert(data.query.page === 1, `Unexpected page: ${data.query.page}`);
    assert(data.query.sort === 'asc', `Unexpected sort: ${data.query.sort}`);
  });

  await check('An invalid query value is rejected', async () => {
    const res = await raw(queryServer.port, '/posts/7?page=abc');
    assert(res.status === 422, `Unexpected status: ${res.status}`);
    const data = JSON.parse(res.body);
    assert(data.details.field === 'page', `Unexpected field: ${data.details?.field}`);
  });

  await check('The enumeration of the query is validated', async () => {
    const res = await raw(queryServer.port, '/posts/7?sort=random');
    assert(res.status === 422, `Unexpected status: ${res.status}`);
    const data = JSON.parse(res.body);
    assert(data.details.field === 'sort', `Unexpected field: ${data.details?.field}`);
  });

  await check('The path parameters are validated in GET', async () => {
    const res = await raw(queryServer.port, '/posts/abc');
    assert(res.status === 422, `Unexpected status: ${res.status}`);
    const data = JSON.parse(res.body);
    assert(data.details.field === 'id', `Unexpected field: ${data.details?.field}`);
    assert(data.details.expected === 'integer', 'Unexpected expected type');
  });

  await check('The body schema does not affect GET', async () => {
    const res = await raw(queryServer.port, '/posts/7');
    assert(res.status === 200, `Unexpected status: ${res.status}`);
  });

  await check('The body schema is still validated in POST', async () => {
    const res = await raw(queryServer.port, '/posts/7', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ post: {} })
    });
    assert(res.status === 422, `Unexpected status: ${res.status}`);
    const data = JSON.parse(res.body);
    assert(data.details.field === 'post.title', `Unexpected field: ${data.details?.field}`);
  });

  await check('A data object with a body property is not a response descriptor', async () => {
    const res = await raw(queryServer.port, '/posts/7');
    assert(res.status === 200, `Unexpected status: ${res.status}`);
    const data = JSON.parse(res.body);
    assert(data.params !== undefined, 'The response was not serialized as data');
  });

  await check('An empty query value is missing, not zero', async () => {
    const res = await raw(queryServer.port, '/query?page=');
    assert(res.status === 200, `Unexpected status: ${res.status}`);
    const data = JSON.parse(res.body);
    assert(data.page === 1, `Unexpected page: ${data.page}`);
  });

  await check('A field named like an option is validated', async () => {
    const res = await raw(queryServer.port, '/named', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'paid' })
    });
    assert(res.status === 200, `Unexpected status: ${res.status}`);

    const invalid = await raw(queryServer.port, '/named', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ other: 'x' })
    });
    assert(invalid.status === 422, `Unexpected status: ${invalid.status}`);
  });

  await check('The 405 answer includes the Allow header', async () => {
    const res = await raw(queryServer.port, '/query', { method: 'DELETE' });
    assert(res.status === 405, `Unexpected status: ${res.status}`);
    assert(res.headers.allow !== undefined, 'The Allow header is missing');
  });

  await check('An invalid route declaration is rejected', async () => {
    let thrown = null;
    try {
      await serve(0, { 'INVALID /x': () => ({}) });
    } catch (err) {
      thrown = err;
    }
    assert(thrown instanceof TypeError, 'The invalid route was not rejected');
  });

  console.log(`\n========================================`);
  console.log(`Summary: ${passCount} passed, ${failCount} failed.`);
  console.log(`========================================\n`);

  process.exit(failCount > 0 ? 1 : 0);
}

runTests();
