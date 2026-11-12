import { Suite, request, postJson } from './helpers.js';

const suite = new Suite('Declarative validation');
const { serve } = await import('../dist/index.js');

const server = await serve(0, {
  '/types': {
    fields: {
      text: { type: 'string' },
      amount: { type: 'number' },
      count: { type: 'integer' },
      active: { type: 'boolean' },
      list: { type: 'array' },
      nested: { type: 'object' },
      mail: { type: 'email' },
      site: { type: 'url' },
      id: { type: 'uuid' },
      day: { type: 'date' }
    },
    POST: ({ body }) => body
  },

  '/required': {
    fields: {
      title: { type: 'string', required: true },
      subtitle: { type: 'string', required: false }
    },
    POST: ({ body }) => body
  },

  '/defaults': {
    fields: {
      page: { type: 'integer', default: 1 },
      tags: { type: 'array', default: [] },
      enabled: { type: 'boolean', default: false }
    },
    POST: ({ body }) => body
  },

  '/constraints': {
    fields: {
      age: { type: 'integer', min: 18, max: 99 },
      name: { type: 'string', minLength: 3, maxLength: 10 },
      code: { type: 'string', pattern: '^[A-Z]{3}$' },
      items: { type: 'array', minItems: 1, maxItems: 3 },
      role: { type: 'string', enum: ['admin', 'user'] }
    },
    POST: ({ body }) => body
  },

  '/nested': {
    fields: {
      post: {
        title: { type: 'string', required: true },
        author: {
          name: { type: 'string', required: true },
          email: { type: 'email' }
        }
      }
    },
    POST: ({ body }) => body
  },

  '/messages': {
    fields: {
      title: { type: 'string', required: true, message: 'The field {} is mandatory' },
      email: { type: 'email', required: true, message: 'The field {} has a wrong format' }
    },
    POST: ({ body }) => body
  },

  '/statuses': {
    fields: {
      token: { type: 'string', required: true, status: 401 },
      code: { type: 'string', required: true, status: 400 },
      amount: { type: 'number', required: true, status: 500 }
    },
    POST: ({ body }) => body
  },

  '/query': {
    query: {
      page: { type: 'integer', default: 1 },
      sort: { type: 'string', enum: ['asc', 'desc'], default: 'asc' }
    },
    GET: ({ query }) => query
  },

  '/params/:id': {
    params: { id: { type: 'integer', required: true } },
    GET: ({ params }) => params
  }
});

suite.section('The types');

const VALID = {
  text: 'hello',
  amount: 1.5,
  count: 3,
  active: true,
  list: [1, 2],
  nested: { a: 1 },
  mail: 'user@example.com',
  site: 'https://example.com',
  id: '123e4567-e89b-12d3-a456-426614174000',
  day: '2026-01-01'
};

await suite.test('A payload with the correct types is accepted', async () => {
  const response = await postJson(`${server.url}/types`, VALID);
  suite.equal(response.status, 200, `Unexpected status: ${response.text}`);
});

const WRONG = {
  text: 1,
  amount: 'x',
  count: 1.5,
  active: 'yes',
  list: {},
  nested: [],
  mail: 'not-an-email',
  site: 'not-a-url',
  id: 'not-a-uuid',
  day: 'not-a-date'
};

for (const [field, value] of Object.entries(WRONG)) {
  await suite.test(`The type of "${field}" is validated`, async () => {
    const response = await postJson(`${server.url}/types`, { ...VALID, [field]: value });
    suite.equal(response.status, 422, 'Unexpected status');
    suite.equal(response.json.details.field, field, 'Unexpected field');
    suite.equal(response.json.details.expected, VALID[field] === value ? undefined : response.json.details.expected, 'Unexpected expected type');
  });
}

suite.section('The required fields');

