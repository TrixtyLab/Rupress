# API reference

## `serve(optionsOrPort, schema?)`

Starts the server and resolves with the binding information.

```js
const server = await serve(3000, {
  /* routes */
});
```

```js
const server = await serve({
  port: 3000,
  host: "127.0.0.1",
  "GET /": () => ({ ok: true }),
});
```

| Parameter       | Type               | Description                                                                        |
| --------------- | ------------------ | ---------------------------------------------------------------------------------- |
| `optionsOrPort` | `number \| object` | The port, or an object with `port` and `host` plus the rest of the schema.         |
| `schema`        | `object`           | The routes and the options. Optional when the first argument is already an object. |

**Resolves with:**

| Property | Type     | Description                                                                                 |
| -------- | -------- | ------------------------------------------------------------------------------------------- |
| `port`   | `number` | The port actually bound (with `port: 0` it returns the one chosen by the operating system). |
| `host`   | `string` | The interface used.                                                                         |
| `url`    | `string` | The base URL (`http://host:port`).                                                          |
| `native` | `object` | The native instance, in case you need low level access.                                     |

### Schema options

| Option            | Type                | Default       | Description                                              |
| ----------------- | ------------------- | ------------- | -------------------------------------------------------- |
| `port`            | `number`            | `3000`        | The port to listen on.                                   |
| `host`            | `string`            | `'127.0.0.1'` | The interface to listen on. IPv6 is supported (`'::1'`). |
| `cors`            | `boolean`           | `false`       | Enables CORS and answers the `OPTIONS` preflight.        |
| `static`          | `string \| object`  | —             | Directory (or `prefix → directory` map) of static files. |
| `spa`             | `boolean \| string` | —             | Serves the entry point when no route matches.            |
| `cache`           | `object`            | —             | Cache policy of the static files.                        |
| `proxy`           | `object`            | —             | Routes delegated to another server (`prefix → URL` map). |
| `security`        | `object`            | see below     | Limits and protections.                                  |
| `before`          | `function`          | —             | Runs before every handler.                               |
| `after`           | `function`          | —             | Runs after the handler, with its result.                 |
| `notFound`        | `function`          | —             | Runs when no route matches.                              |
| `rpc` / `actions` | `object`            | —             | RPC actions (`name → handler` map).                      |
| `_*`              | `function`          | —             | Any other key is a route.                                |

```js
await serve(3000, {
  cors: true,
  security: {
    rateLimit: { max: 100, windowSecs: 10, keyBy: "x-api-key" },
    maxBodySize: 10 * 1024 * 1024,
    headers: true,
    auth: {
      apiKeys: { "key-alice": { name: "alice", permissions: ["posts:write"] } },
      jwt: { secret: process.env.JWT_SECRET },
      allowAnonymous: false,
    },
    tls: { ca: readFileSync("./ca.pem", "utf8") },
  },
});
```

| `security` option | Type                | Default            | Description                                                          |
| ----------------- | ------------------- | ------------------ | -------------------------------------------------------------------- |
| `rateLimit`       | `boolean \| object` | enabled            | `false` disables it; `{ max, windowSecs, keyBy }` tunes it.          |
| `maxBodySize`     | `number`            | `10485760` (10 MB) | Maximum size of the request body.                                    |
| `headers`         | `boolean`           | `true`             | Adds the browser security headers.                                   |
| `auth`            | `object`            | —                  | The authentication layer. See [Authentication](./authentication.md). |
| `tls`             | `object`            | —                  | The TLS options of the proxy (`ca`, `insecure`).                     |

### The hooks

```js
await serve(3000, {
  // Before the handler: if it returns something, that is the response.
  before({ method, path, headers }) {
    if (path.startsWith("/admin") && !headers["authorization"]) {
      throw HttpError.Unauthorized("Missing the authorization header");
    }
  },

  // After the handler: if it returns something, it replaces the result.
  after(result, ctx) {
    return { ...result, servedAt: Date.now() };
  },

  // When no route matches.
  notFound({ path }) {
    throw HttpError.NotFound(`No route for ${path}`);
  },
});
```

### Validations at startup

The declaration of the routes is checked when the server starts, so a typo fails fast
instead of being silently ignored:

```
Error: Invalid route "INVALID /x": "INVALID" is not a valid HTTP method (GET, POST, ...).
Error: Invalid route "GET x": the path must start with "/".
Error: Invalid route "/x": the handler must be a function or an object.
Error: Invalid route "users": the path must start with "/" (the reserved options are: ...).
```

