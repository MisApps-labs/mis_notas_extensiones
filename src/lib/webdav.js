// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ferlagod
// Mis Notas para Chromium — cliente WebDAV mínimo para Nextcloud (equivale a WebDavClient.kt).

import { toBase64 } from './crypto.js';

const PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:"><d:prop><d:getetag/><d:resourcetype/></d:prop></d:propfind>`;

/** Error de WebDAV con el código HTTP y una causa: auth, network, precondition, http. */
export class WebDavError extends Error {
  constructor(reason, status = 0, message = '') {
    super(message || `webdav-${reason}${status ? ` (${status})` : ''}`);
    this.reason = reason;
    this.status = status;
  }
}

/** Quita el prefijo W/ y las comillas de un ETag. */
export function normalizeEtag(raw) {
  if (!raw) return null;
  const v = raw.trim().replace(/^W\//, '').replace(/^"+|"+$/g, '');
  return v || null;
}

function decodeXmlText(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

/**
 * Lee una respuesta multistatus sin DOMParser (no existe en los service workers).
 * Devuelve los ficheros (no carpetas) como [{ name, etag }].
 */
export function parsePropfind(xml) {
  const files = [];
  const responseRe = /<(?:[\w-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?response>/gi;
  const tag = (body, name) => {
    const m = new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${name}>`, 'i').exec(body);
    return m ? decodeXmlText(m[1].trim()) : null;
  };
  let m;
  while ((m = responseRe.exec(xml)) !== null) {
    const body = m[1];
    const href = tag(body, 'href');
    if (!href) continue;
    if (/<(?:[\w-]+:)?collection\b/i.test(body)) continue;
    let path = href.replace(/\/+$/, '');
    try { path = decodeURIComponent(path); } catch { /* se deja tal cual */ }
    const name = path.slice(path.lastIndexOf('/') + 1);
    if (!name) continue;
    files.push({ name, etag: normalizeEtag(tag(body, 'getetag')) });
  }
  return files;
}

export class WebDavClient {
  /**
   * @param {string} rootUrl URL WebDAV de la carpeta de la app (…/remote.php/dav/files/<usuario>/MisNotas/)
   */
  constructor(rootUrl, username, appPassword) {
    this.root = rootUrl.endsWith('/') ? rootUrl : `${rootUrl}/`;
    this.auth = `Basic ${toBase64(new TextEncoder().encode(`${username}:${appPassword}`))}`;
  }

  async request(method, name, { body, headers = {}, okStatuses = [] } = {}) {
    let res;
    try {
      res = await fetch(this.root + encodeURIComponent(name).replace(/%2F/g, '/'), {
        method,
        body,
        headers: { Authorization: this.auth, ...headers },
        // Sin cookies: con una sesión de Nextcloud abierta en el navegador, el servidor
        // exigiría el token CSRF y rechazaría la petición.
        credentials: 'omit',
        cache: 'no-store'
      });
    } catch (e) {
      throw new WebDavError('network', 0, e?.message);
    }
    if (res.status === 401 || res.status === 403) throw new WebDavError('auth', res.status);
    if (res.status === 412) throw new WebDavError('precondition', 412);
    if (!res.ok && !okStatuses.includes(res.status)) throw new WebDavError('http', res.status);
    return res;
  }

  /** Comprueba que la carpeta de la app existe. Devuelve false si no existe (404). */
  async rootExists() {
    const res = await this.request('PROPFIND', '', {
      body: PROPFIND_BODY,
      headers: { Depth: '0', 'Content-Type': 'application/xml; charset=utf-8' },
      okStatuses: [404]
    });
    return res.status !== 404;
  }

  /** Lista los ficheros de la carpeta de la app (PROPFIND Depth: 1). */
  async list() {
    const res = await this.request('PROPFIND', '', {
      body: PROPFIND_BODY,
      headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' }
    });
    return parsePropfind(await res.text());
  }

  /** Descarga un fichero como texto, o null si no existe. */
  async getTextOrNull(name) {
    const res = await this.request('GET', name, { okStatuses: [404] });
    if (res.status === 404) return null;
    return res.text();
  }

  /**
   * Crea un fichero nuevo con If-None-Match: * (nunca sobrescribe).
   * Devuelve true si se creó y false si ya existía (412): p. ej. un reintento de una subida
   * que sí llegó al servidor aunque se perdiera la respuesta.
   */
  async createFile(name, data, contentType) {
    try {
      await this.request('PUT', name, {
        body: data,
        headers: { 'Content-Type': contentType, 'If-None-Match': '*' }
      });
      return true;
    } catch (e) {
      if (e instanceof WebDavError && e.reason === 'precondition') return false;
      throw e;
    }
  }
}
