use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::AtomicU32;
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use napi::bindgen_prelude::*;
use napi_derive::napi;
use tokio::sync::oneshot;

use crate::auth::{ApiKey, AuthConfig, RouteAuth};
use crate::router::MethodRouter;
use crate::proxy::{parse_upstream, ProxyRoute};
use crate::security::SecurityConfig;
use crate::server::{start_server, ServerOptions};
use crate::types::{HandlerTsfn, JsProxyRoute, JsResponse, JsSecurityOptions};

/**
 * Maximum number of dispatches queued towards the JavaScript event loop per route.
 *
 * A bounded queue prevents an unresponsive event loop from growing the heap
 * without limits; the requests are rejected with a 500 instead.
 */
const MAX_PENDING_DISPATCHES: usize = 1024;

impl Default for App {
    fn default() -> Self {
        Self::new()
    }
}

/**
 * Builds the authentication configuration from the options of JavaScript.
 */
fn build_auth_config(auth: crate::types::JsAuthConfig) -> AuthConfig {
    let api_keys = auth
        .api_keys
        .unwrap_or_default()
        .into_iter()
        .map(|(key, value)| {
            (
                key,
                ApiKey {
                    name: value.name,
                    permissions: value.permissions.unwrap_or_default(),
                },
            )
        })
        .collect();

    AuthConfig {
        enabled: true,
        api_keys,
        jwt_secret: auth.jwt_secret,
        jwt_issuer: auth.jwt_issuer,
        jwt_audience: auth.jwt_audience,
        allow_anonymous: auth.allow_anonymous.unwrap_or(false),
    }
}

/**
 * Main application binding connecting Node.js and the Tokio/Hyper engine.
 */
#[napi]
pub struct App {
    router: Arc<RwLock<MethodRouter>>,
    pending_requests: Arc<Mutex<HashMap<u32, oneshot::Sender<JsResponse>>>>,
    next_request_id: Arc<AtomicU32>,
    security: Arc<RwLock<SecurityConfig>>,
    proxy_routes: Vec<ProxyRoute>,
    spa_fallback: Option<String>,
    cache_max_age: u32,
    cache_immutable_max_age: u32,
}

