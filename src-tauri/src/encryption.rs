use aes_gcm::{
    aead::{Aead, KeyInit},
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

#[allow(dead_code)]
const SALT_LENGTH: usize = 22; // SaltString uses 22 characters

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

/// Encrypted note format:
/// [22 bytes salt (base64)][12 bytes nonce (base64)][encrypted content (base64)]
/// Stored as: salt$nonce$ciphertext

/// Encrypts content using AES-256-GCM with Argon2 key derivation.
///
/// # Arguments
/// * `content` - The plaintext content to encrypt
/// * `password` - The password to derive the encryption key from
///
/// # Returns
/// A formatted string containing salt, nonce, and ciphertext (base64 encoded)
///
/// # Security
/// Sensitive key material is zeroized after use to minimize exposure in memory.
pub fn encrypt_content(content: &str, password: &str) -> Result<String, String> {
    // Generate random salt for Argon2
    let salt = SaltString::generate(&mut OsRng);

    // Derive key from password using Argon2
    let argon2 = create_hardened_argon2();
    let password_hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| format!("Failed to hash password: {}", e))?;

    // Extract 32-byte key from the hash
    let hash = password_hash.hash.ok_or("Failed to get hash bytes")?;
    let key_bytes = hash.as_bytes();

    // Ensure we have at least 32 bytes for the key
    if key_bytes.len() < 32 {
        return Err("Derived key too short".to_string());
    }

    // Copy key to a mutable buffer that we can zeroize
    let mut key_buffer = [0u8; 32];
    key_buffer.copy_from_slice(&key_bytes[..32]);

    // Create AES-256-GCM cipher
    let cipher = Aes256Gcm::new_from_slice(&key_buffer)
        .map_err(|e| {
            key_buffer.zeroize();
            format!("Failed to create cipher: {}", e)
        })?;

    // Zeroize key buffer immediately after cipher creation
    key_buffer.zeroize();

    // Generate random nonce
    let mut nonce_bytes = [0u8; NONCE_LENGTH];
    rand::Rng::fill(&mut OsRng, &mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    // Encrypt the content
    let ciphertext = cipher
        .encrypt(nonce, content.as_bytes())
        .map_err(|e| {
            nonce_bytes.zeroize();
            format!("Encryption failed: {}", e)
        })?;

    // Encode components as base64
    let nonce_b64 = BASE64.encode(nonce_bytes);
    let ciphertext_b64 = BASE64.encode(ciphertext);

    // Zeroize nonce after encoding
    nonce_bytes.zeroize();

    // Return formatted string: salt$nonce$ciphertext
    Ok(format!("{}${}${}", salt.as_str(), nonce_b64, ciphertext_b64))
}

/// Decrypts content that was encrypted with `encrypt_content`.
///
/// # Arguments
/// * `encrypted` - The encrypted string (salt$nonce$ciphertext format)
/// * `password` - The password to derive the decryption key from
///
/// # Returns
/// The decrypted plaintext content
///
/// # Security
/// Sensitive key material is zeroized after use to minimize exposure in memory.
pub fn decrypt_content(encrypted: &str, password: &str) -> Result<String, String> {
    // Parse the encrypted string
    let parts: Vec<&str> = encrypted.split('$').collect();
    if parts.len() != 3 {
        return Err("Invalid encrypted format".to_string());
    }

    let salt_str = parts[0];
    let nonce_b64 = parts[1];
    let ciphertext_b64 = parts[2];

    // Decode base64 components
    let mut nonce_bytes = BASE64
        .decode(nonce_b64)
        .map_err(|e| format!("Failed to decode nonce: {}", e))?;
    let mut ciphertext = BASE64
        .decode(ciphertext_b64)
        .map_err(|e| format!("Failed to decode ciphertext: {}", e))?;

    // Reconstruct salt
    let salt = SaltString::from_b64(salt_str)
        .map_err(|e| {
            nonce_bytes.zeroize();
            ciphertext.zeroize();
            format!("Failed to parse salt: {}", e)
        })?;

    // Derive key from password using same Argon2 parameters
    let argon2 = create_hardened_argon2();
    let password_hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| {
            nonce_bytes.zeroize();
            ciphertext.zeroize();
            format!("Failed to hash password: {}", e)
        })?;

    let hash = password_hash.hash.ok_or_else(|| {
        nonce_bytes.zeroize();
        ciphertext.zeroize();
        "Failed to get hash bytes".to_string()
    })?;
    let key_bytes = hash.as_bytes();

    if key_bytes.len() < 32 {
        nonce_bytes.zeroize();
        ciphertext.zeroize();
        return Err("Derived key too short".to_string());
    }

    // Copy key to a mutable buffer that we can zeroize
    let mut key_buffer = [0u8; 32];
    key_buffer.copy_from_slice(&key_bytes[..32]);

    // Create cipher with derived key
    let cipher = Aes256Gcm::new_from_slice(&key_buffer)
        .map_err(|e| {
            key_buffer.zeroize();
            nonce_bytes.zeroize();
            ciphertext.zeroize();
            format!("Failed to create cipher: {}", e)
        })?;

    // Zeroize key buffer immediately after cipher creation
    key_buffer.zeroize();

    // Create nonce from bytes
    if nonce_bytes.len() != NONCE_LENGTH {
        nonce_bytes.zeroize();
        ciphertext.zeroize();
        return Err("Invalid nonce length".to_string());
    }
    let nonce = Nonce::from_slice(&nonce_bytes);

    // Decrypt the content
    let mut plaintext = cipher
        .decrypt(nonce, ciphertext.as_ref())
        .map_err(|_| {
            nonce_bytes.zeroize();
            ciphertext.zeroize();
            "Decryption failed - wrong password or corrupted data".to_string()
        })?;

    // Zeroize intermediate buffers
    nonce_bytes.zeroize();
    ciphertext.zeroize();

    // Convert to string
    let result = String::from_utf8(plaintext.clone())
        .map_err(|e| {
            plaintext.zeroize();
            format!("Failed to convert decrypted content to string: {}", e)
        });

    // Zeroize plaintext bytes
    plaintext.zeroize();

    result
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
}
