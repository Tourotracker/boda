// Climatología del día de la boda: consulta varias fuentes meteorológicas
// (todas gratuitas, sin clave, vía Open-Meteo) una vez al día y guarda un
// histórico por cada momento clave del evento, para ver cómo evoluciona la
// previsión según se acerca la fecha.
const FECHA_BODA = '2026-11-27';
// Sevilla (centro de la ciudad, aproximado; no la coordenada exacta de la finca).
const LATITUD = 37.3891;
const LONGITUD = -5.9845;

// Momentos del día de la boda. "objetivo" es la fecha y hora local (horario
// de Europe/Madrid) que se busca en la previsión por horas. La comida es a
// las 14:15, pero la previsión solo tiene granularidad horaria, así que se
// consulta la hora en punto más cercana (14:00) y se avisa en la interfaz.
const EVENTOS = [
  { id: 'ceremonia', nombre: 'Ceremonia', horaMostrada: '12:00', objetivo: '2026-11-27T12:00' },
  { id: 'comida', nombre: 'Comida', horaMostrada: '14:15', objetivo: '2026-11-27T14:00' },
  { id: 'copas', nombre: 'Copas', horaMostrada: '18:00', objetivo: '2026-11-27T18:00' },
  { id: 'fin', nombre: 'Fin de fiesta', horaMostrada: '01:00 (28/11)', objetivo: '2026-11-28T01:00' }
];

const FUENTES = {
  best_match: 'Open-Meteo (combinado)',
  ecmwf_ifs025: 'ECMWF (Europa)',
  gfs_seamless: 'GFS (EE.UU.)',
  icon_seamless: 'ICON (Alemania)',
  meteofrance_seamless: 'Météo-France',
  ukmo_seamless: 'UK Met Office'
};

const TIEMPO_TEXTO = {
  0: { icono: '☀️', texto: 'Despejado' },
  1: { icono: '🌤️', texto: 'Principalmente despejado' },
  2: { icono: '⛅', texto: 'Parcialmente nublado' },
  3: { icono: '☁️', texto: 'Cubierto' },
  45: { icono: '🌫️', texto: 'Niebla' }, 48: { icono: '🌫️', texto: 'Niebla' },
  51: { icono: '🌦️', texto: 'Llovizna débil' }, 53: { icono: '🌦️', texto: 'Llovizna' }, 55: { icono: '🌦️', texto: 'Llovizna intensa' },
  56: { icono: '🌧️', texto: 'Llovizna helada' }, 57: { icono: '🌧️', texto: 'Llovizna helada' },
  61: { icono: '🌧️', texto: 'Lluvia débil' }, 63: { icono: '🌧️', texto: 'Lluvia' }, 65: { icono: '🌧️', texto: 'Lluvia intensa' },
  66: { icono: '🌧️', texto: 'Lluvia helada' }, 67: { icono: '🌧️', texto: 'Lluvia helada' },
  71: { icono: '❄️', texto: 'Nieve débil' }, 73: { icono: '❄️', texto: 'Nieve' }, 75: { icono: '❄️', texto: 'Nieve intensa' },
  77: { icono: '🌨️', texto: 'Granizo fino' },
  80: { icono: '🌦️', texto: 'Chubascos débiles' }, 81: { icono: '🌦️', texto: 'Chubascos' }, 82: { icono: '🌦️', texto: 'Chubascos fuertes' },
  85: { icono: '🌨️', texto: 'Chubascos de nieve' }, 86: { icono: '🌨️', texto: 'Chubascos de nieve' },
  95: { icono: '⛈️', texto: 'Tormenta' }, 96: { icono: '⛈️', texto: 'Tormenta con granizo' }, 99: { icono: '⛈️', texto: 'Tormenta con granizo' }
};
function textoTiempo(codigo) {
  return TIEMPO_TEXTO[codigo] || { icono: '🌡️', texto: codigo === null || codigo === undefined ? 'Sin dato' : 'Código ' + codigo };
}

function hoyIso() {
  return new Date().toISOString().slice(0, 10);
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

async function columnaExiste(pool, tabla, columna) {
  const { rows } = await pool.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    [tabla, columna]
  );
  return rows.length > 0;
}

