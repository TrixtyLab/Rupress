// Percent-decoding helpers used to normalize user supplied data before it reaches
// the application layer.

/**
 * Converts an hexadecimal digit into its numeric value.
 */
fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

/**
 * Decodes a percent-encoded string.
 *
 * Invalid escape sequences are preserved verbatim instead of being discarded, and
 * the result is always valid UTF-8 (invalid byte sequences are replaced).
 *
 * @param input Raw encoded component.
 * @param plus_as_space When true, `+` is decoded as a space (query string rule).
 */
fn decode(input: &str, plus_as_space: bool) -> String {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut index = 0;

    while index < bytes.len() {
        match bytes[index] {
            b'%' if index + 3 <= bytes.len() => {
                match (hex_value(bytes[index + 1]), hex_value(bytes[index + 2])) {
                    (Some(high), Some(low)) => {
                        out.push((high << 4) | low);
                        index += 3;
                    }
                    _ => {
                        out.push(b'%');
                        index += 1;
                    }
                }
            }
            b'+' if plus_as_space => {
                out.push(b' ');
                index += 1;
            }
            byte => {
                out.push(byte);
                index += 1;
            }
        }
    }

    String::from_utf8_lossy(&out).into_owned()
}

/**
 * Decodes a component of the path (a `+` is a literal plus sign there).
 */
pub fn decode_path(input: &str) -> String {
    decode(input, false)
}

/**
 * Decodes a component of the query string (a `+` means a space there).
 */
pub fn decode_query(input: &str) -> String {
    decode(input, true)
}

/**
 * Parses a raw query string into a map of decoded keys and values.
 */
pub fn parse_query(raw: &str) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();

    for pair in raw.split('&') {
        if pair.is_empty() {
            continue;
        }

        let mut parts = pair.splitn(2, '=');
        let key = parts.next().unwrap_or("");
        let value = parts.next().unwrap_or("");

        map.insert(decode_query(key), decode_query(value));
    }

    map
}
