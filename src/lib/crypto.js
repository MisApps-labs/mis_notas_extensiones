// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ferlagod
// Mis Notas para Chromium — cifrado compatible con las apps de Android y escritorio.
//
// Equivale a CryptoManager.kt:
//  - Clave: PBKDF2-HMAC-SHA256(contraseña UTF-8, salt, iteraciones, 256 bits).
//  - Cifrado: AES-256-GCM, IV aleatorio de 12 bytes, etiqueta de 16 bytes.
//  - Bloque: IV ‖ texto cifrado ‖ etiqueta; en texto, Base64 estándar.
//  - AAD opcional en UTF-8 ("<tipo>:<id>").

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const KDF_ALGORITHM = 'PBKDF2WithHmacSHA256';
export const MIN_ITERATIONS = 10_000;
export const MAX_ITERATIONS = 10_000_000;
export const MIN_SALT_BYTES = 8;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Bytes → Base64 estándar (con relleno), como java.util.Base64. */
export function toBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Base64 estándar → bytes. */
export function fromBase64(text) {
  const binary = atob(text.trim());
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Formas equivalentes de una contraseña (NFC, NFD y sin espacios en los extremos), igual que
 * CryptoManager.passwordVariants: un mismo teclado puede escribir "ñ" de dos maneras.
 */
export function passwordVariants(password) {
  const javaTrim = (s) => s.replace(/^[\u0000- ]+|[\u0000- ]+$/g, '');
  const nfc = password.normalize('NFC');
  const nfd = password.normalize('NFD');
  const all = [password, nfc, nfd, javaTrim(password), javaTrim(nfc), javaTrim(nfd)];
  return [...new Set(all.filter((p) => p.length > 0))];
}

/** Deriva los 32 bytes de la clave AES a partir de la contraseña maestra. */
export async function deriveKeyBytes(password, salt, iterations) {
  if (!password) throw new Error('empty-password');
  if (!(iterations >= MIN_ITERATIONS && iterations <= MAX_ITERATIONS)) throw new Error('bad-iterations');
  const base = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, 256);
  return new Uint8Array(bits);
}

/** Importa una clave AES-GCM. Por defecto no exportable: el navegador no deja leer sus bytes. */
export function importAesKey(rawBytes, extractable = false) {
  return crypto.subtle.importKey('raw', rawBytes, { name: 'AES-GCM' }, extractable, ['encrypt', 'decrypt']);
}

function gcmParams(iv, aad) {
  const params = { name: 'AES-GCM', iv, tagLength: TAG_BYTES * 8 };
  if (aad != null) params.additionalData = encoder.encode(aad);
  return params;
}

/** Cifra bytes y devuelve IV ‖ cifrado ‖ etiqueta. */
export async function encryptBytes(plain, key, aad = null) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const cipher = new Uint8Array(await crypto.subtle.encrypt(gcmParams(iv, aad), key, plain));
  const out = new Uint8Array(IV_BYTES + cipher.length);
  out.set(iv, 0);
  out.set(cipher, IV_BYTES);
  return out;
}

/** Descifra un bloque IV ‖ cifrado ‖ etiqueta. Lanza si la clave o el AAD no coinciden. */
export async function decryptBytes(combined, key, aad = null) {
  if (combined.length < IV_BYTES + TAG_BYTES) throw new Error('payload-too-short');
  const iv = combined.subarray(0, IV_BYTES);
  const cipher = combined.subarray(IV_BYTES);
  return new Uint8Array(await crypto.subtle.decrypt(gcmParams(iv, aad), key, cipher));
}

/** Cifra texto UTF-8 y devuelve Base64. */
export async function encryptText(plainText, key, aad = null) {
  return toBase64(await encryptBytes(encoder.encode(plainText), key, aad));
}

/** Descifra el Base64 producido por encryptText (o por la app). */
export async function decryptText(cipherText, key, aad = null) {
  return decoder.decode(await decryptBytes(fromBase64(cipherText), key, aad));
}
