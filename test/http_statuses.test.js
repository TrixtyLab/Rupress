import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  serve,
  ok,
  created,
  accepted,
  noContent,
  redirect,
  info,
  success,
  error,
  clientError,
  serverError,
  statusCategory,
  statusText,
  HttpSuccess,
  HttpRedirect,
  HttpError,
  HttpInfo,
  HttpClientError,
  HttpServerError,
  HttpStatus,
  HTTP_STATUS_CODES,
  EarlyHints,
  Created,
  NoContent,
  MovedPermanently,
  Teapot,
  BadRequest,
  NotFound,
  ServiceUnavailable
} from '../dist/index.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(testDir, '..', 'dist');

const server = await serve(0, {
  cors: true,

  // Informational 1xx (interim responses, observed through the `information` event)
  'GET /test/1xx/hints': () => {
    return new EarlyHints({ link: '</style.css>; rel=preload; as=style' });
  },

  'GET /test/1xx/info': () => {
    return info(100);
  },

  'GET /test/1xx/with-final': () => {
    return new EarlyHints({ link: '</app.css>' }).withFinal(ok({ ready: true }));
  },

  // Successful 2xx
  'GET /test/2xx/ok': () => {
    return ok({ message: 'Success OK' });
  },

  'POST /test/2xx/created': () => {
    return created({ id: 42, name: 'Item 42' }, '/test/2xx/items/42');
  },

  'POST /test/2xx/accepted': () => {
    return accepted({ jobId: 'abc-123' });
  },

  'DELETE /test/2xx/nocontent': () => {
    return noContent();
  },

  // Redirection 3xx
  'GET /test/3xx/redirect': () => {
    return redirect('/destination', 302);
  },

  'GET /test/3xx/permanent': () => {
    return redirect.permanent('/permanent-destination');
  },

  'GET /test/3xx/thrown': () => {
    throw HttpRedirect.Found('/login-page');
  },

  // Client Errors 4xx
  'GET /test/4xx/bad-request': () => {
    throw new BadRequest('Invalid query parameters', { field: 'q' });
  },

  'GET /test/4xx/not-found': () => {
    throw HttpError.NotFound('Item was not found', { id: 999 });
  },

  'GET /test/4xx/teapot': () => {
    throw new Teapot('Refusing to brew coffee');
  },

  'GET /test/4xx/client-error-helper': () => {
    throw clientError(409, 'The resource is already locked', { resource: 'invoice-1' });
  },

  // Server Errors 5xx
  'GET /test/5xx/service-unavailable': () => {
    throw new ServiceUnavailable('Under scheduled maintenance');
  },

  'GET /test/5xx/internal': () => {
    throw HttpError.InternalServerError('Database connection pool exhausted');
  },

  'GET /test/5xx/server-error-helper': () => {
    throw serverError(503, 'Upstream dependency is down', { dependency: 'redis' });
  },

  // Routing with parameters
  'GET /test/routes/users/:id': ({ params }) => ({ userId: params.id }),

  'GET /test/routes/users/{id}/posts': ({ params }) => ({ userId: params.id }),

  'GET /test/routes/files/:path*': ({ params }) => ({ path: params.path }),

  'GET /test/routes/posts/:postId/comments/:commentId': ({ params }) => params
});

console.log(`Test server running at ${server.url}`);

let passCount = 0;
let failCount = 0;

function report(name, error) {
  console.error(`  ✗ ${name}:`, error.message);
  failCount++;
}

function pass(name, detail = '') {
  console.log(`  ✓ ${name}${detail ? ` (${detail})` : ''}`);
  passCount++;
}

/**
 * Performs a request asserting the final status code (and optionally the body).
 */
async function assertCase(name, fetchOpts, expectedStatus, validator) {
  try {
    const res = await fetch(`${server.url}${fetchOpts.path}`, {
      method: fetchOpts.method || 'GET',
      headers: fetchOpts.headers || {},
      redirect: 'manual'
    });

    if (res.status !== expectedStatus) {
      const bodyText = await res.text();
      throw new Error(`Expected status ${expectedStatus}, received ${res.status}. Body: ${bodyText}`);
    }

    if (validator) {
      await validator(res);
    }

    pass(name, `Status: ${res.status}`);
  } catch (err) {
    report(name, err);
  }
}

/**
 * Performs a request asserting an interim (1xx) response plus the final status.
 *
 * `fetch` never surfaces informational responses, so the `node:http` client is used
 * through its `information` event.
 */
