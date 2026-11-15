# Bibliotecas incluidas

Se incluyen sin modificar, tal como se publican en npm.

| Fichero | Proyecto | Versión | Licencia |
|---------|----------|---------|----------|
| `Readability.js` | [mozilla/readability](https://github.com/mozilla/readability) | 0.5.0 | Apache-2.0 |
| `turndown.js` | [mixmark-io/turndown](https://github.com/mixmark-io/turndown) (`dist/turndown.js`) | 7.2.0 | MIT |
| `turndown-plugin-gfm.js` | [mixmark-io/turndown-plugin-gfm](https://github.com/mixmark-io/turndown-plugin-gfm) (`dist/turndown-plugin-gfm.js`) | 1.0.2 | MIT |

Ambas licencias son compatibles con la GPL-3.0 de Mis Notas.

Para actualizarlas:

```bash
curl -fsSL -o vendor/Readability.js https://unpkg.com/@mozilla/readability@<versión>/Readability.js
curl -fsSL -o vendor/turndown.js https://unpkg.com/turndown@<versión>/dist/turndown.js
curl -fsSL -o vendor/turndown-plugin-gfm.js https://unpkg.com/turndown-plugin-gfm@<versión>/dist/turndown-plugin-gfm.js
```
