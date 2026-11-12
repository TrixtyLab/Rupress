# Authentication

rupress ships with an authentication and authorization layer that runs **in Rust**, without a
round trip to JavaScript: the credentials are verified before the request reaches the handler
and the identity is delivered in the request context.

---

## API keys

```js
await serve(3000, {
  security: {
    auth: {
      apiKeys: {
        "key-alice": { name: "alice", permissions: ["posts:read"] },
        "key-admin": { name: "admin", permissions: ["admin", "posts:read"] },
      },
    },
  },

  "GET /profile": ({ user }) => ({
    name: user.name,
    permissions: user.permissions,
  }),
});
```

The client sends the key in the `X-API-Key` header:

```bash
curl http://127.0.0.1:3000/profile -H 'x-api-key: key-alice'
```

```json
{ "name": "alice", "permissions": ["posts:read"] }
```

A key can also be declared with just its name:

```js
apiKeys: {
  'key-alice': 'alice'
}
```

The comparison is done in **constant time**, so it cannot be timed to guess a key.

### Requests without credentials

By default every request needs a credential. To allow anonymous access:

```js
auth: {
  apiKeys: { 'key-alice': { name: 'alice' } },
  allowAnonymous: true
}
```

The anonymous requests reach the handlers with `ctx.user === null`.

---

## JSON Web Tokens

Tokens are verified with the **HS256** algorithm (symmetric):

```js
await serve(3000, {
  security: {
    auth: {
      jwt: {
        secret: process.env.JWT_SECRET,
        issuer: "https://auth.example.com",
        audience: "@trixtylab/rupress",
      },
    },
  },
});
```

```bash
curl http://127.0.0.1:3000/profile -H 'authorization: Bearer <token>'
```

The `Bearer` scheme is case insensitive, as the RFC requires (`bearer`, `Bearer` and `BEARER`
are equivalent). A request without the scheme is treated as a raw token.

The token is validated completely:

- The signature is compared in constant time.
- The `alg` header must be `HS256`: a token can never choose its own verification method.
- The `exp` (expiration) and `nbf` (not before) claims are honoured.
- The `iss` and `aud` claims are checked when they are configured.

The identity is taken from the claims:

| Claim         | Effect                                                 |
| ------------- | ------------------------------------------------------ |
| `sub`         | The name of the identity (`ctx.user.name`).            |
| `permissions` | The permissions of the identity (an array of strings). |

```json
{
  "sub": "alice",
  "permissions": ["posts:read"],
  "exp": 1790000000
}
```

---

## Permissions

A route declares the permissions it requires:

```js
'/admin': {
  auth: { permissions: ['admin'] },
  GET: ({ user }) => ({ secret: true, by: user.name })
},

'/editor': {
  auth: { anyOf: ['posts:write', 'editor'] },
  POST: ({ body }) => ({ saved: true })
}
```

| Option        | Meaning                                          |
| ------------- | ------------------------------------------------ |
| `permissions` | The identity must have **all** of them.          |
| `anyOf`       | The identity must have **at least one** of them. |

When the identity does not satisfy the requirements, the server answers `403 Forbidden`:

```json
{
  "error": "Forbidden",
  "status": 403,
  "message": "The identity does not have the permissions required by this route.",
  "timestamp": "2026-01-01T00:00:00.000Z",
  "path": "/admin"
}
```

---

## The identity in the context

```js
'GET /me': ({ user }) => user
```

```json
{ "name": "alice", "permissions": ["posts:read"] }
```

When the authentication layer is disabled, `ctx.user` is `null`.

---

## Errors

| Situation                | Status             | Message                                                              |
| ------------------------ | ------------------ | -------------------------------------------------------------------- |
| No credentials           | `401 Unauthorized` | `Authentication is required.`                                        |
| Unknown API key          | `401 Unauthorized` | `The credential is not valid.`                                       |
| Invalid or expired token | `401 Unauthorized` | `The credential is not valid.` / `The credential has expired.`       |
| Missing permissions      | `403 Forbidden`    | `The identity does not have the permissions required by this route.` |

---

## The rate limit per identity

The rate limiter can be applied **per credential** instead of per IP, so the users behind the
same NAT do not share the quota:

```js
await serve(3000, {
  security: {
    rateLimit: { max: 100, windowSecs: 10, keyBy: "x-api-key" },
  },
});
```

The first header of `keyBy` that is present identifies the client; when none is present the IP
address is used. Several headers can be listed, in order of preference:

```js
rateLimit: { max: 100, windowSecs: 10, keyBy: ['x-api-key', 'authorization'] }
```

The credential is **hashed** before being used as the key of the limiter, so the raw secret is
never kept in memory and the size of the key is bounded no matter how long the header is.

> The identity of the rate limit is **not** taken from a header the client can forge freely
> unless you configure it: with `keyBy: 'x-api-key'` anyone can send a different key to get a
> new quota. Use it with the authentication layer enabled, so the key is verified first.

---

## Imperative API

```js
app.post("/users", ({ body, user }) => ({ created: body, by: user.name }), {
  auth: { permissions: ["users:write"] },
});
```

---

## Notes

- The API keys and the JWT secret live in the configuration of the process: rotate them with
  the usual secret management of your platform.
- The verification is constant time, but the **list of API keys is compared one by one**: with
  thousands of keys the verification gets slower. For a large number of identities use JWT.
- There is no session or cookie support: the layer is designed for APIs and machine to machine
  traffic.
