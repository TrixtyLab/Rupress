/**
 * Comprehensive HTTP Status and Response Architecture.
 *
 * Provides typed representation, structured serialization, and ergonomic helpers
 * for all five canonical RFC HTTP status categories:
 * - 1xx: Informational (interim responses)
 * - 2xx: Successful
 * - 3xx: Redirection
 * - 4xx: Client Errors
 * - 5xx: Server Errors
 */

/**
 * Complete catalog of standard HTTP status codes, titles, and descriptions.
 */
export const HTTP_STATUS_CODES = {
  // Informational 1xx
  100: { name: 'Continue', title: 'Continue', message: 'The initial part of a request has been received and has not yet been rejected.' },
  101: { name: 'SwitchingProtocols', title: 'Switching Protocols', message: 'The server is switching protocols according to the Upgrade header.' },
  102: { name: 'Processing', title: 'Processing', message: 'The server has accepted the complete request but has not yet completed it.' },
  103: { name: 'EarlyHints', title: 'Early Hints', message: 'Preloading resources while the server prepares a final response.' },

  // Successful 2xx
  200: { name: 'Ok', title: 'OK', message: 'The request has succeeded.' },
  201: { name: 'Created', title: 'Created', message: 'The request has been fulfilled and resulted in a new resource being created.' },
  202: { name: 'Accepted', title: 'Accepted', message: 'The request has been accepted for processing, but processing is not complete.' },
  203: { name: 'NonAuthoritativeInformation', title: 'Non-Authoritative Information', message: 'Returned meta-information from a local or third-party copy.' },
  204: { name: 'NoContent', title: 'No Content', message: 'The server has fulfilled the request and there is no additional content.' },
  205: { name: 'ResetContent', title: 'Reset Content', message: 'The server has fulfilled the request and the user agent should reset the document view.' },
  206: { name: 'PartialContent', title: 'Partial Content', message: 'The server is delivering only part of the resource due to a Range header.' },
  207: { name: 'MultiStatus', title: 'Multi-Status', message: 'Multiple status codes for distinct operations within a single request.' },
  208: { name: 'AlreadyReported', title: 'Already Reported', message: 'The members of a DAV binding have already been enumerated.' },
  226: { name: 'IMUsed', title: 'IM Used', message: 'The server has fulfilled a GET request for the resource and response is an instance-manipulation.' },

  // Redirection 3xx
  300: { name: 'MultipleChoices', title: 'Multiple Choices', message: 'The target resource has more than one representation.' },
  301: { name: 'MovedPermanently', title: 'Moved Permanently', message: 'The target resource has been assigned a new permanent URI.' },
  302: { name: 'Found', title: 'Found', message: 'The target resource resides temporarily under a different URI.' },
  303: { name: 'SeeOther', title: 'See Other', message: 'The response can be found under a different URI and should be retrieved using GET.' },
  304: { name: 'NotModified', title: 'Not Modified', message: 'A conditional GET or HEAD request has been received and would have resulted in 200 OK.' },
  305: { name: 'UseProxy', title: 'Use Proxy', message: 'The requested resource must be accessed through the specified proxy.' },
  307: { name: 'TemporaryRedirect', title: 'Temporary Redirect', message: 'The target resource resides temporarily under a different URI.' },
  308: { name: 'PermanentRedirect', title: 'Permanent Redirect', message: 'The target resource has been assigned a new permanent URI.' },

  // Client Errors 4xx
  400: { name: 'BadRequest', title: 'Bad Request', message: 'The request could not be understood or was missing required parameters.' },
  401: { name: 'Unauthorized', title: 'Unauthorized', message: 'Authentication is required and has failed or has not been provided.' },
  402: { name: 'PaymentRequired', title: 'Payment Required', message: 'Payment is required to access this resource.' },
  403: { name: 'Forbidden', title: 'Forbidden', message: 'The server understood the request but refuses to authorize it.' },
  404: { name: 'NotFound', title: 'Not Found', message: 'The requested resource could not be found on this server.' },
  405: { name: 'MethodNotAllowed', title: 'Method Not Allowed', message: 'The HTTP method is not allowed for the requested resource.' },
  406: { name: 'NotAcceptable', title: 'Not Acceptable', message: 'The resource cannot generate content matching the Accept headers.' },
  407: { name: 'ProxyAuthenticationRequired', title: 'Proxy Authentication Required', message: 'Authentication with the proxy is required.' },
  408: { name: 'RequestTimeout', title: 'Request Timeout', message: 'The server timed out waiting for the client request.' },
  409: { name: 'Conflict', title: 'Conflict', message: 'The request could not be completed due to a conflict with current resource state.' },
  410: { name: 'Gone', title: 'Gone', message: 'The requested resource is no longer available and no forwarding address is known.' },
  411: { name: 'LengthRequired', title: 'Length Required', message: 'The request did not specify the length of its content.' },
  412: { name: 'PreconditionFailed', title: 'Precondition Failed', message: 'One or more request preconditions evaluated to false.' },
  413: { name: 'PayloadTooLarge', title: 'Payload Too Large', message: 'The request entity exceeds the limits defined by the server.' },
  414: { name: 'UriTooLong', title: 'URI Too Long', message: 'The provided URI was too long for the server to process.' },
  415: { name: 'UnsupportedMediaType', title: 'Unsupported Media Type', message: 'The request payload format is not supported by the target resource.' },
  416: { name: 'RangeNotSatisfiable', title: 'Range Not Satisfiable', message: 'The specified range cannot be fulfilled.' },
  417: { name: 'ExpectationFailed', title: 'Expectation Failed', message: 'The server cannot meet the requirements of the Expect header.' },
  418: { name: 'Teapot', title: "I'm a Teapot", message: 'The server refuses to brew coffee because it is, permanently, a teapot.' },
  421: { name: 'MisdirectedRequest', title: 'Misdirected Request', message: 'The request was directed at a server unable to produce a response.' },
  422: { name: 'UnprocessableContent', title: 'Unprocessable Content', message: 'The request was well-formed but contains semantic errors.' },
  423: { name: 'Locked', title: 'Locked', message: 'The target resource is currently locked.' },
  424: { name: 'FailedDependency', title: 'Failed Dependency', message: 'The request failed due to failure of a previous request.' },
  425: { name: 'TooEarly', title: 'Too Early', message: 'The server is unwilling to risk processing a request that might be replayed.' },
  426: { name: 'UpgradeRequired', title: 'Upgrade Required', message: 'The client should switch to a different protocol.' },
  428: { name: 'PreconditionRequired', title: 'Precondition Required', message: 'The origin server requires the request to be conditional.' },
  429: { name: 'TooManyRequests', title: 'Too Many Requests', message: 'The user has sent too many requests in a given amount of time.' },
  431: { name: 'RequestHeaderFieldsTooLarge', title: 'Request Header Fields Too Large', message: 'The server refuses to process the request because header fields are too large.' },
  451: { name: 'UnavailableForLegalReasons', title: 'Unavailable For Legal Reasons', message: 'The resource is unavailable due to legal or censorship demands.' },

  // Server Errors 5xx
  500: { name: 'InternalServerError', title: 'Internal Server Error', message: 'The server encountered an unexpected condition preventing fulfillment.' },
  501: { name: 'NotImplemented', title: 'Not Implemented', message: 'The server does not support the functionality required to fulfill the request.' },
  502: { name: 'BadGateway', title: 'Bad Gateway', message: 'The server received an invalid response from an inbound server.' },
  503: { name: 'ServiceUnavailable', title: 'Service Unavailable', message: 'The server is currently unable to handle the request due to maintenance or overload.' },
  504: { name: 'GatewayTimeout', title: 'Gateway Timeout', message: 'The server did not receive a timely response from an upstream server.' },
  505: { name: 'HttpVersionNotSupported', title: 'HTTP Version Not Supported', message: 'The server does not support the major version of HTTP used in the request.' },
  506: { name: 'VariantAlsoNegotiates', title: 'Variant Also Negotiates', message: 'Transparent content negotiation results in a circular reference.' },
  507: { name: 'InsufficientStorage', title: 'Insufficient Storage', message: 'The server is unable to store the representation needed to complete the request.' },
  508: { name: 'LoopDetected', title: 'Loop Detected', message: 'The server detected an infinite loop while processing the request.' },
  510: { name: 'NotExtended', title: 'Not Extended', message: 'Further extensions to the request are required for fulfillment.' },
  511: { name: 'NetworkAuthenticationRequired', title: 'Network Authentication Required', message: 'Client needs to authenticate to gain network access.' }
};

