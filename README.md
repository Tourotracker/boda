# RSVP Boda

Formulario de confirmación de asistencia para la boda. Un único servicio
Node.js/Express que sirve el formulario, guarda las respuestas en PostgreSQL
y expone un panel de administración para consultarlas.

## Estructura

- `server.js` — servidor Express: sirve `public/` y expone la API.
- `public/index.html` — formulario que ven los invitados.
- `public/admin.html` — panel para ver y exportar las respuestas (protegido por token).
- `lib/sobres.js` — cómo se rotula el sobre de cada invitación.
- `lib/xlsx.js` — generador de Excel (.xlsx) sin dependencias.

## Gestión de invitados desde el panel

- **Añadir invitado**: además de los que llegan por el formulario, se pueden dar
  de alta a mano. Pueden quedar como *Pendiente de contestar* (no exige dirección).
  Si luego esa persona rellena el formulario, aparecerá como una respuesta nueva:
  elimina la entrada manual.
- **Categorías**: cada invitado tiene *Invitado por* (Ignacio / Ines / Ambos) y
  *Grupo*. En la ficha se puede escribir para buscar la opción, y en el listado
  se filtra por varias a la vez (incluido "Sin asignar"). Las listas están en
  `public/categorias.js`: para añadir o renombrar un grupo, se cambia ahí.
- **Asignar en bloque**: marca varias filas (o todas las filtradas con la casilla
  de la cabecera) y asígnales "Invitado por" y/o grupo de una vez. Lo que se deje
  vacío no cambia. Cada cambio queda en `rsvp_history` con la acción `categorizar`.
- **NUEVO**: cada respuesta que llega (o se modifica) desde el formulario sale
  resaltada con la etiqueta *NUEVO* y, si alguna de las personas ya estaba en
  la lista (mismo nombre y primer apellido), con un aviso de posible duplicado.
  La marca se quita con *Visto* o al editar y guardar la ficha. El botón
  *Ver nuevos* filtra solo esas respuestas.
- **Vista árbol**: el botón cambia la tabla por un árbol Invitado por → Grupo →
  invitados, con invitaciones y personas en cada rama y un punto de color según
  la asistencia. Respeta los filtros; pulsar un invitado abre su ficha.
- **Descargar CSV** respeta los filtros activos; el **Excel de direcciones** sale
  siempre con todos los invitados.
- **Casados**: se deduce del tratamiento. Si en la pareja hay una *Sra.*, se
  consideran casados; con *Srta.*, pareja. Para cambiarlo, edita el tratamiento
  desde el panel.
- **Excel direcciones (sobres)**: una fila por invitación (todos salvo los que no
  asisten), con el destinatario ya rotulado:
  - Casados → `Sres. de <apellidos del marido>` (el que tenga tratamiento *Sr.*).
  - Pareja → `Dña. Eva Ríos y D. Leo Mora`.
  - Sin acompañante → `D. Tomás Vela`.

  La columna *Invitados* lleva solo los nombres de pila ("Javier y Elena", o
  "Javier" si va solo), para distinguir familiares con los mismos apellidos.

  La columna *Avisos* señala direcciones incompletas o casos que revisar.

  Los que no asisten no salen, salvo que en su ficha se marque *Enviar
  invitación por correo aunque no venga* (se ve con un ✉ en la tabla y el árbol).

  Nombres y direcciones salen con mayúscula inicial al estilo español aunque se
  escribieran en mayúsculas o minúsculas: "José María de la Fuente",
  "Avda. de la Constitución 25, 4ºB", "El Puerto de Santa María", y los códigos
  postales de 4 cifras se completan con el 0 inicial. Solo cambia el Excel: los
  datos guardados no se modifican.

## Antes de enviarlo a los invitados

Edita `public/index.html`: busca el comentario `<!-- EDITA AQUÍ -->` cerca del
principio del `<header>` y cambia la fecha límite de confirmación y vuestros
nombres (`Nuestra <span class="names">Boda</span>`). También puedes cambiar el
`<title>` de la página.

## Despliegue en Railway

### 1. Crear el proyecto

1. Entra en [railway.app](https://railway.app) e inicia sesión con GitHub.
2. **New Project → Deploy from GitHub repo** → selecciona el repositorio `boda`.
3. Railway detecta Node.js automáticamente (usa `railway.json`) y ejecuta `npm start`.

### 2. Añadir PostgreSQL

1. En el mismo proyecto de Railway: **+ New → Database → PostgreSQL**.
2. Railway inyecta `DATABASE_URL` automáticamente en el servicio Node.js
   si están en el mismo proyecto (puedes comprobarlo en la pestaña **Variables**
   del servicio; si no aparece, referencia `${{Postgres.DATABASE_URL}}`).

### 3. Variable de entorno

En el servicio Node.js → **Variables**, añade:

```
ADMIN_TOKEN=una_clave_secreta_que_elijas
```

Este token es la contraseña para entrar en `/admin.html` y ver las respuestas.
Elige algo largo y difícil de adivinar — protege los datos personales de tus invitados.

### 4. Generar la URL pública

En el servicio → **Settings → Networking → Generate Domain**.
Te dará algo como `https://rsvp-boda-production.up.railway.app`.

- Formulario para invitados: esa URL, tal cual (`/`).
- Panel de respuestas: esa URL + `/admin.html`.

Comparte la primera con los invitados (por email, WhatsApp, etc.) y guárdate
la segunda junto con el `ADMIN_TOKEN` para ti.

## Seguridad de los datos

- **Activa las copias de seguridad de Railway**: en el servicio de PostgreSQL →
  **Settings → Backups**, actívalas (o comprueba que ya lo están) y elige
  una retención con margen. Esta es la protección real frente a un fallo
  grave (borrado del volumen, problema de Railway, etc.) — nada de lo que
  hace la aplicación puede sustituirla.
- **Borrado no destructivo**: el botón "Eliminar" del panel de admin no
  borra la fila de la base de datos; solo la oculta (`deleted_at`). Los
  datos siguen ahí.
- **Historial de cambios**: cada vez que se edita, reinicia o elimina una
  respuesta desde `/admin.html`, se guarda una copia de cómo estaba antes
  en la tabla `rsvp_history` (columna `datos`, en formato JSON). Si algún
  día hace falta recuperar un dato concreto, está consultando esa tabla
  directamente en la base de datos de Railway.
- Como copia adicional, el botón **Descargar CSV** del panel de admin sirve
  para guardar un export periódico fuera de la base de datos.

## Desarrollo local

```bash
npm install
cp .env.example .env
# edita .env con una URL de Postgres local o remota
npm start
```

## Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/api/rsvp` | Guardar una confirmación |
| `GET` | `/api/respuestas` | Listado de respuestas (requiere cabecera `x-admin-token`) |
| `GET` | `/api/export/direcciones` | Excel de direcciones para los sobres (requiere `x-admin-token`) |
