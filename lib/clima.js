// Climatología del día de la boda: consulta varias fuentes meteorológicas
// (todas gratuitas, sin clave) una vez al día y guarda un histórico por cada
// momento clave del evento, para ver cómo evoluciona la previsión según se
// acerca la fecha.
const { XMLParser } = require('fast-xml-parser');
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
  ukmo_seamless: 'UK Met Office',
  metno: 'MET Norway',
  aemet: 'AEMET'
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

// MET Norway usa sus propios símbolos de texto en vez de los códigos WMO que
// usa Open-Meteo. Se traducen al código WMO más parecido para poder guardar
// y mostrar el tiempo de esta fuente con las mismas tablas que las demás.
const METNO_A_WMO = {
  clearsky: 0, fair: 1, partlycloudy: 2, cloudy: 3, fog: 45,
  lightrain: 61, rain: 63, heavyrain: 65,
  lightrainandthunder: 95, rainandthunder: 95, heavyrainandthunder: 96,
  lightrainshowers: 80, rainshowers: 81, heavyrainshowers: 82,
  lightrainshowersandthunder: 95, rainshowersandthunder: 95, heavyrainshowersandthunder: 96,
  lightsleet: 66, sleet: 66, heavysleet: 67,
  lightsleetandthunder: 66, sleetandthunder: 66, heavysleetandthunder: 67,
  lightsleetshowers: 80, sleetshowers: 81, heavysleetshowers: 82,
  lightsnow: 71, snow: 73, heavysnow: 75,
  lightsnowandthunder: 95, snowandthunder: 96, heavysnowandthunder: 96,
  lightsnowshowers: 85, snowshowers: 85, heavysnowshowers: 86,
  thunder: 95
};
function codigoDesdeSimboloMetNo(symbolCode) {
  if (!symbolCode) return null;
  const base = symbolCode.replace(/_(day|night|polartwilight)$/, '');
  return base in METNO_A_WMO ? METNO_A_WMO[base] : null;
}

