// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ferlagod
// Mis Notas para Chromium — formato de los ficheros en Nextcloud (docs/SYNC_FORMAT.md, v2 y v3).
// Equivale a KeyInfo.kt, KeyInfoV3.kt y RemoteCodec.kt de las apps.
//
// Las funciones reciben un "llavero": { v3, current, keys: Map<kid, CryptoKey>, vmk?: CryptoKey }.
// Una bóveda v2 es un llavero con una sola clave ("v2").

import {
  KDF_ALGORITHM, MIN_ITERATIONS, MAX_ITERATIONS, MIN_SALT_BYTES,
  fromBase64, encryptText, decryptText, encryptBytes, importAesKey, argon2idBytes, passwordVariants
} from './crypto.js';

export const KEYINFO_FILE = 'keyinfo.json';
const CHECK_PLAINTEXT = 'misnotas-key-check-v1';
const CHECK_AAD = 'keyinfo';
const FORMAT = 'misnotas';
const VERSION = 2;
const VERSION_V3 = 3;
export const LEGACY_KID = 'v2';
/** El payload v3 se rellena hasta un múltiplo de este tamaño (como RemoteCodec.PAD_BLOCK). */
const PAD_BLOCK = 512;

export const noteFile = (id) => `note_${id}.json`;
export const folderFile = (id) => `folder_${id}.json`;
export const attachmentFile = (id) => `att_${id}.bin`;
export const attachmentRef = (id) => `attachment://${id}`;

const aad = (type, id) => `${type}:${id}`;

/**
 * Lee y valida keyinfo.json.
 * - v2: { version: 2, salt (Uint8Array), saltB64, iterations, check }
 * - v3: { version: 3, kdf, salt, password, keyring } (cifrado en sobre, ver KeyInfoV3.kt)
 */
export function parseKeyInfo(raw) {
  const json = JSON.parse(raw);
  if (json.format !== 'misnotas-keyinfo') throw new Error('keyinfo-invalid');
  if ((json.version ?? 1) >= VERSION_V3) {
    if (json.version !== VERSION_V3) throw new Error('newer-version');
    const kdf = json.kdf || {};
    if (kdf.name !== 'argon2id') throw new Error('keyinfo-kdf');
    const salt = fromBase64(kdf.salt);
    if (salt.length < MIN_SALT_BYTES) throw new Error('keyinfo-salt');
    const params = { memoryKiB: Number(kdf.memoryKiB), iterations: Number(kdf.iterations), parallelism: Number(kdf.parallelism) };
    if (!(params.memoryKiB >= 8192 && params.memoryKiB <= 1048576 && params.iterations >= 1 && params.iterations <= 20 &&
      params.parallelism >= 1 && params.parallelism <= 16)) throw new Error('keyinfo-kdf');
    if (typeof json.password !== 'string' || typeof json.keyring !== 'string') throw new Error('keyinfo-invalid');
    return { version: VERSION_V3, kdf: params, salt, password: json.password, keyring: json.keyring };
  }
  if ((json.kdf ?? KDF_ALGORITHM) !== KDF_ALGORITHM) throw new Error('keyinfo-kdf');
  const salt = fromBase64(json.salt);
  const iterations = Number(json.iterations);
  if (salt.length < MIN_SALT_BYTES) throw new Error('keyinfo-salt');
  if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
    throw new Error('keyinfo-iterations');
  }
  if (typeof json.check !== 'string' || !json.check.trim()) throw new Error('keyinfo-check');
  return { version: VERSION, salt, saltB64: json.salt, iterations, check: json.check };
}

/**
 * Bóveda v3: contraseña → Argon2id → VMK → llavero. Devuelve { current, vmk (bytes),
 * keys: { kid: bytes } } o null si la contraseña no es la correcta.
 */
export async function openVaultV3(info, password) {
  for (const variant of passwordVariants(password)) {
    const kekBytes = await argon2idBytes(variant, info.salt, info.kdf);
    const kek = await importAesKey(kekBytes);
    let vmkB64;
    try {
      vmkB64 = await decryptText(info.password, kek, 'vmk:password');
    } catch {
      continue;
    }
    const vmk = fromBase64(vmkB64);
    return { vmk, ...(await openKeyring(info, await importAesKey(vmk))) };
  }
  return null;
}

/** Descifra el llavero de keyinfo.json v3 con la VMK. Devuelve { current, keys: { kid: bytes } }. */
export async function openKeyring(info, vmkKey) {
  const ring = JSON.parse(await decryptText(info.keyring, vmkKey, 'keyring'));
  const keys = {};
  for (const [kid, b64] of Object.entries(ring.keys)) keys[kid] = fromBase64(b64);
  if (!keys[ring.current]) throw new Error('keyring-invalid');
  return { current: ring.current, keys };
}

