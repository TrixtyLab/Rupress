use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::auth::AuthConfig;
use crate::tls::TlsConfig;

/**
 * Security configuration for DDoS, body size limits, and browser protection headers.
 */
#[derive(Clone, Debug)]
pub struct SecurityConfig {
    pub enable_rate_limit: bool,
    pub rate_limit_max: u32,
    pub rate_limit_window: Duration,
    /// Headers that identify the client. When one of them is present, the rate limit
    /// is applied to its value instead of the IP address, so the users behind the
    /// same NAT do not share the quota.
    pub rate_limit_key_by: Vec<String>,
    pub max_body_size: usize,
    pub enable_security_headers: bool,
    pub auth: AuthConfig,
    pub tls: TlsConfig,
}

impl Default for SecurityConfig {
    fn default() -> Self {
        Self {
            enable_rate_limit: true,
            rate_limit_max: 100,
            rate_limit_window: Duration::from_secs(10),
            rate_limit_key_by: Vec::new(),
            max_body_size: 10 * 1024 * 1024,
            enable_security_headers: true,
            auth: AuthConfig::default(),
            tls: TlsConfig::default(),
        }
    }
}

/**
 * Internal state of the rate limiter.
 */
#[derive(Debug)]
struct LimiterState {
    records: HashMap<String, (u32, Instant)>,
    last_cleanup: Instant,
}

/**
 * Maximum number of clients tracked by the rate limiter.
 *
 * The map is bounded so a distributed attack (many different source addresses)
 * cannot exhaust the memory of the process.
 */
const MAX_TRACKED_CLIENTS: usize = 100_000;

/**
 * In-memory fixed-window rate limiter designed to mitigate HTTP flood attacks.
 *
 * The bookkeeping map is pruned at most once per window, so the cost of a request
 * stays constant instead of growing with the number of tracked clients.
 */
pub struct RateLimiter {
    state: Mutex<LimiterState>,
    max_requests: u32,
    window: Duration,
}

impl RateLimiter {
    pub fn new(max_requests: u32, window: Duration) -> Self {
        Self {
            state: Mutex::new(LimiterState {
                records: HashMap::new(),
                last_cleanup: Instant::now(),
            }),
            max_requests,
            window,
        }
    }

    pub fn check(&self, key: String) -> bool {
        let mut state = match self.state.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };

        let now = Instant::now();

        // Prune the expired entries at most once per window to keep the cost bounded.
        if now.duration_since(state.last_cleanup) >= self.window {
            let retention = self.window * 2;
            state
                .records
                .retain(|_, (_, start)| now.duration_since(*start) < retention);
            state.last_cleanup = now;
        }

        // Hard limit on the tracked clients: the state is reset instead of growing
        // without limits when the limit is reached.
        if state.records.len() >= MAX_TRACKED_CLIENTS {
            state.records.clear();
            state.last_cleanup = now;
        }

        let entry = state.records.entry(key).or_insert((0, now));
        if now.duration_since(entry.1) >= self.window {
            entry.0 = 1;
            entry.1 = now;
            true
        } else if entry.0 >= self.max_requests {
            false
        } else {
            entry.0 += 1;
            true
        }
    }
}
