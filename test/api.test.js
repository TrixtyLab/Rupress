import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Suite } from './helpers.js';

const suite = new Suite('API and packaging');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

suite.section('The public exports');

const api = await import('../dist/index.js');

const EXPORTS = [
  'serve', 'App',
  'HttpStatus', 'HTTP_STATUS_CODES', 'HTTP_STATUS_CATEGORIES', 'statusCategory', 'statusText',
  'HttpResponse', 'HttpInfo', 'HttpSuccess', 'HttpRedirect', 'HttpError', 'HttpClientError', 'HttpServerError',
  'info', 'ok', 'created', 'accepted', 'noContent', 'success', 'redirect', 'error', 'clientError', 'serverError',
  'badRequest', 'unauthorized', 'forbidden', 'notFound', 'methodNotAllowed', 'conflict', 'gone',
  'unprocessableContent', 'tooManyRequests', 'internalServerError', 'notImplemented', 'badGateway',
  'serviceUnavailable', 'gatewayTimeout',
  'validateBody', 'validateRequest', 'collectFields', 'isFieldDescriptor'
];

for (const name of EXPORTS) {
  await suite.test(`The export "${name}" exists`, () => {
    suite.assert(name in api, `The export "${name}" is missing`);
  });
}

const CLASSES = [
  'Continue', 'SwitchingProtocols', 'Processing', 'EarlyHints',
  'Ok', 'Created', 'Accepted', 'NonAuthoritativeInformation', 'NoContent', 'ResetContent',
  'PartialContent', 'MultiStatus', 'AlreadyReported', 'IMUsed',
  'MultipleChoices', 'MovedPermanently', 'Found', 'SeeOther', 'NotModified', 'UseProxy',
  'TemporaryRedirect', 'PermanentRedirect',
  'BadRequest', 'Unauthorized', 'PaymentRequired', 'Forbidden', 'NotFound', 'MethodNotAllowed',
  'NotAcceptable', 'ProxyAuthenticationRequired', 'RequestTimeout', 'Conflict', 'Gone',
  'LengthRequired', 'PreconditionFailed', 'PayloadTooLarge', 'UriTooLong', 'UnsupportedMediaType',
  'RangeNotSatisfiable', 'ExpectationFailed', 'Teapot', 'MisdirectedRequest', 'UnprocessableContent',
  'Locked', 'FailedDependency', 'TooEarly', 'UpgradeRequired', 'PreconditionRequired', 'TooManyRequests',
  'RequestHeaderFieldsTooLarge', 'UnavailableForLegalReasons',
  'InternalServerError', 'NotImplemented', 'BadGateway', 'ServiceUnavailable', 'GatewayTimeout',
  'HttpVersionNotSupported', 'VariantAlsoNegotiates', 'InsufficientStorage', 'LoopDetected',
  'NotExtended', 'NetworkAuthenticationRequired'
];

for (const name of CLASSES) {
  await suite.test(`The class "${name}" is exported`, () => {
    suite.assert(typeof api[name] === 'function', `The class "${name}" is missing`);
  });
}

suite.section('The hierarchy of the status classes');

await suite.test('The informational classes extend HttpInfo', () => {
  suite.assert(new api.EarlyHints() instanceof api.HttpInfo, 'EarlyHints does not extend HttpInfo');
  suite.assert(new api.Continue() instanceof api.HttpInfo, 'Continue does not extend HttpInfo');
});

await suite.test('The successful classes extend HttpSuccess', () => {
  suite.assert(new api.Ok() instanceof api.HttpSuccess, 'Ok does not extend HttpSuccess');
  suite.assert(new api.Created() instanceof api.HttpSuccess, 'Created does not extend HttpSuccess');
});

await suite.test('The redirection classes extend HttpRedirect', () => {
  suite.assert(new api.Found() instanceof api.HttpRedirect, 'Found does not extend HttpRedirect');
});

