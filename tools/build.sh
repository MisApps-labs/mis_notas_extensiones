#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Mis Notas para navegadores — empaqueta la extensión.
#
#   tools/build.sh            → dist/mis-notas-chromium-<versión>.zip (Chrome Web Store, Edge, Brave, Vivaldi…)
#   tools/build.sh firefox    → además copia el código a firefox/ con su manifiesto
#                               y crea dist/mis-notas-firefox-<versión>.zip (addons.mozilla.org)
#
# El código fuente es único: la raíz de esta carpeta. firefox/ se genera; no la edites a mano.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FIREFOX_DIR="$ROOT/firefox"
VERSION="$(jq -r .version "$ROOT/manifest.json")"
FILES=(manifest.json _locales icons src vendor LICENSE)

mkdir -p "$ROOT/dist"

# --- Chromium -------------------------------------------------------------
CHROME_ZIP="$ROOT/dist/mis-notas-chromium-$VERSION.zip"
rm -f "$CHROME_ZIP"
(cd "$ROOT" && zip -qr -X "$CHROME_ZIP" "${FILES[@]}" -x '*.DS_Store')
echo "Chromium: $CHROME_ZIP"

[[ "${1:-}" == "firefox" ]] || exit 0

# --- Firefox --------------------------------------------------------------
mkdir -p "$FIREFOX_DIR"
for f in "${FILES[@]}"; do
  rm -rf "${FIREFOX_DIR:?}/$f"
  cp -R "$ROOT/$f" "$FIREFOX_DIR/$f"
done
find "$FIREFOX_DIR" -name '.DS_Store' -delete

# Firefox usa una página de fondo (background.scripts) en lugar de service worker,
# necesita un id propio y declarar que no recoge datos.
jq '
  del(.minimum_chrome_version)
  | .background = { "scripts": ["src/background.js"], "type": "module" }
  | .browser_specific_settings = {
      "gecko": {
        "id": "mis-notas@ferlagod",
        "strict_min_version": "128.0",
        "data_collection_permissions": { "required": ["none"] }
      }
    }
' "$ROOT/manifest.json" > "$FIREFOX_DIR/manifest.json"

cat > "$FIREFOX_DIR/README.md" <<'EOF'
# Mis Notas para Firefox

Versión para Firefox de la extensión **Mis Notas**. Esta carpeta se genera automáticamente
desde la carpeta superior con `tools/build.sh firefox`: no edites estos ficheros aquí,
cambia el código en `Mis Notas Extensiones` y vuelve a generar.

Para probarla: `about:debugging` → *Este Firefox* → *Cargar complemento temporal…* y elige `manifest.json`.

La documentación completa está en el README de la carpeta superior.
EOF

FIREFOX_ZIP="$ROOT/dist/mis-notas-firefox-$VERSION.zip"
rm -f "$FIREFOX_ZIP"
(cd "$FIREFOX_DIR" && zip -qr -X "$FIREFOX_ZIP" "${FILES[@]}" -x '*.DS_Store')
echo "Firefox:  $FIREFOX_DIR"
echo "Firefox:  $FIREFOX_ZIP"
