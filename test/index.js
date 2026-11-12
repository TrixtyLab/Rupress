import { serve, HttpError, EarlyHints, ok, notFound } from '../dist/index.js';

/**
 * Removes the control characters of a value before printing it, so a crafted
 * request cannot inject escape sequences into the console.
 */
function sanitize(value) {
  return String(value).replace(/[\u0000-\u001f\u007f]/g, '');
}

const server = await serve(3000, {
  cors: true,

  security: {
    rateLimit: {
      max: 100,
      windowSecs: 10
    },
    maxBodySize: 10 * 1024 * 1024,
    headers: true
  },

  before({ method, path, headers }) {
    console.log(`[Incoming] ${sanitize(method)} ${sanitize(path)}`);
    if (path.startsWith('/admin') && !headers['authorization']) {
      throw HttpError.Unauthorized('Missing authorization header');
    }
  },

  'GET /': () => {
    return {
      status: 'online',
      engine: 'Rust-Hyper'
    };
  },

  // Informational (1xx): sent as an interim response before the final one.
  'GET /early-hints': () => {
    return new EarlyHints({ link: '</app.css>; rel=preload; as=style' }).withFinal(
      ok({ preloaded: true })
    );
  },

  'GET /users/:id': ({ params }) => {
    if (params.id === '0') {
      throw HttpError.NotFound('User not found', { requestedId: params.id });
    }
    return {
      userId: params.id,
      name: 'Alice'
    };
  },

  'GET /coffee': () => {
    throw HttpError.Teapot('Cannot brew coffee on a teapot');
  },

  // The declarative schemas validate the request before the handler runs, so the
  // handler does not have to repeat the checks (a missing field answers 422).
  '/posts/:id': {
    // Body: only for POST, PUT and PATCH.
    fields: {
      post: {
        title: {
          type: 'string',
          required: true
        },
        views: {
          type: 'integer',
          required: false,
          default: 0
        }
      }
    },

    // Query string: validated in every method.
    query: {
      page: { type: 'integer', required: false, default: 1 },
      sort: { type: 'string', enum: ['asc', 'desc'], required: false, default: 'asc' }
    },

    // Path parameters: validated in every method.
    params: {
      id: { type: 'integer', required: true }
    },

    GET: ({ params, query }) => ({
      postId: params.id,
      page: query.page,
      sort: query.sort
    }),
    POST: async ({ params, body }) => {
      return {
        saved: true,
        postId: params.id,
        content: body
      };
    }
  },

  rpc: {
    calculateSum: ({ a, b }) => {
      if (a === undefined || b === undefined) {
        throw HttpError.BadRequest('Both arguments a and b are required');
      }
      return {
        result: Number(a) + Number(b)
      };
    }
  },

  notFound: ({ path }) => {
    throw notFound(`No matching route for ${path}`);
  }
});

console.log(`Secure Rust server with complete HTTP errors running on ${server.url}`);
