export interface RequestContext<TBody = any> {
  method: string;
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: TBody;
  rawBody: string | null;
  /** The identity of the client, when the authentication layer is enabled. */
  user: AuthUser | null;
  json(): any;
}

/**
 * The identity of the client, resolved by the authentication layer.
 */
export interface AuthUser {
  name: string;
  permissions: string[];
}

export interface CustomResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: any;
  binary?: Uint8Array | Buffer;
  interim?: InterimResponse;
}

export interface HttpStatusMeta {
  name: string;
  title: string;
  message: string;
}

export type HttpStatusCategory =
  | 'informational'
  | 'successful'
  | 'redirection'
  | 'client-error'
  | 'server-error';

export const HTTP_STATUS_CATEGORIES: {
  readonly INFORMATIONAL: 'informational';
  readonly SUCCESSFUL: 'successful';
  readonly REDIRECTION: 'redirection';
  readonly CLIENT_ERROR: 'client-error';
  readonly SERVER_ERROR: 'server-error';
};

export const HTTP_STATUS_CODES: Record<number, HttpStatusMeta>;

export function statusCategory(status: number): HttpStatusCategory | null;
export function statusText(status: number): string;

export const HttpStatus: {
  // Informational 1xx
  readonly CONTINUE: 100;
  readonly SWITCHING_PROTOCOLS: 101;
  readonly PROCESSING: 102;
  readonly EARLY_HINTS: 103;

  // Successful 2xx
  readonly OK: 200;
  readonly CREATED: 201;
  readonly ACCEPTED: 202;
  readonly NON_AUTHORITATIVE_INFORMATION: 203;
  readonly NO_CONTENT: 204;
  readonly RESET_CONTENT: 205;
  readonly PARTIAL_CONTENT: 206;
  readonly MULTI_STATUS: 207;
  readonly ALREADY_REPORTED: 208;
  readonly IM_USED: 226;

  // Redirection 3xx
  readonly MULTIPLE_CHOICES: 300;
  readonly MOVED_PERMANENTLY: 301;
  readonly FOUND: 302;
  readonly SEE_OTHER: 303;
  readonly NOT_MODIFIED: 304;
  readonly USE_PROXY: 305;
  readonly TEMPORARY_REDIRECT: 307;
  readonly PERMANENT_REDIRECT: 308;

  // Client Errors 4xx
  readonly BAD_REQUEST: 400;
  readonly UNAUTHORIZED: 401;
  readonly PAYMENT_REQUIRED: 402;
  readonly FORBIDDEN: 403;
  readonly NOT_FOUND: 404;
  readonly METHOD_NOT_ALLOWED: 405;
  readonly NOT_ACCEPTABLE: 406;
  readonly PROXY_AUTHENTICATION_REQUIRED: 407;
  readonly REQUEST_TIMEOUT: 408;
  readonly CONFLICT: 409;
  readonly GONE: 410;
  readonly LENGTH_REQUIRED: 411;
  readonly PRECONDITION_FAILED: 412;
  readonly PAYLOAD_TOO_LARGE: 413;
  readonly URI_TOO_LONG: 414;
  readonly UNSUPPORTED_MEDIA_TYPE: 415;
  readonly RANGE_NOT_SATISFIABLE: 416;
  readonly EXPECTATION_FAILED: 417;
  readonly IM_A_TEAPOT: 418;
  readonly MISDIRECTED_REQUEST: 421;
  readonly UNPROCESSABLE_CONTENT: 422;
  readonly LOCKED: 423;
  readonly FAILED_DEPENDENCY: 424;
  readonly TOO_EARLY: 425;
  readonly UPGRADE_REQUIRED: 426;
  readonly PRECONDITION_REQUIRED: 428;
  readonly TOO_MANY_REQUESTS: 429;
  readonly REQUEST_HEADER_FIELDS_TOO_LARGE: 431;
  readonly UNAVAILABLE_FOR_LEGAL_REASONS: 451;

  // Server Errors 5xx
  readonly INTERNAL_SERVER_ERROR: 500;
  readonly NOT_IMPLEMENTED: 501;
  readonly BAD_GATEWAY: 502;
  readonly SERVICE_UNAVAILABLE: 503;
  readonly GATEWAY_TIMEOUT: 504;
  readonly HTTP_VERSION_NOT_SUPPORTED: 505;
  readonly VARIANT_ALSO_NEGOTIATES: 506;
  readonly INSUFFICIENT_STORAGE: 507;
  readonly LOOP_DETECTED: 508;
  readonly NOT_EXTENDED: 510;
  readonly NETWORK_AUTHENTICATION_REQUIRED: 511;

  category(status: number): HttpStatusCategory | null;
  text(status: number): string;
  CATEGORIES: typeof HTTP_STATUS_CATEGORIES;
};

