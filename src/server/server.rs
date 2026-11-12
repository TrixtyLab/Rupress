use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::task::{Context, Poll};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use http_body_util::{BodyExt, Full, Limited};
use hyper::body::Bytes;
use hyper::header::{HeaderName, HeaderValue};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Request, Response, StatusCode};
use hyper_util::rt::{TokioIo, TokioTimer};
use napi::threadsafe_function::ThreadsafeFunctionCallMode;
use sha2::{Digest, Sha256};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;

use crate::mime::{cache_control, get_mime_type};
use crate::proxy::{self, ProxyRoute};
use crate::router::MethodRouter;
use crate::security::{RateLimiter, SecurityConfig};
use crate::types::{JsDispatchPayload, JsRequest, JsResponse, JsUser, RouteMatch};
use crate::url::{decode_path, parse_query};

/**
 * Queue holding the raw bytes of the interim (1xx) responses pending to be flushed.
 */
type InterimQueue = Arc<Mutex<Vec<u8>>>;

/**
 * Maximum size of the request headers (including the request line).
 */
const MAX_HEADER_SIZE: usize = 64 * 1024;

/**
 * Maximum number of headers accepted in a single request.
 */
const MAX_HEADERS: usize = 100;

/**
 * Time allowed to a client to send the complete request headers.
 */
const HEADER_READ_TIMEOUT: Duration = Duration::from_secs(15);

/**
 * Maximum size of a file served through the static file handler.
 *
 * Static files are buffered in memory, so oversized files are rejected to avoid
 * exhausting the heap with a single request.
 */
const MAX_STATIC_FILE_SIZE: u64 = 32 * 1024 * 1024;

/**
 * Attaches standard browser security headers to mitigate XSS, clickjacking, and MIME sniffing.
 */
fn apply_security_headers(
    mut builder: hyper::http::response::Builder,
    enabled: bool,
) -> hyper::http::response::Builder {
    if enabled {
        builder = builder
            .header("x-content-type-options", "nosniff")
            .header("x-frame-options", "SAMEORIGIN")
            .header("x-xss-protection", "0")
            .header("referrer-policy", "strict-origin-when-cross-origin");
    }
    builder
}

/**
 * Escapes a string so it can be safely embedded inside a JSON document.
 */
fn json_escape(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    for ch in value.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{08}' => out.push_str("\\b"),
            '\u{0c}' => out.push_str("\\f"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out
}

/**
 * Converts a Unix timestamp into an ISO-8601 (UTC) representation.
 */
fn iso8601(timestamp: SystemTime) -> String {
    let duration = timestamp.duration_since(UNIX_EPOCH).unwrap_or_default();
    let total_seconds = duration.as_secs() as i64;
    let millis = duration.subsec_millis();

    let days = total_seconds.div_euclid(86_400);
    let seconds_of_day = total_seconds.rem_euclid(86_400);

    let (year, month, day) = civil_from_days(days);
    let hours = seconds_of_day / 3_600;
    let minutes = (seconds_of_day % 3_600) / 60;
    let seconds = seconds_of_day % 60;

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        year, month, day, hours, minutes, seconds, millis
    )
}

/**
 * Converts a count of days since the Unix epoch into a civil (year, month, day) date.
 */
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let shifted = days + 719_468;
    let era = if shifted >= 0 {
        shifted
    } else {
        shifted - 146_096
    } / 146_097;
    let day_of_era = shifted - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_position = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * month_position + 2) / 5 + 1) as u32;
    let month = if month_position < 10 {
        month_position + 3
    } else {
        month_position - 9
    } as u32;
    if month <= 2 {
        year += 1;
    }
    (year, month, day)
}

/**
 * Builds the canonical error envelope shared with the JavaScript `HttpError` class.
 */
fn json_error_body(status: StatusCode, message: &str, path: Option<&str>) -> String {
    let title = status.canonical_reason().unwrap_or("Error");
    let mut body = format!(
        "{{\"error\":\"{}\",\"status\":{},\"message\":\"{}\",\"timestamp\":\"{}\"",
        json_escape(title),
        status.as_u16(),
        json_escape(message),
        json_escape(&iso8601(SystemTime::now()))
    );
    if let Some(path) = path {
        body.push_str(&format!(",\"path\":\"{}\"", json_escape(path)));
    }
    body.push('}');
    body
}

