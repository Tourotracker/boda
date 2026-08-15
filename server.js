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
      tratamiento VARCHAR(20),
      nombre VARCHAR(200) NOT NULL,
      calle VARCHAR(300),
      cp VARCHAR(10),
      ciudad VARCHAR(100),
      provincia VARCHAR(100),
      asiste VARCHAR(5) NOT NULL,
      con_acompanante VARCHAR(5),
      acompanante_nombre VARCHAR(200),
      transporte VARCHAR(50),
      alergias TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`ALTER TABLE rsvp DROP COLUMN IF EXISTS email`);
  console.log('Base de datos lista.');
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.post('/api/rsvp', async (req, res) => {
  const {
    tratamiento, nombre,
    calle, cp, ciudad, provincia,
    asiste, conAcompanante, acompananteNombre,
    transporte, alergias
  } = req.body;

  if (!nombre || !asiste) {
    return res.status(400).json({ error: 'Faltan campos obligatorios.' });
  }

  try {
    await pool.query(
      `INSERT INTO rsvp
        (tratamiento, nombre, calle, cp, ciudad, provincia,
         asiste, con_acompanante, acompanante_nombre, transporte, alergias)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        tratamiento || '', nombre,
        calle || '', cp || '', ciudad || '', provincia || '',
        asiste, conAcompanante || 'no', acompananteNombre || '',
        transporte || '', alergias || ''
      ]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al guardar.' });
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
