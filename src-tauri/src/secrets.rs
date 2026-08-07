//! OS credential-store access, shared by every feature that holds a secret.
//!
//! Accounts are namespaced by the caller (`plugin:<id>:<key>`,
//! `calendar:google:refresh_token`) so one feature can never read another's
//! secret by guessing a key. Nothing here ever logs a value.

const KEYRING_SERVICE: &str = "Moldavite";

/// Indirection so callers can be tested without touching the real keychain.
pub(crate) trait SecretStore {
    fn get(&self, account: &str) -> Result<Option<String>, String>;
    fn set(&self, account: &str, value: &str) -> Result<(), String>;
    fn delete(&self, account: &str) -> Result<(), String>;
}

pub(crate) struct KeychainSecretStore;

impl KeychainSecretStore {
    fn entry(account: &str) -> Result<keyring::Entry, String> {
        keyring::Entry::new(KEYRING_SERVICE, account)
            .map_err(|e| format!("could not access secret: {e}"))
    }
}

impl SecretStore for KeychainSecretStore {
    fn get(&self, account: &str) -> Result<Option<String>, String> {
        match Self::entry(account)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(format!("could not read secret: {e}")),
        }
    }

    fn set(&self, account: &str, value: &str) -> Result<(), String> {
        Self::entry(account)?
            .set_password(value)
            .map_err(|e| format!("could not save secret: {e}"))
    }

    fn delete(&self, account: &str) -> Result<(), String> {
        match Self::entry(account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("could not delete secret: {e}")),
        }
    }
}
