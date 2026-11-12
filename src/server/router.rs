use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use crate::auth::RouteAuth;
use crate::types::{HandlerTsfn, RouteMatch};
use crate::url::decode_path;

pub const HTTP_METHODS: &[&str] = &["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"];

/**
 * Translates the Express-like parameter syntax (`:id`, `:rest*`) into the syntax
 * expected by matchit (`{id}`, `{*rest}`).
 *
 * Routes using the native matchit syntax (`{id}`) are kept untouched, so both
 * flavours can be mixed in the same project.
 */
fn normalize_path(path: &str) -> String {
    if !path.contains(':') {
        return path.to_string();
    }

    let chars: Vec<char> = path.chars().collect();
    let mut out = String::with_capacity(path.len());
    let mut index = 0;

    while index < chars.len() {
        if chars[index] != ':' {
            out.push(chars[index]);
            index += 1;
            continue;
        }

        let name_start = index + 1;
        let mut name_end = name_start;
        while name_end < chars.len() && (chars[name_end].is_ascii_alphanumeric() || chars[name_end] == '_') {
            name_end += 1;
        }

        if name_end == name_start {
            // Not a parameter (e.g. `http://`), keep the character as is.
            out.push(':');
            index += 1;
            continue;
        }

        let name: String = chars[name_start..name_end].iter().collect();
        let mut cursor = name_end;
        let catch_all = cursor < chars.len() && chars[cursor] == '*';

        if catch_all {
            cursor += 1;
            out.push_str(&format!("{{*{}}}", name));
        } else {
            out.push_str(&format!("{{{}}}", name));
        }

        index = cursor;
    }

    out
}

/**
 * Method-aware radix tree router based on matchit, with fallback and static directory support.
 */
#[derive(Default)]
pub struct MethodRouter {
    routers: HashMap<String, matchit::Router<(Arc<HandlerTsfn>, RouteAuth)>>,
    fallback: Option<Arc<HandlerTsfn>>,
    static_routes: Vec<(String, PathBuf)>,
    cors_enabled: bool,
}

impl MethodRouter {
    pub fn new() -> Self {
        Self {
            routers: HashMap::new(),
            fallback: None,
            static_routes: Vec::new(),
            cors_enabled: false,
        }
    }

    pub fn set_cors(&mut self, enabled: bool) {
        self.cors_enabled = enabled;
    }

    pub fn is_cors_enabled(&self) -> bool {
        self.cors_enabled
    }

    pub fn add_static(&mut self, prefix: String, dir: PathBuf) {
        let clean_prefix = if prefix.starts_with('/') {
            prefix
        } else {
            format!("/{}", prefix)
        };
        self.static_routes.push((clean_prefix, dir));
    }

    pub fn get_static_routes(&self) -> Vec<(String, PathBuf)> {
        self.static_routes.clone()
    }

    pub fn set_fallback(&mut self, handler: Arc<HandlerTsfn>) {
        self.fallback = Some(handler);
    }

    pub fn insert(
        &mut self,
        method: &str,
        path: &str,
        handler: Arc<HandlerTsfn>,
        auth: RouteAuth,
    ) -> Result<(), matchit::InsertError> {
        let method_upper = method.to_uppercase();
        let normalized_path = normalize_path(path);
        let entry = (handler, auth);

        if method_upper == "ALL" {
            for &m in HTTP_METHODS {
                let router = self.routers.entry(m.to_string()).or_default();
                router.insert(&normalized_path, entry.clone())?;
            }
            Ok(())
        } else {
            let router = self.routers.entry(method_upper).or_default();
            router.insert(&normalized_path, entry)
        }
    }

    pub fn match_route(&self, method: &str, path: &str) -> RouteMatch {
        let method_upper = method.to_uppercase();

        if let Some(router) = self.routers.get(&method_upper) {
            if let Ok(matched) = router.at(path) {
                let params = matched
                    .params
                    .iter()
                    // Parameters are percent-decoded so handlers always receive the
                    // real value sent by the client.
                    .map(|(k, v)| (k.to_string(), decode_path(v)))
                    .collect();
                let (handler, auth) = matched.value;
                return RouteMatch::Found(handler.clone(), params, auth.clone());
            }
        }

        for (m, router) in &self.routers {
            if m != &method_upper && router.at(path).is_ok() {
                return RouteMatch::MethodNotAllowed(self.allowed_methods(path, &method_upper));
            }
        }

        if let Some(ref fallback) = self.fallback {
            return RouteMatch::Found(fallback.clone(), HashMap::new(), RouteAuth::default());
        }

        RouteMatch::NotFound
    }

    /**
     * The methods that can serve a path, used by the `Allow` header of a 405.
     */
    fn allowed_methods(&self, path: &str, current: &str) -> Vec<String> {
        let mut allowed: Vec<String> = self
            .routers
            .iter()
            .filter(|(method, router)| method.as_str() != current && router.at(path).is_ok())
            .map(|(method, _)| method.clone())
            .collect();

        allowed.sort();
        allowed
    }
}
