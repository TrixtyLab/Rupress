# rupress documentation

Welcome to the documentation of **rupress**, the HTTP server written in Rust with a
declarative JavaScript API.

## Contents

| # | Document | What you will learn |
| --- | --- | --- |
| 1 | [Getting started](./getting-started.md) | Installation, the first server and how to lay out a project. |
| 2 | [API reference](./api.md) | `serve()`, the `App` class, the schema options and the request context. |
| 3 | [HTTP statuses](./http-statuses.md) | The five categories, the complete registry and the helpers. |
| 4 | [Declarative validation](./validation.md) | Describe the expected fields and delegate the errors. |
| 5 | [Authentication](./authentication.md) | API keys, JWT and per route permissions. |
| 6 | [React, Vite and SPAs](./frontend.md) | Static files, fallback, caching, proxy and WebSocket. |
| 7 | [Security](./security.md) | The active protections, their defaults and how to tune them. |
| 8 | [Architecture](./architecture.md) | The split between Rust and JavaScript and the build pipeline. |
| 9 | [Development](./development.md) | Building, running the tests and contributing. |

## Conventions

- The examples use **JavaScript** with ES modules (`import`).
- Code blocks are copy and paste ready: unless stated otherwise, drop them into a `.mjs` file
  and run `node file.mjs`.
- Option names follow the *camelCase* style in JavaScript and *snake_case* in Rust; the native
  layer translates one into the other.

## Requirements

- **Node.js 18** or newer.
- **Rust** (stable toolchain) only when compiling the project from source.
- **pnpm** (or npm) to install the dependencies and run the scripts.

## Links

- [Repository](../README.md)
- [TypeScript types](../src/js/index.d.ts)