/**
 * Canonical constant mapping for HTTP status integers.
 */
export const HttpStatus = {
  // Informational 1xx
  CONTINUE: 100,
  SWITCHING_PROTOCOLS: 101,
  PROCESSING: 102,
  EARLY_HINTS: 103,

  // Successful 2xx
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NON_AUTHORITATIVE_INFORMATION: 203,
  NO_CONTENT: 204,
  RESET_CONTENT: 205,
  PARTIAL_CONTENT: 206,
  MULTI_STATUS: 207,
  ALREADY_REPORTED: 208,
  IM_USED: 226,

  // Redirection 3xx
  MULTIPLE_CHOICES: 300,
  MOVED_PERMANENTLY: 301,
  FOUND: 302,
  SEE_OTHER: 303,
  NOT_MODIFIED: 304,
  USE_PROXY: 305,
  TEMPORARY_REDIRECT: 307,
  PERMANENT_REDIRECT: 308,

  // Client Errors 4xx
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  PAYMENT_REQUIRED: 402,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  NOT_ACCEPTABLE: 406,
  PROXY_AUTHENTICATION_REQUIRED: 407,
  REQUEST_TIMEOUT: 408,
  CONFLICT: 409,
  GONE: 410,
  LENGTH_REQUIRED: 411,
  PRECONDITION_FAILED: 412,
  PAYLOAD_TOO_LARGE: 413,
  URI_TOO_LONG: 414,
  UNSUPPORTED_MEDIA_TYPE: 415,
  RANGE_NOT_SATISFIABLE: 416,
  EXPECTATION_FAILED: 417,
  IM_A_TEAPOT: 418,
  MISDIRECTED_REQUEST: 421,
  UNPROCESSABLE_CONTENT: 422,
  LOCKED: 423,
  FAILED_DEPENDENCY: 424,
  TOO_EARLY: 425,
  UPGRADE_REQUIRED: 426,
  PRECONDITION_REQUIRED: 428,
  TOO_MANY_REQUESTS: 429,
  REQUEST_HEADER_FIELDS_TOO_LARGE: 431,
  UNAVAILABLE_FOR_LEGAL_REASONS: 451,

  // Server Errors 5xx
  INTERNAL_SERVER_ERROR: 500,
  NOT_IMPLEMENTED: 501,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
  HTTP_VERSION_NOT_SUPPORTED: 505,
  VARIANT_ALSO_NEGOTIATES: 506,
  INSUFFICIENT_STORAGE: 507,
  LOOP_DETECTED: 508,
  NOT_EXTENDED: 510,
  NETWORK_AUTHENTICATION_REQUIRED: 511
};

