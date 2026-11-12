import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { validateRequest, collectFields } from './validation.js';
import {
  HttpResponse,
  HttpError,
  HttpRedirect,
  HttpSuccess,
  HttpInfo,
  HttpClientError,
  HttpServerError,
  HttpStatus,
  HTTP_STATUS_CODES,
  info,
  ok,
  created,
  accepted,
  noContent,
  redirect,
  error,
  success,
  clientError,
  serverError,
  statusCategory,
  statusText,
  Continue,
  SwitchingProtocols,
  Processing,
  EarlyHints,
  Ok,
  Created,
  Accepted,
  NonAuthoritativeInformation,
  NoContent,
  ResetContent,
  PartialContent,
  MultiStatus,
  AlreadyReported,
  IMUsed,
  MultipleChoices,
  MovedPermanently,
  Found,
  SeeOther,
  NotModified,
  UseProxy,
  TemporaryRedirect,
  PermanentRedirect,
  BadRequest,
  Unauthorized,
  PaymentRequired,
  Forbidden,
  NotFound,
  MethodNotAllowed,
  NotAcceptable,
  ProxyAuthenticationRequired,
  RequestTimeout,
  Conflict,
  Gone,
  LengthRequired,
  PreconditionFailed,
  PayloadTooLarge,
  UriTooLong,
  UnsupportedMediaType,
  RangeNotSatisfiable,
  ExpectationFailed,
  Teapot,
  MisdirectedRequest,
  UnprocessableContent,
  Locked,
  FailedDependency,
  TooEarly,
  UpgradeRequired,
  PreconditionRequired,
  TooManyRequests,
  RequestHeaderFieldsTooLarge,
  UnavailableForLegalReasons,
  InternalServerError,
  NotImplemented,
  BadGateway,
  ServiceUnavailable,
  GatewayTimeout,
  HttpVersionNotSupported,
  VariantAlsoNegotiates,
  InsufficientStorage,
  LoopDetected,
  NotExtended,
  NetworkAuthenticationRequired
} from './http.js';

export * from './http.js';
export { validateBody, validateRequest, collectFields, isFieldDescriptor } from './validation.js';

const require = createRequire(import.meta.url);

/**
 * Resolves the compiled native addon.
 *
 * The JavaScript sources live in `src/js` and are copied into `dist` by the build
 * script, therefore the addon may live either next to this file (`dist/index.node`)
 * or inside the build output directory (`dist/index.node` relative to `src/js`).
 */
function loadAddon() {
  const candidates = ['./index.node', '../../dist/index.node', '../dist/index.node'];

  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (err) {
      // Only a missing file is retried with the next candidate: any other failure
      // (incompatible ABI, corrupted binary, ...) must surface to the caller.
      if (err?.code !== 'MODULE_NOT_FOUND') {
        throw err;
      }
    }
  }

  throw new Error(
    'Native addon not found. Run "pnpm build" (or "pnpm build:release") to compile it.'
  );
}

const addon = loadAddon();

/**
 * Safely parses JSON request body on demand to prevent memory bloat in V8.
 */
function parseBody(rawBody, headers) {
  if (!rawBody) return null;
  const contentType = headers['content-type'] || headers['Content-Type'] || '';
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(rawBody);
    } catch {
      return rawBody;
    }
  }
  return rawBody;
}

/**
 * Builds a lazy request context to minimize garbage collection pressure.
 */
function createContext(rawReq) {
  let parsedBody = undefined;
  let parsedJson = undefined;

  const ctx = {
    method: rawReq.method,
    path: rawReq.path,
    params: rawReq.params || {},
    headers: rawReq.headers || {},
    query: rawReq.query || {},
    user: rawReq.user || null,

    get rawBody() {
      return rawReq.body || null;
    },

    get body() {
      if (parsedBody === undefined) {
        parsedBody = parseBody(rawReq.body, rawReq.headers);
      }
      return parsedBody;
    },

    set body(val) {
      parsedBody = val;
    },

    json() {
      if (parsedJson === undefined) {
        if (parsedBody && typeof parsedBody === 'object') {
          parsedJson = parsedBody;
        } else {
          parsedJson = JSON.parse(rawReq.body || '{}');
        }
      }
      return parsedJson;
    }
  };

  return ctx;
}

