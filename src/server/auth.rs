use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use hyper::header::HeaderMap;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

/**
 * The identity extracted from a request.
 */
#[derive(Clone, Debug, Default)]
pub struct AuthUser {
    pub name: String,
    pub permissions: Vec<String>,
    /// Whether the identity comes from a verified credential.
    pub authenticated: bool,
}

/**
 * A credential accepted by the server.
 */
#[derive(Clone, Debug)]
pub struct ApiKey {
    pub name: String,
    pub permissions: Vec<String>,
}

/**
 * Configuration of the authentication layer.
 */
#[derive(Clone, Debug, Default)]
pub struct AuthConfig {
    pub enabled: bool,
    pub api_keys: HashMap<String, ApiKey>,
    pub jwt_secret: Option<String>,
    pub jwt_issuer: Option<String>,
    pub jwt_audience: Option<String>,
    pub allow_anonymous: bool,
}

/**
 * The reason why a request was rejected.
 */
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AuthError {
    /// No credential was provided.
    Missing,
    /// The credential is not valid.
    Invalid,
    /// The credential has expired.
    Expired,
}

/**
 * The claims of a JSON Web Token.
 */
#[derive(Debug, Deserialize, Default)]
struct Claims {
    sub: Option<String>,
    exp: Option<u64>,
    nbf: Option<u64>,
    iss: Option<String>,
    #[serde(default, deserialize_with = "deserialize_audience")]
    aud: Option<Vec<String>>,
    #[serde(default)]
    permissions: Option<Vec<String>>,
}

/**
 * The claims of the header of a JSON Web Token.
 */
#[derive(Debug, Deserialize)]
struct JwtHeader {
    alg: String,
}

/**
 * Accepts the `aud` claim both as a string and as an array of strings.
 */
fn deserialize_audience<'de, D>(deserializer: D) -> Result<Option<Vec<String>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = Option::<serde_json::Value>::deserialize(deserializer)?;

    Ok(match value {
        Some(serde_json::Value::String(text)) => Some(vec![text]),
        Some(serde_json::Value::Array(items)) => Some(
            items
                .into_iter()
                .filter_map(|item| item.as_str().map(|text| text.to_string()))
                .collect(),
        ),
        _ => None,
    })
}

/**
 * Computes the HMAC-SHA256 of a message (RFC 2104).
 */
fn hmac_sha256(key: &[u8], message: &[u8]) -> Vec<u8> {
    const BLOCK_SIZE: usize = 64;

    let mut key_block = [0u8; BLOCK_SIZE];

    if key.len() > BLOCK_SIZE {
        let digest = Sha256::digest(key);
        key_block[..digest.len()].copy_from_slice(&digest);
    } else {
        key_block[..key.len()].copy_from_slice(key);
    }

    let mut inner = Vec::with_capacity(BLOCK_SIZE + message.len());
    let mut outer = Vec::with_capacity(BLOCK_SIZE + 32);

    for byte in key_block.iter() {
        inner.push(byte ^ 0x36);
        outer.push(byte ^ 0x5c);
    }

    inner.extend_from_slice(message);
    outer.extend_from_slice(&Sha256::digest(&inner));

    Sha256::digest(&outer).to_vec()
}

/**
 * Reads a header ignoring the case of its name.
 */
fn header<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers.get(name).and_then(|value| value.to_str().ok())
}

impl AuthConfig {
    /**
     * Extracts the identity of a request.
     */
    pub fn authenticate(&self, headers: &HeaderMap) -> Result<AuthUser, AuthError> {
        if !self.enabled {
            return Ok(AuthUser::default());
        }

        // The API key takes precedence over the bearer token. An empty key is
        // ignored, so it does not hide a valid token.
        if let Some(key) = header(headers, "x-api-key") {
            let key = key.trim();

            if !key.is_empty() {
                return self.verify_api_key(key);
            }
        }

        if let Some(authorization) = header(headers, "authorization") {
            let authorization = authorization.trim();

            // The authentication scheme is case insensitive (RFC 7235).
            let token = match authorization.split_once(' ') {
                Some((scheme, value)) if scheme.eq_ignore_ascii_case("bearer") => value.trim(),
                _ => authorization,
            };

            if !token.is_empty() {
                return self.verify_jwt(token);
            }
        }

        if self.allow_anonymous {
            return Ok(AuthUser::default());
        }

        Err(AuthError::Missing)
    }

