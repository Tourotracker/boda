# RSVP Boda

Formulario de confirmación de asistencia para la boda. Un único servicio
Node.js/Express que sirve el formulario, guarda las respuestas en PostgreSQL
y expone un panel de administración para consultarlas.

## Estructura

- `server.js` — servidor Express: sirve `public/` y expone la API.
- `public/index.html` — formulario que ven los invitados.
- `public/admin.html` — panel para ver y exportar las respuestas (protegido por token).

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