/**
 * Validates a status code before it reaches the native layer.
 *
 * A missing status means `200 OK`; a status that is present but invalid is
 * reported as a `500` so the client never receives a malformed status line.
 */
function normalizeStatus(status) {
  if (status === undefined || status === null) {
    return 200;
  }

  const code = Number(status);
  if (!Number.isInteger(code) || code < 100 || code > 599) {
    return 500;
  }
  return code;
}

/**
 * Normalizes the headers of a response.
 *
 * The names are lowercased (so `Content-Type` and `content-type` can never be sent
 * twice) and the entries with an invalid name or with control characters in the
 * value are discarded, avoiding malformed responses.
 *
 * When a name is repeated in different cases, the first one wins.
 */
function normalizeHeaders(headers) {
  if (!headers || typeof headers !== 'object') {
    return {};
  }

  const normalized = {};

  for (const [name, value] of Object.entries(headers)) {
    if (typeof name !== 'string') continue;

    const key = name.toLowerCase();
    if (!/^[!#$%&'*+\-.^_`|~0-9a-z]+$/.test(key)) continue;
    if (key in normalized) continue;

    const text = String(value);
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u0008\u000a-\u001f]/.test(text)) continue;

    normalized[key] = text;
  }

  return normalized;
}

/**
 * Checks whether a header is already defined, ignoring the case of its name.
 *
 * @param {object} headers Headers of the response.
 * @param {string} name Name of the header.
 * @returns {boolean}
 */
function hasHeader(headers, name) {
  if (!headers || typeof headers !== 'object') {
    return false;
  }

  const lower = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === lower);
}

/**
 * Formats a clean native response object for the Rust N-API layer, ensuring
 * optional string and buffer properties are only set when present to avoid type errors.
 */
function formatNativeResponse(status, headers = {}, bodyStr = undefined, binary = undefined, interim = undefined) {
  const resp = {
    status: normalizeStatus(status),
    headers: normalizeHeaders(headers)
  };
  if (typeof bodyStr === 'string') {
    resp.body = bodyStr;
  }
  if (Buffer.isBuffer(binary)) {
    resp.binary = binary;
  } else if (binary instanceof Uint8Array) {
    resp.binary = Buffer.from(binary.buffer, binary.byteOffset, binary.byteLength);
  }
  if (interim) {
    resp.interim = interim;
  }
  return resp;
}

/**
 * Builds the native payload of an interim (1xx) response.
 */
function formatInterimResponse(response) {
  if (!response || typeof response !== 'object') {
    return null;
  }

  const status = Number(response.status);
  if (!Number.isFinite(status) || status < 100 || status > 199) {
    return null;
  }
  return {
    status,
    headers: normalizeHeaders(response.headers)
  };
}

/**
 * Checks whether a status code belongs to the informational category.
 */
function isInformational(status) {
  const code = Number(status);
  return Number.isFinite(code) && code >= 100 && code <= 199;
}

/**
 * Keys that describe an HTTP response.
 */
const RESPONSE_KEYS = new Set(['status', 'body', 'headers', 'binary', 'interim']);

/**
 * Checks whether a plain object describes an HTTP response.
 *
 * The object must only contain response keys, so a data object such as
 * `{ status: 'online' }` or `{ saved: true, body: ... }` is serialized as the body
 * of the response instead of being rejected as an invalid status.
 */
function isResponseDescriptor(res) {
  const keys = Object.keys(res);

  if (keys.length === 0) {
    return false;
  }

  if (!keys.every((key) => RESPONSE_KEYS.has(key))) {
    return false;
  }

  // A numeric status always describes the response (even if it is out of range,
  // which is reported as a 500). A textual status is a regular data property.
  if ('status' in res) {
    return typeof res.status === 'number';
  }

  return true;
}

/**
 * Reports an unexpected failure in the console, including the stack trace.
 */
