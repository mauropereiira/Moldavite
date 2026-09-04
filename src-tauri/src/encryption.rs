//! Password-based encryption and decryption for locked note bodies.
//!
//! New note locks use Argon2id (64 MiB, three iterations, one lane) to derive
//! an AES-256 key and AES-GCM for authenticated encryption — format V3,
//! `v3$`-prefixed. Each encryption gets a fresh random salt and 96-bit nonce.
//! The KDF parameters are never recorded in the ciphertext, so they cannot
//! change for anything already on disk: the legacy `salt$nonce$ciphertext`
//! format (also used by encrypted exports) and V2 (`v2$` prefix) both keep
//! decrypting at the original 19 MiB parameters. V2 and V3 note ciphertexts
//! bind the stable note identity as AES-GCM AAD; the legacy/export format
//! does not. Temporary key material is zeroized as soon as the cipher exists.

use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use argon2::{
    password_hash::{PasswordHasher, SaltString},
    Argon2, Algorithm, Params, Version,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use rand::rngs::OsRng;
use zeroize::Zeroize;

// Constants
const NONCE_LENGTH: usize = 12;
const NOTE_FORMAT_V2: &str = "v2";
const NOTE_FORMAT_V3: &str = "v3";
const NOTE_AAD_DOMAIN: &[u8] = b"moldavite-note-v2\0";

/// Argon2id parameters for the legacy `salt$nonce$ciphertext` format and V2
/// note locks. The KDF parameters are not recorded in the ciphertext, so
/// these must never change — doing so would silently break every ciphertext
/// written before V3.
///
/// Parameters chosen based on OWASP recommendations:
/// - Algorithm: Argon2id (resistant to side-channel and GPU attacks)
/// - Memory: 19456 KiB (~19 MiB) - balances security and performance
/// - Iterations: 3 - increases computational cost
/// - Parallelism: 1 - single thread for consistent timing
fn legacy_argon2() -> Argon2<'static> {
    let params = Params::new(
        19456,  // m_cost: 19 MiB memory
        3,      // t_cost: 3 iterations
        1,      // p_cost: 1 parallel lane
        Some(32) // output length: 32 bytes for AES-256
    ).expect("Invalid Argon2 parameters");

    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
}

/// Argon2id parameters for V3 note locks — the same iteration/parallelism
/// as the legacy parameters, with memory cost raised to 64 MiB. All new note
/// locks use these.
fn hardened_argon2_v3() -> Argon2<'static> {
    let params = Params::new(
        65536,  // m_cost: 64 MiB memory
        3,      // t_cost: 3 iterations
        1,      // p_cost: 1 parallel lane
        Some(32) // output length: 32 bytes for AES-256
    ).expect("Invalid Argon2 parameters");

    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
}

// Legacy format: salt$nonce$ciphertext (19 MiB Argon2 parameters).
// V2 note format: v2$salt$nonce$ciphertext, with note identity as AAD (19 MiB parameters).
// V3 note format: v3$salt$nonce$ciphertext, with note identity as AAD (64 MiB parameters).

fn cipher_from_password(
    password: &str,
    salt: &SaltString,
    argon2: &Argon2,
) -> Result<Aes256Gcm, String> {
    let password_hash = argon2
        .hash_password(password.as_bytes(), salt)
        .map_err(|e| format!("Failed to hash password: {}", e))?;
    let hash = password_hash.hash.ok_or("Failed to get hash bytes")?;
    let key_bytes = hash.as_bytes();
    if key_bytes.len() < 32 {
        return Err("Derived key too short".to_string());
    }
    let mut key_buffer = [0u8; 32];
    key_buffer.copy_from_slice(&key_bytes[..32]);
    let cipher = Aes256Gcm::new_from_slice(&key_buffer)
        .map_err(|e| {
            key_buffer.zeroize();
            format!("Failed to create cipher: {}", e)
        })?;
    key_buffer.zeroize();
    Ok(cipher)
}

fn encrypt_payload(
    content: &str,
    password: &str,
    aad: &[u8],
    version: Option<&str>,
    argon2: &Argon2,
) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    let cipher = cipher_from_password(password, &salt, argon2)?;

    let mut nonce_bytes = [0u8; NONCE_LENGTH];
    rand::Rng::fill(&mut OsRng, &mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(
            nonce,
            Payload {
                msg: content.as_bytes(),
                aad,
            },
        )
        .map_err(|e| {
            nonce_bytes.zeroize();
            format!("Encryption failed: {}", e)
        })?;
    let nonce_b64 = BASE64.encode(nonce_bytes);
    let ciphertext_b64 = BASE64.encode(ciphertext);
    nonce_bytes.zeroize();

    match version {
        Some(version) => Ok(format!(
            "{version}${}${nonce_b64}${ciphertext_b64}",
            salt.as_str()
        )),
        None => Ok(format!(
            "{}${nonce_b64}${ciphertext_b64}",
            salt.as_str()
        )),
    }
}

