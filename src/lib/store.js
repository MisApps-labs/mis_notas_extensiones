// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ferlagod
// Mis Notas para Chromium — ajustes, clave de cifrado y cola de subidas pendientes.

import { importAesKey, toBase64, fromBase64 } from './crypto.js';

export const DEFAULT_PREFS = {
  /** Carpeta por defecto (null = sin carpeta). */
  defaultFolderId: null,
  /** Última carpeta elegida en la ventana; se propone la próxima vez. */
  lastFolderId: undefined,
  /** Descargar las imágenes y guardarlas como adjuntos cifrados (si no, quedan como enlaces). */
  saveImages: true,
  /** Máximo de imágenes que se copian por nota. */
  maxImages: 20,
  /** Añadir al final la fuente (título y dirección de la página). */
  addSource: true,
  /** En las recetas, los ingredientes como lista de tareas (para tachar al comprar). */
  ingredientsAsTasks: true,
  /** Guardar la clave en este navegador; si es false se olvida al cerrarlo. */
  rememberKey: true
};

// ------------------------------------------------------------------
// chrome.storage.local
// ------------------------------------------------------------------

export async function getAccount() {
  return (await chrome.storage.local.get('account')).account || null;
}

export function setAccount(account) {
  return chrome.storage.local.set({ account });
}

export async function getVault() {
  return (await chrome.storage.local.get('vault')).vault || null;
}

export function setVault(vault) {
  return chrome.storage.local.set({ vault });
}

export async function getPrefs() {
  const { prefs } = await chrome.storage.local.get('prefs');
  return { ...DEFAULT_PREFS, ...(prefs || {}) };
}

export async function setPrefs(patch) {
  const prefs = { ...(await getPrefs()), ...patch };
  await chrome.storage.local.set({ prefs });
  return prefs;
}

export async function getFolderCache() {
  return (await chrome.storage.local.get('folders')).folders || { list: [], etags: {}, fetchedAt: 0 };
}

export function setFolderCache(folders) {
  return chrome.storage.local.set({ folders });
}

/** Borra la cuenta, la clave, la caché de carpetas y la cola (los ajustes de guardado se conservan). */
export async function clearAccount() {
  await chrome.storage.local.remove(['account', 'vault', 'folders']);
  await clearKey();
  await clearQueue();
}

// ------------------------------------------------------------------
// IndexedDB: clave no exportable y cola
// ------------------------------------------------------------------

let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('misnotas', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('keys')) db.createObjectStore('keys');
        if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { dbPromise = null; reject(req.error); };
    });
  }
  return dbPromise;
}

async function tx(storeName, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const store = t.objectStore(storeName);
    let result;
    Promise.resolve(fn(store)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const asPromise = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

/**
 * Guarda las claves desbloqueadas. [ring] = { v3, current, keys: { kid: bytes }, vmk?: bytes }.
 * Si remember es true, como CryptoKey no exportables en IndexedDB (sus bytes no se pueden
 * leer); si no, en chrome.storage.session, que vive solo en memoria.
 */
export async function setKey(ring, remember) {
  await clearKey();
  if (remember) {
    const keys = {};
    for (const [kid, bytes] of Object.entries(ring.keys)) keys[kid] = await importAesKey(bytes, false);
    const vmk = ring.vmk ? await importAesKey(ring.vmk, false) : null;
    await tx('keys', 'readwrite', (s) => s.put({ v3: Boolean(ring.v3), current: ring.current, keys, vmk }, 'ring'));
  } else {
    const keys = {};
    for (const [kid, bytes] of Object.entries(ring.keys)) keys[kid] = toBase64(bytes);
    await chrome.storage.session.set({
      vaultRing: { v3: Boolean(ring.v3), current: ring.current, keys, vmk: ring.vmk ? toBase64(ring.vmk) : null }
    });
  }
}

/** ¿Se guardaron las claves en IndexedDB ("recordar") o solo en la sesión? */
export async function keyRemembered() {
  return Boolean(await tx('keys', 'readonly', (s) => asPromise(s.get('ring'))) ||
    await tx('keys', 'readonly', (s) => asPromise(s.get('vault'))));
}

/**
 * El llavero desbloqueado { v3, current, keys: Map<kid, CryptoKey>, vmk: CryptoKey|null }, o null.
 * Entiende también la clave suelta que guardaban las versiones 1.0 (bóveda v2).
 */
export async function getKey() {
  const stored = await tx('keys', 'readonly', (s) => asPromise(s.get('ring')));
  if (stored) return { v3: stored.v3, current: stored.current, keys: new Map(Object.entries(stored.keys)), vmk: stored.vmk };
  const legacy = await tx('keys', 'readonly', (s) => asPromise(s.get('vault')));
  if (legacy) return { v3: false, current: 'v2', keys: new Map([['v2', legacy]]), vmk: null };
  const { vaultRing, vaultKey } = await chrome.storage.session.get(['vaultRing', 'vaultKey']);
  if (vaultRing) {
    const keys = new Map();
    for (const [kid, b64] of Object.entries(vaultRing.keys)) keys.set(kid, await importAesKey(fromBase64(b64), false));
    return { v3: vaultRing.v3, current: vaultRing.current, keys, vmk: vaultRing.vmk ? await importAesKey(fromBase64(vaultRing.vmk), false) : null };
  }
  if (vaultKey) return { v3: false, current: 'v2', keys: new Map([['v2', await importAesKey(fromBase64(vaultKey), false)]]), vmk: null };
  return null;
}

/**
 * Otro dispositivo rotó la clave: guarda el llavero nuevo ([opened] = { current, keys: { kid: bytes } })
 * conservando la VMK que ya había (no cambia al rotar).
 */
export async function updateRing(opened, remember) {
  if (remember) {
    const stored = await tx('keys', 'readonly', (s) => asPromise(s.get('ring')));
    if (!stored) return;
    const keys = {};
    for (const [kid, bytes] of Object.entries(opened.keys)) keys[kid] = await importAesKey(bytes, false);
    await tx('keys', 'readwrite', (s) => s.put({ ...stored, current: opened.current, keys }, 'ring'));
  } else {
    const { vaultRing } = await chrome.storage.session.get('vaultRing');
    if (!vaultRing) return;
    const keys = {};
    for (const [kid, bytes] of Object.entries(opened.keys)) keys[kid] = toBase64(bytes);
    await chrome.storage.session.set({ vaultRing: { ...vaultRing, current: opened.current, keys } });
  }
}

export async function clearKey() {
  await tx('keys', 'readwrite', (s) => { s.delete('vault'); s.delete('ring'); });
  await chrome.storage.session.remove(['vaultKey', 'vaultRing']);
}

/**
 * Elemento de la cola: { id, kind: 'note'|'folder', label, createdAt, attempts, lastError,
 *   files: [{ name, data: string|Uint8Array, contentType }] } — ya cifrados.
 */
export function enqueue(item) {
  return tx('queue', 'readwrite', (s) => s.put(item));
}

export function getQueue() {
  return tx('queue', 'readonly', (s) => asPromise(s.getAll()))
    .then((items) => items.sort((a, b) => a.createdAt - b.createdAt));
}

export function removeFromQueue(id) {
  return tx('queue', 'readwrite', (s) => s.delete(id));
}

export function clearQueue() {
  return tx('queue', 'readwrite', (s) => s.clear());
}