function reportUnexpectedError(err, path) {
  const message = String(err?.message || err || 'An unexpected error occurred');
  console.error(`[server] Unhandled error while serving ${path}: ${message}`);

  if (err?.stack) {
    console.error(err.stack);
  }
}

/**
 * Reports a server error raised by the application.
 */
function reportServerError(status, title, message, path) {
  console.error(`[server] ${status} ${title} while serving ${path}: ${message}`);
}

/**
 * Normalizes any handler return value into the binary transport layout expected by Rust,
 * supporting HttpErrors, HttpRedirects, HttpResponses, zero-copy buffers, Web API Responses, and serialized objects.
 */
async function normalizeResponse(res, path = null) {
  // `[interim, final]` allows sending an informational response followed by a final one.
  if (Array.isArray(res) && res.length === 2) {
    const interim = formatInterimResponse(res[0]);
    if (interim) {
      const final = await normalizeResponse(res[1], path);
      final.interim = interim;
      return final;
    }
    // Not an interim/final pair: the array is serialized as a regular body below.
  }

  if (res instanceof HttpError) {
    return formatNativeResponse(
      res.status,
      { 'content-type': 'application/json', ...res.headers },
      JSON.stringify(res.toJSON(path))
    );
  }

  if (res instanceof HttpRedirect) {
    const headers = { ...res.headers };
    if (res.location && !headers['location']) {
      headers['location'] = res.location;
    }
    const bodyStr = res.body !== null && res.body !== undefined
      ? (typeof res.body === 'string' ? res.body : JSON.stringify(res.body))
      : undefined;
    return formatNativeResponse(res.status, headers, bodyStr);
  }

  // Informational responses are interim: they are flushed before the final response.
  if (res instanceof HttpInfo) {
    const interim = formatInterimResponse(res);
    const final = res.final !== null && res.final !== undefined
      ? await normalizeResponse(res.final, path)
      : formatNativeResponse(200, {}, undefined);

    if (interim) {
      final.interim = interim;
    }
    return final;
  }

  if (res instanceof HttpResponse) {
    const isBin = Buffer.isBuffer(res.body) || res.body instanceof Uint8Array;
    const binData = isBin ? res.body : undefined;
    let bodyStr = undefined;
    const headers = { ...res.headers };

    if (!isBin) {
      if (typeof res.body === 'string') {
        bodyStr = res.body;
        if (!hasHeader(headers, 'content-type')) {
          headers['content-type'] = 'text/plain; charset=utf-8';
        }
      } else if (res.body !== null && res.body !== undefined) {
        bodyStr = JSON.stringify(res.body);
        if (!hasHeader(headers, 'content-type')) {
          headers['content-type'] = 'application/json';
        }
      }
    } else {
      if (!hasHeader(headers, 'content-type')) {
        headers['content-type'] = 'application/octet-stream';
      }
    }

    return formatNativeResponse(res.status, headers, bodyStr, binData);
  }

  if (Buffer.isBuffer(res) || res instanceof Uint8Array) {
    return formatNativeResponse(
      200,
      { 'content-type': 'application/octet-stream' },
      undefined,
      res
    );
  }

  if (typeof Response !== 'undefined' && res instanceof Response) {
    const status = res.status;
    const headers = {};
    if (res.headers && typeof res.headers.forEach === 'function') {
      res.headers.forEach((value, key) => {
        headers[key] = value;
      });
    }
    const body = await res.text();
    return formatNativeResponse(status, headers, body);
  }

  if (res !== null && typeof res === 'object') {
    if (isResponseDescriptor(res)) {
      const isBin = Buffer.isBuffer(res.binary) || res.binary instanceof Uint8Array;
      const binData = isBin ? res.binary : undefined;
      const bodyStr = typeof res.body === 'string'
        ? res.body
        : (res.body !== undefined && res.body !== null ? JSON.stringify(res.body) : undefined);
      const native = formatNativeResponse(res.status, res.headers, bodyStr, binData);

      const interim = formatInterimResponse(res.interim || {});
      if (interim) {
        native.interim = interim;
      } else if (isInformational(res.status)) {
        // A plain object carrying a 1xx status is treated as an interim response.
        const plainInterim = formatInterimResponse(res);
        if (plainInterim) {
          native.interim = plainInterim;
          native.status = 200;
          native.headers = {};
          delete native.body;
          delete native.binary;
        }
      }
      return native;
    }
    return formatNativeResponse(
      200,
      { 'content-type': 'application/json' },
      JSON.stringify(res)
    );
  }

  return formatNativeResponse(
    200,
    { 'content-type': 'text/plain; charset=utf-8' },
    String(res ?? '')
  );
}

