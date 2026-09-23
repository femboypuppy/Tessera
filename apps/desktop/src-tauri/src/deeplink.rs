//! `tessera://open/<pageId>` (optionally `?workspace=<workspaceId>`) deep links. They arrive from
//! the OS (deep-link plugin), from a second launch (single-instance plugin, in `argv`) or at cold
//! start; all of them are parsed here, queued, and handed to the main window, which navigates.

use crate::validate;
use serde::Serialize;

pub const SCHEME: &str = "tessera";

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeepLink {
    pub page_id: String,
    pub workspace_id: Option<String>,
    pub heading: Option<String>,
    pub block_id: Option<String>,
}

/// Parses a deep link, or returns `None` for anything that isn't a valid Tessera link.
pub fn parse(raw: &str) -> Option<DeepLink> {
    let url = url::Url::parse(raw.trim()).ok()?;
    if url.scheme() != SCHEME || url.host_str() != Some("open") {
        return None;
    }
    let mut segments = url.path_segments()?.filter(|s| !s.is_empty());
    let page_id = segments.next()?.to_string();
    if segments.next().is_some() || validate::id(&page_id).is_err() {
        return None;
    }
    let mut link = DeepLink {
        page_id,
        workspace_id: None,
        heading: None,
        block_id: None,
    };
    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "workspace" if validate::id(&value).is_ok() => {
                link.workspace_id = Some(value.into_owned())
            }
            "heading" if !value.is_empty() && value.chars().count() <= 200 => {
                link.heading = Some(value.into_owned())
            }
            "block" if validate::id(&value).is_ok() => link.block_id = Some(value.into_owned()),
            _ => {}
        }
    }
    Some(link)
}

/// Deep links among command-line arguments (Windows and Linux pass them to the second instance).
pub fn from_args<I: IntoIterator<Item = String>>(args: I) -> Vec<DeepLink> {
    args.into_iter()
        .filter(|arg| arg.starts_with(&format!("{SCHEME}://")))
        .filter_map(|arg| parse(&arg))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_page_links() {
        let link = parse("tessera://open/V1StGXR8_Z5jdHi6B-myT").unwrap();
        assert_eq!(link.page_id, "V1StGXR8_Z5jdHi6B-myT");
        assert_eq!(link.workspace_id, None);
        let link =
            parse("tessera://open/abc/?workspace=ws_1&heading=Launch%20plan&block=b1").unwrap();
        assert_eq!(link.workspace_id.as_deref(), Some("ws_1"));
        assert_eq!(link.heading.as_deref(), Some("Launch plan"));
        assert_eq!(link.block_id.as_deref(), Some("b1"));
    }

    #[test]
    fn rejects_everything_else() {
        for raw in [
            "https://open/abc",
            "tessera://close/abc",
            "tessera://open/",
            "tessera://open/a/b",
            "tessera://open/..%2F..",
            "tessera://open/bad%20id",
            "not a url",
        ] {
            assert_eq!(parse(raw), None, "{raw}");
        }
        let link = parse("tessera://open/abc?workspace=../x").unwrap();
        assert_eq!(link.workspace_id, None, "invalid workspace IDs are dropped");
    }

    #[test]
    fn finds_links_in_arguments() {
        let args = vec![
            "tessera.exe".to_string(),
            "--flag".into(),
            "tessera://open/abc".into(),
        ];
        assert_eq!(from_args(args).len(), 1);
    }
}