/** JSON con un campo "pad" de espacios para que ocupe un múltiplo de PAD_BLOCK bytes. */
export function padded(payload) {
  const enc = new TextEncoder();
  const { pad, ...rest } = payload;
  const base = enc.encode(JSON.stringify(rest)).length;
  const overhead = 9; // ,"pad":""
  const target = Math.ceil((base + overhead) / PAD_BLOCK) * PAD_BLOCK;
  return JSON.stringify({ ...rest, pad: ' '.repeat(target - base - overhead) });
}

/** Cifra un payload en el formato de la bóveda (v2, o v3 con kid, rev y relleno). */
async function seal(type, id, payload, ring) {
  if (!ring.v3) {
    const env = envelope(type, id);
    env.payload = await encryptText(JSON.stringify(payload), ring.keys.get(ring.current), aad(type, id));
    return JSON.stringify(env);
  }
  // La extensión solo crea ficheros nuevos: rev 1.
  const env = { format: FORMAT, version: VERSION_V3, type, id, kid: ring.current };
  env.payload = await encryptText(padded({ ...payload, rev: 1 }), ring.keys.get(ring.current), aad(type, id));
  return JSON.stringify(env);
}

/** Clave para un fichero: la de su "kid" (v3) o la de la bóveda v2. */
function keyFor(json, ring) {
  if ((json.version ?? 0) >= VERSION_V3) {
    const key = ring.keys.get(json.kid);
    if (!key) throw new Error('unknown-kid');
    return key;
  }
  return ring.keys.get(LEGACY_KID) || ring.keys.get(ring.current);
}

/** true si la clave descifra el verificador de keyinfo.json (la contraseña es correcta). */
export async function verifyKey(keyInfo, key) {
  if (keyInfo.version === VERSION_V3) return false;
  try {
    return (await decryptText(keyInfo.check, key, CHECK_AAD)) === CHECK_PLAINTEXT;
  } catch {
    return false;
  }
}

function envelope(type, id) {
  return { format: FORMAT, version: VERSION, type, id };
}

/**
 * Cifra una nota nueva. Mismos campos que RemoteCodec.encodeNote.
 * @param {{id:string, folderId:?string, title:string, content:string, color?:string, isPinned?:boolean, updatedAt?:number}} note
 */
export async function encodeNote(note, key) {
  const payload = {
    folderId: note.folderId || null,
    title: note.title,
    content: note.content,
    isPinned: Boolean(note.isPinned),
    color: note.color || 'DEFAULT',
    updatedAt: note.updatedAt ?? Date.now(),
    isTrashed: false
  };
  return seal('note', note.id, payload, key);
}

/** Cifra una carpeta nueva. Mismos campos que RemoteCodec.encodeFolder. */
export async function encodeFolder(folder, key) {
  const payload = {
    parentId: folder.parentId || null,
    name: folder.name,
    color: folder.color || 'DEFAULT',
    updatedAt: folder.updatedAt ?? Date.now()
  };
  return seal('folder', folder.id, payload, key);
}

/**
 * Descifra un fichero de carpeta. Devuelve { id, parentId, name, color } o null si es una lápida.
 * Lanza si el fichero no es válido o no se descifra con la clave.
 */
export async function decodeFolder(raw, expectedId, ring) {
  const json = JSON.parse(raw);
  if (!('format' in json)) {
    // Formato v1.0: nombre cifrado por separado y sin AAD.
    return {
      id: json.id,
      parentId: json.parentId || null,
      name: await decryptText(json.name, keyFor(json, ring)),
      color: json.color || 'DEFAULT'
    };
  }
  if (json.format !== FORMAT || json.type !== 'folder') throw new Error('bad-envelope');
  if ((json.version ?? 0) > VERSION_V3) throw new Error('newer-version');
  if (json.id !== expectedId) throw new Error('id-mismatch');
  if (json.deleted === true) return null;
  const payload = JSON.parse(await decryptText(json.payload, keyFor(json, ring), aad('folder', json.id)));
  if (payload.deleted === true) return null; // lápida v3 (cifrada)
  return {
    id: json.id,
    parentId: payload.parentId || null,
    name: payload.name || '',
    color: payload.color || 'DEFAULT'
  };
}

/** Cifra los bytes de un adjunto (imagen) con AAD attachment:<id>. */
export function encryptAttachment(bytes, id, ring) {
  return encryptBytes(bytes, ring.keys.get(ring.current), aad('attachment', id));
}
