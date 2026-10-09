# Runbook del panel de administración de Relevo

Para los tres administradores. Está escrito en lenguaje llano: lo que hace falta
saber para usar el panel sin Studio ni SQL, y qué le toca hacer solo al **admin
técnico** (la persona que corre los scripts y tiene acceso a Supabase Studio).
La versión técnica vive en `admin/CLAUDE.md` y en `docs/rf17-plan-admin.md`.

El panel está en **https://admin.rlvo.com.mx**.

*Estado a 2026-10-08 (secciones 2, 3, 5, 6 y 7) y 2026-10-05 (el resto), más la
Ola 5 (catálogo, 2026-10-09): **implementada y probada en local, pendiente de
despliegue**; lo que se dice aquí del catálogo vale cuando esté en producción. Lo
que dice este documento sobre qué cubre el panel y sobre los respaldos cambia con
la Ola 6 y con la estrategia de respaldos: cuando cambie, se actualiza aquí.*

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
- **Cuentas de administrador** (desde el 2026-10-08): el detalle de otro admin
  muestra si su acceso al panel está activado y si tiene app autenticadora
  registrada, y permite **restablecer su app autenticadora** (sección 5). Sobre
  tu propia cuenta no se puede. El panel no activa ni desactiva admins: eso lo
  hace el admin técnico (secciones 5 a 7).
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

**Catálogo** (Ola 5; **pendiente de despliegue** a 2026-10-09: hasta entonces sigue
en Studio): universidades, sus campus y los dominios de correo con los que sus
estudiantes se registran.
- **Universidades y campus** se dan de alta y se editan; **no se borran ni se
  desactivan** desde el panel. Un campus no se puede mover a otra universidad.
- **Dominios:** se agregan, se **desactivan** y se **reactivan**. Desactivar un
  dominio solo impide las altas NUEVAS: las cuentas que ya existen conservan su
  universidad y siguen entrando. Agregar un dominio que ya existe desactivado no
  lo reactiva: hay que usar «Reactivar».
- **Antes de agregar un dominio, la universidad necesita al menos un campus:** sin
  campus, quien se registre no podría completar su perfil. El panel lo rechaza.
- **Los proveedores de correo público** (gmail.com, hotmail.com, outlook.com,
  yahoo.com, icloud.com y similares) no se pueden dar de alta: no identifican a
  una universidad.
- **Coincidencia exacta:** un subdominio (por ejemplo, alumnos.uanl.edu.mx)
  necesita su propia fila.
- **Cuándo ve la app un cambio** (comprobado en las pruebas locales):
  - una universidad o un campus **nuevos**, y un **cambio de nombre** en el selector
    de campus del Feed, se ven **cuando el usuario cierra y vuelve a abrir la
    app**: la app lee el catálogo una vez por sesión, y deslizar para actualizar
    no lo vuelve a leer;
  - el nombre de una **universidad** en las tarjetas se actualiza al deslizar
    para actualizar;
  - el nombre de un **campus** se ve en el detalle de una publicación de ese
    campus, al abrirla.
- Como todo, cada cambio pide motivo (3 a 500 caracteres) y queda en la
  auditoría; el panel todavía no muestra la auditoría del catálogo (Ola 6).

**Lo que todavía no está en el panel:** las métricas (Ola 6). Hasta el despliegue
de la Ola 5, también el catálogo.

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

Desde el 2026-10-08 se resuelve desde el panel. Restablecer la app nunca te deja
entrar por sí solo: tu acceso queda desactivado hasta que el admin técnico lo
active de nuevo, y para eso exige una app registrada DESPUÉS del restablecimiento.
Así, aunque alguien tuviera tu contraseña, no podría quedar como administrador
registrando su propia app.

1. Llamas por voz a otro administrador, a un número que ya tenga tuyo.
2. Ese administrador abre tu cuenta en **Usuarios** y pulsa **«Restablecer app
   autenticadora»**, con un motivo (sin datos personales). En ese momento:
   - tu acceso al panel se desactiva;
   - se elimina la app autenticadora registrada en tu cuenta. Nadie ve ni recibe
     un código nuevo;
   - tu cuenta no se borra: conservas tu correo y tu contraseña;
   - queda en la auditoría: quién lo hizo, cuándo y el motivo.
