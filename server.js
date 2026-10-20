const path = require('path');
const express = require('express');
const { Pool } = require('pg');
const { generarXlsx } = require('./lib/xlsx');
const { sobresParaEnviar } = require('./lib/sobres');
const { filasPorMesa, filasPorInvitado } = require('./lib/mesas-export');
const regalos = require('./lib/regalos');
const CATEGORIAS = require('./public/categorias');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false }
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rsvp (
      id SERIAL PRIMARY KEY,
      guest_token VARCHAR(64),
      tratamiento VARCHAR(100),
      nombre VARCHAR(200) NOT NULL,
      apellidos VARCHAR(200) NOT NULL,
      calle VARCHAR(300),
      cp VARCHAR(10),
      ciudad VARCHAR(100),
      provincia VARCHAR(100),
      asiste VARCHAR(20) NOT NULL,
      con_acompanante VARCHAR(5),
      acompanante_tratamiento VARCHAR(100),
      acompanante_nombre VARCHAR(200),
      acompanante_apellidos VARCHAR(200),
      acompanante_alergias TEXT,
      transporte VARCHAR(50),
      alergias TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`ALTER TABLE rsvp DROP COLUMN IF EXISTS email`);
  await pool.query(`ALTER TABLE rsvp ALTER COLUMN tratamiento TYPE VARCHAR(100)`);
  await pool.query(`ALTER TABLE rsvp ADD COLUMN IF NOT EXISTS apellidos VARCHAR(200)`);
  await pool.query(`ALTER TABLE rsvp ALTER COLUMN asiste TYPE VARCHAR(20)`);
  await pool.query(`ALTER TABLE rsvp ADD COLUMN IF NOT EXISTS acompanante_apellidos VARCHAR(200)`);
  await pool.query(`ALTER TABLE rsvp ADD COLUMN IF NOT EXISTS acompanante_alergias TEXT`);
  await pool.query(`ALTER TABLE rsvp ADD COLUMN IF NOT EXISTS acompanante_tratamiento VARCHAR(100)`);
  await pool.query(`ALTER TABLE rsvp ADD COLUMN IF NOT EXISTS guest_token VARCHAR(64)`);
  await pool.query(`ALTER TABLE rsvp ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`);
  await pool.query(`ALTER TABLE rsvp ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE rsvp ADD COLUMN IF NOT EXISTS iban_copiado_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE rsvp ADD COLUMN IF NOT EXISTS lista_click_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE rsvp ADD COLUMN IF NOT EXISTS invitado_por VARCHAR(20) NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE rsvp ADD COLUMN IF NOT EXISTS grupo VARCHAR(100) NOT NULL DEFAULT ''`);
  // Respuesta llegada por el formulario que aún no se ha revisado en el panel.
  await pool.query(`ALTER TABLE rsvp ADD COLUMN IF NOT EXISTS nuevo BOOLEAN NOT NULL DEFAULT FALSE`);
  // Mandarle la invitación por correo aunque haya dicho que no viene.
  await pool.query(`ALTER TABLE rsvp ADD COLUMN IF NOT EXISTS enviar_invitacion BOOLEAN NOT NULL DEFAULT FALSE`);
  // Sobre de matrimonio como "Sres. de <1er apellido marido> <1er apellido mujer>".
  await pool.query(`ALTER TABLE rsvp ADD COLUMN IF NOT EXISTS sobre_dos_apellidos BOOLEAN NOT NULL DEFAULT FALSE`);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS rsvp_guest_token_idx
    ON rsvp(guest_token) WHERE guest_token IS NOT NULL
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rsvp_history (
      id SERIAL PRIMARY KEY,
      rsvp_id INTEGER NOT NULL,
      accion VARCHAR(20) NOT NULL,
      datos JSONB NOT NULL,
      changed_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS qr_scans (
      id SERIAL PRIMARY KEY,
      scanned_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mesas (
      id SERIAL PRIMARY KEY,
      nombre VARCHAR(100) NOT NULL,
      capacidad INTEGER NOT NULL DEFAULT 10,
      pos_x INTEGER NOT NULL DEFAULT 40,
      pos_y INTEGER NOT NULL DEFAULT 40,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`ALTER TABLE rsvp ADD COLUMN IF NOT EXISTS mesa_id INTEGER REFERENCES mesas(id) ON DELETE SET NULL`);
  // Teléfono (solo panel) para escribir por WhatsApp los agradecimientos.
  await pool.query(`ALTER TABLE rsvp ADD COLUMN IF NOT EXISTS telefono VARCHAR(30) NOT NULL DEFAULT ''`);
  await regalos.initDB(pool);
  console.log('Base de datos lista.');
}

async function registrarHistorial(rsvpId, accion, datosAnteriores) {
  await pool.query(
    'INSERT INTO rsvp_history (rsvp_id, accion, datos) VALUES ($1,$2,$3)',
    [rsvpId, accion, JSON.stringify(datosAnteriores)]
  );
}

// Desde el panel también se pueden dar de alta invitados que aún no han
// contestado ('pendiente'); a esos no se les exige todavía la dirección.
const ASISTE_ADMIN = ['completa', 'copas', 'no', 'pendiente'];

function validarAdmin(body) {
  const { tratamiento, nombre, apellidos, calle, cp, ciudad, provincia, asiste } = body;
  if (!nombre || !apellidos || !asiste) return 'Faltan campos obligatorios.';
  if (!ASISTE_ADMIN.includes(asiste)) return 'Valor de asistencia no válido.';
  if (body.invitadoPor && !CATEGORIAS.invitadoPor.includes(body.invitadoPor)) return '"Invitado por" no válido.';
  if (body.grupo && !CATEGORIAS.grupos.includes(body.grupo)) return 'Grupo no válido.';
  if ((asiste === 'completa' || asiste === 'copas') && (!tratamiento || !calle || !cp || !ciudad || !provincia)) {
    return 'Faltan campos obligatorios.';
  }
  return null;
}

const intentosFallidos = new Map();
const MAX_INTENTOS = 10;
const VENTANA_MS = 15 * 60 * 1000;

function requireAdmin(req, res, next) {
  const ip = req.ip;
  const ahora = Date.now();
  const registro = intentosFallidos.get(ip);
  if (registro && registro.count >= MAX_INTENTOS && ahora < registro.resetAt) {
    return res.status(429).json({ error: 'Demasiados intentos. Inténtalo de nuevo en unos minutos.' });
  }

  const token = req.get('x-admin-token');
  if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
    const actual = (registro && ahora < registro.resetAt) ? registro : { count: 0, resetAt: ahora + VENTANA_MS };
    actual.count += 1;
    intentosFallidos.set(ip, actual);
    return res.status(401).json({ error: 'No autorizado.' });
  }
  if (registro) intentosFallidos.delete(ip);
  next();
}