/**
 * Canonical categories of the HTTP status code registry.
 */
export const HTTP_STATUS_CATEGORIES = {
  INFORMATIONAL: 'informational',
  SUCCESSFUL: 'successful',
  REDIRECTION: 'redirection',
  CLIENT_ERROR: 'client-error',
  SERVER_ERROR: 'server-error'
};

/**
 * Wraps a factory so it can be invoked with or without the `new` keyword.
 *
 * `HttpError.NotFound('...')` and `new HttpError.NotFound('...')` are equivalent.
 */
function factory(create) {
  return function (...args) {
    return create(...args);
  };
}

/**
 * Resolves the canonical category of a status code.
 *
 * @param {number} status HTTP status code.
 * @returns {'informational'|'successful'|'redirection'|'client-error'|'server-error'|null}
 */
export function statusCategory(status) {
  const code = Number(status);
  if (code >= 100 && code < 200) return HTTP_STATUS_CATEGORIES.INFORMATIONAL;
  if (code >= 200 && code < 300) return HTTP_STATUS_CATEGORIES.SUCCESSFUL;
  if (code >= 300 && code < 400) return HTTP_STATUS_CATEGORIES.REDIRECTION;
  if (code >= 400 && code < 500) return HTTP_STATUS_CATEGORIES.CLIENT_ERROR;
  if (code >= 500 && code < 600) return HTTP_STATUS_CATEGORIES.SERVER_ERROR;
  return null;
}

/**
 * Resolves the reason phrase registered for a status code.
 *
 * @param {number} status HTTP status code.
 * @returns {string}
 */
export function statusText(status) {
  const meta = HTTP_STATUS_CODES[Number(status)];
  return meta ? meta.title : 'Unknown Status';
}

HttpStatus.category = statusCategory;
HttpStatus.text = statusText;
HttpStatus.CATEGORIES = HTTP_STATUS_CATEGORIES;

/**
 * Universal HTTP response primitive.
 * Inherits from Error so instances can be returned or thrown directly from handlers.
 */
export class HttpResponse extends Error {
  constructor(status = 200, body = null, headers = {}) {
    const meta = HTTP_STATUS_CODES[status] || {
      name: 'HttpResponse',
      title: 'HTTP Response',
      message: 'HTTP response signal'
    };

    super(typeof body === 'string' ? body : meta.message);
    this.name = meta.name;
    this.status = Number(status);
    this.title = meta.title;
    this.body = body;
    this.headers = headers || {};

    Error.captureStackTrace?.(this, this.constructor);
  }

  header(name, value) {
    this.headers[name.toLowerCase()] = String(value);
    return this;
  }

  /**
   * Returns a serializable representation of the response.
   */
  toJSON(path = null) {
    const payload = {
      error: this.title,
      status: this.status,
      message: this.message,
      timestamp: new Date().toISOString()
    };
    if (path) {
      payload.path = path;
    }
    return payload;
  }
}

/**
 * Category Base: Informational Responses (100-199)
 *
 * Informational responses are *interim*: they are flushed to the client before the
 * final response and can be observed through the `information` event of the
 * `node:http` client. The final response defaults to `200 OK` and can be customized
 * with `.withFinal(...)` or by returning `[interim, final]` from a handler.
 */
