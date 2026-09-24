-- Relevo — cinco valores nuevos de `notification_type` para cuatro avisos
-- nuevos del inbox (RF-16, tanda 2). Sus productores viven en 20260928000473.
--
-- ESTE ARCHIVO EXISTE SOLO PARA EL `ALTER TYPE`, igual que 20260917000458 y por
-- la misma razón medida ahí: Postgres no deja USAR un valor de enum en la misma
-- transacción que lo crea ("unsafe use of new value … New enum values must be
-- committed before they can be used"), y el CLI corre cada archivo en su propia
-- transacción. En 20260917000458 están las cuatro variantes medidas contra
-- PG 17.6.
--
-- Ojo con el precedente engañoso: `compra_calificable` SÍ se agregó en el mismo
-- archivo que su función (20260912000453:196), y funcionó porque el cuerpo de
-- una función plpgsql no se ejecuta al crearla. Aquí no alcanzaría: los `WHEN`
-- de los triggers y las aserciones de T32 nombran estos valores, y un `WHEN` se
-- valida al crear el trigger.
--
-- CINCO valores para CUATRO avisos, porque el tinte y el ícono de la fila salen
-- del `tipo` (src/components/NotifRow.tsx) y el veredicto de moderación tiene
-- dos caras que se pintan distinto (aprobada en --forest, bloqueada en
-- --brick). Con un solo valor, el cliente tendría que leer el texto para saber
-- qué pintar.
--
--   publicacion_aprobada   pendiente → activa, sin que el usuario lo haya visto
--   publicacion_bloqueada  → bloqueada (desde pendiente sin verlo, o desde un
--                          estado ya publicado)
--   calificacion_recibida  alguien te calificó (solo al CREAR la reseña)
--   favorito_vendido       algo que guardaste pasó a vendida
--   avatar_eliminado       la moderación borró tu foto de perfil (RF-18)
--
-- Al final del enum y sin `before`/`after`: nadie ordena por esta columna.

alter type public.notification_type add value 'publicacion_aprobada';
alter type public.notification_type add value 'publicacion_bloqueada';
alter type public.notification_type add value 'calificacion_recibida';
alter type public.notification_type add value 'favorito_vendido';
alter type public.notification_type add value 'avatar_eliminado';
