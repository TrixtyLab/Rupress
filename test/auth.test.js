import crypto from 'node:crypto';
import { Suite, request, buildJwt, now } from './helpers.js';

const suite = new Suite('Authentication and authorization');
const { serve } = await import('../dist/index.js');

const SECRET = 'a-very-secret-key';
const OTHER_SECRET = 'another-secret';
const ISSUER = 'https://auth.example.com';
const AUDIENCE = 'rupress';

const server = await serve(0, {
  security: {
    auth: {
      apiKeys: {
        'key-alice': { name: 'alice', permissions: ['posts:read', 'profile:read'] },
        'key-admin': { name: 'admin', permissions: ['admin'] },
        'key-simple': 'simple'
      },
      jwt: { secret: SECRET, issuer: ISSUER, audience: AUDIENCE }
    }
  },

  'GET /public': () => ({ public: true }),

  '/admin': {
    auth: { permissions: ['admin'] },
    GET: ({ user }) => ({ user })
  },

  '/editor': {
    auth: { anyOf: ['posts:write', 'editor'] },
    GET: ({ user }) => ({ user })
  },

  '/profile': {
    auth: { permissions: ['profile:read'] },
    GET: ({ user }) => ({ user })
  }
});

suite.section('The API keys');

await suite.test('A request without credentials is rejected', async () => {
  const response = await request(`${server.url}/public`);
  suite.equal(response.status, 401, 'Unexpected status');
  suite.equal(response.json.error, 'Unauthorized', 'Unexpected error');
});

await suite.test('An unknown API key is rejected', async () => {
  const response = await request(`${server.url}/public`, { headers: { 'x-api-key': 'unknown' } });
  suite.equal(response.status, 401, 'Unexpected status');
});

await suite.test('A valid API key is accepted', async () => {
  const response = await request(`${server.url}/public`, { headers: { 'x-api-key': 'key-alice' } });
  suite.equal(response.status, 200, 'Unexpected status');
});

await suite.test('An API key declared as a string works', async () => {
  const response = await request(`${server.url}/public`, { headers: { 'x-api-key': 'key-simple' } });
  suite.equal(response.status, 200, 'Unexpected status');
});

await suite.test('The identity of an API key is exposed', async () => {
  const response = await request(`${server.url}/profile`, { headers: { 'x-api-key': 'key-alice' } });
  suite.equal(response.status, 200, 'Unexpected status');
  suite.equal(response.json.user.name, 'alice', 'Unexpected name');
  suite.deepEqual(response.json.user.permissions, ['posts:read', 'profile:read'], 'Unexpected permissions');
});

suite.section('The JSON Web Tokens');

const valid = () => buildJwt({
  sub: 'alice',
  iss: ISSUER,
  aud: AUDIENCE,
  exp: now() + 300,
  permissions: ['posts:read']
}, SECRET);

await suite.test('A valid token is accepted', async () => {
  const response = await request(`${server.url}/public`, {
    headers: { authorization: `Bearer ${valid()}` }
  });
  suite.equal(response.status, 200, 'Unexpected status');
});

await suite.test('The Bearer scheme is case insensitive', async () => {
  for (const scheme of ['Bearer', 'bearer', 'BEARER']) {
    const response = await request(`${server.url}/public`, {
      headers: { authorization: `${scheme} ${valid()}` }
    });
    suite.equal(response.status, 200, `The scheme "${scheme}" was rejected`);
  }
});

await suite.test('A token without the scheme is accepted', async () => {
  const response = await request(`${server.url}/public`, {
    headers: { authorization: valid() }
  });
  suite.equal(response.status, 200, 'Unexpected status');
});

await suite.test('An expired token is rejected', async () => {
  const token = buildJwt({ sub: 'a', iss: ISSUER, aud: AUDIENCE, exp: now() - 10 }, SECRET);
  const response = await request(`${server.url}/public`, { headers: { authorization: `Bearer ${token}` } });
  suite.equal(response.status, 401, 'Unexpected status');
  suite.equal(response.json.message, 'The credential has expired.', 'Unexpected message');
});

await suite.test('A token that is not valid yet is rejected', async () => {
  const token = buildJwt({ sub: 'a', iss: ISSUER, aud: AUDIENCE, nbf: now() + 600 }, SECRET);
  const response = await request(`${server.url}/public`, { headers: { authorization: `Bearer ${token}` } });
  suite.equal(response.status, 401, 'Unexpected status');
});

await suite.test('A token of another issuer is rejected', async () => {
  const token = buildJwt({ sub: 'a', iss: 'https://evil.example.com', aud: AUDIENCE, exp: now() + 60 }, SECRET);
  const response = await request(`${server.url}/public`, { headers: { authorization: `Bearer ${token}` } });
  suite.equal(response.status, 401, 'Unexpected status');
});

