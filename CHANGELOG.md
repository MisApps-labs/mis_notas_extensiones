# Cambios

## 1.1.0 — 2026-11-24

- Compatibilidad con el **cifrado v3** de Mis Notas para Android 1.0.2 (Argon2id, cifrado en sobre, llavero con varias claves, ficheros con `kid`, `rev` y relleno, lápidas cifradas). Una bóveda actualizada en el móvil se desbloquea aquí con la misma contraseña; las rotaciones de clave de otros dispositivos se recogen solas.
- Si el servidor ofrece un `keyinfo.json` más antiguo que el conocido (v2 tras v3), la extensión no sube nada.
- Pruebas del formato (`node --test tests/`) contra bóvedas v2 y v3 creadas por la app Android.

## 1.0.0 — 2026-11-15

Primera versión.

- Guardar en Mis Notas la receta, el artículo, la selección, la página completa o el enlace de la pestaña actual, con vista previa editable.
- Recetas a partir de los datos schema.org (JSON-LD y microdatos): foto, raciones, tiempos, calorías, ingredientes como lista de tareas y pasos por secciones.
- Menú contextual para guardar página, selección, enlace o imagen en la carpeta por defecto.
- Imágenes copiadas como adjuntos WebP cifrados.
- Elegir y crear carpetas.
- Inicio de sesión con Nextcloud (Login Flow v2) o con contraseña de aplicación.
- Cifrado de extremo a extremo compatible con las apps de Android y escritorio (formato de sincronización v2).
- Cola sin conexión con reintentos automáticos.
- Español, inglés, francés, alemán e italiano; tema claro y oscuro.
- Versión para Firefox generada desde el mismo código.
