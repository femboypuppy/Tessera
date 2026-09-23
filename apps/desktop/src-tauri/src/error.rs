//! Errors returned by commands. They serialize as `{ code, message }`, and the TypeScript side
//! (`apps/desktop/src/backend/errors.ts`) maps each `code` to a `TesseraError` subclass.

use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Invalid(String),
    #[error("{0}")]
    Conflict(String),
    #[error("{0}")]
    Unavailable(String),
    #[error("{0}")]
    Internal(String),
    #[error("database error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("file error: {0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Json(#[from] serde_json::Error),
    #[error("{0}")]
    Tauri(#[from] tauri::Error),
}

impl Error {
    /// Stable machine code, shared with `TesseraError.code` in `@tessera/core`.
    pub fn code(&self) -> &'static str {
        match self {
            Error::NotFound(_) => "not_found",
            Error::Invalid(_) => "invalid",
            Error::Conflict(_) => "conflict",
            Error::Unavailable(_) => "unavailable",
            Error::Io(error) if error.kind() == std::io::ErrorKind::NotFound => "not_found",
            Error::Io(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
                "permission_denied"
            }
            _ => "internal",
        }
    }
}

impl Serialize for Error {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("Error", 2)?;
        state.serialize_field("code", self.code())?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}

pub type Result<T> = std::result::Result<T, Error>;

/// Maps a poisoned lock (a panic while holding it) to an error instead of propagating the panic.
pub fn poisoned<T>(_: std::sync::PoisonError<T>) -> Error {
    Error::Internal("an earlier operation failed while holding a lock; restart the app".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_code_and_message() {
        let json = serde_json::to_value(Error::NotFound("Workspace not found".into())).unwrap();
        assert_eq!(json["code"], "not_found");
        assert_eq!(json["message"], "Workspace not found");
    }

    #[test]
    fn maps_io_kinds() {
        let missing = Error::Io(std::io::Error::from(std::io::ErrorKind::NotFound));
        assert_eq!(missing.code(), "not_found");
        let denied = Error::Io(std::io::Error::from(std::io::ErrorKind::PermissionDenied));
        assert_eq!(denied.code(), "permission_denied");
    }
}