3. Entras al panel con tu contraseña. Como ya no tienes app registrada, te manda
   a registrar la app en tu teléfono nuevo, y después a «Casi listo».
4. Segunda llamada al admin técnico: confirmas que fuiste tú y a qué hora
   registraste la app.
5. El admin técnico te **activa** (`crear-admin.mjs activar`, sección 7). Solo
   acepta una app registrada después del restablecimiento.
6. Pulsas «Ya me confirmaron» y vuelves a entrar.

**Si quien pierde el teléfono es un administrador y no hay otro disponible para
restablecerlo, o el panel muestra un aviso de restablecimiento pendiente:**
- «El restablecimiento anterior quedó pendiente. Inténtalo de nuevo para
  completarlo.»: pulsa otra vez «Restablecer app autenticadora». Continúa el MISMO
  restablecimiento; no empieza otro.
- Si nadie puede usar el panel, avisa al admin técnico y se resuelve caso por caso
  (el borrado del factor en el Dashboard nunca se ha ejecutado en producción).

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
   `activar` no exigiría un factor nuevo al reactivar: antes de reactivar, otro
   admin le restablece la app autenticadora desde el panel (sección 5), que sí
   deja el corte que exige `activar`.
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
- **Desbloquear una publicación** (sección 4), **activar** a un administrador
  después de restablecer su app (sección 5) y **desactivar** a un administrador
  (sección 6). Desactivar quita el acceso sin borrar la cuenta, su fila de
  administrador ni su app: es la forma soportada de retirar a alguien del panel.
  `activar` se niega si hay un restablecimiento sin terminar.
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
- **No dar de alta dominios de RLVO** (como `rlvo.com.mx`) en el catálogo. La base
  no lo impide a propósito, pero abriría el registro de la app a los buzones de RLVO
  y, sobre todo, haría que `crear-admin.mjs crear` deje de aceptar correos
  `@rlvo.com.mx` (su preflight rechaza cualquier dominio que esté en el catálogo,
  esté activo o no). Si ocurre, se resuelve en Studio con el admin técnico.
- **Una cuenta que nació sin universidad aunque su dominio está activo** (Ola 5;
  riesgo conocido y aceptado). Pasa solo si un dominio se desactiva en el mismo
  instante en que alguien se registra: la cuenta se crea, pero sin universidad, y
  la app le muestra «sin universidad asignada» en Completar perfil. Reactivar el
  dominio NO la arregla. **No es una instrucción rutinaria:** primero
  diagnóstico, después escalamiento.
  1. Diagnóstico, en Studio y solo leyendo: la fila de `public.users`
     (`universidad_id`, `campus_id`, `estado`); el dominio de su correo en
     `auth.users`; la fila de ese dominio en `universidad_dominios` (a qué
     universidad apunta y si está activo); y las filas `desactivar_dominio` /
     `reactivar_dominio` de `admin_acciones` cerca del `created_at` de la cuenta,
     para confirmar que fue esa ventana y no otra causa.
  2. Qué corresponde: la universidad del dominio, que esa universidad tenga campus
     y que `campus_id` siga en NULL. Fijar `universidad_id` con `campus_id` en
     NULL es válido (`users_campus_requiere_universidad`, FK
     `users_campus_universidad_fkey`). **El campus no se fija a mano: lo elige la
     persona** en Completar perfil.
  3. Escalamiento: lo decide el admin técnico. Antes de tocar nada se anota fuera
     de la base quién, cuándo y por qué (Studio no audita); solo entonces se hace
     el UPDATE de `universidad_id`, y después se confirma que la persona termine su
     perfil.
- **Si el registro de la app se rompe después del despliegue de la Ola 5**:
  existe una herramienta de recuperación **solo para el hook de registro**,
  `docs/rf17-ola5-recuperacion.sql` (con copia junto al respaldo cifrado). **No es
  un rollback de la Ola 5.** Se usa únicamente si el diagnóstico demuestra que la
  causa es el cambio del hook o del trigger de alta: STOP → diagnóstico →
  precondición (`select count(*) from universidad_dominios where not activo`,
  porque restaurar vuelve a abrir los dominios desactivados) → migración
  correctiva NUEVA con ese texto → `db push --dry-run` → aprobación → ejecución.
  Si la falla está en otra parte, o la causa es desconocida: STOP y diagnóstico
  específico, sin restaurar el hook.

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
