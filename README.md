<p align="center">
  <img src="icons/icon128.png" alt="Mis Notas" width="128">
</p>

<h1 align="center">Mis Notas para navegadores</h1>

<p align="center">
  Guarda recetas, artículos y enlaces desde el navegador en Mis Notas, cifrados de extremo a extremo y sincronizados con tu propio Nextcloud.
</p>

<p align="center">
  <a href="LICENSE"><img alt="Licencia: GPL v3" src="https://img.shields.io/badge/licencia-GPLv3-blue.svg"></a>
  <img alt="Chrome · Edge · Brave · Vivaldi · Firefox" src="https://img.shields.io/badge/Chrome%20%C2%B7%20Edge%20%C2%B7%20Brave%20%C2%B7%20Vivaldi%20%C2%B7%20Firefox-extensi%C3%B3n-6E8B3D.svg">
</p>

---

Es la extensión de la familia [Mis Notas para Android](https://github.com/MisApps-labs/mis_notas) y [Mis Notas para escritorio](https://github.com/MisApps-labs/mis_notas_desktop). Usa el mismo [formato de sincronización](https://github.com/MisApps-labs/mis_notas_desktop/blob/main/docs/SYNC_FORMAT.md), el mismo Nextcloud y la misma contraseña maestra, así que lo que guardas en el navegador aparece en el móvil y en el ordenador.

## Qué hace

- **Recetas**: si la página tiene datos de receta (schema.org, los que usan casi todas las webs de cocina), la nota sale limpia, sin anuncios ni la historia de la abuela:
  foto, raciones, tiempos, **ingredientes como lista de tareas** para tacharlos en la compra y pasos numerados, agrupados por secciones.
- **Artículos**: extrae el texto principal de la página (con [Readability](https://github.com/mozilla/readability), el motor del modo lectura de Firefox) y lo convierte a Markdown.
- **Selección**: guarda solo lo que hayas seleccionado, con su formato (negritas, listas, tablas, enlaces).
- **Página completa** o **solo el enlace** (con la descripción y la imagen de la web).
- **Menú contextual** (clic derecho): guardar la página, la selección, un enlace o una imagen sin abrir nada, en la carpeta por defecto.
- **Vista previa editable** antes de guardar, elección de carpeta y **creación de carpetas** nuevas desde la propia ventana.
- **Imágenes**: se descargan, se reducen a WebP (1600 px, como en las apps) y se suben **cifradas** como adjuntos, para que la nota no dependa de la web original. Las que no se puedan descargar quedan como enlace.
- **Fuente**: al final de la nota, un enlace a la página de origen (desactivable).
- **Sin conexión**: si no hay red, la nota se guarda ya cifrada en el navegador y se sube sola más tarde (cada 15 minutos y al abrir el navegador).
- **Atajo de teclado**: Alt+Mayús+S abre la ventana de guardado (se puede cambiar).
- En **español, inglés, francés, alemán e italiano**, según el idioma del navegador. Tema claro u oscuro según el sistema.
- Sin anuncios ni rastreadores.

El Markdown se genera a medida del lector de Mis Notas: imágenes en su propia línea, sublistas con dos espacios, listas de tareas `- [ ]`, tablas, citas y bloques de código.

## Instalación

**Firefox**: instálala desde [addons.mozilla.org](https://addons.mozilla.org/es-ES/firefox/addon/misnotas/) (se actualiza sola).

Para los demás navegadores, descarga la última versión desde [**Releases**](https://github.com/MisApps-labs/mis_notas_extensiones/releases/latest):

- `mis-notas-chromium-<versión>.zip` → Chrome, Edge, Brave, Vivaldi, Opera…
- `mis-notas-firefox-<versión>.zip` → Firefox 128 o posterior (instalación manual; lo recomendable es usar [addons.mozilla.org](https://addons.mozilla.org/es-ES/firefox/addon/misnotas/))

### Chrome, Edge, Brave, Vivaldi, Opera…

1. Descomprime `mis-notas-chromium-<versión>.zip` en una carpeta que no vayas a borrar (el navegador carga la extensión desde ahí).
2. Abre `chrome://extensions` (en Edge, `edge://extensions`; en Brave, `brave://extensions`) y activa el **Modo de desarrollador**.
3. Pulsa **Cargar descomprimida** y elige la carpeta (la que contiene `manifest.json`).
4. Fija el icono de Mis Notas en la barra (icono del puzle → chincheta).

Para actualizar, sustituye el contenido de la carpeta por el de la nueva versión y pulsa el botón de recargar de la extensión en `chrome://extensions`. Los ajustes se conservan.

También puedes clonar el repositorio y cargar directamente su raíz:

```bash
git clone https://github.com/MisApps-labs/mis_notas_extensiones.git
```

### Firefox

La forma recomendada es instalarla desde [**addons.mozilla.org**](https://addons.mozilla.org/es-ES/firefox/addon/misnotas/): pulsa **Añadir a Firefox** y se mantendrá actualizada automáticamente.

Si prefieres cargarla a mano (por ejemplo, para probar cambios):

1. Descomprime `mis-notas-firefox-<versión>.zip` (o genéralo tú con `tools/build.sh firefox`, que crea la carpeta `firefox/`).
2. Abre `about:debugging` → **Este Firefox** → **Cargar complemento temporal…** y elige el `manifest.json` de esa carpeta.

Firefox elimina los complementos temporales al cerrarse. Para tener instalada de forma permanente una versión sin firmar, usa Firefox Developer Edition, Nightly o ESR, pon `xpinstall.signatures.required` a `false` en `about:config`, cambia la extensión del zip a `.xpi` e instálalo desde `about:addons` → engranaje → **Instalar complemento desde archivo…**

## Configuración

La página de ajustes se abre sola al instalar la extensión (y siempre desde el engranaje de la ventana o con clic derecho en el icono → *Opciones*).

1. **Cuenta de Nextcloud**: escribe la dirección de tu servidor y pulsa **Iniciar sesión en Nextcloud**. Se abre una pestaña de tu Nextcloud para autorizar el acceso y la extensión recibe una contraseña de aplicación propia, que puedes revocar cuando quieras en *Ajustes personales → Seguridad*.
   Si lo prefieres, usa **Usar una contraseña de aplicación** y escribe el usuario y una contraseña de aplicación creada a mano.
   El navegador te pedirá permiso para acceder a tu servidor: es el único sitio con el que se comunica la extensión.
2. **Contraseña maestra**: la misma de las apps. Debes haber activado antes la sincronización en la app de Android o de escritorio (la extensión no crea bóvedas nuevas, solo usa la existente).
3. **Al guardar**: carpeta por defecto, copia de las imágenes, fuente e ingredientes como tareas.

## Privacidad y seguridad

- **Cifrado de extremo a extremo** idéntico al de las apps: AES-256-GCM con una clave derivada de tu contraseña maestra (PBKDF2-HMAC-SHA256, 600.000 iteraciones), con los datos asociados `note:<id>`, `folder:<id>` y `attachment:<id>`. Nextcloud solo recibe datos ilegibles.
- Compatible con el **cifrado v3** que se activa desde la app de Android: Argon2id, cifrado en sobre, rotación de clave y ficheros con relleno. Argon2id se calcula con [hash-wasm](https://github.com/Daninet/hash-wasm), incluida en `vendor/`; por eso la extensión declara `'wasm-unsafe-eval'` (permite ejecutar WebAssembly empaquetado en la propia extensión, no código remoto).
- **La contraseña maestra no se guarda.** Se guarda la clave derivada como `CryptoKey` **no exportable** en IndexedDB: el navegador puede usarla para cifrar, pero no deja leer sus bytes. Si desmarcas *Recordar en este navegador*, la clave vive solo en memoria y se pide de nuevo al abrir el navegador.
- La extensión **solo crea ficheros nuevos** (`If-None-Match: *`): nunca modifica ni borra notas existentes, así que no puede pisar cambios de tus otros dispositivos.
- Antes de cada subida comprueba `keyinfo.json`. Si cambias la contraseña maestra en otro dispositivo, la extensión lo detecta y te la vuelve a pedir; si otro dispositivo rota la clave (v3), recoge la nueva sin pedir nada. Si el servidor ofreciera una configuración de cifrado más antigua que la conocida, no sube nada.
- Las peticiones a Nextcloud van **sin cookies**, así que no interfieren con tu sesión web de Nextcloud.
- **Permisos**:
  - *Pestaña activa* y *scripting*: leer la página **solo cuando tú pulsas** el icono, el menú contextual o el atajo.
  - *Almacenamiento*, *menú contextual* y *alarmas*: para los ajustes, el clic derecho y los reintentos.
  - *Tu servidor* y, opcionalmente, *todas las webs*: el primero se pide al conectar. El segundo solo si activas la copia de imágenes y quieres que funcione en cualquier web; sirve únicamente para descargar las imágenes de la página que guardas.
- Sin telemetría ni servicios de terceros. Las tipografías van incluidas en la extensión.

## Desarrollo

No hace falta compilar nada: es JavaScript estándar (módulos ES) y se carga tal cual.

```
manifest.json
src/background.js        service worker: menú contextual, mensajes, cola y alarmas
src/lib/crypto.js        PBKDF2, Argon2id + AES-GCM (equivale a CryptoManager.kt / Argon2.kt)
src/lib/codec.js         keyinfo.json, notas y carpetas v2 y v3 (KeyInfo.kt / KeyInfoV3.kt / RemoteCodec.kt)
src/lib/webdav.js        cliente WebDAV mínimo (PROPFIND, GET, PUT con If-None-Match)
src/lib/nextcloud.js     direcciones, permisos, Login Flow v2 e id de usuario
src/lib/sync.js          guardar nota/carpeta, cola sin conexión, lista de carpetas
src/lib/images.js        imágenes → WebP cifrado (att_<id>.bin)
src/lib/store.js         ajustes, clave no exportable y cola en IndexedDB
src/lib/compose.js       inyección del extractor y pie con la fuente
src/content/extract.js   receta / artículo / selección / página → Markdown
src/popup/               ventana del icono
src/options/             ajustes
vendor/                  Readability 0.5.0, Turndown 7.2.0, turndown-plugin-gfm 1.0.2, hash-wasm 4.12.0 (Argon2id)
tests/                   pruebas del formato contra bóvedas creadas por la app Android (node --test tests/)
```

Para probar cambios, carga la raíz del repositorio como extensión descomprimida (ver [Instalación](#instalación)) y pulsa recargar tras cada cambio. No edites la carpeta `firefox/`: se genera desde la raíz.

Para empaquetar hacen falta `bash`, `jq` y `zip`:

```bash
tools/build.sh            # dist/mis-notas-chromium-<versión>.zip
tools/build.sh firefox    # además genera firefox/ y su zip
```

### Publicar una versión

1. Sube `version` en `manifest.json` y añade la entrada en [CHANGELOG.md](CHANGELOG.md).
2. Crea y sube la etiqueta correspondiente:

   ```bash
   git tag v1.0.1
   git push origin v1.0.1
   ```

3. El workflow [release.yml](.github/workflows/release.yml) genera los dos zip y publica la release en GitHub.

## Contribuir

Los avisos de errores y las propuestas son bienvenidos en [Issues](https://github.com/MisApps-labs/mis_notas_extensiones/issues). Si cambias algo del cifrado o del formato de las notas, debe seguir siendo compatible con el [formato de sincronización](https://github.com/MisApps-labs/mis_notas_desktop/blob/main/docs/SYNC_FORMAT.md) que usan las apps.

## Licencia

[GPL-3.0-or-later](LICENSE), como el resto de Mis Notas. Las bibliotecas de `vendor/` mantienen sus licencias (ver [vendor/README.md](vendor/README.md)).
