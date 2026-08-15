const path = require('path');
const express = require('express');
const { Pool } = require('pg');

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
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS rsvp_guest_token_idx
    ON rsvp(guest_token) WHERE guest_token IS NOT NULL
  `);
  console.log('Base de datos lista.');
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

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
         asiste, con_acompanante, acompanante_tratamiento, acompanante_nombre, acompanante_apellidos, acompanante_alergias, transporte, alergias, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW())
       ON CONFLICT (guest_token) WHERE guest_token IS NOT NULL
       DO UPDATE SET
         tratamiento=EXCLUDED.tratamiento, nombre=EXCLUDED.nombre, apellidos=EXCLUDED.apellidos,
         calle=EXCLUDED.calle, cp=EXCLUDED.cp, ciudad=EXCLUDED.ciudad, provincia=EXCLUDED.provincia,
         asiste=EXCLUDED.asiste, con_acompanante=EXCLUDED.con_acompanante,
         acompanante_tratamiento=EXCLUDED.acompanante_tratamiento, acompanante_nombre=EXCLUDED.acompanante_nombre,
         acompanante_apellidos=EXCLUDED.acompanante_apellidos, acompanante_alergias=EXCLUDED.acompanante_alergias,
         transporte=EXCLUDED.transporte, alergias=EXCLUDED.alergias, updated_at=NOW()`,
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
      'SELECT * FROM rsvp WHERE guest_token = $1 LIMIT 1',
      [token]
    );
    if (!rows.length) return res.json({ encontrado: false });
    res.json({ encontrado: true, respuesta: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al consultar.' });
  }
});

app.get('/api/respuestas', async (req, res) => {
  const token = req.get('x-admin-token') || req.query.token;
  if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'No autorizado.' });
  }

  try {
    const { rows } = await pool.query(
      'SELECT * FROM rsvp ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener datos.' });
  }
});

initDB()
  .then(() => {
    app.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));
  })
  .catch((err) => {
    console.error('No se pudo inicializar la base de datos:', err);
    process.exit(1);
  });
