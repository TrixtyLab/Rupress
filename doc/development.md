# Development

## Requirements

- **Node.js 18** or newer.
- **pnpm** (or npm).
- **Rust** with the stable toolchain and the target of the platform:

```bash
rustup target add x86_64-pc-windows-msvc   # Windows
rustup target add x86_64-unknown-linux-gnu # Linux
rustup target add aarch64-apple-darwin      # macOS (Apple Silicon)
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
| `pnpm dev` | Starts the example server. |
| `pnpm test` | Runs the whole test suite. |

### Cross compilation

The build script accepts a target triple:

```bash
node ./scripts/build.js --release --target x86_64-unknown-linux-gnu
node ./scripts/build.js --release --target aarch64-apple-darwin
```

The name of the library is resolved from the target (`server.dll`, `libserver.so`,
`libserver.dylib`) and the result is always copied to `dist/index.node`.

The `.github/workflows/build.yml` workflow compiles and tests the project on **Linux, macOS and
Windows**, and uploads the artifacts of each platform.

---

## The test suite

```bash
pnpm test
```

| File | Covers |
| --- | --- |
| `test/http_statuses.test.js` | The five HTTP categories, the registry, the helpers and the routing with parameters. |
| `test/regressions.test.js` | Query and parameter decoding, static files and traversal blocking, header normalization, invalid status, `304` without `Location`, ephemeral port, rate limit, startup validations and the declarative validation. |
| `test/frontend.test.js` | SPA fallback, cache policy, proxy to a dev server and the WebSocket tunnel. |
| `test/security.test.js` | API keys, route permissions, the rate limit per key and the HTTPS proxy. |

The tests start real servers on ephemeral ports and use `fetch` and `node:http` as clients, so
they verify the observable behaviour and not the internal implementation.

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

1. Edit the code in `src/js/` or `src/server/`.
2. `pnpm build` to recompile the native addon (only when you touched Rust).
3. `pnpm test` to verify.

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

The workflow builds the addon in release mode, runs the tests and publishes the package with a
provenance attestation. The registry, the scope and the permissions are declared in
`package.json` (`publishConfig`) and in the workflow.

> GitHub Packages only accepts scoped packages, so the name of the package is
> `@trixtylab/rupress` and the scope must match the owner of the repository.

To publish a tarball locally:

```bash
pnpm build:release
pnpm pack --pack-destination ./release
```

The `prepack` hook runs the release build, so the package always includes the native addon,
the JavaScript layer, the types and the documentation.

To publish somewhere else (npmjs, for instance) the registry can be overridden:

```bash
pnpm publish --registry https://registry.npmjs.org --access public
```

---

## Debugging

### The native addon does not load

```
Native addon not found. Run "pnpm build" (or "pnpm build:release") to compile it.
```

Build the project: `pnpm build`.

### `EBUSY` while recompiling

The previous binary is still loaded by a running process. Close the server (or the process that
uses it) and compile again; the build replaces the file anyway.

### The console does not show the errors

The errors are written to `stderr`, not to `stdout`. If you are only capturing `stdout` you
will not see them. Use `2>&1` or look at the error channel of the process.

---

## Contributing

1. Open an issue describing the expected and the current behaviour.
2. Create a branch.
3. Add or adjust the test that covers the change.
4. Run `pnpm test` and `cargo clippy`.
5. Update the documentation in `/doc` when the public API changes.

---

## Links

- [Documentation](./README.md)
- [Project README](../README.md)