/**
 * Creates a JSON encoded error response using the same contract as `HttpError.toJSON()`.
 */
fn json_error_response(
    status: StatusCode,
    message: &str,
    path: Option<&str>,
    cors_enabled: bool,
    security_headers: bool,
) -> Response<Full<Bytes>> {
    let mut builder = Response::builder()
        .status(status)
        .header("content-type", "application/json");

    if cors_enabled {
        builder = builder.header("access-control-allow-origin", "*");
    }
    builder = apply_security_headers(builder, security_headers);

    builder
        .body(Full::new(Bytes::from(json_error_body(status, message, path))))
        .unwrap_or_else(|_| {
            Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .body(Full::new(Bytes::from("Internal Server Error")))
                .unwrap()
        })
}

/**
 * Validates that a header name/value pair can be safely serialized on the wire.
 */
fn is_serializable_header(name: &str, value: &str) -> bool {
    if name.is_empty() {
        return false;
    }

    // The value must not contain control characters (only the horizontal tab is
    // allowed), otherwise the response could be split or corrupted.
    if value
        .bytes()
        .any(|b| b < 0x20 && b != b'\t')
    {
        return false;
    }

    name.bytes().all(|b| {
        b.is_ascii_alphanumeric()
            || matches!(
                b,
                b'!' | b'#'
                    | b'$'
                    | b'%'
                    | b'&'
                    | b'\''
                    | b'*'
                    | b'+'
                    | b'-'
                    | b'.'
                    | b'^'
                    | b'_'
                    | b'`'
                    | b'|'
                    | b'~'
            )
    })
}

/**
 * Serializes an interim (1xx) response into its raw HTTP/1.1 representation.
 *
 * Hyper cannot express informational responses through the regular `Response` API,
 * therefore the bytes are produced here and flushed to the client before the final
 * response, exactly like a compliant HTTP/1.1 server does.
 */
fn serialize_interim_response(
    status: u16,
    headers: Option<&HashMap<String, String>>,
) -> Option<Vec<u8>> {
    let status_code = StatusCode::from_u16(status).ok().filter(|s| s.is_informational())?;

    let reason = status_code.canonical_reason().unwrap_or("Informational");
    let mut raw = format!("HTTP/1.1 {} {}\r\n", status_code.as_u16(), reason);

    if let Some(headers) = headers {
        for (name, value) in headers {
            if !is_serializable_header(name, value) {
                continue;
            }
            raw.push_str(name);
            raw.push_str(": ");
            raw.push_str(value);
            raw.push_str("\r\n");
        }
    }
    raw.push_str("\r\n");

    Some(raw.into_bytes())
}

/**
 * IO wrapper that flushes the queued interim responses before hyper writes anything else.
 *
 * The service layer queues the raw bytes of an informational response while it is
 * still running; this wrapper guarantees they reach the socket before the final
 * response, preserving the order expected by HTTP/1.1 clients.
 */
struct InterimIo {
    inner: TokioIo<TcpStream>,
    queue: InterimQueue,
    out_buf: Vec<u8>,
    out_pos: usize,
}

impl InterimIo {
    fn new(inner: TokioIo<TcpStream>, queue: InterimQueue) -> Self {
        Self {
            inner,
            queue,
            out_buf: Vec::new(),
            out_pos: 0,
        }
    }

    /**
     * Moves the next pending chunk of the interim queue into the write buffer.
     */
    fn pull_next_chunk(&mut self) -> bool {
        let mut queue = self.queue.lock().unwrap_or_else(|e| e.into_inner());
        if queue.is_empty() {
            return false;
        }
        self.out_buf = std::mem::take(&mut *queue);
        self.out_pos = 0;
        true
    }
}

impl hyper::rt::Read for InterimIo {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: hyper::rt::ReadBufCursor<'_>,
    ) -> Poll<std::io::Result<()>> {
        let this = self.get_mut();
        hyper::rt::Read::poll_read(Pin::new(&mut this.inner), cx, buf)
    }
}

