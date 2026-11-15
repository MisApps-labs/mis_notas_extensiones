// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ferlagod
// Mis Notas para Chromium — direcciones de Nextcloud, permisos e inicio de sesión (Login Flow v2).

import { toBase64 } from './crypto.js';

export const DEFAULT_FOLDER_NAME = 'MisNotas';
const DAV_MARKER = '/remote.php/dav/files/';

/**
 * Normaliza lo que escribe el usuario: añade https:// si falta y quita la barra final.
 * Si es una URL WebDAV completa, la conserva tal cual (como AuthPreferences.buildWebDavRootUrl).
 */
export function normalizeServer(input) {
  let s = (input || '').trim();
  if (!s) throw new Error('server-empty');
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  const url = new URL(s);
  return url.href.replace(/\/+$/, '');
}

/** Dirección base del servidor (sin la parte WebDAV), para la API y el Login Flow. */
export function serverBase(server) {
  const i = server.indexOf(DAV_MARKER);
  return i >= 0 ? server.slice(0, i) : server;
}

/** URL WebDAV de la carpeta de la app: https://servidor/remote.php/dav/files/<usuario>/MisNotas/ */
export function buildRootUrl(server, userId) {
  if (server.includes(DAV_MARKER)) return `${server.replace(/\/+$/, '')}/`;
  return `${server}${DAV_MARKER}${encodeURIComponent(userId)}/${DEFAULT_FOLDER_NAME}/`;
}

/** Patrón de permiso para el servidor (cualquier puerto). */
export function originPattern(server) {
  const url = new URL(server);
  return `${url.protocol}//${url.hostname}/*`;
}

/** Pide permiso para conectar con el servidor. Debe llamarse durante un clic del usuario. */
export function requestServerPermission(server) {
  return chrome.permissions.request({ origins: [originPattern(server)] });
}

export function hasServerPermission(server) {
  return chrome.permissions.contains({ origins: [originPattern(server)] });
}

/**
 * Login Flow v2: devuelve { loginUrl, poll() }. poll() resuelve con { server, loginName, appPassword }
 * cuando el usuario concede el acceso en la pestaña de Nextcloud.
 */
export async function startLoginFlow(server, { signal } = {}) {
  const base = serverBase(server);
  const res = await fetch(`${base}/index.php/login/v2`, { method: 'POST', credentials: 'omit', signal });
  if (!res.ok) throw new Error(`login-flow-${res.status}`);
  const data = await res.json();
  const { token, endpoint } = data.poll || {};
  if (!token || !endpoint || !data.login) throw new Error('login-flow-invalid');

  async function poll() {
    const deadline = Date.now() + 20 * 60 * 1000;
    while (Date.now() < deadline) {
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
      try {
        const r = await fetch(endpoint, {
          method: 'POST',
          credentials: 'omit',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `token=${encodeURIComponent(token)}`,
          signal
        });
        if (r.status === 200) return await r.json();
      } catch (e) {
        if (e?.name === 'AbortError') throw e;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error('login-flow-timeout');
  }

  return { loginUrl: data.login, poll };
}

/**
 * Comprueba las credenciales y devuelve el id de usuario de Nextcloud, que es el que va en la
 * ruta WebDAV (puede no coincidir con el nombre con el que se inicia sesión, p. ej. un correo).
 */
export async function fetchUserId(server, loginName, appPassword) {
  const base = serverBase(server);
  const auth = `Basic ${toBase64(new TextEncoder().encode(`${loginName}:${appPassword}`))}`;
  let res;
  try {
    res = await fetch(`${base}/ocs/v2.php/cloud/user?format=json`, {
      headers: { Authorization: auth, 'OCS-APIRequest': 'true', Accept: 'application/json' },
      credentials: 'omit',
      cache: 'no-store'
    });
  } catch {
    throw new Error('network');
  }
  if (res.status === 401 || res.status === 403) throw new Error('auth');
  if (!res.ok) throw new Error(`http-${res.status}`);
  const json = await res.json();
  return json?.ocs?.data?.id || loginName;
}
