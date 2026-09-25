---
paths:
  - "src/app/(explorar)/detalle/**"
  - "src/app/(cuenta)/perfil-publico/**"
  - "src/app/(cuenta)/configuracion.tsx"
  - "app.json"
---

# Compartir y deep links

> Movido verbatim desde `CLAUDE.md` (§8 / §8b). Esta regla carga sola cuando la
> sesión lee alguno de los archivos de `paths:`. Las reglas transversales —
> tokens de diseño (§2), esquema y RLS (§3), inventario de pantallas (§4) y los
> gotchas de infraestructura (§9) — siguen en `CLAUDE.md`, que carga siempre.

- **Compartir comparte solo texto plano, sin ningún link — en LAS TRES
  pantallas que lo tienen.** En Detalle el mensaje es título + precio +
  "Publicado en Relevo"; en "Perfil público", nombre + universidad + "Perfil
  en Relevo" (`.filter(Boolean).join('\n')`, porque ahí
  `nombre`/`universidadNombre` son nullable); en "Configuración" ("Compartir
  la app"), un mensaje fijo invitando a descargar Relevo. Mismo motivo raíz en
  las tres: el proyecto no tiene todavía esquema
  de universal links (iOS) / App Links (Android) ni una página web de respaldo
  para quien no tiene la app instalada — y un link roto es peor que no poner
  nada. **Revisar cuando:** se decida invertir en una fase de deep linking real.
  **Fix:** dominio propio con `apple-app-site-association`/`assetlinks.json`,
  una página de fallback por cada ruta compartible (`/detalle/[id]` y
  `/perfil-publico/[id]`, las dos de Expo Router sin cambiar), y el mismo texto
  plano de hoy pasa a llevar el link real. Es su propio plan aparte.