impl hyper::rt::Write for InterimIo {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        let this = self.get_mut();

        loop {
            if this.out_pos >= this.out_buf.len() && !this.pull_next_chunk() {
                break;
            }

            let chunk = &this.out_buf[this.out_pos..];
            let result = hyper::rt::Write::poll_write(Pin::new(&mut this.inner), cx, chunk);

            match result {
                Poll::Ready(Ok(written)) => {
                    if written == 0 {
                        // The peer is no longer able to accept bytes: returning an error
                        // avoids an infinite loop in this polling method.
                        return Poll::Ready(Err(std::io::Error::new(
                            std::io::ErrorKind::WriteZero,
                            "failed to write the pending interim response",
                        )));
                    }

                    this.out_pos += written;
                    if this.out_pos >= this.out_buf.len() {
                        this.out_buf.clear();
                        this.out_pos = 0;
                    }
                }
                Poll::Ready(Err(err)) => return Poll::Ready(Err(err)),
                Poll::Pending => return Poll::Pending,
            }
        }

        hyper::rt::Write::poll_write(Pin::new(&mut this.inner), cx, buf)
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        let this = self.get_mut();
        hyper::rt::Write::poll_flush(Pin::new(&mut this.inner), cx)
    }

    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        let this = self.get_mut();
        hyper::rt::Write::poll_shutdown(Pin::new(&mut this.inner), cx)
    }
}

/**
 * Resolves the file of the static routes that serves a path.
 *
 * The path is canonicalized and validated against the root directory, so traversal
 * attempts and symlinks pointing outside are rejected.
 */
fn resolve_static_file(path: &str, static_routes: &[(String, PathBuf)]) -> Option<PathBuf> {
    for (prefix, dir) in static_routes {
        let matched = if prefix == "/" {
            Some(path.trim_start_matches('/'))
        } else if path == *prefix {
            Some("")
        } else if let Some(stripped) = path.strip_prefix(prefix) {
            if stripped.starts_with('/') {
                Some(stripped.trim_start_matches('/'))
            } else {
                None
            }
        } else {
            None
        };

        let Some(rel) = matched else {
            continue;
        };

        let rel = decode_path(rel);
        let candidate = if rel.is_empty() {
            dir.join("index.html")
        } else {
            dir.join(rel)
        };

        if let (Ok(canon_file), Ok(canon_dir)) = (candidate.canonicalize(), dir.canonicalize()) {
            if canon_file.starts_with(&canon_dir) && canon_file.is_file() {
                return Some(canon_file);
            }
        }
    }

    None
}

/**
 * Builds the response of a static file, with its MIME type and cache policy.
 */
async fn build_static_response(
    file_path: &Path,
    cors_enabled: bool,
    security_headers: bool,
    cache_max_age: u32,
    cache_immutable_max_age: u32,
) -> Option<Response<Full<Bytes>>> {
    let metadata = tokio::fs::metadata(file_path).await.ok()?;

    if metadata.len() > MAX_STATIC_FILE_SIZE {
        return None;
    }

    let data = tokio::fs::read(file_path).await.ok()?;
    let mime_type = get_mime_type(file_path);
    let file_name = file_path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_default();

    let mut builder = Response::builder()
        .status(StatusCode::OK)
        .header("content-type", mime_type)
        .header(
            "cache-control",
            cache_control(&file_name, cache_max_age, cache_immutable_max_age),
        );

    if cors_enabled {
        builder = builder.header("access-control-allow-origin", "*");
    }
    builder = apply_security_headers(builder, security_headers);

    builder
        .body(Full::new(Bytes::from(data)))
        .ok()
}

/**
 * Builds the identity of the client for the rate limiter.
 *
 * The first configured header that is present identifies the client. The value is
 * hashed, so the raw credential is never stored and the size of the key is bounded
 * no matter how long the header is.
 */
fn identify_client(headers: &hyper::HeaderMap, key_by: &[String]) -> Option<String> {
    for header in key_by {
        let Some(value) = headers.get(header.as_str()).and_then(|value| value.to_str().ok()) else {
            continue;
        };

        if value.is_empty() {
            continue;
        }

        let digest = Sha256::digest(value.as_bytes());
        return Some(format!("{}:{}", header, hex_encode(&digest)));
    }

    None
}