export class HttpResponse extends Error {
  name: string;
  status: number;
  title: string;
  body: any;
  headers: Record<string, string>;
  constructor(status?: number, body?: any, headers?: Record<string, string>);
  header(name: string, value: string | number): this;
  toJSON(path?: string | null): Record<string, any>;
}

/**
 * Interim (1xx) response. It is flushed to the client before the final response.
 */
export class HttpInfo extends HttpResponse {
  final: HttpResponse | CustomResponse | null;
  constructor(status?: number, headers?: Record<string, string>);
  withFinal(finalResponse: HttpResponse | CustomResponse): this;
  static Continue(headers?: Record<string, string>): Continue;
  static SwitchingProtocols(headers?: Record<string, string>): SwitchingProtocols;
  static Processing(headers?: Record<string, string>): Processing;
  static EarlyHints(headers?: Record<string, string>): EarlyHints;
}

export function info(status: number, headers?: Record<string, string>): HttpInfo;

export class Continue extends HttpInfo {}
export class SwitchingProtocols extends HttpInfo {}
export class Processing extends HttpInfo {}
export class EarlyHints extends HttpInfo {}

export class HttpSuccess extends HttpResponse {
  constructor(status?: number, body?: any, headers?: Record<string, string>);
  static Ok(body?: any, headers?: Record<string, string>): Ok;
  static Created(body?: any, locationOrHeaders?: string | Record<string, string>): Created;
  static Accepted(body?: any, headers?: Record<string, string>): Accepted;
  static NonAuthoritativeInformation(body?: any, headers?: Record<string, string>): NonAuthoritativeInformation;
  static NoContent(headers?: Record<string, string>): NoContent;
  static ResetContent(headers?: Record<string, string>): ResetContent;
  static PartialContent(body?: any, headers?: Record<string, string>): PartialContent;
  static MultiStatus(body?: any, headers?: Record<string, string>): MultiStatus;
  static AlreadyReported(body?: any, headers?: Record<string, string>): AlreadyReported;
  static IMUsed(body?: any, headers?: Record<string, string>): IMUsed;
}

export function success(status?: number, body?: any, headers?: Record<string, string>): HttpSuccess;
export function ok(body?: any, headers?: Record<string, string>): Ok;
export function created(body?: any, locationOrHeaders?: string | Record<string, string>): Created;
export function accepted(body?: any, headers?: Record<string, string>): Accepted;
export function noContent(headers?: Record<string, string>): NoContent;

export class Ok extends HttpSuccess {}
export class Created extends HttpSuccess {
  location?: string;
  constructor(body?: any, locationOrHeaders?: string | Record<string, string>);
}
export class Accepted extends HttpSuccess {}
export class NonAuthoritativeInformation extends HttpSuccess {}
export class NoContent extends HttpSuccess {
  constructor(headers?: Record<string, string>);
}
export class ResetContent extends HttpSuccess {
  constructor(headers?: Record<string, string>);
}
export class PartialContent extends HttpSuccess {}
export class MultiStatus extends HttpSuccess {}
export class AlreadyReported extends HttpSuccess {}
export class IMUsed extends HttpSuccess {}

