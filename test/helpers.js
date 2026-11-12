import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';

/**
 * Minimal test suite used by every file of the test directory.
 *
 * It keeps the tests independent (each one uses an ephemeral port) and reports a
 * summary that the runner of `pnpm test` can use.
 */
export class Suite {
  constructor(title) {
    this.title = title;
    this.passed = 0;
    this.failed = 0;
  }

  section(title) {
    console.log(`\n--- ${title} ---`);
  }

  async test(description, fn) {
    try {
      await fn();
      this.passed += 1;
      console.log(`  ✓ ${description}`);
    } catch (error) {
      this.failed += 1;
      console.error(`  ✗ ${description}: ${error.message}`);
    }
  }

  assert(condition, message) {
    if (!condition) {
      throw new Error(message);
    }
  }

  equal(actual, expected, message) {
    if (actual !== expected) {
      throw new Error(`${message} (expected ${expected}, got ${actual})`);
    }
  }

  deepEqual(actual, expected, message) {
    const left = JSON.stringify(sortKeys(actual));
    const right = JSON.stringify(sortKeys(expected));
    if (left !== right) {
      throw new Error(`${message} (expected ${right}, got ${left})`);
    }
  }

  /**
   * Asserts that a function throws an error with the expected type.
   */
  async throws(fn, expected, message) {
    let thrown = null;

    try {
      await fn();
    } catch (error) {
      thrown = error;
    }

    if (!thrown) {
      throw new Error(`${message}: nothing was thrown`);
    }

    if (expected && typeof expected === 'function' && !(thrown instanceof expected)) {
      throw new Error(`${message}: unexpected error type ${thrown.constructor?.name}`);
    }

    return thrown;
  }

  finish() {
    console.log(`\n${'='.repeat(40)}`);
    console.log(`Summary: ${this.passed} passed, ${this.failed} failed.`);
    console.log(`${'='.repeat(40)}\n`);

    process.exit(this.failed > 0 ? 1 : 0);
  }
}

/**
 * Performs a request and returns the status, the headers and the body.
 */
export async function request(url, options = {}) {
  const response = await fetch(url, { redirect: 'manual', ...options });
  const text = await response.text();

  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  return { status: response.status, headers: response.headers, text, json };
}

/**
 * Performs a request with a JSON body.
 */
export function postJson(url, body, options = {}) {
  return request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    body: JSON.stringify(body),
    ...options
  });
}

/**
 * Sends a raw HTTP request over a socket.
 */
export function rawRequest(port, payload, { timeout = 4000 } = {}) {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    let received = '';

    socket.on('connect', () => socket.write(payload));
    socket.on('data', (data) => {
      received += data.toString();
    });
    socket.on('close', () => resolve(received));
    socket.on('error', () => resolve(received));

    setTimeout(() => {
      socket.destroy();
      resolve(received);
    }, timeout);
  });
}

/**
 * Starts a local HTTP server and returns it with its port.
 */
export async function startUpstream(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  return {
    server,
    port: server.address().port,
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

/**
 * Builds a JSON Web Token signed with HS256.
 */
export function buildJwt(payload, secret, header = { alg: 'HS256', typ: 'JWT' }) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const data = `${encode(header)}.${encode(payload)}`;
  const signature = crypto.createHmac('sha256', secret).update(data).digest('base64url');

  return `${data}.${signature}`;
}

/**
 * The current time in seconds.
 */
export function now() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Sorts the keys of an object recursively, so two values can be compared
 * independently of the order in which they were built.
 */
function sortKeys(value) {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }

  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = sortKeys(value[key]);
        return result;
      }, {});
  }

  return value;
}