/**
 * Encodes a digest as an hexadecimal string.
 */
fn hex_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);

    for byte in bytes {
        out.push(char::from_digit((byte >> 4) as u32, 16).unwrap_or('0'));
        out.push(char::from_digit((byte & 0x0f) as u32, 16).unwrap_or('0'));
    }

    out
}

/**
 * Context shared by the responses built by the proxy helpers.
 */
struct ResponseContext {
    path: String,
    cors_enabled: bool,
    security_headers: bool,
    tls: crate::tls::TlsConfig,
}

/**
 * Forwards a request to the upstream server of a proxy route.
 */
async fn forward_to_upstream(
    upstream: proxy::Upstream,
    parts: hyper::http::request::Parts,
    body: Bytes,
    context: ResponseContext,
    client_ip: IpAddr,
) -> Result<Response<Full<Bytes>>, hyper::Error> {
    match proxy::forward(
        &upstream,
        &parts.method,
        &parts.uri,
        &parts.headers,
        body,
        &context.tls,
        Some(client_ip),
    )
    .await
    {
        Ok(response) => Ok(response),
        Err(err) => {
            eprintln!("[server] The proxy request failed: {}", err);
            Ok(json_error_response(
                StatusCode::BAD_GATEWAY,
                "The upstream server is not available.",
                Some(&context.path),
                context.cors_enabled,
                context.security_headers,
            ))
        }
    }
}

/**
 * Options of the HTTP engine.
 */
pub struct ServerOptions {
    pub security: Arc<SecurityConfig>,
    pub proxy_routes: Arc<Vec<ProxyRoute>>,
    pub spa_fallback: Option<String>,
    pub cache_max_age: u32,
    pub cache_immutable_max_age: u32,
}

/**
 * Boots the multithreaded Tokio/Hyper HTTP engine with rate-limiting, size guards, and CORS fast-path.
 *
 * Returns the port that was actually bound, which differs from the requested one
 * when the caller asks for the port `0`.
 */