fn decrypt_payload(
    salt_str: &str,
    nonce_b64: &str,
    ciphertext_b64: &str,
    password: &str,
    aad: &[u8],
    argon2: &Argon2,
) -> Result<String, String> {
    let mut nonce_bytes = BASE64
        .decode(nonce_b64)
        .map_err(|e| format!("Failed to decode nonce: {}", e))?;
    let mut ciphertext = BASE64
        .decode(ciphertext_b64)
        .map_err(|e| format!("Failed to decode ciphertext: {}", e))?;

    let salt = SaltString::from_b64(salt_str)
        .map_err(|e| {
            nonce_bytes.zeroize();
            ciphertext.zeroize();
            format!("Failed to parse salt: {}", e)
        })?;

    let cipher = cipher_from_password(password, &salt, argon2).inspect_err(|_| {
        nonce_bytes.zeroize();
        ciphertext.zeroize();
    })?;

    if nonce_bytes.len() != NONCE_LENGTH {
        nonce_bytes.zeroize();
        ciphertext.zeroize();
        return Err("Invalid nonce length".to_string());
    }
    let nonce = Nonce::from_slice(&nonce_bytes);
    let mut plaintext = cipher
        .decrypt(
            nonce,
            Payload {
                msg: ciphertext.as_ref(),
                aad,
            },
        )
        .map_err(|_| {
            nonce_bytes.zeroize();
            ciphertext.zeroize();
            "Decryption failed - wrong password or corrupted data".to_string()
        })?;
    nonce_bytes.zeroize();
    ciphertext.zeroize();
    let result = String::from_utf8(plaintext.clone())
        .map_err(|e| {
            plaintext.zeroize();
            format!("Failed to convert decrypted content to string: {}", e)
        });
    plaintext.zeroize();
    result
}

/// Encrypt content into the legacy `salt$nonce$ciphertext` storage format
/// (19 MiB Argon2 parameters).
///
/// Encrypted backups depend on this stable format. New note locks use
/// [`encrypt_note_content`], which writes the hardened V3 format instead —
/// this format is not self-describing (no version prefix), so it is kept on
/// its original parameters rather than risking collision with the V2/V3
/// prefix namespace used by note locks (see `decrypt_note_content`'s legacy
/// fallback, which calls this function directly).
pub fn encrypt_content(content: &str, password: &str) -> Result<String, String> {
    encrypt_payload(content, password, &[], None, &legacy_argon2())
}

/// Decrypt the legacy `salt$nonce$ciphertext` storage format (19 MiB Argon2
/// parameters, matching how it was written).
pub fn decrypt_content(encrypted: &str, password: &str) -> Result<String, String> {
    let parts: Vec<&str> = encrypted.split('$').collect();
    if parts.len() != 3 {
        return Err("Invalid encrypted format".to_string());
    }
    decrypt_payload(parts[0], parts[1], parts[2], password, &[], &legacy_argon2())
}

fn note_aad(note_id: &str) -> Vec<u8> {
    let mut aad = Vec::with_capacity(NOTE_AAD_DOMAIN.len() + note_id.len());
    aad.extend_from_slice(NOTE_AAD_DOMAIN);
    aad.extend_from_slice(note_id.as_bytes());
    aad
}

/// Encrypt a note into the versioned V3 format (64 MiB Argon2 parameters)
/// with its stable identity as AAD.
pub fn encrypt_note_content(
    content: &str,
    password: &str,
    note_id: &str,
) -> Result<String, String> {
    encrypt_payload(
        content,
        password,
        &note_aad(note_id),
        Some(NOTE_FORMAT_V3),
        &hardened_argon2_v3(),
    )
}

