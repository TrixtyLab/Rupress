# Getting started

## Installation

The package is published in **GitHub Packages**, so the registry has to be configured once:

```bash
# .npmrc (in your project or globally)
@trixtylab:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

```bash
pnpm add @trixtylab/rupress
```

> GitHub Packages only accepts scoped packages and the scope must match the owner of the
> repository, which is why the package is published as `@trixtylab/rupress`.

The published package ships the native addon already compiled for the usual platforms, so
**Rust is not needed to use it**. If you want to compile it from source you need the stable
Rust toolchain and the target of your platform:

```bash
rustup target add x86_64-pc-windows-msvc   # or the one you need
```

## Your first server

```js
// server.mjs
import { serve } from 'rupress';

const server = await serve(3000, {
  'GET /': () => ({ status: 'online' }),
  'GET /users/:id': ({ params }) => ({ userId: params.id })
});

console.log(`Listening on ${server.url}`);
```

```bash
node server.mjs
```

```
Listening on http://127.0.0.1:3000
```

```bash
curl http://127.0.0.1:3000/users/42
# {"userId":"42"}
```

## Anatomy of a project

```
my-api/
├── package.json
├── server.mjs        # the entry point
├── routes/
│   └── users.mjs     # the routes
└── public/           # the static files (optional)
```

```js
// server.mjs
import { serve } from 'rupress';
import { userRoutes } from './routes/users.mjs';

await serve(3000, {
  ...userRoutes,
  'GET /health': () => ({ ok: true })
});
```

## The three ways to declare a route

### 1. Verb and path

```js
await serve(3000, {
  'GET /users': () => ({ users: [] }),
  'POST /users': ({ body }) => ({ created: body })
});
```

### 2. One object per path (several verbs)

```js
await serve(3000, {
  '/users/:id': {
    GET: ({ params }) => ({ userId: params.id }),
    PUT: ({ params, body }) => ({ updated: params.id, body }),
    DELETE: ({ params }) => ({ deleted: params.id })
  }
});
```

### 3. One object per path with a field schema

```js
await serve(3000, {
  '/users/:id': {
    fields: {
      name: { type: 'string', required: true },
      email: { type: 'email', required: true }
    },
    GET: ({ params }) => ({ userId: params.id }),
    POST: ({ body }) => ({ created: body })
  }
});
```

> When a route declares `fields`, the schema applies to the methods with a body (`POST`, `PUT`,
> `PATCH`). The `GET`/`DELETE` methods are not affected.
> See [Declarative validation](./validation.md).

## The request context

Every handler receives a single object:

```js
'GET /orders/:id': (ctx) => {
  ctx.method;   // 'GET'
  ctx.path;     // '/orders/42'
  ctx.params;   // { id: '42' }
  ctx.query;    // { page: '2', filter: 'active' }
  ctx.headers;  // { 'content-type': 'application/json', ... }
  ctx.body;     // the parsed body (object, string or null)
  ctx.rawBody;  // the body without parsing
  ctx.json();   // parses the body as JSON
  ctx.user;     // { name, permissions } when the authentication layer is enabled
}
```

- `params`, `query` and the body values are **decoded** (`%20` becomes a space).
- The values of `query` and `params` arrive as **strings**; when you declare a type in the
  validation schema they are converted to that type.

## Errors

```js
import { HttpError, notFound } from 'rupress';

'GET /users/:id': ({ params }) => {
  const user = findUser(params.id);
  if (!user) {
    throw notFound(`The user ${params.id} does not exist`);
  }
  return user;
}
```

The errors thrown with `HttpError` are serialized with the same JSON envelope the server uses
for every other error:

```json
{
  "error": "Not Found",
  "status": 404,
  "message": "The user 42 does not exist",
  "timestamp": "2026-01-01T00:00:00.000Z",
  "path": "/users/42",
  "details": { "id": "42" }
}
```

See [HTTP statuses](./http-statuses.md) for the complete registry.

## Authentication

```js
await serve(3000, {
  security: {
    auth: {
      apiKeys: {
        'key-alice': { name: 'alice', permissions: ['posts:write'] }
      }
    }
  },

  '/posts': {
    auth: { permissions: ['posts:write'] },
    POST: ({ body, user }) => ({ created: body, by: user.name })
  }
});
```

The credentials are verified in Rust, without a round trip to JavaScript. See
[Authentication](./authentication.md).

## The imperative API

When you prefer registering the routes by hand:

```js
import { App } from 'rupress';

const app = new App();

app.get('/health', () => ({ ok: true }));
app.post('/users', ({ body }) => ({ created: body }));

const port = await app.listen(3000, '127.0.0.1');
console.log(`Listening on port ${port}`);
```

## Next steps

- [API reference](./api.md) — every schema option.
- [HTTP statuses](./http-statuses.md) — the registry and the helpers.
- [Declarative validation](./validation.md) — delegate the validations to the server.
- [Authentication](./authentication.md) — API keys, JWT and permissions.
- [React, Vite and SPAs](./frontend.md) — serve a complete frontend.