const RESERVED_SCHEMA_KEYS = new Set([
  'port',
  'host',
  'before',
  'after',
  'notFound',
  'rpc',
  'actions',
  'static',
  'spa',
  'cache',
  'proxy',
  'cors',
  'security'
]);

/**
 * HTTP methods that carry a request body, and therefore validate the `fields` schema.
 */
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

/**
 * Extracts the declarative schemas of a route definition.
 *
 * - `fields` describes the body (only for the methods that carry one).
 * - `query` describes the query string.
 * - `params` describes the path parameters.
 *
 * @param {object} definition Route definition.
 * @returns {{ schemas: object, options: object }|null} The validation descriptor.
 */
function extractValidation(definition) {
  if (!definition || typeof definition !== 'object') {
    return null;
  }

  const schemas = {};

  if (definition.fields) {
    schemas.fields = definition.fields;
  }
  if (definition.query) {
    schemas.query = definition.query;
  }
  if (definition.params) {
    schemas.params = definition.params;
  }

  if (Object.keys(schemas).length === 0) {
    return null;
  }

  // The schemas are validated when the server starts, so a typo is reported
  // instead of failing on the first request.
  for (const [source, schema] of Object.entries(schemas)) {
    try {
      collectFields(schema);
    } catch (error) {
      throw new TypeError(`Invalid "${source}" schema: ${error.message}`);
    }
  }

  return { schemas, options: definition.validation };
}

/**
 * Validates the port used to bind the server.
 *
 * @param {number} port Requested port.
 * @returns {number} The validated port.
 */
function validatePort(port) {
  const value = Number(port);
  if (!Number.isInteger(value) || value < 0 || value > 65535) {
    throw new TypeError(`Invalid port: ${port}. It must be an integer between 0 and 65535.`);
  }
  return value;
}

/**
 * Verifies that the directory used for the static files exists.
 */
function validateStaticDirectory(directory) {
  try {
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
      throw new Error(`Static directory not found: ${directory}`);
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Static directory not found')) {
      throw err;
    }
    throw new Error(`Static directory is not accessible: ${directory}`);
  }
}

/**
 * Resolves the file served when no route matches (the entry point of a SPA).
 *
 * @param {boolean|string} spa Value of the `spa` option.
 * @param {Array<{ prefix: string, dir: string }>} staticRoots Static directories.
 * @returns {string} Path of the entry point.
 */
function resolveSpaFallback(spa, staticRoots) {
  if (typeof spa === 'string') {
    return spa;
  }

  const root = staticRoots.find((entry) => entry.prefix === '/') || staticRoots[0];

  if (!root) {
    throw new Error('The "spa" option needs a static directory to serve the entry point.');
  }

  return path.join(root.dir, 'index.html');
}

/**
 * The HTTP verbs that can be used to declare a route.
 */
const ROUTE_METHODS = new Set([
  'GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'ALL', 'RPC'
]);

/**
 * Validates the declaration of a route.
 *
 * @param {string} key Key of the schema.
 * @param {string} verb The verb of the declaration.
 * @param {string} path The path of the declaration.
 */
function validateRoute(key, verb, path) {
  if (!ROUTE_METHODS.has(verb)) {
    throw new TypeError(
      `Invalid route "${key}": "${verb}" is not a valid HTTP method ` +
        `(${Array.from(ROUTE_METHODS).join(', ')}).`
    );
  }

  if (!path.startsWith('/')) {
    throw new TypeError(`Invalid route "${key}": the path must start with "/".`);
  }
}

/**
 * Translates the public security options into the shape expected by the native layer.
 *
 * @param {object} security Public security options.
 * @returns {object} Native security options.
 */