The same applies to the options: an invalid port, a missing static directory or a proxy route
without an upstream are reported before the server starts listening.

## The `App` class

```js
import { App } from "@trixtylab/rupress";

const app = new App();

app.get("/path", handler);
app.post("/path", handler);
app.put("/path", handler);
app.delete("/path", handler);
app.patch("/path", handler);
app.head("/path", handler);
app.options("/path", handler);
app.all("/path", handler); // every verb

app.static("/assets", "./public");
app.cors(true);
app.security({ rateLimit: { max: 50, windowSecs: 60 } });

const port = await app.listen(3000, "127.0.0.1");
```

Every registration method returns `this` so they can be chained:

```js
app
  .get("/health", () => ({ ok: true }))
  .post("/users", ({ body }) => ({ created: body }));
```

`listen()` resolves with the port actually bound, so it works with `port = 0`.

### Validation and permissions in the imperative API

```js
app.post("/users", ({ body }) => body, {
  fields: { email: { type: "email", required: true } },
  auth: { permissions: ["users:write"] },
});
```

## The request context

| Property  | Type             | Description                                                                             |
| --------- | ---------------- | --------------------------------------------------------------------------------------- |
| `method`  | `string`         | The verb in uppercase (`'GET'`, `'POST'`…).                                             |
| `path`    | `string`         | The path of the request (without the query).                                            |
| `params`  | `object`         | The route parameters, decoded.                                                          |
| `query`   | `object`         | The query string, decoded.                                                              |
| `headers` | `object`         | The headers, in lowercase.                                                              |
| `body`    | `any`            | The parsed body (object if it is JSON, string if it is not, `null` when there is none). |
| `rawBody` | `string \| null` | The body without parsing.                                                               |
| `user`    | `object \| null` | The identity of the client: `{ name, permissions }`.                                    |
| `json()`  | `any`            | Parses the body as JSON.                                                                |

`ctx.body` is an accessor: you can read it and assign it (`ctx.body = { ...ctx.body, extra: 1 }`).

## Routing

### Parameters

Both syntaxes are accepted; the router normalizes them internally:

```js
'/users/:id': ({ params }) => params.id          // Express style
'/users/{id}': ({ params }) => params.id          // matchit style
'/files/:path*': ({ params }) => params.path      // catch-all
```

A catch-all must be the last segment of the path.

### Several verbs

```js
'/posts/:id': {
  GET: ({ params }) => ({ postId: params.id }),
  POST: async ({ params, body }) => ({ saved: true, postId: params.id })
}
```

### RPC

```js
await serve(3000, {
  rpc: {
    calculateSum: ({ a, b }) => ({ result: Number(a) + Number(b) }),
  },
});
```

The RPC actions are available at `POST /rpc/<name>` and `GET /rpc/<name>`. On `GET` the input
is the query string; on `POST`, the body.

```js
await serve(3000, {
  rpc: {
    // With a field schema:
    createUser: {
      fields: { name: { type: "string", required: true } },
      handler: ({ name }) => ({ created: name }),
    },
  },
});
```

## Errors

```js
import {
  HttpError,
  HttpClientError,
  HttpServerError,
  error,
} from "@trixtylab/rupress";

throw HttpError.NotFound("Not found");
throw new HttpClientError(409, "Conflict", { current: 3 });
throw error(422, "Invalid payload");
```

They all share the same JSON envelope. See [HTTP statuses](./http-statuses.md).

## Exports

```js
import {
  // Server
  serve,
  App,
  // Statuses
  HttpStatus,
  HTTP_STATUS_CODES,
  HTTP_STATUS_CATEGORIES,
  statusCategory,
  statusText,
  HttpResponse,
  HttpInfo,
  HttpSuccess,
  HttpRedirect,
  HttpError,
  HttpClientError,
  HttpServerError,
  // Helpers
  info,
  ok,
  created,
  accepted,
  noContent,
  success,
  redirect,
  error,
  clientError,
  serverError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  methodNotAllowed,
  conflict,
  gone,
  unprocessableContent,
  tooManyRequests,
  internalServerError,
  notImplemented,
  badGateway,
  serviceUnavailable,
  gatewayTimeout,
  // Validation
  validateBody,
  validateRequest,
  collectFields,
  isFieldDescriptor,
} from "@trixtylab/rupress";
```

The modules are also available separately:

```js
import { HttpError } from "rupress/http";
import { HttpError } from "rupress/errors";
```