app.set('trust proxy', 1);
app.use(express.json());
app.use((req, res, next) => {
  // Las páginas HTML cambian con frecuencia (contenido, admin) y no deben
  // quedarse cacheadas en el móvil de nadie; las imágenes y favicons sí
  // pueden cachearse normalmente.
  if (req.path === '/' || req.path.endsWith('.html')) {
    res.set('Cache-Control', 'no-store, must-revalidate');
  }
  next();
});
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'informacion.html')));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.get('/qr', async (req, res) => {
  try {
    await pool.query('INSERT INTO qr_scans DEFAULT VALUES');
  } catch (err) {
    console.error(err);
  }
  res.redirect(302, '/');
});

app.post('/api/rsvp', async (req, res) => {
  const {
    guestToken,
    tratamiento, nombre, apellidos,
    calle, cp, ciudad, provincia,
    asiste, conAcompanante, acompananteTratamiento, acompananteNombre, acompananteApellidos, acompananteAlergias,
    transporte, alergias
  } = req.body;

  if (!nombre || !apellidos || !asiste) {
    return res.status(400).json({ error: 'Faltan campos obligatorios.' });
  }
  if (asiste !== 'no' && (!tratamiento || !calle || !cp || !ciudad || !provincia)) {
    return res.status(400).json({ error: 'Faltan campos obligatorios.' });
  }

  const token = (typeof guestToken === 'string' && guestToken.length >= 8 && guestToken.length <= 64)
    ? guestToken
    : null;

  try {
    await pool.query(
      `INSERT INTO rsvp
        (guest_token, tratamiento, nombre, apellidos, calle, cp, ciudad, provincia,
         asiste, con_acompanante, acompanante_tratamiento, acompanante_nombre, acompanante_apellidos, acompanante_alergias, transporte, alergias, updated_at, nuevo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW(),TRUE)
       ON CONFLICT (guest_token) WHERE guest_token IS NOT NULL
       DO UPDATE SET
         tratamiento=EXCLUDED.tratamiento, nombre=EXCLUDED.nombre, apellidos=EXCLUDED.apellidos,
         calle=EXCLUDED.calle, cp=EXCLUDED.cp, ciudad=EXCLUDED.ciudad, provincia=EXCLUDED.provincia,
         asiste=EXCLUDED.asiste, con_acompanante=EXCLUDED.con_acompanante,
         acompanante_tratamiento=EXCLUDED.acompanante_tratamiento, acompanante_nombre=EXCLUDED.acompanante_nombre,
         acompanante_apellidos=EXCLUDED.acompanante_apellidos, acompanante_alergias=EXCLUDED.acompanante_alergias,
         transporte=EXCLUDED.transporte, alergias=EXCLUDED.alergias, updated_at=NOW(), deleted_at=NULL, nuevo=TRUE`,
      [
        token,
        tratamiento || '', nombre, apellidos,
        calle || '', cp || '', ciudad || '', provincia || '',
        asiste, conAcompanante || 'no', acompananteTratamiento || '', acompananteNombre || '', acompananteApellidos || '', acompananteAlergias || '',
        transporte || '', alergias || ''
      ]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al guardar.' });
  }
});

app.get('/api/rsvp/estado', async (req, res) => {
  const token = req.query.token;
  if (typeof token !== 'string' || token.length < 8 || token.length > 64) {
    return res.json({ encontrado: false });
  }

  try {
    const { rows } = await pool.query(
      'SELECT * FROM rsvp WHERE guest_token = $1 AND deleted_at IS NULL LIMIT 1',
      [token]
    );
    if (!rows.length) return res.json({ encontrado: false });
    res.json({ encontrado: true, respuesta: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al consultar.' });
  }
});

app.post('/api/evento', async (req, res) => {
  const { guestToken, tipo } = req.body;
  if (tipo !== 'iban' && tipo !== 'lista') {
    return res.status(400).json({ error: 'Tipo inválido.' });
  }
  if (typeof guestToken !== 'string' || guestToken.length < 8 || guestToken.length > 64) {
    return res.json({ ok: true });
  }

  const columna = tipo === 'iban' ? 'iban_copiado_at' : 'lista_click_at';
  try {
    await pool.query(
      `UPDATE rsvp SET ${columna} = NOW() WHERE guest_token = $1 AND deleted_at IS NULL`,
      [guestToken]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al registrar.' });
  }
});

app.get('/api/respuestas', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM rsvp WHERE deleted_at IS NULL ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener datos.' });
  }
});

app.get('/api/qr-scans', requireAdmin, async (req, res) => {
  try {
    const total = await pool.query('SELECT COUNT(*) FROM qr_scans');
    const ultimo = await pool.query('SELECT scanned_at FROM qr_scans ORDER BY scanned_at DESC LIMIT 1');
    res.json({
      total: Number(total.rows[0].count),
      ultimo: ultimo.rows[0] ? ultimo.rows[0].scanned_at : null
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener datos.' });
  }
});

app.post('/api/respuestas', requireAdmin, async (req, res) => {
  const {
    tratamiento, nombre, apellidos,
    calle, cp, ciudad, provincia,
    asiste, conAcompanante, acompananteTratamiento, acompananteNombre, acompananteApellidos, acompananteAlergias,
    transporte, alergias, invitadoPor, grupo, enviarInvitacion, sobreDosApellidos, telefono
  } = req.body;

  const errorValidacion = validarAdmin(req.body);
  if (errorValidacion) {
    return res.status(400).json({ error: errorValidacion });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO rsvp
        (tratamiento, nombre, apellidos, calle, cp, ciudad, provincia,
         asiste, con_acompanante, acompanante_tratamiento, acompanante_nombre, acompanante_apellidos, acompanante_alergias, transporte, alergias, invitado_por, grupo, enviar_invitacion, sobre_dos_apellidos, telefono)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       RETURNING *`,
      [
        tratamiento || '', nombre, apellidos,
        calle || '', cp || '', ciudad || '', provincia || '',
        asiste, conAcompanante || 'no', acompananteTratamiento || '', acompananteNombre || '', acompananteApellidos || '', acompananteAlergias || '',
        transporte || '', alergias || '', invitadoPor || '', grupo || '', enviarInvitacion === true, sobreDosApellidos === true,
        String(telefono || '').trim().slice(0, 30)
      ]
    );
    await registrarHistorial(rows[0].id, 'crear', rows[0]);
    res.json({ ok: true, respuesta: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear.' });
  }
});

app.put('/api/respuestas/mesa-bloque', requireAdmin, async (req, res) => {
  const { ids, mesaId } = req.body;
  if (!idsValidos(ids)) return res.status(400).json({ error: 'No hay invitados para asignar.' });
  if (mesaId !== null && !Number.isInteger(mesaId)) {
    return res.status(400).json({ error: 'Mesa no válida.' });
  }
  try {
    const { rows } = await pool.query(
      'UPDATE rsvp SET mesa_id = $1, updated_at = NOW() WHERE id = ANY($2::int[]) AND deleted_at IS NULL RETURNING *',
      [mesaId, ids]
    );
    res.json({ ok: true, respuestas: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al asignar mesa.' });
  }
});

// Solo el teléfono (para WhatsApp), sin tener que mandar la ficha entera.
app.put('/api/respuestas/:id/telefono', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Id inválido.' });
  const telefono = String(req.body.telefono || '').trim().slice(0, 30);
  try {
    const { rows } = await pool.query(
      'UPDATE rsvp SET telefono = $1, updated_at = NOW() WHERE id = $2 AND deleted_at IS NULL RETURNING id, telefono',
      [telefono, id]
    );
    if (!rows.length) return res.status(404).json({ error: 'No encontrado.' });
    res.json({ ok: true, telefono: rows[0].telefono });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al guardar el teléfono.' });
  }
});

app.put('/api/respuestas/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Id inválido.' });
  }

  const {
    tratamiento, nombre, apellidos,
    calle, cp, ciudad, provincia,
    asiste, conAcompanante, acompananteTratamiento, acompananteNombre, acompananteApellidos, acompananteAlergias,
    transporte, alergias, invitadoPor, grupo, enviarInvitacion, sobreDosApellidos, telefono
  } = req.body;

  const errorValidacion = validarAdmin(req.body);
  if (errorValidacion) {
    return res.status(400).json({ error: errorValidacion });
  }

  try {
    const actual = await pool.query('SELECT * FROM rsvp WHERE id = $1', [id]);
    if (!actual.rows.length) {
      return res.status(404).json({ error: 'No encontrado.' });
    }
    await registrarHistorial(id, 'editar', actual.rows[0]);

    const { rows } = await pool.query(
      `UPDATE rsvp SET
         tratamiento=$1, nombre=$2, apellidos=$3, calle=$4, cp=$5, ciudad=$6, provincia=$7,
         asiste=$8, con_acompanante=$9, acompanante_tratamiento=$10, acompanante_nombre=$11,
         acompanante_apellidos=$12, acompanante_alergias=$13, transporte=$14, alergias=$15,
         invitado_por=$16, grupo=$17, enviar_invitacion=$18, sobre_dos_apellidos=$19, telefono=$20, nuevo=FALSE, updated_at=NOW()
       WHERE id=$21
       RETURNING *`,
      [
        tratamiento || '', nombre, apellidos,
        calle || '', cp || '', ciudad || '', provincia || '',
        asiste, conAcompanante || 'no', acompananteTratamiento || '', acompananteNombre || '', acompananteApellidos || '', acompananteAlergias || '',
        transporte || '', alergias || '', invitadoPor || '', grupo || '', enviarInvitacion === true, sobreDosApellidos === true,
        String(telefono || '').trim().slice(0, 30),
        id
      ]
    );
    res.json({ ok: true, respuesta: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar.' });
  }
});

function asisteTexto(v) {
  if (v === 'completa' || v === 'si') return 'Toda la boda';
  if (v === 'copas') return 'Solo copas';
  if (v === 'pendiente') return 'Pendiente de contestar';
  if (v === 'no') return 'No asiste (se le envía igualmente)';
  return v || '';
}

function idsValidos(ids) {
  return Array.isArray(ids) && ids.length > 0 && ids.length <= 5000 && ids.every(Number.isInteger);
}

app.get('/api/export/direcciones', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM rsvp WHERE deleted_at IS NULL');
    const sobres = sobresParaEnviar(rows);
    const columnas = [
      { titulo: 'Destinatario (sobre)', ancho: 48 },
      { titulo: 'Invitados', ancho: 28 },
      { titulo: 'Invitado por', ancho: 13 },
      { titulo: 'Grupo', ancho: 26 },
      { titulo: 'Dirección', ancho: 40 },
      { titulo: 'Código postal', ancho: 13 },
      { titulo: 'Ciudad', ancho: 20 },
      { titulo: 'Provincia', ancho: 18 },
      { titulo: 'Tipo', ancho: 12 },
      { titulo: 'Personas', ancho: 10 },
      { titulo: 'Asistencia', ancho: 22 },
      { titulo: 'Avisos', ancho: 60 }
    ];
    const filas = sobres.map(s => [
      s.destinatario, s.nombres, s.invitadoPor, s.grupo, s.calle, s.cp, s.ciudad, s.provincia,
      s.tipo, s.personas, asisteTexto(s.asiste), s.avisos.join(' · ')
    ]);
    const xlsx = generarXlsx('Direcciones', columnas, filas);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="direcciones-invitaciones.xlsx"',
      'Cache-Control': 'no-store'
    });
    res.send(xlsx);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al generar el Excel: ' + err.message });
  }
});

// Asignar categoría a varios invitados a la vez. Un campo vacío o ausente
// no se modifica.
app.post('/api/respuestas/categorias', requireAdmin, async (req, res) => {
  const { ids, invitadoPor, grupo, sobreDosApellidos } = req.body;
  if (!idsValidos(ids)) return res.status(400).json({ error: 'No hay invitados seleccionados.' });
  const nuevoInvitadoPor = typeof invitadoPor === 'string' && invitadoPor ? invitadoPor : null;
  const nuevoGrupo = typeof grupo === 'string' && grupo ? grupo : null;
  const nuevoDosApellidos = typeof sobreDosApellidos === 'boolean' ? sobreDosApellidos : null;
  if (!nuevoInvitadoPor && !nuevoGrupo && nuevoDosApellidos === null) {
    return res.status(400).json({ error: 'Elige "Invitado por", un grupo o el formato del sobre.' });
  }
  if (nuevoInvitadoPor && !CATEGORIAS.invitadoPor.includes(nuevoInvitadoPor)) return res.status(400).json({ error: '"Invitado por" no válido.' });
  if (nuevoGrupo && !CATEGORIAS.grupos.includes(nuevoGrupo)) return res.status(400).json({ error: 'Grupo no válido.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO rsvp_history (rsvp_id, accion, datos)
       SELECT id, 'categorizar', to_jsonb(rsvp) FROM rsvp
       WHERE id = ANY($1::int[]) AND deleted_at IS NULL`,
      [ids]
    );
    const { rowCount } = await client.query(
      `UPDATE rsvp SET
         invitado_por = COALESCE($2, invitado_por),
         grupo = COALESCE($3, grupo),
         sobre_dos_apellidos = COALESCE($4, sobre_dos_apellidos),
         updated_at = NOW()
       WHERE id = ANY($1::int[]) AND deleted_at IS NULL`,
      [ids, nuevoInvitadoPor, nuevoGrupo, nuevoDosApellidos]
    );
    await client.query('COMMIT');
    res.json({ ok: true, actualizados: rowCount });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    res.status(500).json({ error: 'Error al asignar la categoría.' });
  } finally {
    client.release();
  }
});

app.post('/api/respuestas/:id/visto', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Id inválido.' });
  }
  try {
    await pool.query('UPDATE rsvp SET nuevo = FALSE WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al marcar como visto.' });
  }
});