export class HttpRedirect extends HttpResponse {
  location: string | null;
  constructor(status?: number, location?: string | null, body?: any, headers?: Record<string, string>);
  static MultipleChoices(location?: string, body?: any, headers?: Record<string, string>): MultipleChoices;
  static MovedPermanently(location?: string, headers?: Record<string, string>): MovedPermanently;
  static Found(location?: string, headers?: Record<string, string>): Found;
  static SeeOther(location?: string, headers?: Record<string, string>): SeeOther;
  static NotModified(headers?: Record<string, string>): NotModified;
  static UseProxy(location?: string, headers?: Record<string, string>): UseProxy;
  static TemporaryRedirect(location?: string, headers?: Record<string, string>): TemporaryRedirect;
  static PermanentRedirect(location?: string, headers?: Record<string, string>): PermanentRedirect;
}

export interface RedirectHelper {
  (location: string, status?: number, headers?: Record<string, string>): HttpRedirect;
  permanent(location: string, headers?: Record<string, string>): PermanentRedirect;
  temporary(location: string, headers?: Record<string, string>): TemporaryRedirect;
  found(location: string, headers?: Record<string, string>): Found;
  seeOther(location: string, headers?: Record<string, string>): SeeOther;
  movedPermanently(location: string, headers?: Record<string, string>): MovedPermanently;
}

export const redirect: RedirectHelper;

export class MultipleChoices extends HttpRedirect {}
export class MovedPermanently extends HttpRedirect {
  constructor(location?: string, headers?: Record<string, string>);
}
export class Found extends HttpRedirect {
  constructor(location?: string, headers?: Record<string, string>);
}
export class SeeOther extends HttpRedirect {
  constructor(location?: string, headers?: Record<string, string>);
}
export class NotModified extends HttpRedirect {
  constructor(headers?: Record<string, string>);
}
export class UseProxy extends HttpRedirect {
  constructor(location?: string, headers?: Record<string, string>);
}
export class TemporaryRedirect extends HttpRedirect {
  constructor(location?: string, headers?: Record<string, string>);
}
export class PermanentRedirect extends HttpRedirect {
  constructor(location?: string, headers?: Record<string, string>);
}

export class HttpError extends HttpResponse {
  name: string;
  status: number;
  title: string;
  details: any;
  constructor(status: number, message?: string, details?: any, headers?: Record<string, string>);
  toJSON(path?: string | null): Record<string, any>;

  static BadRequest(message?: string, details?: any, headers?: Record<string, string>): BadRequest;
  static Unauthorized(message?: string, details?: any, headers?: Record<string, string>): Unauthorized;
  static PaymentRequired(message?: string, details?: any, headers?: Record<string, string>): PaymentRequired;
  static Forbidden(message?: string, details?: any, headers?: Record<string, string>): Forbidden;
  static NotFound(message?: string, details?: any, headers?: Record<string, string>): NotFound;
  static MethodNotAllowed(message?: string, details?: any, headers?: Record<string, string>): MethodNotAllowed;
  static NotAcceptable(message?: string, details?: any, headers?: Record<string, string>): NotAcceptable;
  static ProxyAuthenticationRequired(message?: string, details?: any, headers?: Record<string, string>): ProxyAuthenticationRequired;
  static RequestTimeout(message?: string, details?: any, headers?: Record<string, string>): RequestTimeout;
  static Conflict(message?: string, details?: any, headers?: Record<string, string>): Conflict;
  static Gone(message?: string, details?: any, headers?: Record<string, string>): Gone;
  static LengthRequired(message?: string, details?: any, headers?: Record<string, string>): LengthRequired;
  static PreconditionFailed(message?: string, details?: any, headers?: Record<string, string>): PreconditionFailed;
  static PayloadTooLarge(message?: string, details?: any, headers?: Record<string, string>): PayloadTooLarge;
  static UriTooLong(message?: string, details?: any, headers?: Record<string, string>): UriTooLong;
  static UnsupportedMediaType(message?: string, details?: any, headers?: Record<string, string>): UnsupportedMediaType;
  static RangeNotSatisfiable(message?: string, details?: any, headers?: Record<string, string>): RangeNotSatisfiable;
  static ExpectationFailed(message?: string, details?: any, headers?: Record<string, string>): ExpectationFailed;
  static Teapot(message?: string, details?: any, headers?: Record<string, string>): Teapot;
  static MisdirectedRequest(message?: string, details?: any, headers?: Record<string, string>): MisdirectedRequest;
  static UnprocessableContent(message?: string, details?: any, headers?: Record<string, string>): UnprocessableContent;
  static Locked(message?: string, details?: any, headers?: Record<string, string>): Locked;
  static FailedDependency(message?: string, details?: any, headers?: Record<string, string>): FailedDependency;
  static TooEarly(message?: string, details?: any, headers?: Record<string, string>): TooEarly;
  static UpgradeRequired(message?: string, details?: any, headers?: Record<string, string>): UpgradeRequired;
  static PreconditionRequired(message?: string, details?: any, headers?: Record<string, string>): PreconditionRequired;
  static TooManyRequests(message?: string, details?: any, headers?: Record<string, string>): TooManyRequests;
  static RequestHeaderFieldsTooLarge(message?: string, details?: any, headers?: Record<string, string>): RequestHeaderFieldsTooLarge;
  static UnavailableForLegalReasons(message?: string, details?: any, headers?: Record<string, string>): UnavailableForLegalReasons;

