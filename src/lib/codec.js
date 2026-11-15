// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ferlagod
// Mis Notas para Chromium — formato de los ficheros en Nextcloud (docs/SYNC_FORMAT.md, v2).
// Equivale a KeyInfo.kt y RemoteCodec.kt de las apps.

import {
  KDF_ALGORITHM, MIN_ITERATIONS, MAX_ITERATIONS, MIN_SALT_BYTES,
  fromBase64, encryptText, decryptText, encryptBytes
} from './crypto.js';

export const KEYINFO_FILE = 'keyinfo.json';
const CHECK_PLAINTEXT = 'misnotas-key-check-v1';
const CHECK_AAD = 'keyinfo';
const FORMAT = 'misnotas';
const VERSION = 2;

export const noteFile = (id) => `note_${id}.json`;
export const folderFile = (id) => `folder_${id}.json`;
export const attachmentFile = (id) => `att_${id}.bin`;
export const attachmentRef = (id) => `attachment://${id}`;

const aad = (type, id) => `${type}:${id}`;

/** Lee y valida keyinfo.json. Devuelve { salt (Uint8Array), saltB64, iterations, check }. */
export function parseKeyInfo(raw) {
  const json = JSON.parse(raw);
  if (json.format !== 'misnotas-keyinfo') throw new Error('keyinfo-invalid');
  if ((json.kdf ?? KDF_ALGORITHM) !== KDF_ALGORITHM) throw new Error('keyinfo-kdf');
  const salt = fromBase64(json.salt);
  const iterations = Number(json.iterations);
  if (salt.length < MIN_SALT_BYTES) throw new Error('keyinfo-salt');
  if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
    throw new Error('keyinfo-iterations');
  }
  if (typeof json.check !== 'string' || !json.check.trim()) throw new Error('keyinfo-check');
  return { salt, saltB64: json.salt, iterations, check: json.check };
}

/** true si la clave descifra el verificador de keyinfo.json (la contraseña es correcta). */
export async function verifyKey(keyInfo, key) {
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
  const env = envelope('note', note.id);
  env.payload = await encryptText(JSON.stringify(payload), key, aad('note', note.id));
  return JSON.stringify(env);
}

/** Cifra una carpeta nueva. Mismos campos que RemoteCodec.encodeFolder. */
export async function encodeFolder(folder, key) {
  const payload = {
    parentId: folder.parentId || null,
    name: folder.name,
    color: folder.color || 'DEFAULT',
    updatedAt: folder.updatedAt ?? Date.now()
  };
  const env = envelope('folder', folder.id);
  env.payload = await encryptText(JSON.stringify(payload), key, aad('folder', folder.id));
  return JSON.stringify(env);
}

/**
 * Descifra un fichero de carpeta. Devuelve { id, parentId, name, color } o null si es una lápida.
 * Lanza si el fichero no es válido o no se descifra con la clave.
 */
export async function decodeFolder(raw, expectedId, key) {
  const json = JSON.parse(raw);
  if (!('format' in json)) {
    // Formato v1.0: nombre cifrado por separado y sin AAD.
    return {
      id: json.id,
      parentId: json.parentId || null,
      name: await decryptText(json.name, key),
      color: json.color || 'DEFAULT'
    };
  }
  if (json.format !== FORMAT || json.type !== 'folder') throw new Error('bad-envelope');
  if ((json.version ?? 0) > VERSION) throw new Error('newer-version');
  if (json.id !== expectedId) throw new Error('id-mismatch');
  if (json.deleted === true) return null;
  const payload = JSON.parse(await decryptText(json.payload, key, aad('folder', json.id)));
  return {
    id: json.id,
    parentId: payload.parentId || null,
    name: payload.name || '',
    color: payload.color || 'DEFAULT'
  };
}

/** Cifra los bytes de un adjunto (imagen) con AAD attachment:<id>. */
export function encryptAttachment(bytes, id, key) {
  return encryptBytes(bytes, key, aad('attachment', id));
}