function translateSecurityOptions(security) {
  if (!security || typeof security !== 'object') {
    return {};
  }

  const rateLimit = security.rateLimit;
  const isRateLimitObject = rateLimit && typeof rateLimit === 'object';

  if (security.tls && typeof security.tls === 'object' && security.tls.insecure === true) {
    console.warn(
      '[server] WARNING: the TLS verification of the proxy is disabled. ' +
        'Never use this setting in production.'
    );
  }

  return {
    enableRateLimit: rateLimit !== false,
    rateLimitMax: isRateLimitObject ? rateLimit.max : undefined,
    rateLimitWindowSecs: isRateLimitObject ? rateLimit.windowSecs : undefined,
    rateLimitKeyBy: isRateLimitObject ? toArray(rateLimit.keyBy) : undefined,
    maxBodySizeBytes: security.maxBodySize,
    enableSecurityHeaders: security.headers !== false,
    auth: translateAuthOptions(security.auth),
    tls: translateTlsOptions(security.tls)
  };
}

/**
 * Translates the public TLS options into the native shape.
 *
 * @param {object} tls Public TLS options.
 * @returns {object|undefined} Native TLS options.
 */
function translateTlsOptions(tls) {
  if (!tls || typeof tls !== 'object') {
    return undefined;
  }

  return {
    insecure: tls.insecure === true,
    ca: tls.ca
  };
}

/**
 * Translates the public authentication options into the native shape.
 *
 * @param {object} auth Public authentication options.
 * @returns {object|undefined} Native authentication options.
 */
function translateAuthOptions(auth) {
  if (!auth || typeof auth !== 'object') {
    return undefined;
  }

  const apiKeys = {};

  for (const [key, value] of Object.entries(auth.apiKeys || {})) {
    if (typeof value === 'string') {
      apiKeys[key] = { name: value };
    } else if (value && typeof value === 'object') {
      apiKeys[key] = {
        name: value.name ?? key,
        permissions: toArray(value.permissions)
      };
    }
  }

  const jwt = auth.jwt && typeof auth.jwt === 'object' ? auth.jwt : undefined;
  const allowAnonymous = auth.allowAnonymous === true;

  if (Object.keys(apiKeys).length === 0 && !jwt?.secret && !allowAnonymous) {
    console.warn(
      '[server] WARNING: the authentication layer is enabled but no credential is configured ' +
        '(apiKeys or jwt). Every request will be answered with 401.'
    );
  }

  return {
    apiKeys: Object.keys(apiKeys).length > 0 ? apiKeys : undefined,
    jwtSecret: jwt?.secret,
    jwtIssuer: jwt?.issuer,
    jwtAudience: jwt?.audience,
    allowAnonymous
  };
}

/**
 * Normalizes a value into an array, discarding the empty entries.
 *
 * @param {any} value Value to normalize.
 * @returns {string[]|undefined} The array, or undefined when there is nothing.
 */
function toArray(value) {
  if (value === undefined || value === null) {
    return undefined;
  }

  const items = Array.isArray(value) ? value : [value];
  const filtered = items
    .filter((item) => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim());

  return filtered.length > 0 ? filtered : undefined;
}

/**
 * Extracts the permissions that a route requires.
 *
 * @param {object} definition Route definition.
 * @returns {{ permissions: string[]|undefined, anyOf: string[]|undefined }} The permissions.
 */
function extractRouteAuth(definition) {
  const auth = definition && typeof definition.auth === 'object' ? definition.auth : {};

  return {
    permissions: toArray(auth.permissions),
    anyOf: toArray(auth.anyOf)
  };
}

/**
 * Builds the JSON payload used for unexpected failures.
 */
function internalErrorPayload(err, path) {
  return {
    error: 'Internal Server Error',
    status: 500,
    message: String(err?.message || err || 'An unexpected error occurred'),
    path,
    timestamp: new Date().toISOString()
  };
}