  static InternalServerError(message?: string, details?: any, headers?: Record<string, string>): InternalServerError;
  static NotImplemented(message?: string, details?: any, headers?: Record<string, string>): NotImplemented;
  static BadGateway(message?: string, details?: any, headers?: Record<string, string>): BadGateway;
  static ServiceUnavailable(message?: string, details?: any, headers?: Record<string, string>): ServiceUnavailable;
  static GatewayTimeout(message?: string, details?: any, headers?: Record<string, string>): GatewayTimeout;
  static HttpVersionNotSupported(message?: string, details?: any, headers?: Record<string, string>): HttpVersionNotSupported;
  static VariantAlsoNegotiates(message?: string, details?: any, headers?: Record<string, string>): VariantAlsoNegotiates;
  static InsufficientStorage(message?: string, details?: any, headers?: Record<string, string>): InsufficientStorage;
  static LoopDetected(message?: string, details?: any, headers?: Record<string, string>): LoopDetected;
  static NotExtended(message?: string, details?: any, headers?: Record<string, string>): NotExtended;
  static NetworkAuthenticationRequired(message?: string, details?: any, headers?: Record<string, string>): NetworkAuthenticationRequired;
}

export function error(status: number, message?: string, details?: any, headers?: Record<string, string>): HttpError;

export class HttpClientError extends HttpError {
  constructor(status?: number, message?: string, details?: any, headers?: Record<string, string>);

  static BadRequest(message?: string, details?: any, headers?: Record<string, string>): BadRequest;
  static Unauthorized(message?: string, details?: any, headers?: Record<string, string>): Unauthorized;
  static PaymentRequired(message?: string, details?: any, headers?: Record<string, string>): PaymentRequired;
  static Forbidden(message?: string, details?: any, headers?: Record<string, string>): Forbidden;
  static NotFound(message?: string, details?: any, headers?: Record<string, string>): NotFound;
  static MethodNotAllowed(message?: string, details?: any, headers?: Record<string, string>): MethodNotAllowed;
  static NotAcceptable(message?: string, details?: any, headers?: Record<string, string>): NotAcceptable;
  static ProxyAuthenticationRequired(message?: string, details?: any, headers?: Record<string, string>): ProxyAuthenticationRequired;
  static RequestTimeout(message?: string, details?: any, headers?: Record<string, string>): RequestTimeout;
  static Conflict(message?: string, details?: any, headers?: Record<string, string>): Conflict;
  static Gone(message?: string, details?: any, headers?: Record<string, string>): Gone;
  static LengthRequired(message?: string, details?: any, headers?: Record<string, string>): LengthRequired;
  static PreconditionFailed(message?: string, details?: any, headers?: Record<string, string>): PreconditionFailed;
  static PayloadTooLarge(message?: string, details?: any, headers?: Record<string, string>): PayloadTooLarge;
  static UriTooLong(message?: string, details?: any, headers?: Record<string, string>): UriTooLong;
  static UnsupportedMediaType(message?: string, details?: any, headers?: Record<string, string>): UnsupportedMediaType;
  static RangeNotSatisfiable(message?: string, details?: any, headers?: Record<string, string>): RangeNotSatisfiable;
  static ExpectationFailed(message?: string, details?: any, headers?: Record<string, string>): ExpectationFailed;
  static Teapot(message?: string, details?: any, headers?: Record<string, string>): Teapot;
  static MisdirectedRequest(message?: string, details?: any, headers?: Record<string, string>): MisdirectedRequest;
  static UnprocessableContent(message?: string, details?: any, headers?: Record<string, string>): UnprocessableContent;
  static Locked(message?: string, details?: any, headers?: Record<string, string>): Locked;
  static FailedDependency(message?: string, details?: any, headers?: Record<string, string>): FailedDependency;
  static TooEarly(message?: string, details?: any, headers?: Record<string, string>): TooEarly;
  static UpgradeRequired(message?: string, details?: any, headers?: Record<string, string>): UpgradeRequired;
  static PreconditionRequired(message?: string, details?: any, headers?: Record<string, string>): PreconditionRequired;
  static TooManyRequests(message?: string, details?: any, headers?: Record<string, string>): TooManyRequests;
  static RequestHeaderFieldsTooLarge(message?: string, details?: any, headers?: Record<string, string>): RequestHeaderFieldsTooLarge;
  static UnavailableForLegalReasons(message?: string, details?: any, headers?: Record<string, string>): UnavailableForLegalReasons;
}

