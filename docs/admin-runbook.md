# Runbook del panel de administración de Relevo

Para los tres administradores. Está escrito en lenguaje llano: lo que hace falta
saber para usar el panel sin Studio ni SQL, y qué le toca hacer solo al **admin
técnico** (la persona que corre los scripts y tiene acceso a Supabase Studio).
La versión técnica vive en `admin/CLAUDE.md` y en `docs/rf17-plan-admin.md`.

El panel está en **https://admin.rlvo.com.mx**.

*Estado a 2026-10-08 (secciones 2 y 3), 2026-10-07 (sección 7) y 2026-10-05 (el
resto). Lo que dice este documento sobre qué cubre el panel y sobre los respaldos
cambia con las Olas 3b, 5 y 6 y con la estrategia de respaldos: cuando cambie, se
actualiza aquí.*

## 1. Entrar al panel

1. Correo y contraseña de tu cuenta de administrador.
2. Después, el código de 6 dígitos de tu app autenticadora.
3. **Cada 12 horas el panel te pide el código otra vez.** Si abres un reporte o
   una lista y aparece una ventana "Código de verificación", es normal: escribe el
   código actual y lo que estabas abriendo continúa. Si cancelas, esa pantalla no
   carga y puedes pulsar "Reintentar".
4. **Primera vez, o si olvidaste tu contraseña:** en la pantalla de entrada, "Primera
   vez u olvidé mi contraseña". Te llega un código al correo de tu cuenta. Tu
   cuenta solo ve datos cuando el admin técnico la ha **activado** después de
   confirmar contigo, por otro canal, que fuiste tú quien enroló tu app
   autenticadora.

Cada acción que haces desde el panel guarda tu correo, para siempre, en el registro
de auditoría (una tabla que no se puede modificar ni borrar). Los dos
administradores con correo personal lo aceptaron.

## 2. Qué se puede hacer desde el panel

- **Reportes:** ver la lista, abrir uno, resolverlo o descartarlo (con un motivo
  de 3 a 500 caracteres), ver la publicación o la cuenta reportada y **bloquear
  una publicación**.
- **Moderación** (desde el 2026-10-08): las publicaciones **en revisión**, de la
  más antigua a la más reciente. "Evaluadas" son las que la revisión automática
  mandó a revisión, con el veredicto y el motivo; "Sin evaluar" son altas que se
  quedaron a media subida. Al abrir una puedes **aprobarla** (con motivo: pasa a
  activa, aparece en el catálogo y el dueño recibe un aviso en la app) o
  **bloquearla**.
- **Usuarios:** buscar, ver el detalle, **suspender** y **reactivar** (siempre con
  motivo). El dato **"Bloqueadas"** suma sus publicaciones bloqueadas que siguen
  existiendo y las bloqueadas que eliminó en los últimos 12 meses.
- Todo lo que escribe queda **auditado**: quién, cuándo, qué y por qué.

**Aprobar, lo que conviene saber:**
- No se puede aprobar una publicación **sin fotos** ni la de una **cuenta
  suspendida**: el botón aparece deshabilitado y, si se intenta, el panel dice por
  qué.
- Si dos administradores aprueban la misma publicación a la vez, solo una
  aprobación cuenta; el otro ve "La publicación cambió de estado mientras tanto.
  Recarga el detalle." No es un error.
- Si dice que la revisión automática "sigue en curso", espera unos minutos y
  vuelve a intentarlo.

**Lo que a 2026-10-08 todavía no está en el panel** (sigue en Studio hasta las
Olas 5 y 6): el catálogo de universidades y dominios, y las métricas.

No escribas datos personales en los motivos: son texto libre y la base no puede
impedirlo.

**Fotos que no cargan:** si en el detalle de una publicación una foto dice "La foto
no está disponible", puede ser que la fila de esa foto apunte a una dirección web y
no a un archivo del almacenamiento (hay 2 así, de publicaciones antiguas pausadas,
a 2026-10-06); no es un fallo del panel. Si pulsar "Reintentar" no la carga, avisa
al admin técnico.

## 3. Antes de suspender a alguien

Suspender a una cuenta pausa sus publicaciones activas y **deja sus publicaciones
"en revisión" en revisión**. Desde el 2026-10-07 la base no deja activar una
publicación de una cuenta suspendida por ningún camino (ni el panel, ni la
revisión automática, ni Studio): se queda en revisión hasta que la cuenta se
reactive, y entonces se aprueba o se bloquea como cualquier otra.

- Ya no hace falta avisar al admin técnico al suspender, ni la revisión semanal de
  antes: era la regla provisional mientras faltaba este candado.
- Desde el 2026-10-08 el panel lo dice así al suspender: "no se podrá aprobar
  mientras la cuenta esté suspendida".
- Si en Studio alguien intenta pasar a `activa` una publicación de una cuenta
  suspendida, la base responde con el error `dueno_no_activo`. Es el candado
  funcionando, no una falla.

## 4. Bloquear una publicación

- **Si el dueño elimina después una publicación bloqueada**, la app borra sus
  fotos, pero se conserva un registro mínimo de la moderación (sin fotos) durante
  12 meses; por eso el dato "Bloqueadas" del usuario no baja.

- **Bloquear es definitivo** para la app y el panel: el panel no desbloquea. Piénsalo
  antes.
- **Si fue un error,** solo el admin técnico puede revertirlo, en Studio. Studio **no
  deja rastro** en la auditoría y **el dueño no recibe ningún aviso**, así que quien
  lo haga anota fuera de la base quién, cuándo y por qué, y le avisa al dueño por el
  correo de soporte. Para pasar a `activa` la publicación debe tener al menos una
  foto.
