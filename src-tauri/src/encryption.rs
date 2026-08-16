//! Password-based encryption and decryption for locked note bodies.
//!
//! New ciphertexts use Argon2id (19 MiB, three iterations, one lane) to derive
//! an AES-256 key and AES-GCM for authenticated encryption. Each encryption
//! gets a fresh random salt and 96-bit nonce. Legacy payloads retain the
//! `salt$nonce$ciphertext` format; V2 note locks add a version prefix and bind
//! the stable note identity as AES-GCM AAD. Temporary key material is zeroized
//! as soon as the cipher exists.

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
const NOTE_AAD_DOMAIN: &[u8] = b"moldavite-note-v2\0";

/// Creates Argon2 with hardened parameters for password-based encryption.
///
/// Parameters chosen based on OWASP recommendations:
/// - Algorithm: Argon2id (resistant to side-channel and GPU attacks)
/// - Memory: 19456 KiB (~19 MiB) - balances security and performance
/// - Iterations: 3 - increases computational cost
/// - Parallelism: 1 - single thread for consistent timing
fn create_hardened_argon2() -> Argon2<'static> {
    // Use explicit hardened parameters instead of defaults
    let params = Params::new(
        19456,  // m_cost: 19 MiB memory
        3,      // t_cost: 3 iterations
        1,      // p_cost: 1 parallel lane
        Some(32) // output length: 32 bytes for AES-256
    ).expect("Invalid Argon2 parameters");

    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
}

// Legacy format: salt$nonce$ciphertext
// V2 note format: v2$salt$nonce$ciphertext, with note identity as AAD.

fn cipher_from_password(password: &str, salt: &SaltString) -> Result<Aes256Gcm, String> {
    let argon2 = create_hardened_argon2();
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
) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    let cipher = cipher_from_password(password, &salt)?;

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

    let cipher = cipher_from_password(password, &salt).inspect_err(|_| {
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

/// Encrypt content into the legacy `salt$nonce$ciphertext` storage format.
///
/// Encrypted backups depend on this stable format. New note locks use
/// [`encrypt_note_content`] so their identity is authenticated as AAD.
pub fn encrypt_content(content: &str, password: &str) -> Result<String, String> {
    encrypt_payload(content, password, &[], None)
}

/// Decrypt the legacy `salt$nonce$ciphertext` storage format.
pub fn decrypt_content(encrypted: &str, password: &str) -> Result<String, String> {
    let parts: Vec<&str> = encrypted.split('$').collect();
    if parts.len() != 3 {
        return Err("Invalid encrypted format".to_string());
    }
    decrypt_payload(parts[0], parts[1], parts[2], password, &[])
}

fn note_aad(note_id: &str) -> Vec<u8> {
    let mut aad = Vec::with_capacity(NOTE_AAD_DOMAIN.len() + note_id.len());
    aad.extend_from_slice(NOTE_AAD_DOMAIN);
    aad.extend_from_slice(note_id.as_bytes());
    aad
}

/// Encrypt a note into the versioned V2 format with its stable identity as AAD.
pub fn encrypt_note_content(
    content: &str,
    password: &str,
    note_id: &str,
) -> Result<String, String> {
    encrypt_payload(
        content,
        password,
        &note_aad(note_id),
        Some(NOTE_FORMAT_V2),
    )
}

/// Decrypt V2 note ciphertext with identity AAD, or fall back to the V1 format.
pub fn decrypt_note_content(
    encrypted: &str,
    password: &str,
    note_id: &str,
) -> Result<String, String> {
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
}
