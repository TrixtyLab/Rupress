use std::io;
use std::net::IpAddr;

use http_body_util::{BodyExt, Full};
use hyper::body::Bytes;
use hyper::header::{HeaderMap, HeaderValue, CONNECTION, HOST, TRANSFER_ENCODING, UPGRADE};
use hyper::{Method, Request, Response, StatusCode, Uri};
use hyper_util::rt::TokioIo;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpStream;

use crate::tls::{TlsConfig, TlsStream};

/**
 * Upstream server of a proxy route.
 */
#[derive(Clone, Debug)]
pub struct Upstream {
    pub host: String,
    pub port: u16,
    /// Whether the connection must be encrypted with TLS.
    pub tls: bool,
}

impl Upstream {
    /// Builds the `Host` header value of the upstream.
    pub fn authority(&self) -> String {
        if self.host.contains(':') {
            format!("[{}]:{}", self.host, self.port)
        } else {
            format!("{}:{}", self.host, self.port)
        }
    }

    /// The name used to verify the certificate of the upstream.
    pub fn server_name(&self) -> &str {
        &self.host
    }
}

/**
 * A proxy route: a path prefix and the upstream that serves it.
 */
#[derive(Clone, Debug)]
pub struct ProxyRoute {
    pub prefix: String,
    pub upstream: Upstream,
}

/**
 * Parses an upstream URL such as `http://localhost:5173` or `https://api.example.com`.
 */
pub fn parse_upstream(url: &str) -> Result<Upstream, String> {
    let trimmed = url.trim();

    let (tls, rest) = if let Some(rest) = trimmed.strip_prefix("https://") {
        (true, rest)
    } else if let Some(rest) = trimmed.strip_prefix("http://") {
        (false, rest)
    } else {
        return Err(format!(
            "Invalid upstream URL '{}': it must start with http:// or https://.",
            url
        ));
    };

    let authority = rest.split(['/', '?']).next().unwrap_or("").trim();

    if authority.is_empty() {
        return Err(format!("Invalid upstream URL '{}': the host is missing.", url));
    }

    let default_port = if tls { 443 } else { 80 };

    let (host, port) = if let Some(rest) = authority.strip_prefix('[') {
        // IPv6 literal: [::1]:5173
        let (host, tail) = rest
            .split_once(']')
            .ok_or_else(|| format!("Invalid upstream URL '{}': malformed IPv6 host.", url))?;
        let port = tail
            .strip_prefix(':')
            .and_then(|value| value.parse::<u16>().ok())
            .unwrap_or(default_port);
        (host.to_string(), port)
    } else {
        match authority.rsplit_once(':') {
            Some((host, port)) => {
                let parsed = port
                    .parse::<u16>()
                    .map_err(|_| format!("Invalid upstream URL '{}': invalid port.", url))?;
                (host.to_string(), parsed)
            }
            None => (authority.to_string(), default_port),
        }
    };

    Ok(Upstream { host, port, tls })
}

/**
 * Finds the route that serves a path, preferring the longest matching prefix.
 *
 * The prefix only matches on a path boundary, so `/api` does not capture `/apixyz`.
 * The `*` prefix acts as the fallback of the unmatched paths.
 */
pub fn match_route<'a>(routes: &'a [ProxyRoute], path: &str) -> Option<&'a ProxyRoute> {
    let mut best: Option<&ProxyRoute> = None;

    for route in routes {
        if route.prefix == "*" {
            if best.is_none() {
                best = Some(route);
            }
            continue;
        }

        let matches = path == route.prefix
            || (path.starts_with(&route.prefix)
                && path[route.prefix.len()..].starts_with('/'));

        if !matches {
            continue;
        }

        let is_better = match best {
            Some(current) => {
                current.prefix == "*" || route.prefix.len() > current.prefix.len()
            }
            None => true,
        };

        if is_better {
            best = Some(route);
        }
    }

    best
}

/**
 * Checks whether a request asks for a protocol upgrade (WebSocket).
 */
pub fn is_upgrade_request(headers: &HeaderMap) -> bool {
    let has_upgrade = headers
        .get(UPGRADE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_ascii_lowercase().contains("websocket"))
        .unwrap_or(false);

    let has_connection = headers
        .get(CONNECTION)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_ascii_lowercase().contains("upgrade"))
        .unwrap_or(false);

    has_upgrade && has_connection
}

/**
 * Removes the headers that must not be forwarded.
 */