async function assertInterimCase(name, path, expectedInterimStatus, expectedFinalStatus, validator) {
  try {
    const result = await new Promise((resolve, reject) => {
      const request = http.get(`${server.url}${path}`, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ finalStatus: res.statusCode, body, interim: null }));
      });
      request.on('information', (info) => {
        resolve({ finalStatus: null, body: '', interim: info });
      });
      request.on('error', reject);
    });

    if (!result.interim) {
      throw new Error('Expected an interim (1xx) response but none was received');
    }
    if (result.interim.statusCode !== expectedInterimStatus) {
      throw new Error(
        `Expected interim status ${expectedInterimStatus}, received ${result.interim.statusCode}`
      );
    }

    if (validator) {
      validator(result.interim);
    }

    pass(name, `Interim: ${result.interim.statusCode}`);
  } catch (err) {
    report(name, err);
  }
}

/**
 * Asserts that the build output contains every artifact required at runtime.
 */
function assertBuildOutput() {
  const prefix = { win32: 'win', linux: 'lin', darwin: 'mac' }[process.platform];
  const primaryArch = { win32: 'x64', linux: 'x64', darwin: 'arm64' }[process.platform];
  const binding = process.arch === primaryArch ? `${prefix}.node` : `${prefix}-${process.arch}.node`;
  const required = [binding, 'index.js', 'http.js', 'errors.js', 'index.d.ts'];

  for (const file of required) {
    try {
      const fullPath = path.join(distDir, file);
      if (!fs.existsSync(fullPath) || fs.statSync(fullPath).size === 0) {
        throw new Error(`${file} is missing or empty`);
      }
    } catch (err) {
      report(`build output contains ${file}`, err);
      return;
    }
  }

  pass('build output is complete', required.join(', '));
}

