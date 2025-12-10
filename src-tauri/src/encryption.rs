use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use argon2::{
    password_hash::{PasswordHasher, SaltString},
    Argon2,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use rand::rngs::OsRng;

// Constants
const NONCE_LENGTH: usize = 12;
const SALT_LENGTH: usize = 22; // SaltString uses 22 characters

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
pub fn encrypt_content(content: &str, password: &str) -> Result<String, String> {
    // Generate random salt for Argon2
    let salt = SaltString::generate(&mut OsRng);

    // Derive key from password using Argon2
    let argon2 = Argon2::default();
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

    // Create AES-256-GCM cipher
    let cipher = Aes256Gcm::new_from_slice(&key_bytes[..32])
        .map_err(|e| format!("Failed to create cipher: {}", e))?;

    // Generate random nonce
    let mut nonce_bytes = [0u8; NONCE_LENGTH];
    rand::Rng::fill(&mut OsRng, &mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    // Encrypt the content
    let ciphertext = cipher
        .encrypt(nonce, content.as_bytes())
        .map_err(|e| format!("Encryption failed: {}", e))?;

    // Encode components as base64
    let nonce_b64 = BASE64.encode(nonce_bytes);
    let ciphertext_b64 = BASE64.encode(ciphertext);

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
    let nonce_bytes = BASE64
        .decode(nonce_b64)
        .map_err(|e| format!("Failed to decode nonce: {}", e))?;
    let ciphertext = BASE64
        .decode(ciphertext_b64)
        .map_err(|e| format!("Failed to decode ciphertext: {}", e))?;

    // Reconstruct salt
    let salt = SaltString::from_b64(salt_str)
        .map_err(|e| format!("Failed to parse salt: {}", e))?;

    // Derive key from password using same Argon2 parameters
    let argon2 = Argon2::default();
    let password_hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| format!("Failed to hash password: {}", e))?;

    let hash = password_hash.hash.ok_or("Failed to get hash bytes")?;
    let key_bytes = hash.as_bytes();

    if key_bytes.len() < 32 {
        return Err("Derived key too short".to_string());
    }

    // Create cipher with derived key
    let cipher = Aes256Gcm::new_from_slice(&key_bytes[..32])
        .map_err(|e| format!("Failed to create cipher: {}", e))?;

    // Create nonce from bytes
    if nonce_bytes.len() != NONCE_LENGTH {
        return Err("Invalid nonce length".to_string());
    }
    let nonce = Nonce::from_slice(&nonce_bytes);

    // Decrypt the content
    let plaintext = cipher
        .decrypt(nonce, ciphertext.as_ref())
        .map_err(|_| "Decryption failed - wrong password or corrupted data".to_string())?;

    // Convert to string
    String::from_utf8(plaintext)
        .map_err(|e| format!("Failed to convert decrypted content to string: {}", e))
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
