# rupress

An HTTP server written in **Rust** (Tokio + Hyper) with a declarative JavaScript API, a
complete HTTP status system (1xx → 5xx) and first class support for **React**, **Vite** and
other single page applications.

```js
import { serve, HttpError, ok, created } from "@trixtylab/rupress";

const server = await serve(3000, {
  cors: true,

  security: {
    auth: {
      apiKeys: { "key-alice": { name: "alice", permissions: ["posts:write"] } },
    },
  },

  "GET /users/:id": ({ params, user }) => ({
    userId: params.id,
    by: user.name,
  }),

  "POST /users": ({ body }) => created({ id: 1, ...body }, "/users/1"),

  "/posts/:id": {
    fields: { title: { type: "string", required: true } },
    POST: ({ body }) => ({ saved: true, body }),
  },
});

console.log(`Listening on ${server.url}`);
```

---

## What it provides

|                            |                                                                                                      |
| -------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Engine**                 | Tokio + Hyper in Rust, exposed through N-API. The Node.js event loop never blocks.                   |
| **HTTP statuses**          | All five categories (1xx, 2xx, 3xx, 4xx, 5xx) with 62 codes, classes and helpers.                    |
| **Declarative validation** | Describe the fields you expect and the server answers `422` for you.                                 |
| **Authentication**         | API keys and JWT (HS256) with per route permissions, resolved in Rust without a round trip.          |
| **Frontend**               | Static files, SPA fallback, hash aware caching and a proxy to the Vite dev server.                   |
| **WebSocket**              | Upgrade tunnelling so the Vite HMR works through the server.                                         |
| **Security**               | Rate limiting (per IP or per key), body and header limits, slowloris protection, traversal blocking. |

---

## Installation

The package is published in **GitHub Packages**, so the registry has to be configured once:

```bash
# .npmrc (in your project or globally)
@trixtylab:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

```bash
pnpm add '@trixtylab/rupress'
```

It requires **Node.js 18+**. A Rust toolchain is only needed to build from source.

The package ships a native binding for every supported platform (`win.node`, `lin.node`,
`mac.node` and `mac-x64.node` for Intel macOS). The JavaScript entry point detects the runtime
and loads the matching file, so the same package works on Windows, Linux and macOS.

> GitHub Packages only accepts **scoped** packages, and the scope must match the owner of the
> repository (`@trixtylab`), so the package is published as `'@trixtylab/rupress'`. The package is
> public, so it can be installed with a token that only has the `read:packages` permission.

---

## Scripts

| Script               | Description                                                                                              |
| -------------------- | -------------------------------------------------------------------------------------------------------- |
| `pnpm build`         | Compiles the native addon (debug profile) and generates `dist/`.                                         |
| `pnpm build:release` | Compiles the native addon (release profile) and generates `dist/`.                                       |
| `pnpm build:js`      | Copies the JavaScript layer into `dist` without compiling (used to assemble the multi-platform package). |
| `pnpm dev`           | Starts the example server.                                                                               |
| `pnpm test`          | Runs the whole test suite (9 suites, 375 tests).                                                         |
| `pnpm test:<suite>`  | Runs a single suite (`api`, `config`, `protocol`, `auth`, `validation`…).                                |

---

## Documentation

The full documentation lives in [`/doc`](./doc/README.md):

| Document                                      | Contents                                                      |
| --------------------------------------------- | ------------------------------------------------------------- |
| [Getting started](./doc/getting-started.md)   | Installation, your first server and the layout of a project.  |
| [API reference](./doc/api.md)                 | `serve()`, `App`, the schema options and the request context. |
| [HTTP statuses](./doc/http-statuses.md)       | The five categories, the registry and the helpers.            |
| [Declarative validation](./doc/validation.md) | `fields`, `query` and `params`.                               |
| [Authentication](./doc/authentication.md)     | API keys, JWT and route permissions.                          |
| [React, Vite and SPAs](./doc/frontend.md)     | Static files, fallback, caching, proxy and WebSocket.         |
| [Security](./doc/security.md)                 | Every protection and how to tune it.                          |
| [Architecture](./doc/architecture.md)         | How the work is split between Rust and JavaScript.            |
| [Development](./doc/development.md)           | Building, testing and contributing.                           |

---

## Project layout

```
.
├── index.js               # Package entry point (re-exports dist/)
├── doc/                   # Documentation
├── scripts/
│   └── build.js           # Build pipeline: Rust + JavaScript
├── src/
│   ├── js/                # Source of truth of the JavaScript code
│   │   ├── http.js        #   Complete HTTP status system
│   │   ├── validation.js  #   Declarative field validation
│   │   ├── index.js       #   Server API (serve / App)
│   │   ├── errors.js      #   Compatibility proxy
│   │   └── index.d.ts     #   TypeScript types
│   └── server/            # Rust code (N-API `cdylib` crate)
│       ├── app.rs         #   Application binding
│       ├── server.rs      #   HTTP engine (rate limit, CORS, 1xx, proxy, SPA)
│       ├── proxy.rs       #   Reverse proxy and WebSocket tunnelling
│       ├── auth.rs        #   API keys and JWT
│       ├── tls.rs         #   TLS client for the HTTPS proxy
│       ├── router.rs      #   Method router (matchit)
│       ├── security.rs    #   Rate limiter
│       ├── url.rs         #   Percent-encoding decoding
│       ├── mime.rs        #   MIME types and cache policy
│       └── types.rs       #   JavaScript <-> Rust contract
├── test/                  # Test suite
└── dist/                  # Generated artifact (not versioned)
```

---

## License

[UnSetSoft Public License (UPL) 1.0](./LICENSE.md) — Copyright (c) 2026 jmaxdev.