await suite.test('A missing required field is rejected', async () => {
  const response = await postJson(`${server.url}/required`, {});
  suite.equal(response.status, 422, 'Unexpected status');
  suite.equal(response.json.message, 'Field title is required', 'Unexpected message');
});

await suite.test('An optional field can be missing', async () => {
  const response = await postJson(`${server.url}/required`, { title: 'ok' });
  suite.equal(response.status, 200, 'Unexpected status');
});

await suite.test('An empty string counts as missing', async () => {
  const response = await postJson(`${server.url}/required`, { title: '' });
  suite.equal(response.status, 422, 'Unexpected status');
});

await suite.test('A null counts as missing', async () => {
  const response = await postJson(`${server.url}/required`, { title: null });
  suite.equal(response.status, 422, 'Unexpected status');
});

suite.section('The default values');

await suite.test('The default values are applied', async () => {
  const response = await postJson(`${server.url}/defaults`, {});
  suite.equal(response.status, 200, 'Unexpected status');
  suite.deepEqual(response.json, { page: 1, tags: [], enabled: false }, 'Unexpected body');
});

await suite.test('The default values do not override the sent ones', async () => {
  const response = await postJson(`${server.url}/defaults`, { page: 5 });
  suite.equal(response.json.page, 5, 'Unexpected page');
});

suite.section('The constraints');

await suite.test('A number below the minimum is rejected', async () => {
  const response = await postJson(`${server.url}/constraints`, { age: 10, name: 'abcd', code: 'ABC', items: [1], role: 'user' });
  suite.equal(response.status, 422, 'Unexpected status');
  suite.equal(response.json.details.field, 'age', 'Unexpected field');
});

await suite.test('A number above the maximum is rejected', async () => {
  const response = await postJson(`${server.url}/constraints`, { age: 200, name: 'abcd', code: 'ABC', items: [1], role: 'user' });
  suite.equal(response.status, 422, 'Unexpected status');
  suite.equal(response.json.details.field, 'age', 'Unexpected field');
});

await suite.test('A string below the minimum length is rejected', async () => {
  const response = await postJson(`${server.url}/constraints`, { age: 30, name: 'ab', code: 'ABC', items: [1], role: 'user' });
  suite.equal(response.status, 422, 'Unexpected status');
  suite.equal(response.json.details.field, 'name', 'Unexpected field');
});

await suite.test('A string above the maximum length is rejected', async () => {
  const response = await postJson(`${server.url}/constraints`, { age: 30, name: 'abcdefghijk', code: 'ABC', items: [1], role: 'user' });
  suite.equal(response.status, 422, 'Unexpected status');
  suite.equal(response.json.details.field, 'name', 'Unexpected field');
});

await suite.test('A string that does not match the pattern is rejected', async () => {
  const response = await postJson(`${server.url}/constraints`, { age: 30, name: 'abcd', code: 'abc', items: [1], role: 'user' });
  suite.equal(response.status, 422, 'Unexpected status');
  suite.equal(response.json.details.field, 'code', 'Unexpected field');
});

await suite.test('An array below the minimum is rejected', async () => {
  const response = await postJson(`${server.url}/constraints`, { age: 30, name: 'abcd', code: 'ABC', items: [], role: 'user' });
  suite.equal(response.status, 422, 'Unexpected status');
  suite.equal(response.json.details.field, 'items', 'Unexpected field');
});

await suite.test('An array above the maximum is rejected', async () => {
  const response = await postJson(`${server.url}/constraints`, { age: 30, name: 'abcd', code: 'ABC', items: [1, 2, 3, 4], role: 'user' });
  suite.equal(response.status, 422, 'Unexpected status');
  suite.equal(response.json.details.field, 'items', 'Unexpected field');
});

await suite.test('A value outside the enumeration is rejected', async () => {
  const response = await postJson(`${server.url}/constraints`, { age: 30, name: 'abcd', code: 'ABC', items: [1], role: 'root' });
  suite.equal(response.status, 422, 'Unexpected status');
  suite.equal(response.json.details.field, 'role', 'Unexpected field');
});

