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
 * Guarda la clave. Si remember es true, como CryptoKey no exportable en IndexedDB (sus bytes
 * no se pueden leer); si no, en chrome.storage.session, que vive solo en memoria.
 */
export async function setKey(rawBytes, remember) {
  await clearKey();
  if (remember) {
    const key = await importAesKey(rawBytes, false);
    await tx('keys', 'readwrite', (s) => s.put(key, 'vault'));
  } else {
    await chrome.storage.session.set({ vaultKey: toBase64(rawBytes) });
  }
}

/** La clave de cifrado, o null si no está desbloqueada. */
export async function getKey() {
  const stored = await tx('keys', 'readonly', (s) => asPromise(s.get('vault')));
  if (stored) return stored;
  const { vaultKey } = await chrome.storage.session.get('vaultKey');
  return vaultKey ? importAesKey(fromBase64(vaultKey), false) : null;
}

export async function clearKey() {
  await tx('keys', 'readwrite', (s) => s.delete('vault'));
  await chrome.storage.session.remove('vaultKey');
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