export class HttpInfo extends HttpResponse {
  constructor(status = 100, headers = {}) {
    super(status, null, headers);
    this.final = null;
  }

  /**
   * Attaches the response that must be sent after this interim response.
   */
  withFinal(finalResponse) {
    this.final = finalResponse;
    return this;
  }
}

export const Continue = class extends HttpInfo { constructor(headers = {}) { super(100, headers); } };
export const SwitchingProtocols = class extends HttpInfo { constructor(headers = {}) { super(101, headers); } };
export const Processing = class extends HttpInfo { constructor(headers = {}) { super(102, headers); } };
export const EarlyHints = class extends HttpInfo { constructor(headers = {}) { super(103, headers); } };

HttpInfo.Continue = factory((headers) => new Continue(headers));
HttpInfo.SwitchingProtocols = factory((headers) => new SwitchingProtocols(headers));
HttpInfo.Processing = factory((headers) => new Processing(headers));
HttpInfo.EarlyHints = factory((headers) => new EarlyHints(headers));

/**
 * Creates an informational (1xx) interim response.
 */
export function info(status, headers = {}) {
  return new HttpInfo(status, headers);
}

/**
 * Category Base: Successful Responses (200-299)
 */
export class HttpSuccess extends HttpResponse {
  constructor(status = 200, body = null, headers = {}) {
    super(status, body, headers);
  }
}

export const Ok = class extends HttpSuccess { constructor(body = null, headers = {}) { super(200, body, headers); } };
export const Created = class extends HttpSuccess {
  constructor(body = null, locationOrHeaders = {}) {
    let headers = {};
    if (typeof locationOrHeaders === 'string') {
      headers = { location: locationOrHeaders };
    } else if (locationOrHeaders && typeof locationOrHeaders === 'object') {
      headers = { ...locationOrHeaders };
    }
    super(201, body, headers);
    if (headers.location) {
      this.location = headers.location;
    }
  }
};
export const Accepted = class extends HttpSuccess { constructor(body = null, headers = {}) { super(202, body, headers); } };
export const NonAuthoritativeInformation = class extends HttpSuccess { constructor(body = null, headers = {}) { super(203, body, headers); } };
export const NoContent = class extends HttpSuccess { constructor(headers = {}) { super(204, null, headers); } };
export const ResetContent = class extends HttpSuccess { constructor(headers = {}) { super(205, null, headers); } };
export const PartialContent = class extends HttpSuccess { constructor(body = null, headers = {}) { super(206, body, headers); } };
export const MultiStatus = class extends HttpSuccess { constructor(body = null, headers = {}) { super(207, body, headers); } };
export const AlreadyReported = class extends HttpSuccess { constructor(body = null, headers = {}) { super(208, body, headers); } };
export const IMUsed = class extends HttpSuccess { constructor(body = null, headers = {}) { super(226, body, headers); } };

HttpSuccess.Ok = factory((body, headers) => new Ok(body, headers));
HttpSuccess.Created = factory((body, loc) => new Created(body, loc));
HttpSuccess.Accepted = factory((body, headers) => new Accepted(body, headers));
HttpSuccess.NonAuthoritativeInformation = factory((body, headers) => new NonAuthoritativeInformation(body, headers));
HttpSuccess.NoContent = factory((headers) => new NoContent(headers));
HttpSuccess.ResetContent = factory((headers) => new ResetContent(headers));
HttpSuccess.PartialContent = factory((body, headers) => new PartialContent(body, headers));
HttpSuccess.MultiStatus = factory((body, headers) => new MultiStatus(body, headers));
HttpSuccess.AlreadyReported = factory((body, headers) => new AlreadyReported(body, headers));
HttpSuccess.IMUsed = factory((body, headers) => new IMUsed(body, headers));

/**
 * Creates a successful (2xx) response.
 */
export function success(status = 200, body = null, headers = {}) {
  return new HttpSuccess(status, body, headers);
}

/**
 * Creates a `200 OK` response.
 */
export function ok(body = null, headers = {}) {
  return new Ok(body, headers);
}

/**
 * Creates a `201 Created` response, optionally pointing to the new resource.
 */
export function created(body = null, locationOrHeaders = {}) {
  return new Created(body, locationOrHeaders);
}

/**
 * Creates a `202 Accepted` response.
 */
export function accepted(body = null, headers = {}) {
  return new Accepted(body, headers);
}

/**
 * Creates a `204 No Content` response.
 */
export function noContent(headers = {}) {
  return new NoContent(headers);
}

/**
 * Category Base: Redirections (300-399)
 */
