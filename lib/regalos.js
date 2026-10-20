// Regalos y agradecimientos.
//
// Un regalo puede ser de una ficha, de varias (regalo de grupo) o de alguien
// que no está en la lista ("de parte de"). El agradecimiento se lleva por
// cada ficha del regalo, porque en un regalo de grupo se da las gracias a
// cada uno; si el regalo no tiene fichas, se lleva en el propio regalo.
const express = require('express');
const { generarXlsx } = require('./xlsx');
const { sobre } = require('./sobres');
const { leerTabla } = require('./leer-tabla');

const TIPOS = ['transferencia', 'lista', 'fisico', 'sobre', 'otro'];
const TIPO_TEXTO = {
  transferencia: 'Transferencia', lista: 'Lista El Corte Inglés', fisico: 'Regalo físico',
  sobre: 'Sobre en la boda', otro: 'Otro'
};
const ESTADOS = ['pendiente', 'escrito', 'enviado'];
const ESTADO_TEXTO = { pendiente: 'Pendiente', escrito: 'Escrito', enviado: 'Enviado' };
const AJUSTES_PERMITIDOS = ['plantilla_whatsapp'];

async function initDB(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS regalos (
      id SERIAL PRIMARY KEY,
      tipo VARCHAR(20) NOT NULL DEFAULT 'otro',
      descripcion TEXT NOT NULL DEFAULT '',
      importe NUMERIC(10,2),
      fecha DATE,
      de_parte_de TEXT NOT NULL DEFAULT '',
      notas TEXT NOT NULL DEFAULT '',
      concepto_banco TEXT NOT NULL DEFAULT '',
      agradecimiento VARCHAR(20) NOT NULL DEFAULT 'pendiente',
      medio VARCHAR(30) NOT NULL DEFAULT '',
      agradecido_at DATE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS regalo_invitados (
      regalo_id INTEGER NOT NULL REFERENCES regalos(id) ON DELETE CASCADE,
      rsvp_id INTEGER NOT NULL REFERENCES rsvp(id) ON DELETE CASCADE,
      agradecimiento VARCHAR(20) NOT NULL DEFAULT 'pendiente',
      medio VARCHAR(30) NOT NULL DEFAULT '',
      agradecido_at DATE,
      PRIMARY KEY (regalo_id, rsvp_id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ajustes (
      clave VARCHAR(50) PRIMARY KEY,
      valor TEXT NOT NULL DEFAULT ''
    )
  `);
}

// "50", "50,5", "1.234,56", "1,234.56", 50 -> número; vacío -> null
function leerImporte(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  if (typeof valor === 'number') return Number.isFinite(valor) ? Math.round(valor * 100) / 100 : NaN;
  let t = String(valor).replace(/[€\s]/g, '');
  if (!t) return null;
  const coma = t.lastIndexOf(',');
  const punto = t.lastIndexOf('.');
  if (coma > punto) t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(/,/g, '');
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

function validarRegalo(body) {
  const tipo = TIPOS.includes(body.tipo) ? body.tipo : null;
  if (!tipo) return { error: 'Tipo de regalo no válido.' };
  const importe = leerImporte(body.importe);
  if (Number.isNaN(importe) || (importe !== null && importe < 0)) return { error: 'Importe no válido.' };
  const fecha = body.fecha ? String(body.fecha) : null;
  if (fecha && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return { error: 'Fecha no válida.' };
  const invitados = Array.isArray(body.invitados) ? [...new Set(body.invitados)] : [];
  if (invitados.length > 1000 || !invitados.every(Number.isInteger)) return { error: 'Invitados no válidos.' };
  const dePartede = String(body.dePartede || '').trim().slice(0, 300);
  if (!invitados.length && !dePartede) return { error: 'Elige al menos un invitado o escribe de parte de quién es.' };
  return {
    datos: {
      tipo, importe, fecha, invitados, dePartede,
      descripcion: String(body.descripcion || '').trim().slice(0, 1000),
      notas: String(body.notas || '').trim().slice(0, 2000),
      conceptoBanco: String(body.conceptoBanco || '').trim().slice(0, 1000)
    }
  };
}

async function guardarInvitados(client, regaloId, invitados) {
  // Se conservan los agradecimientos de las fichas que siguen en el regalo.
  await client.query(
    'DELETE FROM regalo_invitados WHERE regalo_id = $1 AND NOT (rsvp_id = ANY($2::int[]))',
    [regaloId, invitados]
  );
  if (invitados.length) {
    await client.query(
      `INSERT INTO regalo_invitados (regalo_id, rsvp_id)
       SELECT $1, r.id FROM rsvp r WHERE r.id = ANY($2::int[])
       ON CONFLICT DO NOTHING`,
      [regaloId, invitados]
    );
  }
}

async function crearRegalo(client, d) {
  const { rows } = await client.query(
    `INSERT INTO regalos (tipo, descripcion, importe, fecha, de_parte_de, notas, concepto_banco)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [d.tipo, d.descripcion, d.importe, d.fecha, d.dePartede, d.notas, d.conceptoBanco]
  );
  await guardarInvitados(client, rows[0].id, d.invitados);
  return rows[0].id;
}

async function listarRegalos(pool) {
  const [regalos, enlaces] = await Promise.all([
    pool.query(`SELECT *, to_char(fecha, 'YYYY-MM-DD') AS fecha, to_char(agradecido_at, 'YYYY-MM-DD') AS agradecido_at
                FROM regalos WHERE deleted_at IS NULL ORDER BY COALESCE(fecha, created_at::date) DESC, id DESC`),
    pool.query(`SELECT ri.*, to_char(ri.agradecido_at, 'YYYY-MM-DD') AS agradecido_at
                FROM regalo_invitados ri JOIN rsvp r ON r.id = ri.rsvp_id WHERE r.deleted_at IS NULL`)
  ]);
  const porRegalo = new Map();
  for (const e of enlaces.rows) {
    if (!porRegalo.has(e.regalo_id)) porRegalo.set(e.regalo_id, []);
    porRegalo.get(e.regalo_id).push({
      rsvp_id: e.rsvp_id, agradecimiento: e.agradecimiento, medio: e.medio, agradecido_at: e.agradecido_at
    });
  }
  return regalos.rows.map(r => ({
    ...r,
    importe: r.importe === null ? null : Number(r.importe),
    invitados: porRegalo.get(r.id) || []
  }));
}

function textoRegalo(g) {
  const partes = [TIPO_TEXTO[g.tipo] || g.tipo];
  if (g.descripcion) partes.push(g.descripcion);
  if (g.importe !== null && g.importe !== undefined) {
    partes.push(Number(g.importe).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €');
  }
  return partes.join(' · ');
}

function hoy() {
  return new Date().toISOString().slice(0, 10);
}

function registrarRutas(app, pool, requireAdmin) {
  const conTransaccion = async (res, mensajeError, fn) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const resultado = await fn(client);
      await client.query('COMMIT');
      return resultado;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(err);
      res.status(500).json({ error: mensajeError });
      return undefined;
    } finally {
      client.release();
    }
  };

  app.get('/api/regalos', requireAdmin, async (req, res) => {
    try {
      res.json(await listarRegalos(pool));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error al obtener los regalos.' });
    }
  });

  app.post('/api/regalos', requireAdmin, async (req, res) => {
    const { error, datos } = validarRegalo(req.body);
    if (error) return res.status(400).json({ error });
    const id = await conTransaccion(res, 'Error al guardar el regalo.', client => crearRegalo(client, datos));
    if (id !== undefined) res.json({ ok: true, id });
  });

  // Varios regalos a la vez (importación del extracto del banco)
  app.post('/api/regalos/lote', requireAdmin, async (req, res) => {
    const lista = Array.isArray(req.body.regalos) ? req.body.regalos : [];
    if (!lista.length || lista.length > 2000) return res.status(400).json({ error: 'No hay regalos que importar.' });
    const validados = [];
    for (const [i, r] of lista.entries()) {
      const { error, datos } = validarRegalo(r);
      if (error) return res.status(400).json({ error: `Fila ${i + 1}: ${error}` });
      validados.push(datos);
    }
    const ok = await conTransaccion(res, 'Error al importar los regalos.', async client => {
      for (const d of validados) await crearRegalo(client, d);
      return true;
    });
    if (ok) res.json({ ok: true, creados: validados.length });
  });

  app.put('/api/regalos/:id', requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Id inválido.' });
    const { error, datos: d } = validarRegalo(req.body);
    if (error) return res.status(400).json({ error });
    const ok = await conTransaccion(res, 'Error al guardar el regalo.', async client => {
      const { rowCount } = await client.query(
        `UPDATE regalos SET tipo=$1, descripcion=$2, importe=$3, fecha=$4, de_parte_de=$5, notas=$6, updated_at=NOW()
         WHERE id=$7 AND deleted_at IS NULL`,
        [d.tipo, d.descripcion, d.importe, d.fecha, d.dePartede, d.notas, id]
      );
      if (!rowCount) return false;
      await guardarInvitados(client, id, d.invitados);
      return true;
    });
    if (ok === false) return res.status(404).json({ error: 'No encontrado.' });
    if (ok) res.json({ ok: true });
  });

  // Borrado no destructivo, como las respuestas.
  app.delete('/api/regalos/:id', requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Id inválido.' });
    try {
      const { rowCount } = await pool.query(
        'UPDATE regalos SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL', [id]
      );
      if (!rowCount) return res.status(404).json({ error: 'No encontrado.' });
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error al eliminar el regalo.' });
    }
  });

  // Cambiar el estado del agradecimiento de varios a la vez.
  // pares: [{ regaloId, rsvpId }] (rsvpId null = regalo sin fichas)
  app.post('/api/regalos/agradecimientos', requireAdmin, async (req, res) => {
    const { pares, estado, medio } = req.body;
    if (!Array.isArray(pares) || !pares.length || pares.length > 5000) {
      return res.status(400).json({ error: 'No hay agradecimientos seleccionados.' });
    }
    if (!pares.every(p => p && Number.isInteger(p.regaloId) && (p.rsvpId === null || Number.isInteger(p.rsvpId)))) {
      return res.status(400).json({ error: 'Selección no válida.' });
    }
    if (!ESTADOS.includes(estado)) return res.status(400).json({ error: 'Estado no válido.' });
    const medioTexto = typeof medio === 'string' ? medio.trim().slice(0, 30) : null;
    const fecha = estado === 'enviado' ? hoy() : null;
    const ok = await conTransaccion(res, 'Error al guardar el agradecimiento.', async client => {
      for (const p of pares) {
        const params = [estado, medioTexto, fecha, p.regaloId];
        if (p.rsvpId === null) {
          await client.query(
            `UPDATE regalos SET agradecimiento=$1, medio=COALESCE($2, medio), agradecido_at=$3, updated_at=NOW() WHERE id=$4`,
            params
          );
        } else {
          await client.query(
            `UPDATE regalo_invitados SET agradecimiento=$1, medio=COALESCE($2, medio), agradecido_at=$3
             WHERE regalo_id=$4 AND rsvp_id=$5`,
            [...params, p.rsvpId]
          );
        }
      }
      return true;
    });
    if (ok) res.json({ ok: true, actualizados: pares.length });
  });

  app.get('/api/ajustes/:clave', requireAdmin, async (req, res) => {
    if (!AJUSTES_PERMITIDOS.includes(req.params.clave)) return res.status(404).json({ error: 'No encontrado.' });
    try {
      const { rows } = await pool.query('SELECT valor FROM ajustes WHERE clave = $1', [req.params.clave]);
      res.json({ valor: rows.length ? rows[0].valor : null });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error al leer el ajuste.' });
    }
  });

  app.put('/api/ajustes/:clave', requireAdmin, async (req, res) => {
    if (!AJUSTES_PERMITIDOS.includes(req.params.clave)) return res.status(404).json({ error: 'No encontrado.' });
    const valor = String(req.body.valor || '').slice(0, 2000);
    try {
      await pool.query(
        `INSERT INTO ajustes (clave, valor) VALUES ($1, $2)
         ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor`,
        [req.params.clave, valor]
      );
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error al guardar el ajuste.' });
    }
  });

  // Extracto del banco: el navegador manda el archivo tal cual y se devuelven
  // las filas; la elección de columnas y el emparejamiento se hacen en el panel.
  app.post('/api/banco/leer', requireAdmin,
    express.raw({ type: 'application/octet-stream', limit: '15mb' }),
    (req, res) => {
      if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'No se ha recibido el archivo.' });
      try {
        res.json({ filas: leerTabla(req.body) });
      } catch (err) {
        res.status(400).json({ error: err.message || 'No se ha podido leer el archivo.' });
      }
    });

  // Excel para escribir los agradecimientos: una fila por persona a la que
  // dar las gracias. Por defecto solo los que faltan; ?todos=1 incluye todos.
  app.get('/api/export/agradecimientos', requireAdmin, async (req, res) => {
    try {
      const todos = req.query.todos === '1';
      const [lista, fichas] = await Promise.all([
        listarRegalos(pool),
        pool.query('SELECT * FROM rsvp WHERE deleted_at IS NULL')
      ]);
      const porId = new Map(fichas.rows.map(r => [r.id, r]));
      const filas = [];
      for (const g of lista) {
        const destinos = g.invitados.length
          ? g.invitados.map(i => ({ ficha: porId.get(i.rsvp_id), estado: i }))
          : [{ ficha: null, estado: g }];
        for (const { ficha, estado } of destinos) {
          if (!todos && estado.agradecimiento === 'enviado') continue;
          if (g.invitados.length && !ficha) continue;
          const s = ficha ? sobre(ficha) : null;
          filas.push({
            orden: ESTADOS.indexOf(estado.agradecimiento),
            celdas: [
              s ? s.destinatario : g.de_parte_de,
              s ? s.nombres : g.de_parte_de,
              textoRegalo(g),
              g.importe,
              g.invitados.length > 1 ? `De grupo (${g.invitados.length} fichas)` : (g.de_parte_de && ficha ? g.de_parte_de : ''),
              g.fecha || '',
              ESTADO_TEXTO[estado.agradecimiento] || estado.agradecimiento,
              estado.medio || '',
              estado.agradecido_at || '',
              ficha ? ficha.telefono || '' : '',
              s ? s.calle : '', s ? s.cp : '', s ? s.ciudad : '', s ? s.provincia : '',
              ficha ? ficha.grupo || '' : '',
              g.notas || ''
            ]
          });
        }
      }
      filas.sort((a, b) => a.orden - b.orden || String(a.celdas[0]).localeCompare(String(b.celdas[0]), 'es'));
      const columnas = [
        { titulo: 'Destinatario (sobre)', ancho: 40 }, { titulo: 'Invitados', ancho: 24 },
        { titulo: 'Regalo', ancho: 42 }, { titulo: 'Importe (€)', ancho: 12 }, { titulo: 'Regalo de grupo / de parte de', ancho: 26 },
        { titulo: 'Fecha regalo', ancho: 13 }, { titulo: 'Agradecimiento', ancho: 15 }, { titulo: 'Medio', ancho: 12 },
        { titulo: 'Fecha agradecimiento', ancho: 18 }, { titulo: 'Teléfono', ancho: 15 },
        { titulo: 'Dirección', ancho: 36 }, { titulo: 'Código postal', ancho: 13 }, { titulo: 'Ciudad', ancho: 18 },
        { titulo: 'Provincia', ancho: 16 }, { titulo: 'Grupo', ancho: 22 }, { titulo: 'Notas', ancho: 40 }
      ];
      const xlsx = generarXlsx('Agradecimientos', columnas, filas.map(f => f.celdas));
      res.set({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="agradecimientos${todos ? '-todos' : '-pendientes'}.xlsx"`,
        'Cache-Control': 'no-store'
      });
      res.send(xlsx);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error al generar el Excel: ' + err.message });
    }
  });
}

module.exports = { initDB, registrarRutas, leerImporte, TIPOS, ESTADOS };
