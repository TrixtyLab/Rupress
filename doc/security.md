# Security

rupress applies the following protections **automatically**, without configuring anything. All
of them can be tuned.

---

## Summary

| Protection | Detail | Default |
| --- | --- | --- |
| **Request limit** | Fixed window per client. The `429` answer includes `Retry-After` with the real window and the standard JSON envelope. | 100 requests / 10 s || **Maximum body** | The body of the request is cut when it exceeds the limit; the answer is `413`. | 10 MB |
| **Headers** | Maximum number of headers and maximum size per request; when exceeded it answers `431` and closes the connection. | 100 headers / 64 KB |
| **Slowloris** | The client has a limited time to send the complete headers; otherwise the connection is closed. | 15 s |
| **Path traversal** | The static files are resolved with canonical paths and validated against the root directory. | Enabled |
| **Hidden files** | The paths containing `/.` are not served (`.env`, `.git`…). | Enabled |
| **Static file size** | The files bigger than 32 MB are rejected with `413` instead of exhausting the memory. | 32 MB |
| **Header injection** | The names are normalized to lowercase and the values with control characters are discarded. | Enabled |
| **Response integrity** | The statuses are validated (only 100–599) and every error uses the same JSON envelope. | Enabled |
| **Memory** | The queue of dispatches towards the event loop is bounded and the pending requests are always released. | Enabled |
| **Authentication** | API keys and JWT verified in Rust, in constant time. | Disabled |
| **CORS** | Opt in: only enabled with `cors: true`. | Disabled |
| **Browser headers** | `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`… | Enabled |
| **Local listening** | The server binds to `127.0.0.1` unless another interface is given. | `127.0.0.1` |

---

## Configuration

```js
await serve(3000, {
  security: {
    rateLimit: { max: 100, windowSecs: 10, keyBy: 'x-api-key' },
    maxBodySize: 10 * 1024 * 1024,
    headers: true,
    auth: {
      apiKeys: { 'key-alice': { name: 'alice', permissions: ['posts:read'] } }
    }
  }
});
```

| `security` option | Type | Default | Description |
| --- | --- | --- | --- |
| `rateLimit` | `boolean \| object` | enabled | `false` disables it; `{ max, windowSecs, keyBy }` tunes the limit, the window and the identity of the client. |
| `maxBodySize` | `number` | `10485760` | Maximum size of the request body (in bytes). |
| `headers` | `boolean` | `true` | Adds the browser security headers. |
| `auth` | `object` | — | The authentication layer. See [Authentication](./authentication.md). |
| `tls` | `object` | — | The TLS options of the proxy (`ca`, `insecure`). |

Disabling the request limit (development only):

```js
security: { rateLimit: false }
```

---

## The rate limiter

- It is a **fixed window per client**. The IP address is used by default; `X-Forwarded-For` is
  never trusted, so the identity of the client cannot be forged.
- With `keyBy` the quota is applied to a credential instead of the IP, so the users behind the
  same NAT do not share it. The credential is **hashed** before being used as the key: the raw
  value is never kept in memory and the size of the key is bounded.
- The `429` answer includes `Retry-After` with the real configured window:

```
HTTP/1.1 429 Too Many Requests
Retry-After: 10
Content-Type: application/json

{"error":"Too Many Requests","status":429,"message":"Too many requests, please retry later.","timestamp":"..."}
```

- The map of clients is **bounded**: it is pruned once per window and it has a limit, so a
  distributed attack cannot exhaust the memory of the process.

---

## Slowloris protection

A slow client that opens the connection and never sends the complete request would keep a
connection open forever. The engine closes the connection when the headers are not complete
after 15 seconds:

```
$ nc 127.0.0.1 3000
> GET / HTTP/1.1
< (15 seconds later) the connection is closed
```

---

## Header flooding

Sending too many headers, or a huge one, produces a `431` and the connection is closed:

```
$ curl -H "X-Big: $(python -c 'print("a"*100000)')" http://127.0.0.1:3000
HTTP/1.1 431 Request Header Fields Too Large
```

---

## Static files

- The path is **decoded** and **canonicalized** before touching the disk.
- The result is validated against the root directory: `../`, `%2e%2e` and the symbolic links
  pointing outside are rejected with `404`.
- The hidden files are not served.
- The files bigger than 32 MB are rejected with `413`.

```
GET /../secret.txt          -> 404
GET /%2e%2e/secret.txt      -> 404
GET /..%2fsecret.txt        -> 404
GET /.env                   -> 404
```

---

## Header injection

The headers returned by the application are normalized:

- The name is lowercased, so `Content-Type` and `content-type` cannot be sent twice.
- The values with control characters (CR, LF, NUL…) are discarded.
- The statuses are validated: only the codes between 100 and 599 are accepted.

```js
'GET /evil': () => ({
  status: 200,
  headers: { 'X-Injected': 'value\r\nX-Evil: yes' },   // -> discarded
  body: 'ok'
});
```

---

## Authentication

The credentials are verified in Rust, in constant time, before the request reaches the
handler. See [Authentication](./authentication.md) for the API keys and the JWT.

---

## Error logging

The errors are reported through `stderr`:

- The **unexpected** errors (an unhandled exception) with their full stack trace.
- The **5xx** errors with their message.
- The **4xx** errors are not reported: they are expected answers for the client.

This makes it possible to detect problems in production without filling the log with noise.

---

## Known limitations

- The rate limiter does not distinguish the users behind the same NAT when `keyBy` is not
  configured: they share the quota of their IP.
- There is no session or cookie support: the authentication layer is designed for APIs and
  machine to machine traffic.
- The TLS of the proxy verifies the certificates against the system trust store; the
  `insecure` option disables it and must never be used in production.