await suite.test('A token for another audience is rejected', async () => {
  const token = buildJwt({ sub: 'a', iss: ISSUER, aud: 'another-app', exp: now() + 60 }, SECRET);
  const response = await request(`${server.url}/public`, { headers: { authorization: `Bearer ${token}` } });
  suite.equal(response.status, 401, 'Unexpected status');
});

await suite.test('A token signed with another secret is rejected', async () => {
  const token = buildJwt({ sub: 'a', iss: ISSUER, aud: AUDIENCE, exp: now() + 60 }, OTHER_SECRET);
  const response = await request(`${server.url}/public`, { headers: { authorization: `Bearer ${token}` } });
  suite.equal(response.status, 401, 'Unexpected status');
});

await suite.test('The "none" algorithm is rejected', async () => {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: 'admin' })}.`;

  const response = await request(`${server.url}/public`, { headers: { authorization: `Bearer ${token}` } });
  suite.equal(response.status, 401, 'Unexpected status');
});

await suite.test('A token with a modified payload is rejected', async () => {
  const token = valid();
  const [header, payload, signature] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ sub: 'admin', iss: ISSUER, aud: AUDIENCE, exp: now() + 300 })).toString('base64url');

  const response = await request(`${server.url}/public`, {
    headers: { authorization: `Bearer ${header}.${forged}.${signature}` }
  });
  suite.equal(response.status, 401, 'Unexpected status');
});

await suite.test('A malformed token is rejected', async () => {
  for (const token of ['abc', 'a.b', 'a.b.c.d', '']) {
    const response = await request(`${server.url}/public`, { headers: { authorization: `Bearer ${token}` } });
    suite.equal(response.status, 401, `The token "${token}" was accepted`);
  }
});

await suite.test('The permissions of a token are exposed', async () => {
  const token = buildJwt({
    sub: 'bob',
    iss: ISSUER,
    aud: AUDIENCE,
    exp: now() + 300,
    permissions: ['profile:read']
  }, SECRET);

  const response = await request(`${server.url}/profile`, {
    headers: { authorization: `Bearer ${token}` }
  });
  suite.equal(response.status, 200, 'Unexpected status');
  suite.equal(response.json.user.name, 'bob', 'Unexpected name');
});

suite.section('The permissions of the routes');

await suite.test('A route with permissions rejects an identity without them', async () => {
  const response = await request(`${server.url}/admin`, { headers: { 'x-api-key': 'key-alice' } });
  suite.equal(response.status, 403, 'Unexpected status');
  suite.equal(response.json.error, 'Forbidden', 'Unexpected error');
});

await suite.test('A route with permissions accepts an identity with them', async () => {
  const response = await request(`${server.url}/admin`, { headers: { 'x-api-key': 'key-admin' } });
  suite.equal(response.status, 200, 'Unexpected status');
  suite.equal(response.json.user.name, 'admin', 'Unexpected name');
});

await suite.test('The anyOf permissions accept one of them', async () => {
  const response = await request(`${server.url}/editor`, { headers: { 'x-api-key': 'key-alice' } });
  suite.equal(response.status, 403, 'Unexpected status');
});

await suite.test('The permissions of the route require a credential', async () => {
  const response = await request(`${server.url}/admin`);
  suite.equal(response.status, 401, 'Unexpected status');
});

suite.section('The anonymous access');

await suite.test('The anonymous requests are accepted when they are allowed', async () => {
  const anonymous = await serve(0, {
    security: { auth: { apiKeys: { 'k': 'x' }, allowAnonymous: true } },
    'GET /me': ({ user }) => ({ user })
  });

  const response = await request(`${anonymous.url}/me`);
  suite.equal(response.status, 200, 'Unexpected status');
  suite.equal(response.json.user, null, 'The anonymous identity is not null');
});

await suite.test('The anonymous requests are rejected by default', async () => {
  const strict = await serve(0, {
    security: { auth: { apiKeys: { 'k': 'x' } } },
    'GET /me': () => ({})
  });

  const response = await request(`${strict.url}/me`);
  suite.equal(response.status, 401, 'Unexpected status');
});

suite.section('The credentials of the request');

await suite.test('The API key takes precedence over the token', async () => {
  const response = await request(`${server.url}/public`, {
    headers: { 'x-api-key': 'key-alice', authorization: `Bearer ${valid()}` }
  });
  suite.equal(response.status, 200, 'Unexpected status');
});

await suite.test('An invalid API key is rejected even with a valid token', async () => {
  const response = await request(`${server.url}/public`, {
    headers: { 'x-api-key': 'unknown', authorization: `Bearer ${valid()}` }
  });
  suite.equal(response.status, 401, 'Unexpected status');
});

suite.finish();