async function runTests() {
  console.log('\n--- Build output ---');
  assertBuildOutput();

  console.log('\n--- Testing 1xx Informational ---');
  await assertInterimCase('103 Early Hints', '/test/1xx/hints', 103, 200, (info) => {
    if (!info.headers.link) throw new Error('Missing link header');
  });

  await assertInterimCase('100 Continue', '/test/1xx/info', 100, 200);

  await assertInterimCase('103 Early Hints with custom final response', '/test/1xx/with-final', 103, 200);

  console.log('\n--- Testing 2xx Successful ---');
  await assertCase('200 OK via ok()', { path: '/test/2xx/ok' }, 200, async (res) => {
    const data = await res.json();
    if (data.message !== 'Success OK') throw new Error('Invalid body payload');
  });

  await assertCase('201 Created via created()', { path: '/test/2xx/created', method: 'POST' }, 201, async (res) => {
    if (res.headers.get('location') !== '/test/2xx/items/42') throw new Error('Invalid location header');
    const data = await res.json();
    if (data.id !== 42) throw new Error('Invalid created body');
  });

  await assertCase('202 Accepted via accepted()', { path: '/test/2xx/accepted', method: 'POST' }, 202);

  await assertCase('204 No Content via noContent()', { path: '/test/2xx/nocontent', method: 'DELETE' }, 204, async (res) => {
    const text = await res.text();
    if (text.length > 0) throw new Error('Expected empty body for 204');
  });

  console.log('\n--- Testing 3xx Redirection ---');
  await assertCase('302 Found via redirect()', { path: '/test/3xx/redirect' }, 302, async (res) => {
    if (res.headers.get('location') !== '/destination') throw new Error('Invalid location header');
  });

  await assertCase('308 Permanent Redirect via redirect.permanent()', { path: '/test/3xx/permanent' }, 308, async (res) => {
    if (res.headers.get('location') !== '/permanent-destination') throw new Error('Invalid location header');
  });

  await assertCase('302 Thrown HttpRedirect.Found', { path: '/test/3xx/thrown' }, 302, async (res) => {
    if (res.headers.get('location') !== '/login-page') throw new Error('Invalid location header');
  });

  console.log('\n--- Testing 4xx Client Errors ---');
  await assertCase('400 Bad Request via throw new BadRequest()', { path: '/test/4xx/bad-request' }, 400, async (res) => {
    const data = await res.json();
    if (data.error !== 'Bad Request' || data.details?.field !== 'q') throw new Error('Invalid error body');
  });

  await assertCase('404 Not Found via throw HttpError.NotFound()', { path: '/test/4xx/not-found' }, 404, async (res) => {
    const data = await res.json();
    if (data.error !== 'Not Found' || data.details?.id !== 999) throw new Error('Invalid error body');
  });

  await assertCase("418 I'm a Teapot via throw new Teapot()", { path: '/test/4xx/teapot' }, 418, async (res) => {
    const data = await res.json();
    if (data.status !== 418) throw new Error('Invalid teapot status');
  });

  await assertCase('409 Conflict via clientError()', { path: '/test/4xx/client-error-helper' }, 409, async (res) => {
    const data = await res.json();
    if (data.error !== 'Conflict' || data.details?.resource !== 'invoice-1') throw new Error('Invalid error body');
  });

  await assertCase('404 Not Found for unmatched routes', { path: '/test/unknown-route' }, 404, async (res) => {
    const data = await res.json();
    if (data.status !== 404 || !data.path) throw new Error('Invalid error envelope');
  });

  console.log('\n--- Testing 5xx Server Errors ---');
  await assertCase('503 Service Unavailable via throw new ServiceUnavailable()', { path: '/test/5xx/service-unavailable' }, 503, async (res) => {
    const data = await res.json();
    if (data.status !== 503 || data.error !== 'Service Unavailable') throw new Error('Invalid 503 body');
  });

  await assertCase('500 Internal Server Error via throw HttpError.InternalServerError()', { path: '/test/5xx/internal' }, 500, async (res) => {
    const data = await res.json();
    if (data.status !== 500) throw new Error('Invalid 500 body');
  });

  await assertCase('503 Service Unavailable via serverError()', { path: '/test/5xx/server-error-helper' }, 503, async (res) => {
    const data = await res.json();
    if (data.details?.dependency !== 'redis') throw new Error('Invalid error details');
  });

  console.log('\n--- Testing the routing with parameters ---');
  await assertCase('Express-like parameter (:id)', { path: '/test/routes/users/7' }, 200, async (res) => {
    const data = await res.json();
    if (data.userId !== '7') throw new Error('Invalid route parameter');
  });

  await assertCase('matchit parameter ({id})', { path: '/test/routes/users/7/posts' }, 200, async (res) => {
    const data = await res.json();
    if (data.userId !== '7') throw new Error('Invalid route parameter');
  });

  await assertCase('Catch-all parameter (:path*)', { path: '/test/routes/files/a/b/c.txt' }, 200, async (res) => {
    const data = await res.json();
    if (data.path !== 'a/b/c.txt') throw new Error('Invalid catch-all parameter');
  });

  await assertCase('Multiple parameters', { path: '/test/routes/posts/1/comments/2' }, 200, async (res) => {
    const data = await res.json();
    if (data.postId !== '1' || data.commentId !== '2') throw new Error('Invalid route parameters');
  });

  console.log('\n--- Testing the status catalog ---');
  const catalog = [
    ['category of 103', statusCategory(103), 'informational'],
    ['category of 201', statusCategory(201), 'successful'],
    ['category of 302', statusCategory(302), 'redirection'],
    ['category of 404', statusCategory(404), 'client-error'],
    ['category of 500', statusCategory(500), 'server-error'],
    ['reason phrase of 418', statusText(418), "I'm a Teapot"]
  ];

  for (const [name, actual, expected] of catalog) {
    if (actual !== expected) {
      report(name, new Error(`Expected ${expected}, received ${actual}`));
    } else {
      pass(name, String(actual));
    }
  }

  const registry = Object.keys(HTTP_STATUS_CODES).map(Number).sort((a, b) => a - b);
  const expectedRegistry = [100, 101, 102, 103, 200, 201, 202, 203, 204, 205, 206, 207, 208, 226,
    300, 301, 302, 303, 304, 305, 307, 308,
    400, 401, 402, 403, 404, 405, 406, 407, 408, 409, 410, 411, 412, 413, 414, 415, 416, 417, 418,
    421, 422, 423, 424, 425, 426, 428, 429, 431, 451,
    500, 501, 502, 503, 504, 505, 506, 507, 508, 510, 511];

  if (JSON.stringify(registry) !== JSON.stringify(expectedRegistry)) {
    report('status registry is complete', new Error(`Unexpected registry: ${registry.join(', ')}`));
  } else {
    pass('status registry is complete', `${registry.length} codes`);
  }

  console.log('\n--- Testing the category helpers ---');
  const helpers = [
    ['HttpInfo', new HttpInfo(103) instanceof HttpSuccess === false],
    ['HttpSuccess', new HttpSuccess(200) instanceof HttpError === false],
    ['HttpClientError', new HttpClientError(404) instanceof HttpServerError === false],
    ['HttpServerError', new HttpServerError(500) instanceof HttpClientError === false],
    ['success()', success(203).status === 203],
    ['error()', error(418, 'x').status === 418],
    ['clientError()', clientError(404).status === 404],
    ['serverError()', serverError(503).status === 503],
    ['HttpStatus.OK', HttpStatus.OK === 200]
  ];

  for (const [name, valid] of helpers) {
    if (!valid) {
      report(name, new Error('Helper did not behave as expected'));
    } else {
      pass(name);
    }
  }

  console.log(`\n========================================`);
  console.log(`Summary: ${passCount} passed, ${failCount} failed.`);
  console.log(`========================================\n`);

  process.exit(failCount > 0 ? 1 : 0);
}

runTests();