/**
 * Boots the server using a unified declarative definition with full HTTP error handling,
 * DDoS protection, browser security headers, and kernel-level static routing.
 *
 * @param {number | object} optionsOrPort Port number or server configuration object.
 * @param {object} [maybeSchema] Route definitions, RPC actions, hooks, and static assets.
 * @returns {Promise<{ port: number, host: string, url: string, native: any }>}
 */
export async function serve(optionsOrPort, maybeSchema) {
  let port = 3000;
  let host = '127.0.0.1';
  let schema = {};

  if (typeof optionsOrPort === 'number') {
    port = optionsOrPort;
    schema = maybeSchema || {};
    // The host may also be defined in the schema when the port is the first argument.
    if (typeof schema.host === 'string') {
      host = schema.host;
    }
  } else if (typeof optionsOrPort === 'object' && optionsOrPort !== null) {
    const { port: p, host: h, ...rest } = optionsOrPort;
    schema = { ...rest, ...(maybeSchema || {}) };
    if (p !== undefined) {
      port = p;
    }
    if (typeof h === 'string') {
      host = h;
    } else if (typeof schema.host === 'string') {
      host = schema.host;
    }
  } else {
    throw new TypeError(
      'The first argument must be the port (a number) or an object with the options and the routes.'
    );
  }

  port = validatePort(port);

  const nativeApp = new addon.App();
  const staticRoots = [];
  const beforeHook = typeof schema.before === 'function' ? schema.before : null;
  const afterHook = typeof schema.after === 'function' ? schema.after : null;
  const notFoundHook = typeof schema.notFound === 'function' ? schema.notFound : null;

  if (schema.security && typeof schema.security === 'object') {
    nativeApp.setSecurity(translateSecurityOptions(schema.security));
  }

  if (schema.cors) {
    nativeApp.setCors(true);
  }

  if (schema.static) {
    if (typeof schema.static === 'string') {
      // A single directory is served from the root of the server.
      validateStaticDirectory(schema.static);
      nativeApp.addStatic('/', schema.static);
      staticRoots.push({ prefix: '/', dir: schema.static });
    } else if (typeof schema.static === 'object' && schema.static !== null) {
      for (const [prefix, dir] of Object.entries(schema.static)) {
        validateStaticDirectory(String(dir));
        nativeApp.addStatic(prefix, String(dir));
        staticRoots.push({ prefix, dir: String(dir) });
      }
    }
  }

  // Single page applications: the unmatched paths serve the entry point so the
  // router of the frontend can take over.
  if (schema.spa) {
    const fallback = resolveSpaFallback(schema.spa, staticRoots);
    nativeApp.setSpaFallback(fallback);
  }

  // Cache policy of the static files.
  if (schema.cache && typeof schema.cache === 'object') {
    nativeApp.setCachePolicy(schema.cache.maxAge, schema.cache.immutableMaxAge);
  }

  // Requests delegated to another server (the Vite dev server, for instance).
  if (schema.proxy && typeof schema.proxy === 'object') {
    const routes = [];

    for (const [prefix, upstream] of Object.entries(schema.proxy)) {
      if (typeof upstream !== 'string' || upstream.length === 0) {
        throw new TypeError(`The proxy route "${prefix}" must point to an upstream URL.`);
      }
      routes.push({ prefix, upstream });
    }

    if (routes.length > 0) {
      nativeApp.setProxy(routes);
    }
  }

  function createDispatcher(handler, validation) {
    return async (payload) => {
      const { id, request } = payload;
      const ctx = createContext(request);

      try {
        if (beforeHook) {
          const early = await beforeHook(ctx);
          if (early !== undefined && early !== null) {
            const normalizedEarly = await normalizeResponse(early, ctx.path);
            nativeApp.respond(id, normalizedEarly);
            return;
          }
        }

        // The declarative schemas are validated before the handler runs, so the
        // application only receives requests that match the declared contract.
        // The body schema only applies to the methods that carry a body.
        if (validation?.schemas) {
          const schemas = BODY_METHODS.has(ctx.method)
            ? validation.schemas
            : { ...validation.schemas, fields: undefined };

          validateRequest(schemas, {
            body: ctx.body,
            query: ctx.query,
            params: ctx.params
          }, validation.options);
        }

        let result = await handler(ctx);
        if (afterHook) {
          const modified = await afterHook(result, ctx);
          if (modified !== undefined) {
            result = modified;
          }
        }

        const normalized = await normalizeResponse(result, ctx.path);
        nativeApp.respond(id, normalized);
      } catch (err) {
        if (err instanceof HttpError) {
          if (err.status >= 500) {
            reportServerError(err.status, err.title, err.message, ctx.path);
          }
          nativeApp.respond(id, formatNativeResponse(
            err.status,
            { 'content-type': 'application/json', ...err.headers },
            JSON.stringify(err.toJSON(ctx.path))
          ));
        } else if (err instanceof HttpResponse) {
          const normalized = await normalizeResponse(err, ctx.path);
          nativeApp.respond(id, normalized);
        } else {
          reportUnexpectedError(err, ctx.path);
          nativeApp.respond(id, formatNativeResponse(
            500,
            { 'content-type': 'application/json' },
            JSON.stringify(internalErrorPayload(err, ctx.path))
          ));
        }
      }
    };
  }

  const rpcMap = schema.rpc || schema.actions;
  if (rpcMap && typeof rpcMap === 'object') {
    for (const [actionName, actionHandler] of Object.entries(rpcMap)) {
      const handler = typeof actionHandler === 'function' ? actionHandler : actionHandler?.handler;
      if (typeof handler === 'function') {
        const rpcPath = `/rpc/${actionName}`;
        const validation = extractValidation(actionHandler);
        const rpcDispatcher = createDispatcher((ctx) => {
          const input = ctx.method === 'GET' ? ctx.query : (ctx.body ?? ctx.query ?? {});
          return handler(input, ctx);
        }, validation);
        nativeApp.registerRoute('POST', rpcPath, rpcDispatcher);
        nativeApp.registerRoute('GET', rpcPath, rpcDispatcher);
      }
    }
  }

  for (const [key, value] of Object.entries(schema)) {
    if (RESERVED_SCHEMA_KEYS.has(key)) continue;

    if (key.includes(' ')) {
      const [verb, ...pathSegments] = key.trim().split(/\s+/);
      const routePath = pathSegments.join(' ');
      const method = verb.toUpperCase();

      validateRoute(key, method, routePath);

      if (method === 'RPC') {
        const rpcDispatcher = createDispatcher((ctx) => {
          const input = ctx.method === 'GET' ? ctx.query : (ctx.body ?? ctx.query ?? {});
          return value(input, ctx);
        });
        nativeApp.registerRoute('POST', routePath, rpcDispatcher);
        nativeApp.registerRoute('GET', routePath, rpcDispatcher);
      } else if (typeof value === 'object' && value !== null && typeof value.handler === 'function') {
        // 'POST /path': { fields, query, params, auth, handler }
        const { permissions, anyOf } = extractRouteAuth(value);
        nativeApp.registerRoute(
          method,
          routePath,
          createDispatcher(value.handler, extractValidation(value)),
          permissions,
          anyOf
        );
      } else {
        nativeApp.registerRoute(method, routePath, createDispatcher(value));
      }
    } else if (key.startsWith('/') && typeof value === 'object' && value !== null) {
      // '/path': { fields, query, params, auth, GET, POST }
      const validation = extractValidation(value);
      const { permissions, anyOf } = extractRouteAuth(value);

      for (const [subVerb, subHandler] of Object.entries(value)) {
        if (typeof subHandler === 'function') {
          const method = subVerb.toUpperCase();
          nativeApp.registerRoute(
            method,
            key,
            createDispatcher(subHandler, validation),
            permissions,
            anyOf
          );
        }
      }
    } else if (key.startsWith('/') && typeof value === 'function') {
      nativeApp.registerRoute('GET', key, createDispatcher(value));
    } else if (key.startsWith('/')) {
      throw new TypeError(`Invalid route "${key}": the handler must be a function or an object.`);
    } else {
      throw new TypeError(
        `Invalid route "${key}": the path must start with "/" ` +
          `(the reserved options are: ${Array.from(RESERVED_SCHEMA_KEYS).join(', ')}).`
      );
    }
  }

  if (notFoundHook) {
    nativeApp.setFallback(createDispatcher(notFoundHook));
  }

  const boundPort = await nativeApp.listen(port, host);
  const actualPort = Number(boundPort) || port;
  // IPv6 addresses must be wrapped in brackets to build a valid URL.
  const urlHost = host.includes(':') ? `[${host}]` : host;

  return {
    port: actualPort,
    host,
    url: `http://${urlHost}:${actualPort}`,
    native: nativeApp
  };
}