export class HttpRedirect extends HttpResponse {
  constructor(status = 302, location = '/', body = null, headers = {}) {
    // A redirect without a target (e.g. 304 Not Modified) must not emit a
    // `location` header.
    const hasLocation = location !== null && location !== undefined && location !== '';
    const loc = hasLocation ? String(location) : null;
    const mergedHeaders = { ...headers };
    if (loc) {
      mergedHeaders.location = loc;
    }
    super(status, body, mergedHeaders);
    this.location = loc;
  }
}

export const MultipleChoices = class extends HttpRedirect { constructor(location = '/', body = null, headers = {}) { super(300, location, body, headers); } };
export const MovedPermanently = class extends HttpRedirect { constructor(location = '/', headers = {}) { super(301, location, null, headers); } };
export const Found = class extends HttpRedirect { constructor(location = '/', headers = {}) { super(302, location, null, headers); } };
export const SeeOther = class extends HttpRedirect { constructor(location = '/', headers = {}) { super(303, location, null, headers); } };
export const NotModified = class extends HttpRedirect { constructor(headers = {}) { super(304, null, null, headers); } };
export const UseProxy = class extends HttpRedirect { constructor(location = '/', headers = {}) { super(305, location, null, headers); } };
export const TemporaryRedirect = class extends HttpRedirect { constructor(location = '/', headers = {}) { super(307, location, null, headers); } };
export const PermanentRedirect = class extends HttpRedirect { constructor(location = '/', headers = {}) { super(308, location, null, headers); } };

HttpRedirect.MultipleChoices = factory((loc, body, headers) => new MultipleChoices(loc, body, headers));
HttpRedirect.MovedPermanently = factory((loc, headers) => new MovedPermanently(loc, headers));
HttpRedirect.Found = factory((loc, headers) => new Found(loc, headers));
HttpRedirect.SeeOther = factory((loc, headers) => new SeeOther(loc, headers));
HttpRedirect.NotModified = factory((headers) => new NotModified(headers));
HttpRedirect.UseProxy = factory((loc, headers) => new UseProxy(loc, headers));
HttpRedirect.TemporaryRedirect = factory((loc, headers) => new TemporaryRedirect(loc, headers));
HttpRedirect.PermanentRedirect = factory((loc, headers) => new PermanentRedirect(loc, headers));

/**
 * High-level redirection helper function supporting default, temporary, and permanent semantics.
 */
export function redirect(location, status = 302, headers = {}) {
  return new HttpRedirect(status, location, null, headers);
}

redirect.permanent = factory((location, headers) => new PermanentRedirect(location, headers));
redirect.temporary = factory((location, headers) => new TemporaryRedirect(location, headers));
redirect.found = factory((location, headers) => new Found(location, headers));
redirect.seeOther = factory((location, headers) => new SeeOther(location, headers));
redirect.movedPermanently = factory((location, headers) => new MovedPermanently(location, headers));

/**
 * Category Base: Client & Server Errors (400-599)
 */
export class HttpError extends HttpResponse {
  constructor(status = 500, message = null, details = null, headers = {}) {
    const meta = HTTP_STATUS_CODES[status] || {
      name: 'HttpError',
      title: 'HTTP Error',
      message: 'An HTTP error occurred'
    };

    super(status, null, headers);
    this.name = meta.name;
    this.status = Number(status);
    this.title = meta.title;
    this.message = message || meta.message;
    this.details = details;

    Error.captureStackTrace?.(this, this.constructor);
  }

  toJSON(path = null) {
    const payload = {
      error: this.title,
      status: this.status,
      message: this.message,
      timestamp: new Date().toISOString()
    };
    if (path) {
      payload.path = path;
    }
    if (this.details !== null && this.details !== undefined) {
      payload.details = this.details;
    }
    return payload;
  }
}

/**
 * Creates an error response for any 4xx or 5xx status code.
 */
export function error(status, message, details = null, headers = {}) {
  return new HttpError(status, message, details, headers);
}

/**
 * Category Base: Client Errors (400-499)
 */
export class HttpClientError extends HttpError {
  constructor(status = 400, message = null, details = null, headers = {}) {
    super(status, message, details, headers);
  }
}