- **Si la publicación está vendida** y hay una calificación pendiente, el comprador
  se queda sin camino en la app para calificar al vendedor. Avísale al comprador por
  soporte **antes** de bloquearla.

## 5. Perdí o cambié el teléfono (la app autenticadora)

El admin técnico no puede simplemente borrar tu factor: cualquiera con tu contraseña
podría registrar uno nuevo y quedar como administrador. El orden es este:

1. Llamas por voz al admin técnico, a un número que él ya tenga tuyo.
2. Él **desactiva** tu cuenta (no la borra): pierdes el acceso de inmediato y queda
   auditado.
3. Él borra tu factor en el Dashboard de Supabase (Authentication → Users). **Este
   paso del Dashboard todavía no se ha ejecutado en producción**: si esa opción no
   aparece o no funciona, no improvises otra vía; avisa y se resuelve caso por caso.
4. Entras al panel con tu contraseña y, como no tienes factor, te manda a enrolar la
   app en el teléfono nuevo.
5. Segunda llamada: confirmas que fuiste tú y a qué hora enrolaste.
6. Él te **reactiva**. El sistema exige que tu factor sea posterior a la
   desactivación, así que el factor viejo no sirve.

Si quien pierde el teléfono es el propio admin técnico, hace los mismos pasos sobre
su cuenta; conviene que otro admin sea testigo de la llamada.

## 6. Si sospechas que una cuenta de administrador se comprometió

1. Avisa **de inmediato** al admin técnico.
2. Él desactiva esa cuenta. El efecto es inmediato (desde la raíz del repositorio):
   ```bash
   node scripts/crear-admin.mjs desactivar --remoto --pooler-host <host-del-pooler> <correo> --motivo "<3 a 500 caracteres>"
   ```
   Pide, en este orden, el identificador del proyecto, la llave secreta temporal y la
   contraseña de la base (las dos últimas sin eco). Si hay prisa y no hay tiempo de
   crear la llave, el admin técnico tiene un recurso en Studio:
   `update private.admins set activado_at = null where user_id = '<uuid de esa cuenta>'`.
   Se usa solo en una emergencia, **no deja fila de auditoría** (anota después quién,
   cuándo y por qué) y, como no deja la fila `desactivar_admin`, el script
   `activar` no exigiría un factor nuevo al reactivar: borra el factor a mano
   antes de reactivar.
3. La persona cambia la contraseña de su correo y revisa su verificación en dos
   pasos antes de volver a activarse.

## 7. Lo que solo hace el admin técnico

- **Dar de alta a un administrador** (`crear-admin.mjs crear --remoto …`; para un
  correo que no sea `@rlvo.com.mx`, con `--correo-externo`) y **activarlo**, siempre
  después de una llamada de confirmación. Una cuenta que ya existe en el marketplace
  **no se convierte** en administrador: se usa otro correo.
- **La llave secreta temporal** que pide el script se crea en el Dashboard para esa
  alta y **se borra al terminar**. No se guarda en ningún archivo ni se pega en un
  chat.
- **Suspender o reactivar por Studio** (no por el panel): hay que escribir
  `suspendido_at` y `suspension_motivo` (entre 3 y 500 caracteres) al suspender, y
  dejar los dos en nulo al reactivar. Si falta alguno, la base responde con el error
  `23514`. Studio no audita.
- **Desbloquear una publicación** (sección 4) y **desactivar a un administrador**
  (secciones 5 y 6).
- **Barrido de fotos huérfanas, cada lunes.** Una carpeta de `listing-photos` cuya
  publicación ya no existe es basura: nadie la puede ver ni borrar desde la app (la
  publicación siempre se crea ANTES de subir sus fotos, así que una carpeta sin
  publicación solo queda después de un borrado que no alcanzó a limpiarla). En
  Studio, de solo lectura:
  ```sql
  select split_part(o.name, '/', 1) as carpeta, count(*) as objetos
    from storage.objects o
   where o.bucket_id = 'listing-photos'
     and not exists (select 1 from public.listings l
                      where l.id::text = split_part(o.name, '/', 1))
   group by 1 order by 1;
  ```
  Cada carpeta que aparezca se borra en Dashboard → Storage → `listing-photos`, y la
  consulta se repite hasta que dé 0. Al escribir esto (2026-10-07) había una:
  `57/`, con 1 objeto.

## 8. Respaldos: lo que hay y lo que no

- **A 2026-10-05, el proyecto de Supabase no tiene respaldos automáticos ni
  recuperación a un punto en el tiempo.**
- Existe una copia cifrada del esquema y de los datos tomada la noche del
  **2026-10-01** (hora de Monterrey), antes de resolver las cuatro publicaciones pendientes y de crear a los tres
  administradores. Es una fotografía que envejece cada día, **no** una estrategia de
  respaldo, y no incluye los archivos de Storage ni los secretos.
- Hechos puntuales verificados en el equipo del admin técnico (no garantías
  permanentes; pueden cambiar): FileVault activado; sin destinos de Time Machine ni
  snapshots locales de APFS al momento de la comprobación; la copia está fuera de
  iCloud Drive y de las carpetas sincronizadas comprobadas; su frase de paso está
  en un gestor de contraseñas; la imagen se montó y se comprobó contra los SHA-256
  originales, y los `.sql` en claro se borraron después. **No hay fecha límite ni
  política para borrar o reemplazar la copia: es una decisión pendiente.**
- Definir una estrategia de respaldos (plan con respaldos diarios o un volcado
  cifrado periódico) es una deuda abierta.
