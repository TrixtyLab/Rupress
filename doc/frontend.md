# React, Vite and single page applications

rupress comes with everything needed to serve a modern frontend, both in **development** and in
**production**.

---

## Production: static files and SPA fallback

```js
import { serve } from 'rupress';

await serve(3000, {
  static: './dist',   // the Vite build
  spa: true,          // the routes of the React router serve index.html
  cache: { maxAge: 3600, immutableMaxAge: 31536000 },

  'GET /api/users': () => ({ users: [] })
});
```

### The SPA fallback

With `spa: true`, any path that does not match a rule serves the `index.html` of the root
static directory. That way the router of the frontend (React Router, Vue Router, TanStack…)
resolves the path in the browser.

```js
// GET /users/42  ->  200 with the index.html
```

The file can also be given explicitly:

```js
spa: './dist/index.html'
```

> The fallback only applies to `GET` and `HEAD`. A `POST` to an unknown path still answers
> `404`.

### The cache policy

| File | `Cache-Control` |
| --- | --- |
| `index.html` | `no-cache` — the new version is always downloaded. |
| Hashed assets (`assets/index-a1B2c3D4.js`) | `public, max-age=31536000, immutable`. |
| Everything else | `public, max-age=3600` (configurable). |

The hash is detected in the style of **Vite/Rollup** (`name-hash.ext`) and of **webpack**
(`name.hash.ext`).

```js
cache: {
  maxAge: 3600,          // the rest of the files
  immutableMaxAge: 31536000  // the hashed assets
}
```

### Several directories

```js
await serve(3000, {
  static: {
    '/assets': './dist/assets',
    '/images': './public/images'
  },
  spa: './dist/index.html'
});
```

---

## Development: proxy to the Vite dev server

```js
await serve(3000, {
  proxy: {
    '/@vite': 'http://localhost:5173',
    '/@id': 'http://localhost:5173',
    '/src': 'http://localhost:5173',
    '*': 'http://localhost:5173'   // everything else goes to the dev server
  },

  'GET /api/users': () => ({ users: [] })
});
```

The `*` prefix acts as the **fallback** for the paths that are not handled.

The proxy adds the `X-Forwarded-For` header with the address of the client, **replacing** the
value the client could have sent: it must not be forgeable. The `Host` header is rewritten
with the upstream, and the hop-by-hop headers (`Connection`, `Transfer-Encoding`,
`Content-Length`…) are never forwarded.

### The resolution order

| Order | Source | Answered by |
| --- | --- | --- |
| First | Application routes | your handlers |
| Second | Static files | the build folder |
| Third | Proxy | the Vite dev server |
| Fourth | SPA fallback | the index.html |
| Last | Nothing | 404 |

The API routes always win, so the proxy never interferes with the backend.

### The other way around (the usual option)

The inverse setup also works, and it is the one Vite uses by default: the dev server runs on
`5173` and proxies the API calls to `3000`.

```js
// vite.config.js
export default {
  server: {
    proxy: {
      '/api': 'http://localhost:3000'
    }
  }
};
```

In that case **nothing has to be configured** in rupress: the server only exposes the API.

---

## HTTPS upstreams

The proxy speaks TLS with the upstreams that use `https://`:

```js
proxy: {
  '*': 'https://api.example.com'
}
```

The certificate is verified against the **system trust store**, exactly like a browser would
do. When the upstream uses a private certificate, trust it explicitly:

```js
await serve(3000, {
  security: {
    tls: { ca: readFileSync('./ca.pem', 'utf8') }
  },
  proxy: { '*': 'https://internal.example.com' }
});
```

For a local development server with a self signed certificate the verification can be
disabled (**development only**):

```js
security: { tls: { insecure: true } }
```

---

## WebSocket: the Vite HMR

The requests that ask for a protocol *upgrade* are **tunnelled** to the upstream, so the HMR
(Hot Module Replacement) works through the Rust server:

```
browser  ──WebSocket──▶  rupress  ──WebSocket──▶  Vite dev server
```

The handshake is completed against the upstream and its answer is forwarded to the client, so
the connection behaves exactly as if the upstream had answered.

```js
await serve(3000, {
  proxy: {
    '/@vite': 'http://localhost:5173',   // includes the HMR WebSocket
    '*': 'http://localhost:5173'
  }
});
```

If the request is an upgrade but no proxy route handles it, the server answers
`501 Not Implemented`.

---

## Complete example: API and frontend

```js
// server.mjs
import { serve, HttpError } from 'rupress';

const isProduction = process.env.NODE_ENV === 'production';

await serve(3000, {
  cors: true,

  // The API always has priority
  'GET /api/products': ({ query }) => {
    const page = Number(query.page ?? 1);
    return { products: [], page };
  },

  'POST /api/products': ({ body }) => ({ created: body }),

  // The frontend
  ...(isProduction
    ? { static: './dist', spa: true }
    : { proxy: { '*': 'http://localhost:5173' } })
});
```

In production, `vite build` generates `dist/` and rupress serves it. In development, Vite
serves the frontend and rupress only exposes the API.

---

## Recommended Vite configuration

```js
// vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000'
    }
  },
  build: {
    outDir: 'dist'
  }
});
```

---

## Security notes

- The static files are served through their **canonical** path and validated against the root
  directory: the traversal attempts (`../`, `%2e%2e`) and the symbolic links pointing outside
  are rejected with `404`.
- The hidden files (`.env`, `.git`) are **not** served.
- The files bigger than 32 MB are rejected with `413` (they are served from memory, to avoid
  exhausting the heap).
- The limit can be tuned with `security.maxBodySize`.