async function initDB(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS clima_previsiones (
      id SERIAL PRIMARY KEY,
      fecha_consulta DATE NOT NULL,
      fuente VARCHAR(40) NOT NULL,
      evento VARCHAR(20) NOT NULL DEFAULT 'dia',
      temp NUMERIC(5,1),
      sensacion_termica NUMERIC(5,1),
      prob_precipitacion NUMERIC(5,1),
      viento_kmh NUMERIC(5,1),
      codigo_tiempo INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (fecha_consulta, fuente, evento)
    )
  `);
  // Migración desde la versión anterior (un valor diario de máx/mín por
  // fuente) a un valor por cada momento del evento (ceremonia, comida...).
  await pool.query(`ALTER TABLE clima_previsiones ADD COLUMN IF NOT EXISTS evento VARCHAR(20) NOT NULL DEFAULT 'dia'`);
  await pool.query(`ALTER TABLE clima_previsiones ADD COLUMN IF NOT EXISTS temp NUMERIC(5,1)`);
  await pool.query(`ALTER TABLE clima_previsiones ADD COLUMN IF NOT EXISTS sensacion_termica NUMERIC(5,1)`);
  const tieneRestriccionVieja = await pool.query(
    `SELECT 1 FROM pg_constraint WHERE conname = 'clima_previsiones_fecha_consulta_fuente_key'`
  );
  if (tieneRestriccionVieja.rows.length) {
    await pool.query(`ALTER TABLE clima_previsiones DROP CONSTRAINT clima_previsiones_fecha_consulta_fuente_key`);
  }
  const tieneRestriccionNueva = await pool.query(
    `SELECT 1 FROM pg_constraint WHERE conname = 'clima_previsiones_fecha_fuente_evento_key'`
  );
  if (!tieneRestriccionNueva.rows.length) {
    await pool.query(`ALTER TABLE clima_previsiones ADD CONSTRAINT clima_previsiones_fecha_fuente_evento_key UNIQUE (fecha_consulta, fuente, evento)`);
  }
  // Informe diario escrito a mano (por una tarea programada) con el análisis
  // de la previsión del día, publicado una vez al día.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS clima_informes (
      fecha DATE PRIMARY KEY,
      texto TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

// Pide a Open-Meteo la previsión por horas de un único modelo (modelo vacío =
// combinado "best_match" por defecto) y devuelve los valores en cada momento
// clave del evento. Una petición por modelo, para no depender de cómo nombra
// las claves cuando se piden varios modelos a la vez.
async function consultarFuente(modelo) {
  const params = new URLSearchParams({
    latitude: String(LATITUD),
    longitude: String(LONGITUD),
    hourly: 'temperature_2m,apparent_temperature,precipitation_probability,weather_code,wind_speed_10m',
    timezone: 'Europe/Madrid',
    forecast_days: '16'
  });
  if (modelo !== 'best_match') params.set('models', modelo);
  const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Open-Meteo respondió ${res.status} para el modelo ${modelo}`);
  const datos = await res.json();
  const horario = datos.hourly || {};
  const tiempos = horario.time || [];
  const resultado = {};
  for (const ev of EVENTOS) {
    const indice = tiempos.indexOf(ev.objetivo);
    if (indice === -1) { resultado[ev.id] = null; continue; }
    resultado[ev.id] = {
      temp: num(horario.temperature_2m && horario.temperature_2m[indice]),
      sensacion_termica: num(horario.apparent_temperature && horario.apparent_temperature[indice]),
      prob_precipitacion: num(horario.precipitation_probability && horario.precipitation_probability[indice]),
      viento_kmh: num(horario.wind_speed_10m && horario.wind_speed_10m[indice]),
      codigo_tiempo: num(horario.weather_code && horario.weather_code[indice])
    };
  }
  return resultado;
}

// Consulta todas las fuentes y guarda (o actualiza) la fila de hoy para cada
// una y cada momento del evento. Los fallos de una fuente no impiden guardar
// las demás, ni que un momento sin dato (fuera del rango de 16 días) impida
// guardar los demás momentos de esa misma fuente.
async function consultarYGuardar(pool) {
  if (hoyIso() > FECHA_BODA) return { ok: true, guardadas: 0, nota: 'La boda ya ha pasado.' };
  const fecha = hoyIso();
  let guardadas = 0;
  const errores = [];
  for (const modelo of Object.keys(FUENTES)) {
    try {
      const porEvento = await consultarFuente(modelo);
      for (const ev of EVENTOS) {
        const d = porEvento[ev.id];
        if (!d) { errores.push(`${modelo} / ${ev.nombre}: fuera de rango de previsión`); continue; }
        await pool.query(
          `INSERT INTO clima_previsiones (fecha_consulta, fuente, evento, temp, sensacion_termica, prob_precipitacion, viento_kmh, codigo_tiempo)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (fecha_consulta, fuente, evento) DO UPDATE SET
             temp=EXCLUDED.temp, sensacion_termica=EXCLUDED.sensacion_termica, prob_precipitacion=EXCLUDED.prob_precipitacion,
             viento_kmh=EXCLUDED.viento_kmh, codigo_tiempo=EXCLUDED.codigo_tiempo`,
          [fecha, modelo, ev.id, d.temp, d.sensacion_termica, d.prob_precipitacion, d.viento_kmh, d.codigo_tiempo]
        );
        guardadas++;
      }
    } catch (err) {
      console.error('Clima: error consultando', modelo, err.message);
      errores.push(`${modelo}: ${err.message}`);
    }
  }
  return { ok: guardadas > 0, guardadas, errores };
}