export const BadRequest = class extends HttpClientError { constructor(msg, d, h) { super(400, msg, d, h); } };
export const Unauthorized = class extends HttpClientError { constructor(msg, d, h) { super(401, msg, d, h); } };
export const PaymentRequired = class extends HttpClientError { constructor(msg, d, h) { super(402, msg, d, h); } };
export const Forbidden = class extends HttpClientError { constructor(msg, d, h) { super(403, msg, d, h); } };
export const NotFound = class extends HttpClientError { constructor(msg, d, h) { super(404, msg, d, h); } };
export const MethodNotAllowed = class extends HttpClientError { constructor(msg, d, h) { super(405, msg, d, h); } };
export const NotAcceptable = class extends HttpClientError { constructor(msg, d, h) { super(406, msg, d, h); } };
export const ProxyAuthenticationRequired = class extends HttpClientError { constructor(msg, d, h) { super(407, msg, d, h); } };
export const RequestTimeout = class extends HttpClientError { constructor(msg, d, h) { super(408, msg, d, h); } };
export const Conflict = class extends HttpClientError { constructor(msg, d, h) { super(409, msg, d, h); } };
export const Gone = class extends HttpClientError { constructor(msg, d, h) { super(410, msg, d, h); } };
export const LengthRequired = class extends HttpClientError { constructor(msg, d, h) { super(411, msg, d, h); } };
export const PreconditionFailed = class extends HttpClientError { constructor(msg, d, h) { super(412, msg, d, h); } };
export const PayloadTooLarge = class extends HttpClientError { constructor(msg, d, h) { super(413, msg, d, h); } };
export const UriTooLong = class extends HttpClientError { constructor(msg, d, h) { super(414, msg, d, h); } };
export const UnsupportedMediaType = class extends HttpClientError { constructor(msg, d, h) { super(415, msg, d, h); } };
export const RangeNotSatisfiable = class extends HttpClientError { constructor(msg, d, h) { super(416, msg, d, h); } };
export const ExpectationFailed = class extends HttpClientError { constructor(msg, d, h) { super(417, msg, d, h); } };
export const Teapot = class extends HttpClientError { constructor(msg, d, h) { super(418, msg, d, h); } };
export const MisdirectedRequest = class extends HttpClientError { constructor(msg, d, h) { super(421, msg, d, h); } };
export const UnprocessableContent = class extends HttpClientError { constructor(msg, d, h) { super(422, msg, d, h); } };
export const Locked = class extends HttpClientError { constructor(msg, d, h) { super(423, msg, d, h); } };
export const FailedDependency = class extends HttpClientError { constructor(msg, d, h) { super(424, msg, d, h); } };
export const TooEarly = class extends HttpClientError { constructor(msg, d, h) { super(425, msg, d, h); } };
export const UpgradeRequired = class extends HttpClientError { constructor(msg, d, h) { super(426, msg, d, h); } };
export const PreconditionRequired = class extends HttpClientError { constructor(msg, d, h) { super(428, msg, d, h); } };
export const TooManyRequests = class extends HttpClientError { constructor(msg, d, h) { super(429, msg, d, h); } };
export const RequestHeaderFieldsTooLarge = class extends HttpClientError { constructor(msg, d, h) { super(431, msg, d, h); } };
export const UnavailableForLegalReasons = class extends HttpClientError { constructor(msg, d, h) { super(451, msg, d, h); } };

HttpClientError.BadRequest = factory((msg, d, h) => new BadRequest(msg, d, h));
HttpClientError.Unauthorized = factory((msg, d, h) => new Unauthorized(msg, d, h));
HttpClientError.PaymentRequired = factory((msg, d, h) => new PaymentRequired(msg, d, h));
HttpClientError.Forbidden = factory((msg, d, h) => new Forbidden(msg, d, h));
HttpClientError.NotFound = factory((msg, d, h) => new NotFound(msg, d, h));
HttpClientError.MethodNotAllowed = factory((msg, d, h) => new MethodNotAllowed(msg, d, h));
HttpClientError.NotAcceptable = factory((msg, d, h) => new NotAcceptable(msg, d, h));
HttpClientError.ProxyAuthenticationRequired = factory((msg, d, h) => new ProxyAuthenticationRequired(msg, d, h));
HttpClientError.RequestTimeout = factory((msg, d, h) => new RequestTimeout(msg, d, h));
HttpClientError.Conflict = factory((msg, d, h) => new Conflict(msg, d, h));
HttpClientError.Gone = factory((msg, d, h) => new Gone(msg, d, h));
HttpClientError.LengthRequired = factory((msg, d, h) => new LengthRequired(msg, d, h));
HttpClientError.PreconditionFailed = factory((msg, d, h) => new PreconditionFailed(msg, d, h));
HttpClientError.PayloadTooLarge = factory((msg, d, h) => new PayloadTooLarge(msg, d, h));
HttpClientError.UriTooLong = factory((msg, d, h) => new UriTooLong(msg, d, h));
HttpClientError.UnsupportedMediaType = factory((msg, d, h) => new UnsupportedMediaType(msg, d, h));
HttpClientError.RangeNotSatisfiable = factory((msg, d, h) => new RangeNotSatisfiable(msg, d, h));
HttpClientError.ExpectationFailed = factory((msg, d, h) => new ExpectationFailed(msg, d, h));
HttpClientError.Teapot = factory((msg, d, h) => new Teapot(msg, d, h));
HttpClientError.MisdirectedRequest = factory((msg, d, h) => new MisdirectedRequest(msg, d, h));
HttpClientError.UnprocessableContent = factory((msg, d, h) => new UnprocessableContent(msg, d, h));
HttpClientError.Locked = factory((msg, d, h) => new Locked(msg, d, h));
HttpClientError.FailedDependency = factory((msg, d, h) => new FailedDependency(msg, d, h));
HttpClientError.TooEarly = factory((msg, d, h) => new TooEarly(msg, d, h));
HttpClientError.UpgradeRequired = factory((msg, d, h) => new UpgradeRequired(msg, d, h));
HttpClientError.PreconditionRequired = factory((msg, d, h) => new PreconditionRequired(msg, d, h));
HttpClientError.TooManyRequests = factory((msg, d, h) => new TooManyRequests(msg, d, h));
HttpClientError.RequestHeaderFieldsTooLarge = factory((msg, d, h) => new RequestHeaderFieldsTooLarge(msg, d, h));
HttpClientError.UnavailableForLegalReasons = factory((msg, d, h) => new UnavailableForLegalReasons(msg, d, h));