fn strip_hop_by_hop(headers: &HeaderMap) -> HeaderMap {
    let mut forwarded = HeaderMap::new();

    for (name, value) in headers.iter() {
        if name == HOST
            || name == CONNECTION
            || name == TRANSFER_ENCODING
            // The length is calculated again with the real body of the request.
            || name == hyper::header::CONTENT_LENGTH
        {
            continue;
        }
        // The address of the client is set by the proxy, never by the client.
        if name.as_str().eq_ignore_ascii_case("x-forwarded-for")
            || name.as_str().eq_ignore_ascii_case("x-forwarded-host")
            || name.as_str().eq_ignore_ascii_case("x-forwarded-proto")
        {
            continue;
        }
        forwarded.append(name.clone(), value.clone());
    }

    forwarded
}

/**
 * The transport used to talk with the upstream: plain TCP or TLS.
 */
pub trait UpstreamTransport: AsyncRead + AsyncWrite + Unpin + Send {}

impl<T: AsyncRead + AsyncWrite + Unpin + Send> UpstreamTransport for T {}

pub type UpstreamIo = Box<dyn UpstreamTransport>;

/**
 * Opens the connection with the upstream, negotiating TLS when it is required.
 */
async fn connect_upstream(
    upstream: &Upstream,
    tls_config: &TlsConfig,
) -> Result<UpstreamIo, String> {
    let socket = TcpStream::connect(upstream.authority())
        .await
        .map_err(|err| format!("Cannot connect to the upstream {}: {}", upstream.authority(), err))?;

    if upstream.tls {
        let tls = TlsStream::connect(socket, upstream.server_name(), tls_config)
            .await
            .map_err(|err| format!("The TLS handshake with {} failed: {}", upstream.authority(), err))?;

        Ok(Box::new(tls))
    } else {
        Ok(Box::new(socket))
    }
}

/**
 * Forwards a regular HTTP request to the upstream server.
 */
pub async fn forward(
    upstream: &Upstream,
    method: &Method,
    uri: &Uri,
    headers: &HeaderMap,
    body: Bytes,
    tls_config: &TlsConfig,
    client_ip: Option<IpAddr>,
) -> Result<Response<Full<Bytes>>, String> {
    let io = TokioIo::new(connect_upstream(upstream, tls_config).await?);

    let (mut sender, connection) = hyper::client::conn::http1::handshake(io)
        .await
        .map_err(|err| format!("Handshake with the upstream failed: {}", err))?;

    tokio::spawn(async move {
        let _ = connection.await;
    });

    let mut builder = Request::builder()
        .method(method.clone())
        .uri(uri.clone())
        .header(HOST, upstream.authority());

    for (name, value) in strip_hop_by_hop(headers).iter() {
        builder = builder.header(name, value);
    }

    // The address of the client is forwarded to the upstream, replacing the value
    // that the client could have sent: it must not be forgeable.
    if let Some(ip) = client_ip {
        builder = builder.header("x-forwarded-for", ip.to_string());
    }

    let request = builder
        .body(Full::new(body))
        .map_err(|err| format!("Cannot build the upstream request: {}", err))?;

    let response = sender
        .send_request(request)
        .await
        .map_err(|err| format!("The upstream request failed: {}", err))?;

    let (parts, body) = response.into_parts();
    let bytes = body
        .collect()
        .await
        .map_err(|err| format!("Cannot read the upstream response: {}", err))?
        .to_bytes();

    let mut response = Response::from_parts(parts, Full::new(bytes));

    // The hop-by-hop headers belong to the connection with the upstream and must
    // not be forwarded to the client. The length is recalculated by hyper.
    response.headers_mut().remove(hyper::header::CONTENT_LENGTH);
    response.headers_mut().remove(TRANSFER_ENCODING);
    response.headers_mut().remove(hyper::header::CONNECTION);
    response.headers_mut().remove(hyper::header::PROXY_AUTHENTICATE);
    response.headers_mut().remove(hyper::header::PROXY_AUTHORIZATION);

    if let Ok(keep_alive) = hyper::header::HeaderName::from_bytes(b"keep-alive") {
        response.headers_mut().remove(keep_alive);
    }

    Ok(response)
}

/**
 * Performs the WebSocket handshake against the upstream server.
 *
 * Returns the connection and the raw bytes of the response, so the caller can
 * forward the handshake to the client and tunnel the rest of the stream.
 */