app.post('/api/respuestas/:id/reset', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Id inválido.' });
  }

  try {
    const actual = await pool.query('SELECT * FROM rsvp WHERE id = $1', [id]);
    if (!actual.rows.length) {
      return res.status(404).json({ error: 'No encontrado.' });
    }
    await registrarHistorial(id, 'reiniciar', actual.rows[0]);
    await pool.query('UPDATE rsvp SET guest_token = NULL, updated_at = NOW() WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al reiniciar.' });
  }
});

app.delete('/api/respuestas/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Id inválido.' });
  }

  try {
    const actual = await pool.query('SELECT * FROM rsvp WHERE id = $1', [id]);
    if (!actual.rows.length) {
      return res.status(404).json({ error: 'No encontrado.' });
    }
    await registrarHistorial(id, 'eliminar', actual.rows[0]);
    await pool.query('UPDATE rsvp SET deleted_at = NOW() WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar.' });
  }
});

app.get('/api/mesas', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM mesas ORDER BY id');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener datos.' });
  }
});

app.post('/api/mesas', requireAdmin, async (req, res) => {
  const { nombre, capacidad, posX, posY } = req.body;
  if (!nombre || !String(nombre).trim()) {
    return res.status(400).json({ error: 'Falta el nombre de la mesa.' });
  }
  const cap = Number(capacidad);
  if (!Number.isInteger(cap) || cap < 1) {
    return res.status(400).json({ error: 'Capacidad no válida.' });
  }
  try {
    const { rows } = await pool.query(
      'INSERT INTO mesas (nombre, capacidad, pos_x, pos_y) VALUES ($1,$2,$3,$4) RETURNING *',
      [String(nombre).trim(), cap, Number.isInteger(posX) ? posX : 40, Number.isInteger(posY) ? posY : 40]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear la mesa.' });
  }
});

app.put('/api/mesas/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Id inválido.' });
  const { nombre, capacidad, posX, posY } = req.body;
  if (capacidad !== undefined && (!Number.isInteger(Number(capacidad)) || Number(capacidad) < 1)) {
    return res.status(400).json({ error: 'Capacidad no válida.' });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE mesas SET
         nombre = COALESCE($1, nombre),
         capacidad = COALESCE($2, capacidad),
         pos_x = COALESCE($3, pos_x),
         pos_y = COALESCE($4, pos_y),
         updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [
        nombre !== undefined ? String(nombre).trim() : null,
        capacidad !== undefined ? Number(capacidad) : null,
        Number.isInteger(posX) ? posX : null,
        Number.isInteger(posY) ? posY : null,
        id
      ]
    );
    if (!rows.length) return res.status(404).json({ error: 'No encontrada.' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar la mesa.' });
  }
});

