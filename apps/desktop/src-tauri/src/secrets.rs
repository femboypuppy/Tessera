//! Tokens for Tessera servers, kept in the OS keychain (Keychain on macOS, Credential Manager on
//! Windows, the Secret Service on Linux). Only the list of servers (no secrets) is stored in the
//! config folder, so the settings panel can show where the device is signed in.

use crate::config::{server_origin, ServerEntry, ServersFile};
use crate::db::now_ms;
use crate::error::{poisoned, Error, Result};
use crate::state::AppState;

pub const SERVICE: &str = "app.tessera.desktop";
const MAX_TOKEN_LEN: usize = 8192;

fn entry(origin: &str) -> Result<keyring::Entry> {
    keyring::Entry::new(SERVICE, origin)
        .map_err(|e| Error::Unavailable(format!("keychain unavailable: {e}")))
}

pub fn get(server: &str) -> Result<Option<String>> {
    let origin = server_origin(server)?;
    match entry(&origin)?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(Error::Unavailable(format!(
            "could not read the keychain: {error}"
        ))),
    }
}

pub fn set(state: &AppState, server: &str, token: &str) -> Result<()> {
    validate_token(token)?;
    let origin = server_origin(server)?;
    entry(&origin)?
        .set_password(token)
        .map_err(|e| Error::Unavailable(format!("could not write to the keychain: {e}")))?;
    let _guard = state.servers_lock.lock().map_err(poisoned)?;
    let mut file = ServersFile::load(&state.paths.servers)?;
    file.servers.retain(|s| s.server != origin);
    file.servers.push(ServerEntry {
        server: origin,
        saved_at: now_ms(),
    });
    file.save(&state.paths.servers)
}

pub fn delete(state: &AppState, server: &str) -> Result<()> {
    let origin = server_origin(server)?;
    match entry(&origin)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => {}
        Err(error) => {
            return Err(Error::Unavailable(format!(
                "could not update the keychain: {error}"
            )))
        }
    }
    let _guard = state.servers_lock.lock().map_err(poisoned)?;
    let mut file = ServersFile::load(&state.paths.servers)?;
    file.servers.retain(|s| s.server != origin);
    file.save(&state.paths.servers)
}

pub fn list(state: &AppState) -> Result<Vec<ServerEntry>> {
    let _guard = state.servers_lock.lock().map_err(poisoned)?;
    Ok(ServersFile::load(&state.paths.servers)?.servers)
}

fn validate_token(token: &str) -> Result<()> {
    if token.is_empty() || token.len() > MAX_TOKEN_LEN || token.chars().any(|c| c.is_control()) {
        return Err(Error::Invalid(
            "tokens must be 1 to 8192 printable characters".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_tokens() {
        assert!(validate_token("tsk_abc.def").is_ok());
        assert!(validate_token("").is_err());
        assert!(validate_token("a\nb").is_err());
        assert!(validate_token(&"x".repeat(MAX_TOKEN_LEN + 1)).is_err());
    }
}