await suite.test('A payload that satisfies the constraints is accepted', async () => {
  const response = await postJson(`${server.url}/constraints`, { age: 30, name: 'abcd', code: 'ABC', items: [1], role: 'user' });
  suite.equal(response.status, 200, `Unexpected status: ${response.text}`);
});

suite.section('The nested schemas');

await suite.test('A nested required field is validated', async () => {
  const response = await postJson(`${server.url}/nested`, { post: { title: 'ok' } });
  suite.equal(response.status, 422, 'Unexpected status');
  suite.equal(response.json.details.field, 'post.author.name', 'Unexpected field');
});

await suite.test('A nested payload is accepted', async () => {
  const response = await postJson(`${server.url}/nested`, {
    post: { title: 'ok', author: { name: 'alice', email: 'a@b.com' } }
  });
  suite.equal(response.status, 200, `Unexpected status: ${response.text}`);
});

suite.section('The messages');

await suite.test('The custom message of a required field is used', async () => {
  const response = await postJson(`${server.url}/messages`, {});
  suite.equal(response.status, 422, 'Unexpected status');
  suite.equal(response.json.message, 'The field title is mandatory', 'Unexpected message');
});

await suite.test('The custom message of a type is used', async () => {
  const response = await postJson(`${server.url}/messages`, { title: 'ok', email: 'nope' });
  suite.equal(response.status, 422, 'Unexpected status');
  suite.equal(response.json.message, 'The field email has a wrong format', 'Unexpected message');
});

suite.section('The delegated statuses');

await suite.test('A field can delegate the 401', async () => {
  const response = await postJson(`${server.url}/statuses`, { code: 'x', amount: 1 });
  suite.equal(response.status, 401, 'Unexpected status');
});

await suite.test('A field can delegate the 400', async () => {
  const response = await postJson(`${server.url}/statuses`, { token: 'x', amount: 1 });
  suite.equal(response.status, 400, 'Unexpected status');
});

await suite.test('A field can delegate the 500', async () => {
  const response = await postJson(`${server.url}/statuses`, { token: 'x', code: 'y' });
  suite.equal(response.status, 500, 'Unexpected status');
});

suite.section('The query string and the parameters');

await suite.test('The query is validated', async () => {
  const response = await request(`${server.url}/query?page=abc`);
  suite.equal(response.status, 422, 'Unexpected status');
  suite.equal(response.json.details.field, 'page', 'Unexpected field');
});

await suite.test('The query is converted to the declared type', async () => {
  const response = await request(`${server.url}/query?page=3&sort=desc`);
  suite.equal(response.status, 200, 'Unexpected status');
  suite.equal(response.json.page, 3, 'The value was not converted');
  suite.equal(response.json.sort, 'desc', 'Unexpected value');
});

await suite.test('The defaults of the query are applied', async () => {
  const response = await request(`${server.url}/query`);
  suite.equal(response.status, 200, 'Unexpected status');
  suite.equal(response.json.page, 1, 'Unexpected default');
  suite.equal(response.json.sort, 'asc', 'Unexpected default');
});

await suite.test('An empty query value uses the default', async () => {
  const response = await request(`${server.url}/query?page=`);
  suite.equal(response.status, 200, 'Unexpected status');
  suite.equal(response.json.page, 1, 'The empty value was not replaced by the default');
});

await suite.test('The path parameters are validated', async () => {
  const response = await request(`${server.url}/params/abc`);
  suite.equal(response.status, 422, 'Unexpected status');
  suite.equal(response.json.details.field, 'id', 'Unexpected field');
});

await suite.test('The path parameters are converted', async () => {
  const response = await request(`${server.url}/params/42`);
  suite.equal(response.status, 200, 'Unexpected status');
  suite.equal(response.json.id, 42, 'The value was not converted');
});

suite.finish();