await suite.test('The client errors extend HttpClientError and HttpError', () => {
  suite.assert(new api.NotFound() instanceof api.HttpClientError, 'NotFound does not extend HttpClientError');
  suite.assert(new api.NotFound() instanceof api.HttpError, 'NotFound does not extend HttpError');
});

await suite.test('The server errors extend HttpServerError and HttpError', () => {
  suite.assert(new api.InternalServerError() instanceof api.HttpServerError, 'InternalServerError does not extend HttpServerError');
  suite.assert(new api.InternalServerError() instanceof api.HttpError, 'InternalServerError does not extend HttpError');
});

await suite.test('Every class extends HttpResponse', () => {
  suite.assert(new api.Ok() instanceof api.HttpResponse, 'Ok does not extend HttpResponse');
  suite.assert(new api.NotFound() instanceof api.HttpResponse, 'NotFound does not extend HttpResponse');
});

suite.section('The App class');

const METHODS = [
  'get', 'post', 'put', 'delete', 'patch', 'head', 'options', 'all',
  'static', 'cors', 'security', 'listen'
];

const app = new api.App();

for (const name of METHODS) {
  await suite.test(`The method "${name}" exists`, () => {
    suite.assert(typeof app[name] === 'function', `The method "${name}" is missing`);
  });
}

await suite.test('The registration methods return the instance', () => {
  const instance = new api.App();
  const returned = instance.get('/x', () => ({})).post('/y', () => ({}));
  suite.assert(returned === instance, 'The methods do not return the instance');
});

suite.section('The status registry');

await suite.test('The registry contains the 62 standard codes', () => {
  const codes = Object.keys(api.HTTP_STATUS_CODES).map(Number);
  suite.equal(codes.length, 62, 'Unexpected number of codes');
});

await suite.test('Every code has a name, a title and a message', () => {
  for (const [code, meta] of Object.entries(api.HTTP_STATUS_CODES)) {
    suite.assert(typeof meta.name === 'string' && meta.name.length > 0, `The code ${code} has no name`);
    suite.assert(typeof meta.title === 'string' && meta.title.length > 0, `The code ${code} has no title`);
    suite.assert(typeof meta.message === 'string' && meta.message.length > 0, `The code ${code} has no message`);
  }
});

await suite.test('The categories are resolved', () => {
  suite.equal(api.statusCategory(103), 'informational', 'Unexpected category');
  suite.equal(api.statusCategory(204), 'successful', 'Unexpected category');
  suite.equal(api.statusCategory(301), 'redirection', 'Unexpected category');
  suite.equal(api.statusCategory(404), 'client-error', 'Unexpected category');
  suite.equal(api.statusCategory(500), 'server-error', 'Unexpected category');
  suite.equal(api.statusCategory(999), null, 'Unexpected category');
});

await suite.test('The reason phrases are resolved', () => {
  suite.equal(api.statusText(404), 'Not Found', 'Unexpected reason phrase');
  suite.equal(api.statusText(418), "I'm a Teapot", 'Unexpected reason phrase');
});

suite.section('The metadata of the package');

await suite.test('The name is scoped to the owner of the repository', () => {
  suite.assert(packageJson.name.startsWith('@'), 'GitHub Packages requires a scoped name');
  suite.assert(packageJson.name.toLowerCase() === packageJson.name, 'The name must be lowercase');
});

await suite.test('The repository points to the GitHub repository', () => {
  suite.assert(
    packageJson.repository?.url?.includes('github.com'),
    'The repository field must point to the GitHub repository'
  );
  suite.assert(
    packageJson.homepage?.includes('github.com'),
    'The homepage must point to the GitHub repository'
  );
});

await suite.test('The publish registry is GitHub Packages', () => {
  suite.equal(packageJson.publishConfig?.registry, 'https://npm.pkg.github.com', 'Unexpected registry');
  suite.equal(packageJson.publishConfig?.access, 'public', 'Unexpected access');
});