pub async fn start_server(
    addr: SocketAddr,
    router: Arc<RwLock<MethodRouter>>,
    pending_requests: Arc<Mutex<HashMap<u32, oneshot::Sender<JsResponse>>>>,
    next_request_id: Arc<AtomicU32>,
    options: ServerOptions,
) -> std::io::Result<u16> {
    let security = options.security;
    let proxy_routes = options.proxy_routes;
    let spa_fallback = options.spa_fallback;
    let cache_max_age = options.cache_max_age;
    let cache_immutable_max_age = options.cache_immutable_max_age;
    let listener = TcpListener::bind(addr).await?;
    let bound_port = listener.local_addr()?.port();
    let rate_limiter = Arc::new(RateLimiter::new(
        security.rate_limit_max,
        security.rate_limit_window,
    ));

    tokio::spawn(async move {
        loop {
            let (stream, peer_addr) = match listener.accept().await {
                Ok(conn) => conn,
                Err(_) => {
                    tokio::time::sleep(Duration::from_millis(10)).await;
                    continue;
                }
            };

            // Interim (1xx) responses are queued here and flushed by the IO wrapper
            // right before hyper encodes the final response.
            let interim_queue: InterimQueue = Arc::new(Mutex::new(Vec::new()));

            let io = InterimIo::new(TokioIo::new(stream), interim_queue.clone());
            let router_ref = router.clone();
            let pending_ref = pending_requests.clone();
            let next_id_ref = next_request_id.clone();
            let security_ref = security.clone();
            let limiter_ref = rate_limiter.clone();
            let proxy_ref = proxy_routes.clone();
            let spa_ref = spa_fallback.clone();
            let client_ip: IpAddr = peer_addr.ip();

            tokio::task::spawn(async move {
                let service = service_fn(move |req: Request<hyper::body::Incoming>| {
                    let router = router_ref.clone();
                    let pending = pending_ref.clone();
                    let next_id = next_id_ref.clone();
                    let sec = security_ref.clone();
                    let limiter = limiter_ref.clone();
                    let interim_queue = interim_queue.clone();
                    let proxy_routes = proxy_ref.clone();
                    let spa_fallback = spa_ref.clone();

                    async move {
                        let path = req.uri().path().to_string();
                        let method = req.method().to_string();

                        let (cors_enabled, static_routes) = {
                            let r = router.read().unwrap_or_else(|e| e.into_inner());
                            (r.is_cors_enabled(), r.get_static_routes())
                        };

                        // The client is identified by the first configured header that is
                        // present (an API key, for instance) or, when there is none, by its
                        // IP address. The identity is hashed so the raw credential is
                        // never kept in memory and the size of the key stays bounded.
                        let rate_limit_key = match identify_client(req.headers(), &sec.rate_limit_key_by) {
                            Some(identity) => identity,
                            None => format!("ip:{}", client_ip),
                        };

                        if sec.enable_rate_limit && !limiter.check(rate_limit_key) {
                            let retry_after = sec.rate_limit_window.as_secs().max(1);
                            let mut builder = Response::builder()
                                .status(StatusCode::TOO_MANY_REQUESTS)
                                .header("content-type", "application/json")
                                .header("retry-after", retry_after.to_string());

                            if cors_enabled {
                                builder = builder.header("access-control-allow-origin", "*");
                            }
                            builder = apply_security_headers(builder, sec.enable_security_headers);

                            return Ok::<_, hyper::Error>(builder
                                .body(Full::new(Bytes::from(json_error_body(
                                    StatusCode::TOO_MANY_REQUESTS,
                                    "Too many requests, please retry later.",
                                    None,
                                ))))
                                .unwrap());
                        }

                        if cors_enabled && method == "OPTIONS" {
                            let mut resp = Response::builder()
                                .status(StatusCode::NO_CONTENT)
                                .header("access-control-allow-origin", "*")
                                .header(
                                    "access-control-allow-methods",
                                    "GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS",
                                )
                                .header("access-control-allow-headers", "*")
                                .header("access-control-max-age", "86400");
                            resp = apply_security_headers(resp, sec.enable_security_headers);
                            return Ok::<_, hyper::Error>(
                                resp.body(Full::new(Bytes::new())).unwrap(),
                            );
                        }

                        // The identity of the client is resolved before the request is
                        // consumed, so the handlers can use it and the permissions of the
                        // route can be checked.
                        let user = match sec.auth.authenticate(req.headers()) {
                            Ok(user) => user,
                            Err(error) => {
                                let (status, message) = match error {
                                    crate::auth::AuthError::Missing => (
                                        StatusCode::UNAUTHORIZED,
                                        "Authentication is required.",
                                    ),
                                    crate::auth::AuthError::Expired => (
                                        StatusCode::UNAUTHORIZED,
                                        "The credential has expired.",
                                    ),
                                    crate::auth::AuthError::Invalid => (
                                        StatusCode::UNAUTHORIZED,
                                        "The credential is not valid.",
                                    ),
                                };

                                return Ok::<_, hyper::Error>(json_error_response(
                                    status,
                                    message,
                                    Some(&path),
                                    cors_enabled,
                                    sec.enable_security_headers,
                                ));
                            }
                        };

                        // A protocol upgrade (WebSocket) is handled before the body is
                        // consumed, because the connection is handed over to the tunnel.
                        if proxy::is_upgrade_request(req.headers()) {
                            let mut request = req;

                            let Some(route) = proxy::match_route(&proxy_routes, &path) else {
                                return Ok::<_, hyper::Error>(json_error_response(
                                    StatusCode::NOT_IMPLEMENTED,
                                    "This server does not handle WebSocket connections.",
                                    Some(&path),
                                    cors_enabled,
                                    sec.enable_security_headers,
                                ));
                            };

                            let upstream = route.upstream.clone();
                            let method = request.method().clone();
                            let uri = request.uri().clone();
                            let headers = request.headers().clone();

                            let handshake =
                                proxy::handshake(&upstream, &method, &uri, &headers, &sec.tls)
                                    .await;

                            let (stream, buffer, head_end) = match handshake {
                                Ok(result) => result,
                                Err(err) => {
                                    eprintln!("[server] The upgrade failed: {}", err);
                                    return Ok::<_, hyper::Error>(json_error_response(
                                        StatusCode::BAD_GATEWAY,
                                        "Cannot connect to the upstream server.",
                                        Some(&path),
                                        cors_enabled,
                                        sec.enable_security_headers,
                                    ));
                                }
                            };

                            let head = &buffer[..head_end];
                            let leftover = buffer[head_end..].to_vec();

                            let (status, upstream_headers) = match proxy::parse_head(head) {
                                Ok(result) => result,
                                Err(err) => {
                                    eprintln!("[server] Invalid upgrade response: {}", err);
                                    return Ok::<_, hyper::Error>(json_error_response(
                                        StatusCode::BAD_GATEWAY,
                                        "The upstream returned an invalid upgrade response.",
                                        Some(&path),
                                        cors_enabled,
                                        sec.enable_security_headers,
                                    ));
                                }
                            };

                            let mut builder = Response::builder().status(status);
                            for (name, value) in upstream_headers.iter() {
                                builder = builder.header(name, value);
                            }

                            if status == StatusCode::SWITCHING_PROTOCOLS {
                                let response = builder.body(Full::new(Bytes::new())).unwrap();

                                // The request is kept alive until the tunnel finishes, so the
                                // connection is not released while it is in use.
                                tokio::spawn(async move {
                                    match hyper::upgrade::on(&mut request).await {
                                        Ok(upgraded) => {
                                            let client = TokioIo::new(upgraded);
                                            let _ = proxy::tunnel(client, stream, leftover).await;
                                        }
                                        Err(err) => {
                                            eprintln!("[server] The upgrade failed: {}", err);
                                        }
                                    }
                                });

                                return Ok::<_, hyper::Error>(response);
                            }

                            // The upstream refused the upgrade: its response is forwarded
                            // as it is, including the body.
                            let mut stream = stream;
                            let body =
                                proxy::read_body(&mut stream, &leftover, &upstream_headers).await;

                            return Ok::<_, hyper::Error>(
                                builder.body(Full::new(Bytes::from(body))).unwrap(),
                            );
                        }
                        let query: HashMap<String, String> = req
                            .uri()
                            .query()
                            .map(parse_query)
                            .unwrap_or_default();

                        let headers: HashMap<String, String> = req
                            .headers()
                            .iter()
                            .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
                            .collect();

                        let (parts, incoming_body) = req.into_parts();

                        let limited_body = Limited::new(incoming_body, sec.max_body_size);
                        let body_bytes = match limited_body.collect().await {
                            Ok(collected) => Some(collected.to_bytes()),
                            Err(_) => {
                                return Ok::<_, hyper::Error>(json_error_response(
                                    StatusCode::PAYLOAD_TOO_LARGE,
                                    "The request payload exceeds the maximum size allowed.",
                                    Some(&path),
                                    cors_enabled,
                                    sec.enable_security_headers,
                                ));
                            }
                        };

                        let raw_body = body_bytes.unwrap_or_default();
                        let body = String::from_utf8(raw_body.to_vec()).ok();

                        let route_match = {
                            let r = router.read().unwrap_or_else(|e| e.into_inner());
                            r.match_route(&method, &path)
                        };

                        match route_match {
                            RouteMatch::NotFound => {
                                // The static files are served before the proxy, so the built
                                // assets take precedence over the development server.
                                if (method == "GET" || method == "HEAD")
                                    && !static_routes.is_empty()
                                    && !path.contains('\0')
                                    && !path.contains("/.")
                                {
                                    if let Some(file_path) =
                                        resolve_static_file(&path, &static_routes)
                                    {
                                        if let Some(response) = build_static_response(
                                            &file_path,
                                            cors_enabled,
                                            sec.enable_security_headers,
                                            cache_max_age,
                                            cache_immutable_max_age,
                                        )
                                        .await
                                        {
                                            return Ok::<_, hyper::Error>(response);
                                        }
                                    }
                                }

                                // The request is delegated to another server (the Vite dev
                                // server, for instance).
                                if !proxy_routes.is_empty() {
                                    if let Some(route) = proxy::match_route(&proxy_routes, &path) {
                                        let upstream = route.upstream.clone();

                                        return forward_to_upstream(
                                            upstream,
                                            parts,
                                            raw_body,
                                            ResponseContext {
                                                path: path.clone(),
                                                cors_enabled,
                                                security_headers: sec.enable_security_headers,
                                                tls: sec.tls.clone(),
                                            },
                                            client_ip,
                                        )
                                        .await;
                                    }
                                }

                                // Single page applications serve their entry point so the
                                // router of the frontend can take over.
                                if let Some(fallback) = &spa_fallback {
                                    if method == "GET" || method == "HEAD" {
                                        let fallback_path = PathBuf::from(fallback);

                                        if let Some(response) = build_static_response(
                                            &fallback_path,
                                            cors_enabled,
                                            sec.enable_security_headers,
                                            cache_max_age,
                                            cache_immutable_max_age,
                                        )
                                        .await
                                        {
                                            return Ok::<_, hyper::Error>(response);
                                        }
                                    }
                                }

                                Ok::<_, hyper::Error>(json_error_response(
                                    StatusCode::NOT_FOUND,
                                    "The requested resource could not be found on this server.",
                                    Some(&path),
                                    cors_enabled,
                                    sec.enable_security_headers,
                                ))
                            }
                            RouteMatch::MethodNotAllowed(allowed) => {
                                let mut builder = Response::builder()
                                    .status(StatusCode::METHOD_NOT_ALLOWED)
                                    .header("content-type", "application/json");

                                // The RFC requires the list of the methods that would work.
                                if !allowed.is_empty() {
                                    builder = builder.header("allow", allowed.join(", "));
                                }

                                if cors_enabled {
                                    builder = builder.header("access-control-allow-origin", "*");
                                }
                                builder = apply_security_headers(builder, sec.enable_security_headers);

                                Ok::<_, hyper::Error>(
                                    builder
                                        .body(Full::new(Bytes::from(json_error_body(
                                            StatusCode::METHOD_NOT_ALLOWED,
                                            "The HTTP method is not allowed for the requested resource.",
                                            Some(&path),
                                        ))))
                                        .unwrap(),
                                )
                            }
                            RouteMatch::Found(tsfn, params, route_auth) => {
                                // The identity must have the permissions the route requires.
                                if !route_auth.allows(&user) {
                                    return Ok::<_, hyper::Error>(json_error_response(
                                        StatusCode::FORBIDDEN,
                                        "The identity does not have the permissions required by this route.",
                                        Some(&path),
                                        cors_enabled,
                                        sec.enable_security_headers,
                                    ));
                                }

                                let request_id = next_id.fetch_add(1, Ordering::Relaxed);
                                let (tx, rx) = oneshot::channel::<JsResponse>();

                                {
                                    let mut map = pending.lock().unwrap_or_else(|e| e.into_inner());
                                    map.insert(request_id, tx);
                                }

                                let js_req = JsRequest {
                                    method: method.clone(),
                                    path: path.clone(),
                                    params,
                                    query,
                                    headers,
                                    body,
                                    // The identity is only attached when it comes from a
                                    // verified credential.
                                    user: if user.authenticated {
                                        Some(JsUser {
                                            name: user.name.clone(),
                                            permissions: user.permissions.clone(),
                                        })
                                    } else {
                                        None
                                    },
                                };

                                let dispatch_status = tsfn.call(
                                    JsDispatchPayload {
                                        id: request_id,
                                        request: js_req,
                                    },
                                    ThreadsafeFunctionCallMode::NonBlocking,
                                );

                                if dispatch_status != napi::Status::Ok {
                                    let mut map = pending.lock().unwrap_or_else(|e| e.into_inner());
                                    map.remove(&request_id);

                                    eprintln!(
                                        "[server] Failed to dispatch to the JavaScript handler ({} {})",
                                        method, path
                                    );

                                    return Ok::<_, hyper::Error>(json_error_response(
                                        StatusCode::INTERNAL_SERVER_ERROR,
                                        "Failed to dispatch to JavaScript handler.",
                                        Some(&path),
                                        cors_enabled,
                                        sec.enable_security_headers,
                                    ));
                                }

                                let response_result =
                                    tokio::time::timeout(Duration::from_secs(30), rx).await;

                                match response_result {
                                    Ok(Ok(js_res)) => {
                                        // Interim (1xx) responses are queued and flushed to the
                                        // socket before the final response is encoded.
                                        if let Some(interim) = &js_res.interim {
                                            if let Some(status) = interim.status {
                                                if let Some(raw) =
                                                    serialize_interim_response(status, interim.headers.as_ref())
                                                {
                                                    let mut queue = interim_queue.lock().unwrap_or_else(|e| e.into_inner());
                                                    queue.extend_from_slice(&raw);
                                                }
                                            }
                                        }

                                        let status_code = js_res
                                            .status
                                            .and_then(|s| StatusCode::from_u16(s).ok())
                                            // A final response can never be informational.
                                            .filter(|s| !s.is_informational())
                                            .unwrap_or(StatusCode::OK);

                                        let mut resp_builder = Response::builder().status(status_code);

                                        if cors_enabled {
                                            resp_builder = resp_builder.header("access-control-allow-origin", "*");
                                        }

                                        resp_builder = apply_security_headers(
                                            resp_builder,
                                            sec.enable_security_headers,
                                        );

                                        if let Some(resp_headers) = js_res.headers {
                                            for (k, v) in resp_headers {
                                                if let (Ok(h_name), Ok(h_val)) = (
                                                    HeaderName::from_bytes(k.as_bytes()),
                                                    HeaderValue::from_str(&v),
                                                ) {
                                                    resp_builder = resp_builder.header(h_name, h_val);
                                                }
                                            }
                                        }

                                        let resp_body_bytes = if let Some(bin) = js_res.binary {
                                            Bytes::copy_from_slice(bin.as_ref())
                                        } else if let Some(text) = js_res.body {
                                            Bytes::from(text)
                                        } else {
                                            Bytes::new()
                                        };

                                        Ok::<_, hyper::Error>(
                                            resp_builder
                                                .body(Full::new(resp_body_bytes))
                                                .unwrap_or_else(|_| {
                                                    Response::builder()
                                                        .status(StatusCode::INTERNAL_SERVER_ERROR)
                                                        .body(Full::new(Bytes::from(
                                                            "Error constructing HTTP response",
                                                        )))
                                                        .unwrap()
                                                }),
                                        )
                                    }
                                    Ok(Err(_)) => {
                                        // The handler aborted without answering: the pending
                                        // entry must be released to avoid leaking memory.
                                        let mut map = pending.lock().unwrap_or_else(|e| e.into_inner());
                                        map.remove(&request_id);

                                        eprintln!(
                                            "[server] The handler aborted without sending a response ({} {})",
                                            method, path
                                        );

                                        Ok::<_, hyper::Error>(json_error_response(
                                            StatusCode::INTERNAL_SERVER_ERROR,
                                            "Handler aborted without sending response.",
                                            Some(&path),
                                            cors_enabled,
                                            sec.enable_security_headers,
                                        ))
                                    }
                                    Err(_) => {
                                        let mut map = pending.lock().unwrap_or_else(|e| e.into_inner());
                                        map.remove(&request_id);

                                        Ok::<_, hyper::Error>(json_error_response(
                                            StatusCode::GATEWAY_TIMEOUT,
                                            "Gateway Timeout: handler took longer than 30s.",
                                            Some(&path),
                                            cors_enabled,
                                            sec.enable_security_headers,
                                        ))
                                    }
                                }
                            }
                        }
                    }
                });

                // The connection is hardened against slowloris and header flooding.
                let mut builder = http1::Builder::new();
                builder.timer(TokioTimer::new());
                builder.header_read_timeout(HEADER_READ_TIMEOUT);
                builder.max_header_size(MAX_HEADER_SIZE);
                builder.max_headers(MAX_HEADERS);

                // The upgrades are enabled so the WebSocket tunnels can be completed.
                let _ = builder.serve_connection(io, service).with_upgrades().await;
            });
        }
    });

    Ok(bound_port)
}