export class HttpServerError extends HttpError {
  constructor(status?: number, message?: string, details?: any, headers?: Record<string, string>);

  static InternalServerError(message?: string, details?: any, headers?: Record<string, string>): InternalServerError;
  static NotImplemented(message?: string, details?: any, headers?: Record<string, string>): NotImplemented;
  static BadGateway(message?: string, details?: any, headers?: Record<string, string>): BadGateway;
  static ServiceUnavailable(message?: string, details?: any, headers?: Record<string, string>): ServiceUnavailable;
  static GatewayTimeout(message?: string, details?: any, headers?: Record<string, string>): GatewayTimeout;
  static HttpVersionNotSupported(message?: string, details?: any, headers?: Record<string, string>): HttpVersionNotSupported;
  static VariantAlsoNegotiates(message?: string, details?: any, headers?: Record<string, string>): VariantAlsoNegotiates;
  static InsufficientStorage(message?: string, details?: any, headers?: Record<string, string>): InsufficientStorage;
  static LoopDetected(message?: string, details?: any, headers?: Record<string, string>): LoopDetected;
  static NotExtended(message?: string, details?: any, headers?: Record<string, string>): NotExtended;
  static NetworkAuthenticationRequired(message?: string, details?: any, headers?: Record<string, string>): NetworkAuthenticationRequired;
}

export function clientError(status?: number, message?: string, details?: any, headers?: Record<string, string>): HttpClientError;
export function serverError(status?: number, message?: string, details?: any, headers?: Record<string, string>): HttpServerError;

export function badRequest(message?: string, details?: any, headers?: Record<string, string>): BadRequest;
export function unauthorized(message?: string, details?: any, headers?: Record<string, string>): Unauthorized;
export function forbidden(message?: string, details?: any, headers?: Record<string, string>): Forbidden;
export function notFound(message?: string, details?: any, headers?: Record<string, string>): NotFound;
export function methodNotAllowed(message?: string, details?: any, headers?: Record<string, string>): MethodNotAllowed;
export function conflict(message?: string, details?: any, headers?: Record<string, string>): Conflict;
export function gone(message?: string, details?: any, headers?: Record<string, string>): Gone;
export function unprocessableContent(message?: string, details?: any, headers?: Record<string, string>): UnprocessableContent;
export function tooManyRequests(message?: string, details?: any, headers?: Record<string, string>): TooManyRequests;

export function internalServerError(message?: string, details?: any, headers?: Record<string, string>): InternalServerError;
export function notImplemented(message?: string, details?: any, headers?: Record<string, string>): NotImplemented;
export function badGateway(message?: string, details?: any, headers?: Record<string, string>): BadGateway;
export function serviceUnavailable(message?: string, details?: any, headers?: Record<string, string>): ServiceUnavailable;
export function gatewayTimeout(message?: string, details?: any, headers?: Record<string, string>): GatewayTimeout;

