// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ferlagod
// Mis Notas para Chromium — guardar notas y carpetas en Nextcloud.
//
// La extensión solo crea ficheros nuevos (If-None-Match: *), así que nunca pisa cambios de las
// apps ni necesita fusionar. Lo que no se puede subir se guarda ya cifrado en una cola y se
// reintenta más tarde.

import { WebDavClient, WebDavError } from './webdav.js';
import {
  KEYINFO_FILE, parseKeyInfo, verifyKey, openKeyring, encodeNote, encodeFolder, decodeFolder,
  noteFile, folderFile
} from './codec.js';
import { embedImages } from './images.js';
import {
  getAccount, getVault, setVault, getPrefs, getKey, clearKey, keyRemembered, updateRing,
  getFolderCache, setFolderCache, enqueue, getQueue, removeFromQueue
} from './store.js';

/** Error con un código que la interfaz traduce (ver _locales: err_<código>). */
export class AppError extends Error {
  constructor(code, detail = '') {
    super(code + (detail ? `: ${detail}` : ''));
    this.code = code;
  }
}

/** Traduce los errores de red y WebDAV a códigos de la interfaz. */
export function errorCode(e) {
  if (e instanceof AppError) return e.code;
  if (e instanceof WebDavError) {
    if (e.reason === 'auth') return 'auth';
    if (e.reason === 'network') return 'network';
    return 'server';
  }
  return 'unknown';
}

async function client() {
  const account = await getAccount();
  if (!account) throw new AppError('not_configured');
  return new WebDavClient(account.rootUrl, account.loginName, account.appPassword);
}

async function requireKey() {
  const key = await getKey();
  if (!key) throw new AppError('locked');
  return key;
}

/**
 * Regla 1 del formato: antes de escribir, comprobar que keyinfo.json sigue siendo el mismo.
 * Si la contraseña maestra se cambió desde otro dispositivo, la clave guardada ya no vale.
 */
async function checkVault(dav, ring) {
  const raw = await dav.getTextOrNull(KEYINFO_FILE);
  if (raw === null) {
    if (!(await dav.rootExists())) throw new AppError('root_missing');
    throw new AppError('vault_missing');
  }
  const info = parseKeyInfo(raw);
  const cached = await getVault();
  if (info.version >= 3) {
    // Bóveda actualizada a v3 desde el móvil: sin la VMK hay que volver a escribir la contraseña.
    if (!ring.v3 || !ring.vmk) {
      await clearKey();
      throw new AppError('vault_changed');
    }
    if (cached && cached.v3 && cached.keyring === info.keyring && cached.password === info.password) return;
    let opened;
    try {
      opened = await openKeyring(info, ring.vmk);
    } catch {
      await clearKey();
      throw new AppError('vault_changed');
    }
    // Un llavero con menos claves que el conocido sería una vuelta atrás.
    for (const kid of ring.keys.keys()) if (!(kid in opened.keys)) throw new AppError('vault_changed');
    if (opened.current !== ring.current || Object.keys(opened.keys).length !== ring.keys.size) {
      // Otro dispositivo rotó la clave: se guardan las nuevas (la VMK no cambia).
      await updateRing(opened, await keyRemembered());
    }
    await setVault({ v3: true, keyring: info.keyring, password: info.password });
    return;
  }
  if (ring.v3) {
    // El servidor ofrece un keyinfo v2 a un dispositivo en v3: no se sigue.
    throw new AppError('vault_changed');
  }
  if (cached && cached.check === info.check && cached.saltB64 === info.saltB64 && cached.iterations === info.iterations) {
    return;
  }
  if (!(await verifyKey(info, ring.keys.get(ring.current)))) {
    await clearKey();
    throw new AppError('vault_changed');
  }
  await setVault({ saltB64: info.saltB64, iterations: info.iterations, check: info.check });
}

/** Sube los elementos pendientes en orden. Devuelve cuántos quedan. */
export async function flushQueue() {
  const items = await getQueue();
  if (items.length === 0) return 0;
  const dav = await client();
  const key = await requireKey();
  await checkVault(dav, key);

  let remaining = items.length;
  for (const item of items) {
    try {
      // Primero los adjuntos y la carpeta; la nota al final, para que ninguna app vea una nota
      // que apunte a una imagen que aún no existe.
      for (const f of item.files) await dav.createFile(f.name, f.data, f.contentType);
      await removeFromQueue(item.id);
      remaining--;
    } catch (e) {
      item.attempts = (item.attempts || 0) + 1;
      item.lastError = errorCode(e);
      await enqueue(item);
      // Sin red o sin permiso no tiene sentido seguir con el resto.
      if (item.lastError === 'network' || item.lastError === 'auth') throw e;
    }
  }
  return remaining;
}

