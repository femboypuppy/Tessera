//! `tessera-asset://localhost/<workspaceId>/<assetId>` (`http://tessera-asset.localhost/…` on
//! Windows): serves attachments of open workspaces to `<img>`, `<video>` and friends. Only assets
//! recorded in an open workspace's database are served, from its `assets/` folder.

use crate::error::Error;
use crate::state::AppState;
use crate::validate;
use percent_encoding::percent_decode_str;
use tauri::http::{header, Request, Response, StatusCode};
use tauri::{AppHandle, Manager, Runtime};

pub const SCHEME: &str = "tessera-asset";

/// Splits the request path into `(workspaceId, assetId)`. `convertFileSrc` percent-encodes the
/// whole path, so `/` may arrive as `%2F`.
pub fn parse_path(path: &str) -> Option<(String, String)> {
    let decoded = percent_decode_str(path.trim_start_matches('/'))
        .decode_utf8()
        .ok()?;
    let (workspace, asset) = decoded.split_once('/')?;
    validate::id(workspace).ok()?;
    validate::asset_id(asset).ok()?;
    Some((workspace.to_string(), asset.to_string()))
}

fn plain(status: StatusCode, message: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(message.as_bytes().to_vec())
        .unwrap_or_default()
}

pub fn handle<R: Runtime>(app: &AppHandle<R>, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    if request.method() != tauri::http::Method::GET && request.method() != tauri::http::Method::HEAD
    {
        return plain(StatusCode::METHOD_NOT_ALLOWED, "method not allowed");
    }
    let Some((workspace_id, asset_id)) = parse_path(request.uri().path()) else {
        return plain(StatusCode::BAD_REQUEST, "bad asset URL");
    };
    let state = app.state::<AppState>();
    let result = state
        .workspaces
        .get(&workspace_id)
        .and_then(|ws| ws.asset_bytes(&asset_id));
    match result {
        Ok(Some((row, bytes))) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, row.mime_type)
            .header(header::CONTENT_LENGTH, bytes.len())
            // Content-addressed: the bytes behind an ID never change.
            .header(
                header::CACHE_CONTROL,
                "private, max-age=31536000, immutable",
            )
            .header("X-Content-Type-Options", "nosniff")
            // SVGs opened directly must not run scripts.
            .header(
                header::CONTENT_SECURITY_POLICY,
                "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
            )
            .body(if request.method() == tauri::http::Method::HEAD {
                Vec::new()
            } else {
                bytes
            })
            .unwrap_or_else(|_| plain(StatusCode::INTERNAL_SERVER_ERROR, "response error")),
        Ok(None) | Err(Error::NotFound(_)) => plain(StatusCode::NOT_FOUND, "asset not found"),
        Err(error) => {
            log::warn!("asset {workspace_id}/{asset_id}: {error}");
            plain(
                StatusCode::INTERNAL_SERVER_ERROR,
                "could not read the asset",
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_encoded_and_plain_paths() {
        let asset = "a".repeat(64);
        assert_eq!(
            parse_path(&format!("/ws1%2F{asset}")),
            Some(("ws1".into(), asset.clone()))
        );
        assert_eq!(
            parse_path(&format!("/ws1/{asset}")),
            Some(("ws1".into(), asset))
        );
        assert_eq!(parse_path("/ws1"), None);
        assert_eq!(parse_path("/ws1%2F..%2F..%2Fetc"), None);
        assert_eq!(parse_path("/../x/y"), None);
    }
}