export class BadRequest extends HttpClientError {}
export class Unauthorized extends HttpClientError {}
export class PaymentRequired extends HttpClientError {}
export class Forbidden extends HttpClientError {}
export class NotFound extends HttpClientError {}
export class MethodNotAllowed extends HttpClientError {}
export class NotAcceptable extends HttpClientError {}
export class ProxyAuthenticationRequired extends HttpClientError {}
export class RequestTimeout extends HttpClientError {}
export class Conflict extends HttpClientError {}
export class Gone extends HttpClientError {}
export class LengthRequired extends HttpClientError {}
export class PreconditionFailed extends HttpClientError {}
export class PayloadTooLarge extends HttpClientError {}
export class UriTooLong extends HttpClientError {}
export class UnsupportedMediaType extends HttpClientError {}
export class RangeNotSatisfiable extends HttpClientError {}
export class ExpectationFailed extends HttpClientError {}
export class Teapot extends HttpClientError {}
export class MisdirectedRequest extends HttpClientError {}
export class UnprocessableContent extends HttpClientError {}
export class Locked extends HttpClientError {}
export class FailedDependency extends HttpClientError {}
export class TooEarly extends HttpClientError {}
export class UpgradeRequired extends HttpClientError {}
export class PreconditionRequired extends HttpClientError {}
export class TooManyRequests extends HttpClientError {}
export class RequestHeaderFieldsTooLarge extends HttpClientError {}
export class UnavailableForLegalReasons extends HttpClientError {}

export class InternalServerError extends HttpServerError {}
export class NotImplemented extends HttpServerError {}
export class BadGateway extends HttpServerError {}
export class ServiceUnavailable extends HttpServerError {}
export class GatewayTimeout extends HttpServerError {}
export class HttpVersionNotSupported extends HttpServerError {}
export class VariantAlsoNegotiates extends HttpServerError {}
export class InsufficientStorage extends HttpServerError {}
export class LoopDetected extends HttpServerError {}
export class NotExtended extends HttpServerError {}
export class NetworkAuthenticationRequired extends HttpServerError {}

export type HandlerReturn =
  | Response
  | HttpResponse
  | CustomResponse
  | [HttpResponse, HttpResponse]
  | Record<string, any>
  | Uint8Array
  | Buffer
  | string
  | number
  | boolean
  | void
  | null;

export type RouteHandler<TBody = any> = (
  ctx: RequestContext<TBody>
) => HandlerReturn | Promise<HandlerReturn>;

export type ActionHandler<TInput = any> = (
  input: TInput,
  ctx: RequestContext
) => HandlerReturn | Promise<HandlerReturn>;

export interface RateLimitOptions {
  max?: number;
  windowSecs?: number;
  /**
   * Header that identifies the client (an API key, for instance). When it is
   * present, the quota is applied to it instead of the IP address, so the users
   * behind the same NAT do not share it.
   */
  keyBy?: string | string[];
}

/**
 * An API key accepted by the server.
 */
export type ApiKeyDefinition = string | {
  name?: string;
  permissions?: string[];
};

/**
 * Configuration of the authentication layer.
 */
export interface AuthOptions {
  /** The accepted API keys, indexed by their value. */
  apiKeys?: Record<string, ApiKeyDefinition>;
  /** Verification of the JSON Web Tokens (only HS256 is supported). */
  jwt?: {
    secret: string;
    issuer?: string;
    audience?: string;
  };
  /** Allows the requests without credentials. Default: false. */
  allowAnonymous?: boolean;
}

/**
 * Configuration of the TLS connections opened by the proxy.
 */
export interface TlsOptions {
  /** Disables the verification of the certificate (development only). */
  insecure?: boolean;
  /** Additional certificates to trust, in PEM format. */
  ca?: string;
}

export interface SecurityOptions {
  rateLimit?: boolean | RateLimitOptions;
  maxBodySize?: number;
  headers?: boolean;
  auth?: AuthOptions;
  tls?: TlsOptions;
}

/**
 * The permissions a route requires.
 */
export interface RouteAuth {
  /** The identity must have **all** of these permissions. */
  permissions?: string[];
  /** The identity must have **at least one** of these permissions. */
  anyOf?: string[];
}