// Tabla oficial de "estado de cielo" de AEMET (tomada de la página de ayuda
// de su propia web, aemet.es/es/eltiempo/prediccion/municipios/ayuda, que
// lista el icono y la descripción de cada código). El sufijo "n" indica
// variante nocturna (mismo significado). Dentro de cada familia, AEMET solo
// distingue grado de nubosidad, no de intensidad, así que esta tabla usa el
// grado de nubosidad como aproximación de intensidad al traducir a un único
// código WMO por familia.
const AEMET_CIELO_A_WMO = {
  11: 0, 12: 1, 13: 2, 14: 2, 15: 3, 16: 3, 17: 2, // despejado..cubierto, nubes altas
  23: 63, 24: 63, 25: 63, 26: 65, // con lluvia
  33: 73, 34: 73, 35: 75, 36: 75, // con nieve
  43: 61, 44: 61, 45: 61, 46: 63, // con lluvia escasa
  51: 95, 52: 95, 53: 95, 54: 95, // con tormenta
  61: 95, 62: 95, 63: 96, 64: 96, // con tormenta y lluvia escasa
  71: 71, 72: 71, 73: 73, 74: 73, // con nieve escasa
  81: 45, 82: 45, 83: 45 // niebla, bruma, calima (sin equivalente exacto)
};
function codigoDesdeCieloAemet(codigo) {
  if (!codigo && codigo !== 0) return null;
  const base = parseInt(String(codigo).replace(/n$/, ''), 10);
  return base in AEMET_CIELO_A_WMO ? AEMET_CIELO_A_WMO[base] : null;
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

// MET Norway (api.met.no), gratuita y sin clave; solo exige un User-Agent que
// identifique la aplicación (sin datos personales). Sus horas vienen en UTC,
// así que hay que convertir los momentos del evento (hora de Europe/Madrid)
// a UTC para buscarlos; en noviembre Madrid va en CET (UTC+1) todo el año,
// así que el desfase es fijo y no hace falta una librería de zonas horarias.
const METNO_USER_AGENT = 'boda-ines-ignacio-weather/1.0 (+https://boda-ines-ignacio.up.railway.app)';
async function consultarMetNorway() {
  const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${LATITUD}&lon=${LONGITUD}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': METNO_USER_AGENT } });
  if (!res.ok) throw new Error(`MET Norway respondió ${res.status}`);
  const datos = await res.json();
  const serie = (datos.properties && datos.properties.timeseries) || [];
  const porInstante = new Map();
  for (const punto of serie) porInstante.set(new Date(punto.time).getTime(), punto);
  const resultado = {};
  for (const ev of EVENTOS) {
    const instanteObjetivo = new Date(ev.objetivo + ':00+01:00').getTime();
    const punto = porInstante.get(instanteObjetivo);
    if (!punto) { resultado[ev.id] = null; continue; }
    const details = (punto.data.instant && punto.data.instant.details) || {};
    const siguiente = punto.data.next_1_hours || punto.data.next_6_hours || punto.data.next_12_hours || null;
    const simbolo = siguiente && siguiente.summary ? siguiente.summary.symbol_code : null;
    const vientoMs = num(details.wind_speed);
    resultado[ev.id] = {
      temp: num(details.air_temperature),
      sensacion_termica: null, // MET Norway no calcula sensación térmica
      prob_precipitacion: null, // ni probabilidad de precipitación (solo cantidad esperada)
      viento_kmh: vientoMs === null ? null : Math.round(vientoMs * 3.6 * 10) / 10,
      codigo_tiempo: codigoDesdeSimboloMetNo(simbolo)
    };
  }
  return resultado;
}

// AEMET (Agencia Estatal de Meteorología). No hace falta clave: se usa el
// mismo feed XML público que carga la propia web de AEMET para Sevilla
// capital (41091); su nota legal autoriza el uso citando a AEMET como
// fuente, que es justo como se muestra en la interfaz. Solo cubre 7 días y
// la resolución horaria (6/12/18/24h) completa solo está en los 2 primeros
// días; para el resto solo hay un bloque por periodo del día (00-06, 06-12,
// 12-18, 18-24) y una máxima/mínima diaria, así que se usa lo más preciso
// que haya disponible para cada momento del evento.
const AEMET_MUNICIPIO = '41091'; // Sevilla capital
const AEMET_USER_AGENT = 'boda-ines-ignacio-weather/1.0 (+https://boda-ines-ignacio.up.railway.app)';
const aemetParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

// De más preciso a menos: a partir de 3 días vista AEMET deja de publicar
// las franjas de 6 horas y solo da medio día (00-12/12-24) o el día entero
// (00-24), así que se prueban en cascada hasta encontrar una con datos.
function periodosParaHora(hora) {
  if (hora < 6) return ['00-06', '00-12', '00-24'];
  if (hora < 12) return ['06-12', '00-12', '00-24'];
  if (hora < 18) return ['12-18', '12-24', '00-24'];
  return ['18-24', '12-24', '00-24'];
}
function bloquePorPeriodo(coleccion, hora) {
  const lista = Array.isArray(coleccion) ? coleccion : (coleccion ? [coleccion] : []);
  for (const periodo of periodosParaHora(hora)) {
    const item = lista.find(x => x && x['@_periodo'] === periodo);
    if (item) return item;
  }
  return null;
}
function datoPorHora(bloque, hora) {
  if (!bloque || !bloque.dato) return null;
  const lista = Array.isArray(bloque.dato) ? bloque.dato : [bloque.dato];
  const item = lista.find(d => d && d['@_hora'] === hora);
  const val = item && item['#text'] !== undefined ? parseFloat(item['#text']) : NaN;
  return num(val);
}
function mediaMaxMin(bloque) {
  if (!bloque) return null;
  const max = num(parseFloat(bloque.maxima));
  const min = num(parseFloat(bloque.minima));
  if (max === null || min === null) return null;
  return Math.round(((max + min) / 2) * 10) / 10;
}

async function consultarAemet() {
  const url = `https://www.aemet.es/xml/municipios/localidad_${AEMET_MUNICIPIO}.xml`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': AEMET_USER_AGENT } });
  if (!res.ok) throw new Error(`AEMET respondió ${res.status}`);
  const buffer = await res.arrayBuffer();
  const texto = new TextDecoder('iso-8859-15').decode(buffer); // el feed viene en ISO-8859-15, no UTF-8
  const datos = aemetParser.parse(texto);
  const dias = datos.root && datos.root.prediccion && datos.root.prediccion.dia;
  const listaDias = Array.isArray(dias) ? dias : (dias ? [dias] : []);
  const porFecha = new Map();
  for (const dia of listaDias) porFecha.set(dia['@_fecha'], dia);

  const resultado = {};
  for (const ev of EVENTOS) {
    const [fechaObjetivo, horaTexto] = ev.objetivo.split('T');
    const hora = parseInt(horaTexto.split(':')[0], 10);
    const dia = porFecha.get(fechaObjetivo);
    if (!dia) { resultado[ev.id] = null; continue; }

    const horaExacta = (hora === 0) ? '24' : (hora === 6 || hora === 12 || hora === 18) ? String(hora) : null;

    const temp = (horaExacta && datoPorHora(dia.temperatura, horaExacta)) ?? mediaMaxMin(dia.temperatura);
    const sensacion = (horaExacta && datoPorHora(dia.sens_termica, horaExacta)) ?? mediaMaxMin(dia.sens_termica);
    const bloqueCielo = bloquePorPeriodo(dia.estado_cielo, hora);
    const bloqueViento = bloquePorPeriodo(dia.viento, hora);
    const bloqueProb = bloquePorPeriodo(dia.prob_precipitacion, hora);
    const velocidadViento = bloqueViento && bloqueViento.velocidad !== undefined && bloqueViento.velocidad !== ''
      ? num(parseFloat(bloqueViento.velocidad)) : null;

    resultado[ev.id] = {
      temp,
      sensacion_termica: sensacion,
      prob_precipitacion: bloqueProb && bloqueProb['#text'] !== undefined ? num(parseFloat(bloqueProb['#text'])) : null,
      viento_kmh: velocidadViento,
      codigo_tiempo: codigoDesdeCieloAemet(bloqueCielo && bloqueCielo['#text'])
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
      const porEvento = modelo === 'metno' ? await consultarMetNorway()
        : modelo === 'aemet' ? await consultarAemet()
        : await consultarFuente(modelo);
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