    /**
     * Verifies an API key in constant time.
     *
     * Every configured key is compared, so the time taken does not depend on the
     * position of the valid one.
     */
    fn verify_api_key(&self, provided: &str) -> Result<AuthUser, AuthError> {
        let mut found: Option<&ApiKey> = None;

        for (candidate, user) in &self.api_keys {
            let equal: bool = candidate.as_bytes().ct_eq(provided.as_bytes()).into();

            if equal {
                found = Some(user);
            }
        }

        match found {
            Some(user) => Ok(AuthUser {
                name: user.name.clone(),
                permissions: user.permissions.clone(),
                authenticated: true,
            }),
            None => Err(AuthError::Invalid),
        }
    }

    /**
     * Verifies the signature and the claims of a JSON Web Token (HS256).
     */
    fn verify_jwt(&self, token: &str) -> Result<AuthUser, AuthError> {
        let secret = self.jwt_secret.as_ref().ok_or(AuthError::Missing)?;

        let mut segments = token.split('.');
        let header = segments.next().ok_or(AuthError::Invalid)?;
        let payload = segments.next().ok_or(AuthError::Invalid)?;
        let signature = segments.next().ok_or(AuthError::Invalid)?;

        if segments.next().is_some() {
            return Err(AuthError::Invalid);
        }

        let header_bytes = URL_SAFE_NO_PAD
            .decode(header)
            .map_err(|_| AuthError::Invalid)?;

        let jwt_header: JwtHeader =
            serde_json::from_slice(&header_bytes).map_err(|_| AuthError::Invalid)?;

        // Only the symmetric algorithm is accepted: the token is never trusted to
        // choose its own verification method.
        if jwt_header.alg != "HS256" {
            return Err(AuthError::Invalid);
        }

        let expected = hmac_sha256(
            secret.as_bytes(),
            format!("{}.{}", header, payload).as_bytes(),
        );

        let provided = URL_SAFE_NO_PAD
            .decode(signature)
            .map_err(|_| AuthError::Invalid)?;

        if expected.len() != provided.len()
            || !bool::from(expected.as_slice().ct_eq(provided.as_slice()))
        {
            return Err(AuthError::Invalid);
        }

        let payload_bytes = URL_SAFE_NO_PAD
            .decode(payload)
            .map_err(|_| AuthError::Invalid)?;

        let claims: Claims =
            serde_json::from_slice(&payload_bytes).map_err(|_| AuthError::Invalid)?;

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|value| value.as_secs())
            .unwrap_or_default();

        if let Some(exp) = claims.exp {
            if now >= exp {
                return Err(AuthError::Expired);
            }
        }

        if let Some(nbf) = claims.nbf {
            if now < nbf {
                return Err(AuthError::Invalid);
            }
        }

        if let Some(issuer) = &self.jwt_issuer {
            if claims.iss.as_deref() != Some(issuer.as_str()) {
                return Err(AuthError::Invalid);
            }
        }

        if let Some(audience) = &self.jwt_audience {
            let matches = claims
                .aud
                .as_ref()
                .map(|values| values.iter().any(|value| value == audience))
                .unwrap_or(false);

            if !matches {
                return Err(AuthError::Invalid);
            }
        }

        Ok(AuthUser {
            name: claims.sub.unwrap_or_default(),
            permissions: claims.permissions.unwrap_or_default(),
            authenticated: true,
        })
    }
}

/**
 * The permissions a route requires.
 */
#[derive(Clone, Debug, Default)]
pub struct RouteAuth {
    /// The user must have **all** of these permissions.
    pub permissions: Vec<String>,
    /// The user must have **at least one** of these permissions.
    pub any_of: Vec<String>,
}

impl RouteAuth {
    /**
     * Checks whether the identity satisfies the requirements of the route.
     */
    pub fn allows(&self, user: &AuthUser) -> bool {
        let granted = |needed: &String| user.permissions.iter().any(|value| value == needed);

        if !self.permissions.iter().all(granted) {
            return false;
        }

        if !self.any_of.is_empty() && !self.any_of.iter().any(granted) {
            return false;
        }

        true
    }
}