/**
 * Object-oriented class for backward compatibility and imperative workflows.
 */
export class App {
  constructor() {
    this._native = new addon.App();
  }

  _wrap(handler, options = {}) {
    const validation = extractValidation(options);

    return async (payload) => {
      const { id, request } = payload;
      const ctx = createContext(request);
      try {
        if (validation) {
          // The body schema only applies to the methods that carry a body.
          const schemas = BODY_METHODS.has(ctx.method)
            ? validation.schemas
            : { ...validation.schemas, fields: undefined };

          validateRequest(schemas, {
            body: ctx.body,
            query: ctx.query,
            params: ctx.params
          }, validation.options);
        }

        let res = await handler(ctx);
        const normalized = await normalizeResponse(res, ctx.path);
        this._native.respond(id, normalized);
      } catch (err) {
        if (err instanceof HttpError) {
          if (err.status >= 500) {
            reportServerError(err.status, err.title, err.message, ctx.path);
          }
          this._native.respond(id, formatNativeResponse(
            err.status,
            { 'content-type': 'application/json', ...err.headers },
            JSON.stringify(err.toJSON(ctx.path))
          ));
        } else if (err instanceof HttpResponse) {
          const normalized = await normalizeResponse(err, ctx.path);
          this._native.respond(id, normalized);
        } else {
          reportUnexpectedError(err, ctx.path);
          this._native.respond(id, formatNativeResponse(
            500,
            { 'content-type': 'application/json' },
            JSON.stringify(internalErrorPayload(err, ctx.path))
          ));
        }
      }
    };
  }