app.delete('/api/mesas/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Id inválido.' });
  try {
    const { rowCount } = await pool.query('DELETE FROM mesas WHERE id = $1', [id]);
    if (!rowCount) return res.status(404).json({ error: 'No encontrada.' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar la mesa.' });
  }
});

app.put('/api/respuestas/:id/mesa', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Id inválido.' });
  const { mesaId } = req.body;
  if (mesaId !== null && !Number.isInteger(mesaId)) {
    return res.status(400).json({ error: 'Mesa no válida.' });
  }
  try {
    const { rows } = await pool.query(
      'UPDATE rsvp SET mesa_id = $1, updated_at = NOW() WHERE id = $2 AND deleted_at IS NULL RETURNING *',
      [mesaId, id]
    );
    if (!rows.length) return res.status(404).json({ error: 'No encontrado.' });
    res.json({ ok: true, respuesta: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al asignar mesa.' });
  }
});

app.get('/api/export/mesas-por-mesa', requireAdmin, async (req, res) => {
  try {
    const [mesasRes, respuestasRes] = await Promise.all([
      pool.query('SELECT * FROM mesas ORDER BY id'),
      pool.query('SELECT * FROM rsvp WHERE deleted_at IS NULL')
    ]);
    const { columnas, filas } = filasPorMesa(mesasRes.rows, respuestasRes.rows);
    const xlsx = generarXlsx('Por mesa', columnas, filas);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="mesas-por-mesa.xlsx"',
      'Cache-Control': 'no-store'
    });
    res.send(xlsx);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al generar el Excel: ' + err.message });
  }
});

app.get('/api/export/mesas-por-invitado', requireAdmin, async (req, res) => {
  try {
    const [mesasRes, respuestasRes] = await Promise.all([
      pool.query('SELECT * FROM mesas ORDER BY id'),
      pool.query('SELECT * FROM rsvp WHERE deleted_at IS NULL')
    ]);
    const { columnas, filas } = filasPorInvitado(mesasRes.rows, respuestasRes.rows);
    const xlsx = generarXlsx('Por invitado', columnas, filas);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="mesas-por-invitado.xlsx"',
      'Cache-Control': 'no-store'
    });
    res.send(xlsx);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al generar el Excel: ' + err.message });
  }
});

regalos.registrarRutas(app, pool, requireAdmin);

initDB()
  .then(() => {
    app.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));
  })
  .catch((err) => {
    console.error('No se pudo inicializar la base de datos:', err);
    process.exit(1);
  });
