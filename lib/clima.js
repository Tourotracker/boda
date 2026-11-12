// Climatología del día de la boda: consulta varias fuentes meteorológicas
// (todas gratuitas, sin clave, vía Open-Meteo) una vez al día y guarda un
// histórico, para ver cómo evoluciona la previsión según se acerca la fecha.
const FECHA_BODA = '2026-11-27';
// Sevilla (centro de la ciudad, aproximado; no la coordenada exacta de la finca).
const LATITUD = 37.3891;
const LONGITUD = -5.9845;

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

// Un valor del "daily" de Open-Meteo puede venir como número o null.
function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

async function initDB(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS clima_previsiones (
      id SERIAL PRIMARY KEY,
      fecha_consulta DATE NOT NULL,
      fuente VARCHAR(40) NOT NULL,
      temp_max NUMERIC(5,1),
      temp_min NUMERIC(5,1),
      prob_precipitacion NUMERIC(5,1),
      precipitacion_mm NUMERIC(6,2),
      viento_kmh NUMERIC(5,1),
      codigo_tiempo INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (fecha_consulta, fuente)
    )
  `);
}

// Pide a Open-Meteo la previsión de un único modelo (modelo vacío = combinado
// "best_match" por defecto). Una petición por modelo, para no depender de
// cómo nombra las claves cuando se piden varios modelos a la vez.
async function consultarFuente(modelo) {
  const params = new URLSearchParams({
    latitude: String(LATITUD),
    longitude: String(LONGITUD),
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,weather_code,wind_speed_10m_max',
    timezone: 'Europe/Madrid',
    forecast_days: '16'
  });
  if (modelo !== 'best_match') params.set('models', modelo);
  const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Open-Meteo respondió ${res.status} para el modelo ${modelo}`);
  const datos = await res.json();
  const diario = datos.daily || {};
  const indice = (diario.time || []).indexOf(FECHA_BODA);
  if (indice === -1) return null; // la fecha de la boda está fuera del rango de 16 días
  return {
    temp_max: num(diario.temperature_2m_max && diario.temperature_2m_max[indice]),
    temp_min: num(diario.temperature_2m_min && diario.temperature_2m_min[indice]),
    prob_precipitacion: num(diario.precipitation_probability_max && diario.precipitation_probability_max[indice]),
    precipitacion_mm: num(diario.precipitation_sum && diario.precipitation_sum[indice]),
    viento_kmh: num(diario.wind_speed_10m_max && diario.wind_speed_10m_max[indice]),
    codigo_tiempo: num(diario.weather_code && diario.weather_code[indice])
  };
}

// Consulta todas las fuentes y guarda (o actualiza) la fila de hoy para cada
// una. Los fallos de una fuente no impiden guardar las demás.
async function consultarYGuardar(pool) {
  if (hoyIso() > FECHA_BODA) return { ok: true, guardadas: 0, nota: 'La boda ya ha pasado.' };
  const fecha = hoyIso();
  let guardadas = 0;
  const errores = [];
  for (const modelo of Object.keys(FUENTES)) {
    try {
      const d = await consultarFuente(modelo);
      if (!d) { errores.push(`${modelo}: la fecha de la boda está fuera de su rango de previsión`); continue; }
      await pool.query(
        `INSERT INTO clima_previsiones (fecha_consulta, fuente, temp_max, temp_min, prob_precipitacion, precipitacion_mm, viento_kmh, codigo_tiempo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (fecha_consulta, fuente) DO UPDATE SET
           temp_max=EXCLUDED.temp_max, temp_min=EXCLUDED.temp_min, prob_precipitacion=EXCLUDED.prob_precipitacion,
           precipitacion_mm=EXCLUDED.precipitacion_mm, viento_kmh=EXCLUDED.viento_kmh, codigo_tiempo=EXCLUDED.codigo_tiempo`,
        [fecha, modelo, d.temp_max, d.temp_min, d.prob_precipitacion, d.precipitacion_mm, d.viento_kmh, d.codigo_tiempo]
      );
      guardadas++;
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
     FROM clima_previsiones ORDER BY fecha_consulta DESC, fuente ASC`
  );
  for (const r of rows) { r.fecha_consulta = r.fecha_consulta_iso; delete r.fecha_consulta_iso; }
  return rows.map(r => ({
    ...r,
    temp_max: r.temp_max === null ? null : Number(r.temp_max),
    temp_min: r.temp_min === null ? null : Number(r.temp_min),
    prob_precipitacion: r.prob_precipitacion === null ? null : Number(r.prob_precipitacion),
    precipitacion_mm: r.precipitacion_mm === null ? null : Number(r.precipitacion_mm),
    viento_kmh: r.viento_kmh === null ? null : Number(r.viento_kmh),
    codigo_tiempo: r.codigo_tiempo === null ? null : Number(r.codigo_tiempo)
  }));
}

function registrarRutas(app, pool, requireAdmin) {
  app.get('/api/clima', requireAdmin, async (req, res) => {
    try {
      res.json({ fechaBoda: FECHA_BODA, fuentes: FUENTES, previsiones: await listarPrevisiones(pool) });
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
}

module.exports = { initDB, registrarRutas, programarActualizacionDiaria, FUENTES, FECHA_BODA, textoTiempo };
