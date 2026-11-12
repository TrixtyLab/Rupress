# Architecture

rupress is an **HTTP engine written in Rust** with an **API written in JavaScript**. Each layer
does what it does best: Rust takes care of the socket, the routing and the protections;
JavaScript takes care of the logic of the application.

```
        JavaScript                        Rust (Tokio + Hyper)
  ┌──────────────────────┐        ┌──────────────────────────────────┐
  │  serve() / App       │        │  HTTP engine                     │
  │  http.js  (statuses) │ ─────▶ │  · Router (matchit)              │
  │  validation.js       │ N-API  │  · Rate limiter                  │
  │                      │        │  · Authentication (API key/JWT)  │
  └──────────────────────┘        │  · Security headers              │
                                  │  · Static files + SPA            │
                                  │  · Proxy + WebSocket tunnel      │
                                  │  · TLS for the HTTPS proxy       │
                                  │  · Interim (1xx) responses       │
                                  └──────────────────────────────────┘
```

---

## The split

### Rust (`src/server/`)

| File | Responsibility |
| --- | --- |
| `server.rs` | The engine: accept connections, apply the protections, resolve the routes, dispatch to the handler and build the response. |
| `router.rs` | The method router (based on `matchit`), the fallback and the static directories. |
| `security.rs` | The fixed window rate limiter. |
| `auth.rs` | The API keys, the JWT verification and the permissions of the routes. |
| `proxy.rs` | The reverse proxy and the WebSocket tunnel. |
| `tls.rs` | The TLS client used by the HTTPS proxy. |
| `mime.rs` | The MIME types and the cache policy. |
| `url.rs` | The percent-encoding decoding. |
| `types.rs` | The contract between Rust and JavaScript (the N-API objects). |
| `app.rs` | The application binding (`App`) and the configuration. |

### JavaScript (`src/js/`)

| File | Responsibility |
| --- | --- |
| `http.js` | The HTTP status system: registry, classes, factories and helpers. |
| `validation.js` | The declarative validation of the fields, the query and the parameters. |
| `index.js` | The server API: `serve()`, `App`, the context and the normalization of the responses. |
| `index.d.ts` | The TypeScript types. |
| `errors.js` | A compatibility proxy that re-exports `http.js`. |

---

## The flow of a request

1. **Connection**: Tokio accepts the socket and a wrapper (`InterimIo`) is created, able to
   write the 1xx responses before the final one.
2. **Rate limit**: the quota of the client is checked (by IP or by credential). When it is
   exceeded, the answer is `429` with `Retry-After`.
3. **Authentication**: the credential is verified in constant time. When it fails, the answer
   is `401`.
4. **CORS**: when it is enabled and the method is `OPTIONS`, the preflight is answered.
5. **Upgrade**: when the request asks for a protocol upgrade and a proxy route handles it, the
   handshake is completed with the upstream and the connection is tunnelled.
6. **Body**: it is read with the size limit; when it is exceeded, the answer is `413`.
7. **Routes**: the match is looked up. When there is one, the request is dispatched to the
   JavaScript handler through a *threadsafe function*.
8. **Permissions**: the identity must have the permissions the route requires, otherwise the
   answer is `403`.
9. **Static files**: when there was no match, a static file is looked up.
10. **Proxy**: when there was no match and there is a proxy route, the request is delegated.
11. **SPA**: when there was no match and there is an entry point, it is served.
12. **404**: when nothing matches, the standard JSON envelope is answered.

---

## The 1xx (interim) responses

Hyper **cannot** return a `1xx` as the final response: it turns it into a `500`. That is the
correct behaviour of HTTP/1.1, where a `1xx` is always interim.

To support it, rupress solves it in two parts:

- The `InterimIo` wrapper keeps the bytes of the 1xx responses in a queue and writes them to
  the socket **before** hyper encodes the final response.
- The service returns the interim response in the `interim` field of the native object, and the
  engine serializes it raw (`HTTP/1.1 103 Early Hints\r\n...`).

```js
'GET /early-hints': () => new EarlyHints({ link: '</app.css>' }).withFinal(ok({ ready: true }))
```

---

## Authentication without a round trip

The credentials are verified in Rust, so the request does not have to travel to JavaScript to
be authorized:

1. The API key is looked up with a **constant time** comparison.
2. The JWT is verified (signature, `exp`, `nbf`, `iss`, `aud`) with HMAC-SHA256.
3. The identity is attached to the request (`ctx.user`).

The permissions of the route travel with the handler registration, so the check is a simple
comparison when the route is resolved.

---

## The build pipeline

The project has **two sources of truth** separated: the Rust code and the JavaScript code.
`dist/` is a generated artifact.

```
src/js/*.js  ─┐
              ├─► scripts/build.js ─► dist/*.js  +  dist/index.node  +  dist/index.d.ts
src/server/  ─┘         │
                        └─► cargo build (debug | release [--target <triple>])
```

`scripts/build.js`:

1. Compiles the Rust crate with cargo (optionally for another target triple).
2. Copies the library into `dist/index.node`, resolving the name of the platform
   (`server.dll`, `libserver.so`, `libserver.dylib`).
3. Copies `src/js/*.js` and `src/js/*.d.ts` into `dist/`.
4. Cleans the leftovers of previous builds (`*.old`).
5. **Verifies** that the output is complete; when something is missing the build fails.

The `prepack` and `prepublishOnly` hooks run the release build, so the published package
**always** includes the native addon, the JavaScript layer and the types.

> **Why the code does not live in `dist/`**: `dist/` is the output folder. If the code were
> there, any build that regenerated it would take the whole implementation with it. With the
> source in `src/js/` and the copy in the build, the result is always reproducible.

---

## The JavaScript ↔ Rust boundary

The contract lives in `src/server/types.rs`:

```rust
#[napi(object)]
pub struct JsRequest {
    pub method: String,
    pub path: String,
    pub params: HashMap<String, String>,
    pub query: HashMap<String, String>,
    pub headers: HashMap<String, String>,
    pub body: Option<String>,
    pub user: Option<JsUser>,
}

#[napi(object)]
pub struct JsResponse {
    pub status: Option<u16>,
    pub headers: Option<HashMap<String, String>>,
    pub body: Option<String>,
    pub binary: Option<Buffer>,
    pub interim: Option<JsInterimResponse>,
}
```

The handler is registered with a N-API *threadsafe function* with a **bounded queue** (1024
elements): when the Node.js event loop is blocked, the requests are rejected with a `500`
instead of growing the heap without limits.

---

## Design decisions

| Decision | Reason |
| --- | --- |
| The status is a `u16` and not an enum | It allows any code of the HTTP registry, including the rarely used ones. |
| The errors share a JSON envelope | The client always receives the same shape, no matter where the error comes from. |
| The proxy goes **after** the routes | The API routes are never lost behind the dev server. |
| The static files are canonicalized | It is the correct way to block the traversal (it also works with symbolic links). |
| The dispatch queue is bounded | A blocked event loop must not be able to exhaust the memory. |
| The authentication runs in Rust | No round trip per request, and the comparison is constant time. |
| The TLS uses `rustls` | Pure Rust: no OpenSSL dependency and the same behaviour on every platform. |
