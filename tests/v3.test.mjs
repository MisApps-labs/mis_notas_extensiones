// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ferlagod
// Mis Notas para navegadores — formato v2/v3 contra bóvedas creadas por la app Android
// (generadas con app/src/test/.../CliFixtureTest.kt del repositorio de Android).
//
//   node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.hashwasm = require('../vendor/argon2.umd.min.js');

const { parseKeyInfo, openVaultV3, verifyKey, decodeFolder, encodeNote, encodeFolder, LEGACY_KID } = await import('../src/lib/codec.js');
const { deriveKeyBytes, importAesKey, decryptText } = await import('../src/lib/crypto.js');

const fx = (p) => readFileSync(new URL(`./fixtures/${p}`, import.meta.url), 'utf8');
const password = fx('password.txt');

async function ringFrom(opened, v3) {
  const keys = new Map();
  for (const [kid, bytes] of Object.entries(opened.keys)) keys.set(kid, await importAesKey(bytes));
  return { v3, current: opened.current, keys, vmk: opened.vmk ? await importAesKey(opened.vmk) : null };
}

test('abre una bóveda v3 de Android y lee sus carpetas', async () => {
  const info = parseKeyInfo(fx('v3/keyinfo.json'));
  assert.equal(info.version, 3);
  assert.equal(await openVaultV3(info, 'contraseña mala'), null);
  const opened = await openVaultV3(info, password);
  assert.ok(opened);
  assert.equal(Object.keys(opened.keys).length, 2);
  const ring = await ringFrom(opened, true);
  const folder = await decodeFolder(fx('v3/folder_f2.json'), 'f2', ring);
  assert.equal(folder.name, 'Proyecto');
  assert.equal(folder.parentId, 'f1');
});

test('escribe notas v3 con kid, rev y relleno que las apps pueden leer', async () => {
  const info = parseKeyInfo(fx('v3/keyinfo.json'));
  const ring = await ringFrom(await openVaultV3(info, password), true);
  const raw = JSON.parse(await encodeNote({ id: 'x1', title: 'Desde el navegador', content: 'hola' }, ring));
  assert.equal(raw.version, 3);
  assert.equal(raw.kid, ring.current);
  const plain = await decryptText(raw.payload, ring.keys.get(ring.current), 'note:x1');
  assert.equal(new TextEncoder().encode(plain).length % 512, 0);
  const payload = JSON.parse(plain);
  assert.equal(payload.title, 'Desde el navegador');
  assert.equal(payload.rev, 1);
  assert.equal(payload.isTrashed, false);
  const folder = JSON.parse(await encodeFolder({ id: 'f9', name: 'Web' }, ring));
  assert.equal((await decodeFolder(JSON.stringify(folder), 'f9', ring)).name, 'Web');
});

test('las bóvedas v2 siguen igual', async () => {
  const info = parseKeyInfo(fx('v2/keyinfo.json'));
  assert.equal(info.version, 2);
  const bytes = await deriveKeyBytes(password, info.salt, info.iterations);
  const key = await importAesKey(bytes);
  assert.ok(await verifyKey(info, key));
  const ring = { v3: false, current: LEGACY_KID, keys: new Map([[LEGACY_KID, key]]), vmk: null };
  assert.equal((await decodeFolder(fx('v2/folder_f1.json'), 'f1', ring)).name, 'Trabajo');
  const raw = JSON.parse(await encodeNote({ id: 'x2', title: 't', content: 'c' }, ring));
  assert.equal(raw.version, 2);
  assert.equal(raw.kid, undefined);
});

test('un keyinfo de una versión futura se rechaza', () => {
  assert.throws(() => parseKeyInfo(JSON.stringify({ format: 'misnotas-keyinfo', version: 4 })), /newer-version/);
});