/**
 * The options accepted by the route registration of the imperative API.
 */
export interface RouteOptions {
  fields?: FieldsSchema;
  query?: FieldsSchema;
  params?: FieldsSchema;
  validation?: ValidationOptions;
  auth?: RouteAuth;
}

/**
 * Cache policy of the static files.
 */
export interface CacheOptions {
  /** `max-age` of the files without a hash in their name. Default: 3600. */
  maxAge?: number;
  /** `max-age` of the assets with a hash in their name. Default: 31536000 (1 year). */
  immutableMaxAge?: number;
}

/**
 * Routes delegated to another server (the Vite dev server, for instance).
 *
 * The `*` prefix acts as the fallback of the unmatched paths.
 */
export type ProxyRoutes = Record<string, string>;

/**
 * Options accepted by a field of a declarative schema.
 */
export interface FieldOptions {
  type?: string;
  format?: string;
  required?: boolean;
  default?: any;
  message?: string;
  status?: number;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  enum?: any[];
  minItems?: number;
  maxItems?: number;
}

/**
 * Declarative schema of the fields expected by a route.
 */
export type FieldsSchema = Record<string, FieldOptions | FieldsSchema>;

/**
 * Options of the declarative validation of a route.
 */
export interface ValidationOptions {
  status?: number;
}

export function isFieldDescriptor(value: unknown): boolean;
export function collectFields(
  schema: FieldsSchema,
  prefix?: string
): Array<{ path: string; spec: FieldOptions }>;
export function validateBody(
  schema: FieldsSchema,
  body: any,
  options?: ValidationOptions
): any;
export function validateRequest(
  schemas: { fields?: FieldsSchema; query?: FieldsSchema; params?: FieldsSchema },
  sources: { body?: any; query?: Record<string, any>; params?: Record<string, any> },
  options?: ValidationOptions
): void;

/**
 * Schemas a route can declare: `fields` for the body, `query` for the query string
 * and `params` for the path parameters.
 */
export interface RouteValidation {
  fields?: FieldsSchema;
  query?: FieldsSchema;
  params?: FieldsSchema;
  validation?: ValidationOptions;
}

export interface RouteDefinition extends RouteValidation {
  handler?: RouteHandler;
  auth?: RouteAuth;
  [method: string]: any;
}

export interface ServerSchema {
  port?: number;
  host?: string;
  cors?: boolean;
  static?: string | Record<string, string>;
  /**
   * Serves the entry point when no route matches (single page applications).
   * `true` uses the `index.html` of the root static directory.
   */
  spa?: boolean | string;
  cache?: CacheOptions;
  proxy?: ProxyRoutes;
  security?: SecurityOptions;
  before?: (ctx: RequestContext) => any | Promise<any>;
  after?: (result: any, ctx: RequestContext) => any | Promise<any>;
  notFound?: (ctx: RequestContext) => HandlerReturn | Promise<HandlerReturn>;
  rpc?: Record<string, ActionHandler>;
  actions?: Record<string, ActionHandler>;
  [routePattern: string]: any;
}

export interface ServerInstance {
  port: number;
  host: string;
  url: string;
  native: any;
}

export function serve(
  optionsOrPort: number | ServerSchema,
  schema?: ServerSchema
): Promise<ServerInstance>;

export class App {
  constructor();
  get(path: string, handler: RouteHandler, options?: RouteOptions): this;
  post(path: string, handler: RouteHandler, options?: RouteOptions): this;
  put(path: string, handler: RouteHandler, options?: RouteOptions): this;
  delete(path: string, handler: RouteHandler, options?: RouteOptions): this;
  patch(path: string, handler: RouteHandler, options?: RouteOptions): this;
  head(path: string, handler: RouteHandler, options?: RouteOptions): this;
  options(path: string, handler: RouteHandler, options?: RouteOptions): this;
  all(path: string, handler: RouteHandler, options?: RouteOptions): this;
  static(prefix: string, dir: string): this;
  cors(enabled?: boolean): this;
  security(options: SecurityOptions): this;
  listen(port: number, host?: string): Promise<number>;
}

export default serve;
