use napi::bindgen_prelude::Buffer;
use napi::threadsafe_function::{ErrorStrategy, ThreadsafeFunction};
use napi_derive::napi;
use std::collections::HashMap;
use std::sync::Arc;

/**
 * Normalized HTTP request object passed to JavaScript route handlers.
 */
#[napi(object)]
#[derive(Clone, Debug)]
pub struct JsRequest {
    pub method: String,
    pub path: String,
    pub params: HashMap<String, String>,
    pub query: HashMap<String, String>,
    pub headers: HashMap<String, String>,
    pub body: Option<String>,
    /// The identity of the client, when the authentication layer is enabled.
    pub user: Option<JsUser>,
}

/**
 * Interim (1xx) response written directly to the socket before the final response.
 *
 * Hyper is unable to emit 1xx status codes as a regular response, so the engine
 * serializes them by hand and then continues with the final response.
 */
#[napi(object)]
#[derive(Clone, Default)]
pub struct JsInterimResponse {
    pub status: Option<u16>,
    pub headers: Option<HashMap<String, String>>,
}

/**
 * Response structure returned from JavaScript back to the Rust HTTP engine.
 */
#[napi(object)]
#[derive(Clone, Default)]
pub struct JsResponse {
    pub status: Option<u16>,
    pub headers: Option<HashMap<String, String>>,
    pub body: Option<String>,
    pub binary: Option<Buffer>,
    pub interim: Option<JsInterimResponse>,
}

/**
 * Proxy route exposed by the JavaScript layer.
 */
#[napi(object)]
#[derive(Clone, Debug)]
pub struct JsProxyRoute {
    pub prefix: String,
    pub upstream: String,
}

/**
 * Payload dispatched across threads to the Node.js event loop.
 */
#[napi(object)]
#[derive(Clone)]
pub struct JsDispatchPayload {
    pub id: u32,
    pub request: JsRequest,
}

/**
 * Configuration of the TLS connections opened by the proxy.
 */
#[napi(object)]
#[derive(Clone, Debug, Default)]
pub struct JsTlsConfig {
    /// Disables the verification of the certificate (development only).
    pub insecure: Option<bool>,
    /// Additional certificates to trust, in PEM format.
    pub ca: Option<String>,
}

/**
 * Security configuration options exposed to JavaScript.
 */
#[napi(object)]
#[derive(Clone, Debug, Default)]
pub struct JsSecurityOptions {
    pub enable_rate_limit: Option<bool>,
    pub rate_limit_max: Option<u32>,
    pub rate_limit_window_secs: Option<u32>,
    /// Headers that identify the client (an API key, for instance). When one of them
    /// is present, the rate limit is applied to it instead of the IP address.
    pub rate_limit_key_by: Option<Vec<String>>,
    pub max_body_size_bytes: Option<u32>,
    pub enable_security_headers: Option<bool>,
    pub auth: Option<JsAuthConfig>,
    pub tls: Option<JsTlsConfig>,
}

/**
 * An API key accepted by the server.
 */
#[napi(object)]
#[derive(Clone, Debug)]
pub struct JsApiKey {
    pub name: String,
    pub permissions: Option<Vec<String>>,
}

/**
 * Configuration of the authentication layer.
 */
#[napi(object)]
#[derive(Clone, Debug, Default)]
pub struct JsAuthConfig {
    pub api_keys: Option<std::collections::HashMap<String, JsApiKey>>,
    pub jwt_secret: Option<String>,
    pub jwt_issuer: Option<String>,
    pub jwt_audience: Option<String>,
    pub allow_anonymous: Option<bool>,
}

/**
 * The identity of the client, available in the request context.
 */
#[napi(object)]
#[derive(Clone, Debug, Default)]
pub struct JsUser {
    pub name: String,
    pub permissions: Vec<String>,
}

pub type HandlerTsfn = ThreadsafeFunction<JsDispatchPayload, ErrorStrategy::Fatal>;

pub enum RouteMatch {
    Found(Arc<HandlerTsfn>, HashMap<String, String>, crate::auth::RouteAuth),
    /// The path exists but not with this method. It carries the methods that would work.
    MethodNotAllowed(Vec<String>),
    NotFound,
}