// Comprueba cada hora si ya se ha guardado la previsión de hoy; si no, la
// pide. Así no hace falta un cron aparte: basta con que el servidor esté
// encendido (como lo está siempre en Railway).
function programarActualizacionDiaria(pool) {
  async function comprobar() {
    try {
      if (hoyIso() > FECHA_BODA) return;
      const { rows } = await pool.query(
        'SELECT 1 FROM clima_previsiones WHERE fecha_consulta = $1 LIMIT 1', [hoyIso()]
      );
      if (!rows.length) await consultarYGuardar(pool);
    } catch (err) {
      console.error('Clima: error en la comprobación diaria', err.message);
    }
  }
  setTimeout(comprobar, 30 * 1000); // al arrancar, con un pequeño margen
  setInterval(comprobar, 60 * 60 * 1000); // y luego cada hora
}

async function listarPrevisiones(pool) {
  const { rows } = await pool.query(
    `SELECT *, to_char(fecha_consulta, 'YYYY-MM-DD') AS fecha_consulta_iso
     FROM clima_previsiones ORDER BY fecha_consulta DESC, evento ASC, fuente ASC`
  );
  return rows.map(r => ({
    ...r,
    fecha_consulta: r.fecha_consulta_iso,
    fecha_consulta_iso: undefined,
    temp: r.temp === null ? null : Number(r.temp),
    sensacion_termica: r.sensacion_termica === null ? null : Number(r.sensacion_termica),
    prob_precipitacion: r.prob_precipitacion === null ? null : Number(r.prob_precipitacion),
    viento_kmh: r.viento_kmh === null ? null : Number(r.viento_kmh),
    codigo_tiempo: r.codigo_tiempo === null ? null : Number(r.codigo_tiempo)
  }));
}

async function obtenerUltimoInforme(pool) {
  const { rows } = await pool.query(
    `SELECT to_char(fecha, 'YYYY-MM-DD') AS fecha, texto, created_at FROM clima_informes ORDER BY fecha DESC LIMIT 1`
  );
  return rows[0] || null;
}

function validarInforme(body) {
  const texto = typeof body.texto === 'string' ? body.texto.trim() : '';
  if (!texto) return { error: 'El texto del informe es obligatorio.' };
  if (texto.length > 8000) return { error: 'El informe es demasiado largo (máximo 8000 caracteres).' };
  const fecha = typeof body.fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.fecha) ? body.fecha : hoyIso();
  return { texto, fecha };
}

async function guardarInforme(pool, fecha, texto) {
  const { rows } = await pool.query(
    `INSERT INTO clima_informes (fecha, texto) VALUES ($1,$2)
     ON CONFLICT (fecha) DO UPDATE SET texto = EXCLUDED.texto, created_at = NOW()
     RETURNING to_char(fecha, 'YYYY-MM-DD') AS fecha, texto, created_at`,
    [fecha, texto]
  );
  return rows[0];
}

function registrarRutas(app, pool, requireAdmin) {
  app.get('/api/clima', requireAdmin, async (req, res) => {
    try {
      res.json({
        fechaBoda: FECHA_BODA, fuentes: FUENTES, eventos: EVENTOS,
        previsiones: await listarPrevisiones(pool), informe: await obtenerUltimoInforme(pool)
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error al obtener la climatología.' });
    }
  });

  app.post('/api/clima/actualizar', requireAdmin, async (req, res) => {
    try {
      const resultado = await consultarYGuardar(pool);
      res.json(resultado);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error al consultar las fuentes meteorológicas.' });
    }
  });

  app.put('/api/clima/informe', requireAdmin, async (req, res) => {
    const validado = validarInforme(req.body || {});
    if (validado.error) return res.status(400).json({ error: validado.error });
    try {
      res.json(await guardarInforme(pool, validado.fecha, validado.texto));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error al guardar el informe.' });
    }
  });
}

module.exports = { initDB, registrarRutas, programarActualizacionDiaria, FUENTES, EVENTOS, FECHA_BODA, textoTiempo };