await suite.test('The entry points are declared', () => {
  suite.equal(packageJson.main, './index.js', 'Unexpected main');
  suite.equal(packageJson.types, './dist/index.d.ts', 'Unexpected types');
  suite.assert(packageJson.exports?.['.'], 'The main export is missing');
  suite.assert(packageJson.exports?.['./http'], 'The ./http export is missing');
  suite.assert(packageJson.exports?.['./errors'], 'The ./errors export is missing');
});

await suite.test('The published files include everything needed', () => {
  for (const entry of ['index.js', 'dist', 'README.md', 'LICENSE.md']) {
    suite.assert(packageJson.files.includes(entry), `The file "${entry}" is not published`);
  }
});

await suite.test('The license matches the file of the project', () => {
  suite.assert(
    packageJson.license === 'SEE LICENSE IN LICENSE.md',
    'The license must reference the file of the project'
  );
  suite.assert(fs.existsSync(path.join(root, 'LICENSE.md')), 'The LICENSE.md file is missing');
});

suite.section('The build output');

const REQUIRED = ['index.node', 'index.js', 'http.js', 'errors.js', 'validation.js', 'index.d.ts'];

for (const file of REQUIRED) {
  await suite.test(`The file "${file}" is generated`, () => {
    const fullPath = path.join(root, 'dist', file);
    suite.assert(fs.existsSync(fullPath), `The file "${file}" is missing`);
    suite.assert(fs.statSync(fullPath).size > 0, `The file "${file}" is empty`);
  });
}

await suite.test('The native addon can be loaded', async () => {
  const addon = await import('../dist/index.js');
  suite.assert(typeof addon.serve === 'function', 'The addon did not load');
});

suite.section('The type declarations');

const declarations = fs.readFileSync(path.join(root, 'dist', 'index.d.ts'), 'utf8');

for (const declaration of [
  'RequestContext', 'ServerSchema', 'ServerInstance', 'SecurityOptions', 'AuthOptions',
  'TlsOptions', 'FieldsSchema', 'FieldOptions', 'RouteAuth', 'AuthUser', 'CacheOptions',
  'ProxyRoutes', 'HttpStatusMeta'
]) {
  await suite.test(`The type "${declaration}" is declared`, () => {
    suite.assert(declarations.includes(declaration), `The type "${declaration}" is missing`);
  });
}

suite.section('The workflows');

await suite.test('The publish workflow exists', () => {
  const file = path.join(root, '.github', 'workflows', 'publish.yml');
  suite.assert(fs.existsSync(file), 'The publish workflow is missing');

  const content = fs.readFileSync(file, 'utf8');
  suite.assert(content.includes('npm.pkg.github.com'), 'The registry is not configured');
  suite.assert(content.includes('packages: write'), 'The packages permission is missing');
  suite.assert(content.includes('id-token: write'), 'The id-token permission is missing');
  suite.assert(content.includes('NODE_AUTH_TOKEN'), 'The token is missing');
  suite.assert(content.includes('pnpm publish'), 'The publish step is missing');
  suite.assert(content.includes('pnpm/action-setup'), 'pnpm is not installed');
});

await suite.test('The build workflow covers the three platforms', () => {
  const file = path.join(root, '.github', 'workflows', 'build.yml');
  suite.assert(fs.existsSync(file), 'The build workflow is missing');

  const content = fs.readFileSync(file, 'utf8');

  const matrix = content.match(/os:\s*\[([^\]]*)\]/);
  suite.assert(matrix, 'The matrix of platforms is missing');

  const platforms = matrix[1]
    .split(',')
    .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);

  // The label of a platform can be pinned to a version (`macos-15`) or follow the
  // latest image (`macos-latest`), so only the family of the runner is checked.
  for (const family of ['ubuntu', 'macos', 'windows']) {
    suite.assert(
      platforms.some((platform) => platform.toLowerCase().startsWith(family)),
      `The platform "${family}" is missing`
    );
  }

  suite.assert(content.includes('pnpm/action-setup'), 'pnpm is not installed');
});

suite.finish();