#[napi]
impl App {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            router: Arc::new(RwLock::new(MethodRouter::new())),
            pending_requests: Arc::new(Mutex::new(HashMap::new())),
            next_request_id: Arc::new(AtomicU32::new(1)),
            security: Arc::new(RwLock::new(SecurityConfig::default())),
            proxy_routes: Vec::new(),
            spa_fallback: None,
            cache_max_age: 3600,
            cache_immutable_max_age: 31_536_000,
        }
    }

    #[napi]
    pub fn set_security(&mut self, options: JsSecurityOptions) -> Result<()> {
        let mut sec = self.security.write().map_err(|e| {
            Error::from_reason(format!("Failed to acquire security lock: {}", e))
        })?;

        if let Some(enabled) = options.enable_rate_limit {
            sec.enable_rate_limit = enabled;
        }
        if let Some(max) = options.rate_limit_max {
            sec.rate_limit_max = max;
        }
        if let Some(window_secs) = options.rate_limit_window_secs {
            sec.rate_limit_window = Duration::from_secs(window_secs as u64);
        }
        if let Some(headers) = options.rate_limit_key_by {
            sec.rate_limit_key_by = headers
                .into_iter()
                .map(|name| name.trim().to_ascii_lowercase())
                .filter(|name| !name.is_empty())
                .collect();
        }
        if let Some(max_body) = options.max_body_size_bytes {
            sec.max_body_size = max_body as usize;
        }
        if let Some(headers_enabled) = options.enable_security_headers {
            sec.enable_security_headers = headers_enabled;
        }
        if let Some(auth) = options.auth {
            sec.auth = build_auth_config(auth);
        }
        if let Some(tls) = options.tls {
            sec.tls.insecure = tls.insecure.unwrap_or(false);
            sec.tls.ca = tls.ca;

            if sec.tls.insecure {
                eprintln!(
                    "[server] WARNING: the TLS verification of the proxy is disabled. \
                     Never use this setting in production."
                );
            }
        }

        Ok(())
    }

    /**
     * Registers the routes that are delegated to another server (a Vite dev server,
     * for instance). The `*` prefix acts as the fallback of the unmatched paths.
     */
    #[napi]
    pub fn set_proxy(&mut self, routes: Vec<JsProxyRoute>) -> Result<()> {
        let mut parsed = Vec::with_capacity(routes.len());

        for route in routes {
            let upstream = parse_upstream(&route.upstream)
                .map_err(|err| Error::from_reason(format!("Invalid proxy route: {}", err)))?;
            parsed.push(ProxyRoute {
                prefix: route.prefix,
                upstream,
            });
        }

        self.proxy_routes = parsed;

        Ok(())
    }

    /**
     * Sets the file served when no route matches (the `index.html` of a SPA).
     */
    #[napi]
    pub fn set_spa_fallback(&mut self, path: String) -> Result<()> {
        self.spa_fallback = Some(path);
        Ok(())
    }

    /**
     * Sets the cache policy of the static files.
     */
    #[napi]
    pub fn set_cache_policy(&mut self, max_age: Option<u32>, immutable_max_age: Option<u32>) -> Result<()> {
        if let Some(max_age) = max_age {
            self.cache_max_age = max_age;
        }
        if let Some(immutable_max_age) = immutable_max_age {
            self.cache_immutable_max_age = immutable_max_age;
        }
        Ok(())
    }

    #[napi]
    pub fn register_route(
        &mut self,
        method: String,
        path: String,
        handler: JsFunction,
        permissions: Option<Vec<String>>,
        any_of: Option<Vec<String>>,
    ) -> Result<()> {
        // The queue is bounded: if the JavaScript event loop is blocked, the pending
        // dispatches are rejected instead of growing the heap without limits.
        let tsfn: HandlerTsfn = handler.create_threadsafe_function(MAX_PENDING_DISPATCHES, |ctx| {
            Ok(vec![ctx.value])
        })?;

        let mut router = self.router.write().map_err(|e| {
            Error::from_reason(format!("Failed to acquire router lock: {}", e))
        })?;

        router
            .insert(
                &method,
                &path,
                Arc::new(tsfn),
                RouteAuth {
                    permissions: permissions.unwrap_or_default(),
                    any_of: any_of.unwrap_or_default(),
                },
            )
            .map_err(|e| Error::from_reason(format!("Failed to register route '{} {}': {}", method, path, e)))?;

        Ok(())
    }

    #[napi]
    pub fn get(&mut self, path: String, handler: JsFunction, permissions: Option<Vec<String>>, any_of: Option<Vec<String>>) -> Result<()> {
        self.register_route("GET".to_string(), path, handler, permissions, any_of)
    }

    #[napi]
    pub fn post(&mut self, path: String, handler: JsFunction, permissions: Option<Vec<String>>, any_of: Option<Vec<String>>) -> Result<()> {
        self.register_route("POST".to_string(), path, handler, permissions, any_of)
    }

    #[napi]
    pub fn put(&mut self, path: String, handler: JsFunction, permissions: Option<Vec<String>>, any_of: Option<Vec<String>>) -> Result<()> {
        self.register_route("PUT".to_string(), path, handler, permissions, any_of)
    }

    #[napi]
    pub fn delete(&mut self, path: String, handler: JsFunction, permissions: Option<Vec<String>>, any_of: Option<Vec<String>>) -> Result<()> {
        self.register_route("DELETE".to_string(), path, handler, permissions, any_of)
    }

    #[napi]
    pub fn patch(&mut self, path: String, handler: JsFunction, permissions: Option<Vec<String>>, any_of: Option<Vec<String>>) -> Result<()> {
        self.register_route("PATCH".to_string(), path, handler, permissions, any_of)
    }

    #[napi]
    pub fn all(&mut self, path: String, handler: JsFunction, permissions: Option<Vec<String>>, any_of: Option<Vec<String>>) -> Result<()> {
        self.register_route("ALL".to_string(), path, handler, permissions, any_of)
    }

    #[napi]
    pub fn add_static(&mut self, prefix: String, dir: String) -> Result<()> {
        let path = std::path::PathBuf::from(dir);
        let mut router = self.router.write().map_err(|e| {
            Error::from_reason(format!("Failed to acquire router lock: {}", e))
        })?;
        router.add_static(prefix, path);
        Ok(())
    }

    #[napi]
    pub fn set_cors(&mut self, enabled: bool) -> Result<()> {
        let mut router = self.router.write().map_err(|e| {
            Error::from_reason(format!("Failed to acquire router lock: {}", e))
        })?;
        router.set_cors(enabled);
        Ok(())
    }

    #[napi]
    pub fn set_fallback(&mut self, handler: JsFunction) -> Result<()> {
        let tsfn: HandlerTsfn =
            handler.create_threadsafe_function(0, |ctx| Ok(vec![ctx.value]))?;

        let mut router = self.router.write().map_err(|e| {
            Error::from_reason(format!("Failed to acquire router lock: {}", e))
        })?;

        router.set_fallback(Arc::new(tsfn));
        Ok(())
    }

    #[napi]
    pub fn respond(&self, id: u32, response: JsResponse) -> Result<()> {
        let mut map = self.pending_requests.lock().map_err(|e| {
            Error::from_reason(format!("Failed to acquire requests lock: {}", e))
        })?;

        if let Some(tx) = map.remove(&id) {
            let _ = tx.send(response);
        }

        Ok(())
    }

    /// Starts the HTTP engine and resolves with the port that was actually bound.
    ///
    /// When the requested port is `0` the operating system picks a free one, so the
    /// real value is returned to the caller.
    #[napi]
    pub async fn listen(&self, port: u16, host: Option<String>) -> Result<u16> {
        let host_str = host.unwrap_or_else(|| "127.0.0.1".to_string());

        // IPv6 addresses must be wrapped in brackets to build a valid socket address.
        let addr: SocketAddr = if host_str.contains(':') {
            format!("[{}]:{}", host_str, port)
        } else {
            format!("{}:{}", host_str, port)
        }
        .parse()
        .map_err(|e| Error::from_reason(format!("Invalid socket address {}:{}: {}", host_str, port, e)))?;

        let sec_config = self.security.read().map_err(|e| {
            Error::from_reason(format!("Failed to read security configuration: {}", e))
        })?.clone();

        let bound_port = start_server(
            addr,
            self.router.clone(),
            self.pending_requests.clone(),
            self.next_request_id.clone(),
            ServerOptions {
                security: Arc::new(sec_config),
                proxy_routes: Arc::new(self.proxy_routes.clone()),
                spa_fallback: self.spa_fallback.clone(),
                cache_max_age: self.cache_max_age,
                cache_immutable_max_age: self.cache_immutable_max_age,
            },
        )
        .await
        .map_err(|e| Error::from_reason(format!("Failed to bind server on {}: {}", addr, e)))?;

        Ok(bound_port)
    }
}
