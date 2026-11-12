# Development

## Requirements

- **Node.js 18** or newer.
- **pnpm** (or npm).
- **Rust** with the stable toolchain and the target of the platform:

```bash
rustup target add x86_64-pc-windows-msvc   # Windows
rustup target add x86_64-unknown-linux-gnu # Linux
rustup target add aarch64-apple-darwin      # macOS (Apple Silicon)
rustup target add x86_64-apple-darwin       # macOS (Intel)
```

---

## Getting started

```bash
pnpm install
pnpm build          # compiles the native addon in debug mode
pnpm dev            # starts the example server
```

The example server (`test/index.js`) listens on `http://127.0.0.1:3000` and shows the main
features: routes with parameters, declarative validation, interim (1xx) responses, HTTP errors
and RPC.

---

## Scripts

| Script | Description |
| --- | --- |
| `pnpm build` | Compiles the native addon (debug profile) and generates `dist/`. |
| `pnpm build:release` | Compiles the native addon (release profile) and generates `dist/`. |
| `pnpm build:js` | Copies the JavaScript layer into `dist` without compiling. |
| `pnpm dev` | Starts the example server. |
| `pnpm test` | Runs the whole test suite. |

### Cross compilation

The build script accepts a target triple:

```bash
node ./scripts/build.js --release --target x86_64-unknown-linux-gnu
node ./scripts/build.js --release --target aarch64-apple-darwin
node ./scripts/build.js --release --target x86_64-apple-darwin
```

The name of the library is resolved from the target (`server.dll`, `libserver.so`,
`libserver.dylib`) and the result is copied to a platform-specific binding:

| Platform | Architecture | Output |
| --- | --- | --- |
| Windows | x64 | `dist/win.node` |
| Windows | arm64 | `dist/win-arm64.node` |
| Linux | x64 | `dist/lin.node` |
| Linux | arm64 | `dist/lin-arm64.node` |
| macOS | arm64 | `dist/mac.node` |
| macOS | x64 | `dist/mac-x64.node` |

The JavaScript loader (`src/js/index.js`) resolves the file that matches
`process.platform` and `process.arch` at runtime, so a single package can contain every
platform. `pnpm build:js` copies only the JavaScript layer, and
`pnpm build:js --require-all` (the `prepack` hook) also verifies that `win.node`, `lin.node`,
`mac.node` and `mac-x64.node` are all present.

The `.github/workflows/build.yml` workflow compiles and tests the project on **Linux, macOS and
Windows**, builds both macOS architectures on the same runner and merges the binaries of every
platform into a single package.

---

## The test suite

```bash
pnpm test                 # every suite
pnpm test:protocol        # one suite
```

The runner (`test/run.js`) executes every suite and summarizes the result:

```
Suites: 9/9 passed
Tests:  375 passed, 0 failed
```

| File | Covers |
| --- | --- |
| `test/api.test.js` | The public exports, the hierarchy of the status classes, the metadata of the package, the build output, the type declarations and the workflows. |
| `test/config.test.js` | The detection of the misconfigurations: invalid ports, invalid routes, duplicated routes, missing directories, invalid schemas, invalid upstreams and the warnings of the configuration. |
| `test/protocol.test.js` | The HTTP protocol: the methods, CORS, the bodies, the chunked encoding, `100-continue`, the MIME types, the malformed requests and the limits of the connection. |
| `test/auth.test.js` | The complete matrix of the authentication: API keys, JWT (including the `alg: none` attack, the tampered payload and the expired tokens), the permissions of the routes and the anonymous access. |
| `test/validation.test.js` | The complete matrix of the declarative validation: every type, the required fields, the defaults, the constraints, the nested schemas, the custom messages and the delegated statuses. |
| `test/http_statuses.test.js` | The five HTTP categories, the registry, the helpers and the routing with parameters. |
| `test/regressions.test.js` | The regressions: the decoding of the query and the parameters, the static files and the traversal blocking, the normalization of the headers, the invalid status, the ephemeral port, the rate limit and the startup validations. |
| `test/frontend.test.js` | The SPA fallback, the cache policy, the proxy to a dev server and the WebSocket tunnel. |
| `test/security.test.js` | The API keys, the route permissions, the rate limit per key and the HTTPS proxy. |