  get(path, handler, options) {
    this._native.get(path, this._wrap(handler, options), options?.auth?.permissions, options?.auth?.anyOf);
    return this;
  }

  post(path, handler, options) {
    this._native.post(path, this._wrap(handler, options), options?.auth?.permissions, options?.auth?.anyOf);
    return this;
  }

  put(path, handler, options) {
    this._native.put(path, this._wrap(handler, options), options?.auth?.permissions, options?.auth?.anyOf);
    return this;
  }

  delete(path, handler, options) {
    this._native.delete(path, this._wrap(handler, options), options?.auth?.permissions, options?.auth?.anyOf);
    return this;
  }

  patch(path, handler, options) {
    this._native.patch(path, this._wrap(handler, options), options?.auth?.permissions, options?.auth?.anyOf);
    return this;
  }

  head(path, handler, options) {
    this._native.registerRoute('HEAD', path, this._wrap(handler, options), options?.auth?.permissions, options?.auth?.anyOf);
    return this;
  }

  options(path, handler, options) {
    this._native.registerRoute('OPTIONS', path, this._wrap(handler, options), options?.auth?.permissions, options?.auth?.anyOf);
    return this;
  }

  all(path, handler, options) {
    this._native.all(path, this._wrap(handler, options), options?.auth?.permissions, options?.auth?.anyOf);
    return this;
  }

  static(prefix, dir) {
    this._native.addStatic(prefix, dir);
    return this;
  }

  cors(enabled = true) {
    this._native.setCors(enabled);
    return this;
  }

  security(options) {
    this._native.setSecurity(translateSecurityOptions(options));
    return this;
  }

  /**
   * Starts the server and resolves with the port that was actually bound.
   *
   * @param {number} port Port number (`0` lets the operating system choose one).
   * @param {string} [host] Host interface.
   * @returns {Promise<number>} The bound port.
   */
  listen(port, host) {
    return this._native.listen(validatePort(port), host);
  }
}

export default serve;