/**
 * Category Base: Server Errors (500-599)
 */
export class HttpServerError extends HttpError {
  constructor(status = 500, message = null, details = null, headers = {}) {
    super(status, message, details, headers);
  }
}

export const InternalServerError = class extends HttpServerError { constructor(msg, d, h) { super(500, msg, d, h); } };
export const NotImplemented = class extends HttpServerError { constructor(msg, d, h) { super(501, msg, d, h); } };
export const BadGateway = class extends HttpServerError { constructor(msg, d, h) { super(502, msg, d, h); } };
export const ServiceUnavailable = class extends HttpServerError { constructor(msg, d, h) { super(503, msg, d, h); } };
export const GatewayTimeout = class extends HttpServerError { constructor(msg, d, h) { super(504, msg, d, h); } };
export const HttpVersionNotSupported = class extends HttpServerError { constructor(msg, d, h) { super(505, msg, d, h); } };
export const VariantAlsoNegotiates = class extends HttpServerError { constructor(msg, d, h) { super(506, msg, d, h); } };
export const InsufficientStorage = class extends HttpServerError { constructor(msg, d, h) { super(507, msg, d, h); } };
export const LoopDetected = class extends HttpServerError { constructor(msg, d, h) { super(508, msg, d, h); } };
export const NotExtended = class extends HttpServerError { constructor(msg, d, h) { super(510, msg, d, h); } };
export const NetworkAuthenticationRequired = class extends HttpServerError { constructor(msg, d, h) { super(511, msg, d, h); } };

HttpServerError.InternalServerError = factory((msg, d, h) => new InternalServerError(msg, d, h));
HttpServerError.NotImplemented = factory((msg, d, h) => new NotImplemented(msg, d, h));
HttpServerError.BadGateway = factory((msg, d, h) => new BadGateway(msg, d, h));
HttpServerError.ServiceUnavailable = factory((msg, d, h) => new ServiceUnavailable(msg, d, h));
HttpServerError.GatewayTimeout = factory((msg, d, h) => new GatewayTimeout(msg, d, h));
HttpServerError.HttpVersionNotSupported = factory((msg, d, h) => new HttpVersionNotSupported(msg, d, h));
HttpServerError.VariantAlsoNegotiates = factory((msg, d, h) => new VariantAlsoNegotiates(msg, d, h));
HttpServerError.InsufficientStorage = factory((msg, d, h) => new InsufficientStorage(msg, d, h));
HttpServerError.LoopDetected = factory((msg, d, h) => new LoopDetected(msg, d, h));
HttpServerError.NotExtended = factory((msg, d, h) => new NotExtended(msg, d, h));
HttpServerError.NetworkAuthenticationRequired = factory((msg, d, h) => new NetworkAuthenticationRequired(msg, d, h));