Every suite starts real servers on **ephemeral ports** and uses `fetch` and `node:http` as
clients, so they verify the observable behaviour and not the internal implementation.

The TLS tests need `openssl` to generate a certificate authority; set `OPENSSL_PATH` to point
to the binary. When it is not available those tests are skipped:

```bash
OPENSSL_PATH=/usr/bin/openssl pnpm test
```

---

## Structure

```
.
├── doc/                   # This documentation
├── scripts/build.js       # Build pipeline (Rust + JavaScript)
├── src/
│   ├── js/                # JavaScript code (source of truth)
│   └── server/            # Rust code
├── test/                  # Tests and the example server
└── dist/                  # Generated artifact
```

### The workflow

- Edit the code in `src/js/` or `src/server/`.
- Run `pnpm build` to recompile the native addon (only when you touched Rust).
- Run `pnpm test` to verify.

> `dist/` is **not** versioned: it is always regenerated with `pnpm build`. If you edit
> JavaScript and want to try it without recompiling, you can import it directly from `src/js/`.

---

## Style

- **JavaScript**: two spaces, semicolons, single quotes. The comments explain the *why*, not the
  *what*.
- **Rust**: the standard `cargo fmt` format.
- The error messages and the comments of the code are written in English, like the
  documentation.

---

## Checks

```bash
cargo clippy --manifest-path ./src/server/Cargo.toml   # without warnings
cargo fmt --manifest-path ./src/server/Cargo.toml      # formats the code
pnpm test
```

---

## Publishing

The package is published in **GitHub Packages** by the `Publish` workflow (`.github/workflows/
publish.yml`), which runs on every `v*` tag and can also be triggered manually:

```bash
git tag v1.0.0
git push origin v1.0.0
```

The workflow builds the addon on Windows, Linux and macOS (both macOS architectures), merges the
binaries into a single `dist/`, runs the tests and publishes the package with a provenance
attestation. The registry, the scope and the permissions are declared in `package.json`
(`publishConfig`) and in the workflow.

> GitHub Packages only accepts scoped packages, so the name of the package is
> `@trixtylab/rupress` and the scope must match the owner of the repository.

To publish a tarball locally, all the platform binaries must be present in `dist/`:

```bash
pnpm build:release                                          # current platform
pnpm build:js --require-all                                 # assemble + verify
pnpm pack --pack-destination ./release
```

The `prepack` hook runs the JavaScript assembly and fails when `win.node`, `lin.node`,
`mac.node` or `mac-x64.node` is missing, so an incomplete package cannot be published by
accident.

To publish somewhere else (npmjs, for instance) the registry can be overridden:

```bash
pnpm publish --registry https://registry.npmjs.org --access public
```

---

## Debugging

### The native addon does not load

```
Native addon not found for win32-x64. Expected "win.node" next to the JavaScript layer.
Run "pnpm build" (or "pnpm build:release") to compile it.
```

Build the project: `pnpm build`. The generated name depends on the platform: `win.node` on
Windows, `lin.node` on Linux and `mac.node` (or `mac-x64.node` on Intel) on macOS.

### `EBUSY` while recompiling

The previous binary is still loaded by a running process. Close the server (or the process that
uses it) and compile again; the build replaces the file anyway.

### The console does not show the errors

The errors are written to `stderr`, not to `stdout`. If you are only capturing `stdout` you
will not see them. Use `2>&1` or look at the error channel of the process.

---

## Contributing

- Open an issue describing the expected and the current behaviour.
- Create a branch.
- Add or adjust the test that covers the change.
- Run `pnpm test` and `cargo clippy`.
- Update the documentation in `/doc` when the public API changes.

---

## Links

- [Documentation](./README.md)
- [Project README](../README.md)