pub async fn handshake(
    upstream: &Upstream,
    method: &Method,
    uri: &Uri,
    headers: &HeaderMap,
    tls_config: &TlsConfig,
) -> Result<(UpstreamIo, Vec<u8>, usize), String> {
    let mut stream = connect_upstream(upstream, tls_config).await?;

    let path = uri
        .path_and_query()
        .map(|value| value.as_str().to_string())
        .unwrap_or_else(|| "/".to_string());

    let mut request = format!("{} {} HTTP/1.1\r\n", method.as_str(), path);
    request.push_str(&format!("Host: {}\r\n", upstream.authority()));

    for (name, value) in headers.iter() {
        if name == HOST
            || name == CONNECTION
            || name == TRANSFER_ENCODING
            || name == UPGRADE
            || name == hyper::header::CONTENT_LENGTH
        {
            continue;
        }
        request.push_str(&format!(
            "{}: {}\r\n",
            name.as_str(),
            value.to_str().unwrap_or_default()
        ));
    }

    request.push_str("Connection: Upgrade\r\n");
    request.push_str("Upgrade: websocket\r\n");
    request.push_str("\r\n");

    stream
        .write_all(request.as_bytes())
        .await
        .map_err(|err| format!("Cannot send the upgrade request: {}", err))?;
    stream
        .flush()
        .await
        .map_err(|err| format!("Cannot flush the upgrade request: {}", err))?;

    let mut buffer = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];

    loop {
        let read = stream
            .read(&mut chunk)
            .await
            .map_err(|err| format!("Cannot read the upgrade response: {}", err))?;

        if read == 0 {
            return Err("The upstream closed the connection during the handshake.".to_string());
        }

        buffer.extend_from_slice(&chunk[..read]);

        if let Some(position) = find_head_end(&buffer) {
            return Ok((stream, buffer, position));
        }

        if buffer.len() > 64 * 1024 {
            return Err("The upgrade response is too large.".to_string());
        }
    }
}

/**
 * Reads the body of a response that is not an upgrade, according to its
 * `Content-Length`.
 *
 * The bytes already read from the stream are the first ones of the body.
 */
pub async fn read_body(
    stream: &mut UpstreamIo,
    leftover: &[u8],
    headers: &HeaderMap,
) -> Vec<u8> {
    let expected = headers
        .get(hyper::header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);

    let mut body = leftover.to_vec();

    if body.len() >= expected {
        body.truncate(expected);
        return body;
    }

    let mut buffer = vec![0u8; expected - body.len()];

    if let Ok(read) = stream.read(&mut buffer).await {
        body.extend_from_slice(&buffer[..read]);
    }

    body.truncate(expected);
    body
}

/**
 * Finds the end of the HTTP head (`\r\n\r\n`) inside a buffer.
 *
 * It returns the position **after** the marker, so the bytes that follow are the
 * beginning of the body and not the end of the head.
 */
fn find_head_end(buffer: &[u8]) -> Option<usize> {
    buffer
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|position| position + 4)
}

/**
 * Parses the status code and the headers of a raw HTTP response head.
 */
pub fn parse_head(head: &[u8]) -> Result<(StatusCode, HeaderMap), String> {
    let text = String::from_utf8_lossy(head);
    let mut lines = text.split("\r\n");

    let status_line = lines
        .next()
        .ok_or_else(|| "The upstream response is empty.".to_string())?;

    let mut parts = status_line.split_whitespace();
    let _version = parts.next();
    let code: u16 = parts
        .next()
        .and_then(|value| value.parse().ok())
        .ok_or_else(|| format!("Invalid upstream status line: {}", status_line))?;

    let mut headers = HeaderMap::new();

    for line in lines {
        if line.is_empty() {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            let name = name.trim();
            let value = value.trim();
            if let (Ok(name), Ok(value)) = (
                hyper::header::HeaderName::from_bytes(name.as_bytes()),
                HeaderValue::from_str(value),
            ) {
                headers.append(name, value);
            }
        }
    }

    Ok((StatusCode::from_u16(code).unwrap_or(StatusCode::BAD_GATEWAY), headers))
}

/**
 * Size of the buffers used to pump the bytes between both sides of the tunnel.
 */
const TUNNEL_BUFFER_SIZE: usize = 16 * 1024;

/**
 * Tunnels the bytes between the client and the upstream server.
 *
 * The leftover bytes already read from the upstream are sent first, so no frame is
 * lost between the handshake and the tunnel.
 */
pub async fn tunnel<T, U>(
    mut client: T,
    mut upstream: U,
    leftover: Vec<u8>,
) -> io::Result<()>
where
    T: AsyncRead + AsyncWrite + Unpin,
    U: AsyncRead + AsyncWrite + Unpin,
{
    // The buffers need capacity: reading into an empty buffer would be reported
    // as the end of the stream.
    let mut to_client = vec![0u8; TUNNEL_BUFFER_SIZE];
    let mut to_upstream = vec![0u8; TUNNEL_BUFFER_SIZE];

    if !leftover.is_empty() {
        client.write_all(&leftover).await?;
        client.flush().await?;
    }

    loop {
        tokio::select! {
            read = client.read(&mut to_upstream) => {
                let count = read?;
                if count == 0 {
                    break;
                }
                upstream.write_all(&to_upstream[..count]).await?;
                upstream.flush().await?;
            }
            read = upstream.read(&mut to_client) => {
                let count = read?;
                if count == 0 {
                    break;
                }
                client.write_all(&to_client[..count]).await?;
                client.flush().await?;
            }
        }
    }

    Ok(())
}