/**
 * Cifra y guarda una nota nueva.
 * @param {{title: string, content: string, folderId: ?string, saveImages?: boolean}} input
 * @returns {Promise<{status: 'saved'|'queued', error?: string}>}
 */
export async function saveNote(input) {
  const key = await requireKey();
  await client(); // comprueba que hay cuenta
  const prefs = await getPrefs();
  const saveImages = input.saveImages ?? prefs.saveImages;

  let content = input.content;
  let files = [];
  if (saveImages && prefs.maxImages > 0) {
    ({ content, files } = await embedImages(content, key, prefs.maxImages));
  }

  const id = crypto.randomUUID();
  const title = (input.title || '').trim().slice(0, 300);
  const body = await encodeNote({ id, folderId: input.folderId || null, title, content, updatedAt: Date.now() }, key);
  files.push({ name: noteFile(id), data: body, contentType: 'application/json; charset=utf-8' });

  await enqueue({ id, kind: 'note', label: title, createdAt: Date.now(), attempts: 0, files });
  return flushAndReport(id);
}

/** Crea una carpeta nueva y la añade a la caché local. Devuelve { folder, status }. */
export async function createFolder(name, parentId = null) {
  const key = await requireKey();
  await client();
  const clean = (name || '').trim().slice(0, 120);
  if (!clean) throw new AppError('folder_name');
  const folder = { id: crypto.randomUUID(), parentId: parentId || null, name: clean, color: 'DEFAULT' };
  const body = await encodeFolder({ ...folder, updatedAt: Date.now() }, key);
  await enqueue({
    id: folder.id, kind: 'folder', label: clean, createdAt: Date.now(), attempts: 0,
    files: [{ name: folderFile(folder.id), data: body, contentType: 'application/json; charset=utf-8' }]
  });
  const cache = await getFolderCache();
  cache.list = [...cache.list.filter((f) => f.id !== folder.id), folder];
  await setFolderCache(cache);
  return { folder, ...(await flushAndReport(folder.id)) };
}

async function flushAndReport(id) {
  try {
    await flushQueue();
  } catch (e) {
    const stillQueued = (await getQueue()).some((i) => i.id === id);
    if (stillQueued) return { status: 'queued', error: errorCode(e) };
    throw e;
  }
  const stillQueued = (await getQueue()).find((i) => i.id === id);
  return stillQueued ? { status: 'queued', error: stillQueued.lastError } : { status: 'saved' };
}

/**
 * Actualiza la lista de carpetas desde el servidor, descargando solo las que cambiaron (ETag).
 * Devuelve la lista [{ id, parentId, name, color }].
 */
export async function refreshFolders() {
  const dav = await client();
  const key = await requireKey();
  await checkVault(dav, key);

  const cache = await getFolderCache();
  const byId = new Map(cache.list.map((f) => [f.id, f]));
  const pendingIds = new Set((await getQueue()).filter((i) => i.kind === 'folder').map((i) => i.id));
  const etags = {};
  const list = [];

  const remote = (await dav.list()).filter((f) => /^folder_[A-Za-z0-9-]+\.json$/.test(f.name));
  const toFetch = [];
  for (const file of remote) {
    const id = file.name.slice('folder_'.length, -'.json'.length);
    if (file.etag && cache.etags[file.name] === file.etag) {
      etags[file.name] = file.etag;
      const known = byId.get(id);
      if (known) list.push(known);
    } else {
      toFetch.push({ file, id });
    }
  }
  for (let i = 0; i < toFetch.length; i += 6) {
    await Promise.all(toFetch.slice(i, i + 6).map(async ({ file, id }) => {
      try {
        const raw = await dav.getTextOrNull(file.name);
        if (raw === null) return;
        const folder = await decodeFolder(raw, id, key);
        etags[file.name] = file.etag;
        if (folder) list.push(folder);
      } catch {
        // Fichero ilegible o de otra bóveda: se ignora, como hacen las apps.
      }
    }));
  }
  // Las carpetas creadas aquí que aún no se han subido.
  for (const id of pendingIds) {
    const f = byId.get(id);
    if (f && !list.some((x) => x.id === id)) list.push(f);
  }

  await setFolderCache({ list, etags, fetchedAt: Date.now() });
  return list;
}

/** Comprueba que la contraseña maestra corresponde a keyinfo.json del servidor. */
export async function fetchKeyInfo() {
  const dav = await client();
  const raw = await dav.getTextOrNull(KEYINFO_FILE);
  if (raw === null) {
    if (!(await dav.rootExists())) throw new AppError('root_missing');
    throw new AppError('vault_missing');
  }
  return parseKeyInfo(raw);
}
