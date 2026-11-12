import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Suite, request } from './helpers.js';

const suite = new Suite('Configuration');
const { serve } = await import('../dist/index.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

suite.section('The port');

await suite.test('A port out of range is rejected', async () => {
  await suite.throws(() => serve(70000, {}), TypeError, 'The invalid port was accepted');
  await suite.throws(() => serve(-1, {}), TypeError, 'The negative port was accepted');
  await suite.throws(() => serve(Number.NaN, {}), TypeError, 'The NaN port was accepted');
});

await suite.test('A port as a string is rejected', async () => {
  await suite.throws(() => serve('3000', {}), TypeError, 'The string port was accepted');
});

await suite.test('The first argument must be a number or an object', async () => {
  await suite.throws(() => serve(null, {}), TypeError, 'null was accepted');
  await suite.throws(() => serve(undefined, {}), TypeError, 'undefined was accepted');
});

await suite.test('The port 0 is resolved to the real one', async () => {
  const server = await serve(0, { 'GET /': () => ({ ok: true }) });
  suite.assert(server.port > 0, 'The port was not resolved');
  const response = await request(`${server.url}/`);
  suite.equal(response.status, 200, 'The server does not answer');
});

suite.section('The declaration of the routes');

await suite.test('An invalid verb is rejected', async () => {
  await suite.throws(
    () => serve(0, { 'INVALID /x': () => ({}) }),
    TypeError,
    'The invalid verb was accepted'
  );
});

await suite.test('A path without a leading slash is rejected', async () => {
  await suite.throws(
    () => serve(0, { 'GET x': () => ({}) }),
    TypeError,
    'The invalid path was accepted'
  );
});

await suite.test('A handler that is not a function is rejected', async () => {
  await suite.throws(
    () => serve(0, { '/x': 42 }),
    TypeError,
    'The invalid handler was accepted'
  );
});

await suite.test('A key that is not a route is rejected', async () => {
  await suite.throws(
    () => serve(0, { users: () => ({}) }),
    TypeError,
    'The invalid key was accepted'
  );
});

await suite.test('A duplicated route is rejected', async () => {
  const { App } = await import('../dist/index.js');
  const app = new App();

  app.get('/x', () => ({}));

  await suite.throws(
    () => app.get('/x', () => ({})),
    'The duplicated route was accepted'
  );
});

await suite.test('An invalid schema is rejected when the server starts', async () => {
  await suite.throws(
    () => serve(0, { '/x': { fields: { title: { type: 'string', requred: true } }, POST: () => ({}) } }),
    TypeError,
    'The invalid schema was accepted'
  );
});

suite.section('The static files');

await suite.test('A missing static directory is rejected', async () => {
  await suite.throws(
    () => serve(0, { static: './this-directory-does-not-exist' }),
    Error,
    'The missing directory was accepted'
  );
});

await suite.test('A file instead of a directory is rejected', async () => {
  await suite.throws(
    () => serve(0, { static: './package.json' }),
    Error,
    'The file was accepted as a directory'
  );
});

await suite.test('The SPA fallback needs a static directory', async () => {
  await suite.throws(
    () => serve(0, { spa: true }),
    Error,
    'The SPA fallback without a directory was accepted'
  );
});

suite.section('The proxy');

await suite.test('An invalid upstream URL is rejected', async () => {
  await suite.throws(
    () => serve(0, { proxy: { '*': 'not-a-url' } }),
    'The invalid upstream was accepted'
  );
});

await suite.test('A proxy route without an upstream is rejected', async () => {
  await suite.throws(
    () => serve(0, { proxy: { '*': '' } }),
    TypeError,
    'The empty upstream was accepted'
  );
});

await suite.test('An HTTPS upstream is accepted', async () => {
  const server = await serve(0, { proxy: { '*': 'https://localhost:9999' } });
  suite.assert(server.port > 0, 'The server did not start');
});

suite.section('The warnings of the configuration');

await suite.test('An authentication layer without credentials warns', async () => {
  const original = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));

  try {
    await serve(0, { security: { auth: {} }, 'GET /': () => ({}) });
  } finally {
    console.warn = original;
  }

  suite.assert(
    warnings.some((warning) => warning.includes('WARNING') && warning.includes('authentication')),
    `The warning was not shown: ${JSON.stringify(warnings)}`
  );
});

await suite.test('A valid authentication layer does not warn', async () => {
  const original = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));

  try {
    await serve(0, {
      security: { auth: { apiKeys: { 'k': 'alice' } } },
      'GET /': () => ({})
    });
  } finally {
    console.warn = original;
  }

  suite.assert(
    !warnings.some((warning) => warning.includes('authentication')),
    `An unexpected warning was shown: ${JSON.stringify(warnings)}`
  );
});

await suite.test('Disabling the TLS verification warns', async () => {
  const original = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));

  try {
    await serve(0, {
      security: { tls: { insecure: true } },
      proxy: { '*': 'https://localhost:9999' }
    });
  } finally {
    console.warn = original;
  }

  suite.assert(
    warnings.some((warning) => warning.includes('WARNING') && warning.includes('TLS')),
    `The warning was not shown: ${JSON.stringify(warnings)}`
  );
});

suite.section('The environment of the server');

await suite.test('The host of the schema is used when the port is the first argument', async () => {
  const server = await serve(0, { host: '127.0.0.1', 'GET /': () => ({}) });
  suite.equal(server.host, '127.0.0.1', 'Unexpected host');
  suite.assert(server.url.includes('127.0.0.1'), 'Unexpected url');
});

await suite.test('The host can be an IPv6 address', async () => {
  const server = await serve(0, { host: '::1', 'GET /': () => ({}) });
  suite.equal(server.host, '::1', 'Unexpected host');
  suite.assert(server.url.includes('[::1]'), `Unexpected url: ${server.url}`);
});

await suite.test('The options and the routes can be given in one object', async () => {
  const server = await serve({ port: 0, 'GET /': () => ({ ok: true }) });
  const response = await request(`${server.url}/`);
  suite.equal(response.status, 200, 'The server does not answer');
});

suite.section('The documentation');

const docFiles = ['README.md', 'doc/README.md', 'doc/api.md', 'doc/frontend.md', 'doc/security.md',
  'doc/validation.md', 'doc/authentication.md', 'doc/http-statuses.md', 'doc/architecture.md',
  'doc/development.md', 'doc/getting-started.md'];

await suite.test('Every document exists', () => {
  for (const file of docFiles) {
    suite.assert(fs.existsSync(path.join(root, file)), `The document "${file}" is missing`);
  }
});

await suite.test('The documents do not have broken links', () => {
  for (const file of docFiles) {
    const fullPath = path.join(root, file);
    const content = fs.readFileSync(fullPath, 'utf8');

    for (const match of content.matchAll(/\]\((\.{1,2}\/[^)#]+)\)/g)) {
      const target = path.resolve(path.dirname(fullPath), match[1]);
      suite.assert(fs.existsSync(target), `The link "${match[1]}" of "${file}" is broken`);
    }
  }
});

await suite.test('The README documents the installation', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  suite.assert(readme.includes('npm.pkg.github.com'), 'The registry is not documented');
  suite.assert(readme.includes(packageScope()), 'The scoped name is not documented');
});

function packageScope() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  return pkg.name;
}

suite.finish();
