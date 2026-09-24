-- Relevo — el nombre del perfil es un nombre de persona, no un username.
--
-- Hasta aquí `users.nombre` era `text` a secas (20260906000438:9) y lo único
-- que se exigía, en el cliente, era que no quedara vacío tras el trim. O sea que
-- la base guardaba cualquier cosa: números, emojis, símbolos, espacios dobles.
-- El nombre aparece en la tarjeta del vendedor, en Perfil público, en las
-- reseñas y en "¿A quién le vendiste?", así que es dato de confianza, y la regla
-- va aquí y no en un `if` de React (CLAUDE.md §0 regla 7).
--
-- LA REGLA: letras, y un separador (espacio, apóstrofe recto ', apóstrofe
-- tipográfico ’ o guion -) SOLO ENTRE letras. De 2 a 50 caracteres (no bytes:
-- `char_length`). La forma `^L+([ '’-]L+)*$` cubre de una vez "sin espacios al
-- inicio ni al final ni dobles": un separador siempre tiene una letra a cada
-- lado. NULL se permite: la fila nace sin nombre (la crea el trigger de alta) y
-- lo recibe en "Completar perfil".
--
-- "LETRA" ES UN CONJUNTO EXPLÍCITO, NO `[[:alpha:]]`. Medido en remoto y en
-- local (2026-09-24): la base es `en_US.UTF-8` con provider ICU, y ahí
-- `[[:alpha:]]` SÍ reconoce José/Nuñez/Müller. El motivo no es que falle hoy:
--   · `[[:alpha:]]` depende del ctype de la base, así que su significado
--     cambiaría con la configuración sin que esta migración cambiara;
--   · no equivale a `\p{L}` de JS, así que cliente y base no podrían compartir
--     la definición, y el amarre (`scripts/probe-perfil.mjs`) no tendría nada
--     que comparar.
-- El conjunto va escrito con escapes `\uXXXX`, que el regex ARE de Postgres
-- entiende (medido) y que `pg_get_constraintdef` devuelve tal cual (medido): el
-- probe busca ESTE string literal en la definición viva y lo compara contra
-- `CLASE_LETRA` de `src/lib/validacion-perfil.ts`.
--
--   A-Z a-z            ASCII
--   \u00C0-\u00D6        Latin-1: À…Ö   (salta \u00D7, el signo ×)
--   \u00D8-\u00F6        Latin-1: Ø…ö   (salta \u00F7, el signo ÷)
--   \u00F8-\u00FF        Latin-1: ø…ÿ
--   \u0100-\u017F        Latin Extended-A, entero de letras: polaco (ł ż),
--                      checo (č ř), turco (ş ğ ı), húngaro (ő)… — estudiantes
--                      de intercambio, el mismo motivo que abrió las ladas.
--
-- Quedan fuera Latin Extended-B (el rumano ș/ț; ş/ţ, en A, son su sustituto
-- habitual), griego, cirílico y CJK: se escriben romanizados.
--
-- LA BASE NO NORMALIZA, RECHAZA. El cliente normaliza antes de guardar (NFC,
-- trim, colapsar espacios); si algo llega sin normalizar, esto lo rechaza con
-- 23514 en vez de arreglarlo en silencio. Consecuencia concreta: una cadena en
-- NFD ("José" como e + U+0301) se rechaza, porque la marca combinante no es
-- una letra del conjunto — por eso `normalizarNombre()` pasa a NFC primero.
--
-- DATOS PREVIOS: al escribir esto había 1 fila en remoto que no cumplía (un
-- dígito en el nombre; medido solo por conteo). Se corrige a mano en Studio
-- ANTES del push — el paso 0 del runbook de CLAUDE.md §8 lo remide. Este check
-- entra validado, sin NOT VALID: si ese paso se salta, el push falla con 23514
-- en vez de dejar una fila incoherente.

alter table public.users add constraint users_nombre_valido check (
  nombre is null or (
    char_length(nombre) between 2 and 50
    and nombre ~ '^[A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF\u0100-\u017F]+([ ''’-][A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF\u0100-\u017F]+)*$'
  )
);