HttpError.BadRequest = factory((msg, d, h) => new BadRequest(msg, d, h));
HttpError.Unauthorized = factory((msg, d, h) => new Unauthorized(msg, d, h));
HttpError.PaymentRequired = factory((msg, d, h) => new PaymentRequired(msg, d, h));
HttpError.Forbidden = factory((msg, d, h) => new Forbidden(msg, d, h));
HttpError.NotFound = factory((msg, d, h) => new NotFound(msg, d, h));
HttpError.MethodNotAllowed = factory((msg, d, h) => new MethodNotAllowed(msg, d, h));
HttpError.NotAcceptable = factory((msg, d, h) => new NotAcceptable(msg, d, h));
HttpError.ProxyAuthenticationRequired = factory((msg, d, h) => new ProxyAuthenticationRequired(msg, d, h));
HttpError.RequestTimeout = factory((msg, d, h) => new RequestTimeout(msg, d, h));
HttpError.Conflict = factory((msg, d, h) => new Conflict(msg, d, h));
HttpError.Gone = factory((msg, d, h) => new Gone(msg, d, h));
HttpError.LengthRequired = factory((msg, d, h) => new LengthRequired(msg, d, h));
HttpError.PreconditionFailed = factory((msg, d, h) => new PreconditionFailed(msg, d, h));
HttpError.PayloadTooLarge = factory((msg, d, h) => new PayloadTooLarge(msg, d, h));
HttpError.UriTooLong = factory((msg, d, h) => new UriTooLong(msg, d, h));
HttpError.UnsupportedMediaType = factory((msg, d, h) => new UnsupportedMediaType(msg, d, h));
HttpError.RangeNotSatisfiable = factory((msg, d, h) => new RangeNotSatisfiable(msg, d, h));
HttpError.ExpectationFailed = factory((msg, d, h) => new ExpectationFailed(msg, d, h));
HttpError.Teapot = factory((msg, d, h) => new Teapot(msg, d, h));
HttpError.MisdirectedRequest = factory((msg, d, h) => new MisdirectedRequest(msg, d, h));
HttpError.UnprocessableContent = factory((msg, d, h) => new UnprocessableContent(msg, d, h));
HttpError.Locked = factory((msg, d, h) => new Locked(msg, d, h));
HttpError.FailedDependency = factory((msg, d, h) => new FailedDependency(msg, d, h));
HttpError.TooEarly = factory((msg, d, h) => new TooEarly(msg, d, h));
HttpError.UpgradeRequired = factory((msg, d, h) => new UpgradeRequired(msg, d, h));
HttpError.PreconditionRequired = factory((msg, d, h) => new PreconditionRequired(msg, d, h));
HttpError.TooManyRequests = factory((msg, d, h) => new TooManyRequests(msg, d, h));
HttpError.RequestHeaderFieldsTooLarge = factory((msg, d, h) => new RequestHeaderFieldsTooLarge(msg, d, h));
HttpError.UnavailableForLegalReasons = factory((msg, d, h) => new UnavailableForLegalReasons(msg, d, h));

HttpError.InternalServerError = factory((msg, d, h) => new InternalServerError(msg, d, h));
HttpError.NotImplemented = factory((msg, d, h) => new NotImplemented(msg, d, h));
HttpError.BadGateway = factory((msg, d, h) => new BadGateway(msg, d, h));
HttpError.ServiceUnavailable = factory((msg, d, h) => new ServiceUnavailable(msg, d, h));
HttpError.GatewayTimeout = factory((msg, d, h) => new GatewayTimeout(msg, d, h));
HttpError.HttpVersionNotSupported = factory((msg, d, h) => new HttpVersionNotSupported(msg, d, h));
HttpError.VariantAlsoNegotiates = factory((msg, d, h) => new VariantAlsoNegotiates(msg, d, h));
HttpError.InsufficientStorage = factory((msg, d, h) => new InsufficientStorage(msg, d, h));
HttpError.LoopDetected = factory((msg, d, h) => new LoopDetected(msg, d, h));
HttpError.NotExtended = factory((msg, d, h) => new NotExtended(msg, d, h));
HttpError.NetworkAuthenticationRequired = factory((msg, d, h) => new NetworkAuthenticationRequired(msg, d, h));

/**
 * Creates a client error (4xx) response.
 */
export function clientError(status = 400, message = null, details = null, headers = {}) {
  return new HttpClientError(status, message, details, headers);
}

/**
 * Creates a server error (5xx) response.
 */
export function serverError(status = 500, message = null, details = null, headers = {}) {
  return new HttpServerError(status, message, details, headers);
}

/**
 * Shortcuts for the most common client errors.
 */
export const badRequest = (message, details, headers) => new BadRequest(message, details, headers);
export const unauthorized = (message, details, headers) => new Unauthorized(message, details, headers);
export const forbidden = (message, details, headers) => new Forbidden(message, details, headers);
export const notFound = (message, details, headers) => new NotFound(message, details, headers);
export const methodNotAllowed = (message, details, headers) => new MethodNotAllowed(message, details, headers);
export const conflict = (message, details, headers) => new Conflict(message, details, headers);
export const gone = (message, details, headers) => new Gone(message, details, headers);
export const unprocessableContent = (message, details, headers) => new UnprocessableContent(message, details, headers);
export const tooManyRequests = (message, details, headers) => new TooManyRequests(message, details, headers);

/**
 * Shortcuts for the most common server errors.
 */
export const internalServerError = (message, details, headers) => new InternalServerError(message, details, headers);
export const notImplemented = (message, details, headers) => new NotImplemented(message, details, headers);
export const badGateway = (message, details, headers) => new BadGateway(message, details, headers);
export const serviceUnavailable = (message, details, headers) => new ServiceUnavailable(message, details, headers);
export const gatewayTimeout = (message, details, headers) => new GatewayTimeout(message, details, headers);