/// Decrypt V3 or V2 note ciphertext with identity AAD (64 MiB and 19 MiB
/// Argon2 parameters respectively, matching how each was written), or fall
/// back to the pre-versioned legacy format.
pub fn decrypt_note_content(
    encrypted: &str,
    password: &str,
    note_id: &str,
) -> Result<String, String> {
    if let Some(versioned) = encrypted.strip_prefix(&format!("{NOTE_FORMAT_V3}$")) {
        let parts: Vec<&str> = versioned.split('$').collect();
        if parts.len() != 3 {
            return Err("Invalid encrypted format".to_string());
        }
        return decrypt_payload(
            parts[0],
            parts[1],
            parts[2],
            password,
            &note_aad(note_id),
            &hardened_argon2_v3(),
        );
    }
    let Some(versioned) = encrypted.strip_prefix(&format!("{NOTE_FORMAT_V2}$")) else {
        return decrypt_content(encrypted, password);
    };
    let parts: Vec<&str> = versioned.split('$').collect();
    if parts.len() != 3 {
        return Err("Invalid encrypted format".to_string());
    }
    decrypt_payload(
        parts[0],
        parts[1],
        parts[2],
        password,
        &note_aad(note_id),
        &legacy_argon2(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypt_decrypt() {
        let content = "Hello, this is a secret note!";
        let password = "my_secure_password";

        let encrypted = encrypt_content(content, password).unwrap();
        let decrypted = decrypt_content(&encrypted, password).unwrap();

        assert_eq!(content, decrypted);
    }

    #[test]
    fn test_wrong_password() {
        let content = "Secret content";
        let password = "correct_password";
        let wrong_password = "wrong_password";

        let encrypted = encrypt_content(content, password).unwrap();
        let result = decrypt_content(&encrypted, wrong_password);

        assert!(result.is_err());
    }

    #[test]
    fn security_regression_note_ciphertext_is_bound_to_note_identity() {
        let password = "shared password";
        let encrypted =
            encrypt_note_content("alpha secret", password, "standalone:alpha.md").unwrap();

        assert_eq!(
            decrypt_note_content(&encrypted, password, "standalone:alpha.md").unwrap(),
            "alpha secret"
        );
        assert!(decrypt_note_content(&encrypted, password, "standalone:beta.md").is_err());

        let legacy = encrypt_content("legacy secret", password).unwrap();
        assert_eq!(
            decrypt_note_content(&legacy, password, "standalone:any-name.md").unwrap(),
            "legacy secret"
        );
    }

    #[test]
    fn test_v3_round_trip() {
        let content = "V3 hardened note body";
        let password = "hardened password";
        let note_id = "standalone:v3-test.md";

        let encrypted = encrypt_note_content(content, password, note_id).unwrap();
        assert!(encrypted.starts_with("v3$"));

        let decrypted = decrypt_note_content(&encrypted, password, note_id).unwrap();
        assert_eq!(decrypted, content);
    }

    #[test]
    fn test_old_parameters_still_decrypt_through_the_public_entry_point() {
        // Simulate a note locked before the V3 upgrade: encrypt directly
        // through the pre-V3 (19 MiB) code path that V2 used, not through
        // the current (V3) `encrypt_note_content`.
        let content = "Pre-V3 note body";
        let password = "old password";
        let note_id = "standalone:legacy-v2.md";

        let old_encrypted = encrypt_payload(
            content,
            password,
            &note_aad(note_id),
            Some(NOTE_FORMAT_V2),
            &legacy_argon2(),
        )
        .unwrap();
        assert!(old_encrypted.starts_with("v2$"));

        let decrypted = decrypt_note_content(&old_encrypted, password, note_id).unwrap();
        assert_eq!(decrypted, content);
    }

    #[test]
    fn test_wrong_password_fails_for_both_v2_and_v3() {
        let content = "secret body";
        let note_id = "standalone:wrong-password.md";

        let v3 = encrypt_note_content(content, "right password", note_id).unwrap();
        assert!(decrypt_note_content(&v3, "wrong password", note_id).is_err());

        let v2 = encrypt_payload(
            content,
            "right password",
            &note_aad(note_id),
            Some(NOTE_FORMAT_V2),
            &legacy_argon2(),
        )
        .unwrap();
        assert!(decrypt_note_content(&v2, "wrong password", note_id).is_err());
    }

    #[test]
    fn test_relock_after_unlock_produces_v3() {
        // Start from a legacy (pre-V2, unversioned) locked note, "unlock" it
        // through the public entry point, then lock it again — the fresh
        // ciphertext must be V3, not the format it started as.
        let content = "will be relocked";
        let password = "relock password";
        let note_id = "standalone:relock.md";

        let legacy = encrypt_content(content, password).unwrap();
        let unlocked = decrypt_note_content(&legacy, password, note_id).unwrap();
        assert_eq!(unlocked, content);

        let relocked = encrypt_note_content(&unlocked, password, note_id).unwrap();
        assert!(relocked.starts_with("v3$"));
        assert_eq!(
            decrypt_note_content(&relocked, password, note_id).unwrap(),
            content
        );
    }
}
