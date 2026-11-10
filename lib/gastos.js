// Gastos de la boda: proveedores (con su IBAN y contrato), los distintos
// conceptos/gastos que se les paga a cada uno, los plazos previstos y el
// historial de pagos ya hechos.
const { leerImporte } = require('./regalos');
const CATEGORIAS_INVITADOS = require('../public/categorias');

const PAGADORES = CATEGORIAS_INVITADOS.invitadoPor; // ['Ignacio', 'Ines', 'Ambos']

const CATEGORIAS = [
  'finca_catering', 'fotografia_video', 'flores_decoracion', 'musica',
  'vestuario_belleza', 'invitaciones_papeleria', 'transporte', 'pastel', 'alianzas', 'viaje_novios', 'otros'
];
const CATEGORIA_TEXTO = {
  finca_catering: 'Finca y catering', fotografia_video: 'Fotografía y vídeo',
  flores_decoracion: 'Flores y decoración', musica: 'Música', vestuario_belleza: 'Vestuario y belleza',
  invitaciones_papeleria: 'Invitaciones y papelería', transporte: 'Transporte',
  pastel: 'Pastel y dulces', alianzas: 'Alianzas', viaje_novios: 'Viaje de novios', otros: 'Otros'
};
const METODOS = ['metalico', 'transferencia'];
const METODO_TEXTO = { metalico: 'Metálico', transferencia: 'Transferencia' };

async function columnaExiste(pool, tabla, columna) {
  const { rows } = await pool.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    [tabla, columna]
  );
  return rows.length > 0;
}

async function initDB(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS proveedores (
      id SERIAL PRIMARY KEY,
      nombre VARCHAR(200) NOT NULL,
      iban VARCHAR(34) NOT NULL DEFAULT '',
      contrato TEXT NOT NULL DEFAULT '',
      notas TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS gastos (
      id SERIAL PRIMARY KEY,
      proveedor_id INTEGER REFERENCES proveedores(id),
      categoria VARCHAR(30) NOT NULL DEFAULT 'otros',
      concepto TEXT NOT NULL DEFAULT '',
      importe_total NUMERIC(10,2) NOT NULL DEFAULT 0,
      fecha_limite DATE,
      documento TEXT NOT NULL DEFAULT '',
      notas TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    )
  `);

  // Migración desde el modelo anterior, en el que proveedor/iban/contrato
  // vivían repetidos en cada gasto: se crea una ficha de proveedor por cada
  // nombre distinto (con el IBAN/contrato que tuviera alguno de sus gastos),
  // se enlaza cada gasto a su proveedor, y se quitan las columnas viejas.
  // Solo se ejecuta una vez: si la columna "proveedor" ya no existe, es que
  // ya se hizo en un arranque anterior.
  if (await columnaExiste(pool, 'gastos', 'proveedor')) {
    await pool.query(`ALTER TABLE gastos ADD COLUMN IF NOT EXISTS proveedor_id INTEGER REFERENCES proveedores(id)`);
    await pool.query(`
      INSERT INTO proveedores (nombre, iban, contrato)
      SELECT DISTINCT ON (nombre) nombre, iban, contrato FROM (
        SELECT trim(proveedor) AS nombre, iban, contrato, created_at
        FROM gastos
        WHERE proveedor_id IS NULL AND trim(proveedor) <> ''
      ) t
      ORDER BY nombre, (iban <> '') DESC, (contrato <> '') DESC, created_at DESC
    `);
    await pool.query(`
      UPDATE gastos g SET proveedor_id = p.id
      FROM proveedores p
      WHERE g.proveedor_id IS NULL AND trim(g.proveedor) = p.nombre
    `);
    await pool.query(`ALTER TABLE gastos DROP COLUMN IF EXISTS proveedor`);
    await pool.query(`ALTER TABLE gastos DROP COLUMN IF EXISTS iban`);
    await pool.query(`ALTER TABLE gastos DROP COLUMN IF EXISTS contrato`);
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS gasto_pagos (
      id SERIAL PRIMARY KEY,
      gasto_id INTEGER NOT NULL REFERENCES gastos(id) ON DELETE CASCADE,
      importe NUMERIC(10,2) NOT NULL,
      fecha DATE,
      metodo VARCHAR(30) NOT NULL DEFAULT '',
      pagado_por VARCHAR(20) NOT NULL DEFAULT 'Ambos',
      iva NUMERIC(10,2),
      notas TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`ALTER TABLE gasto_pagos ADD COLUMN IF NOT EXISTS pagado_por VARCHAR(20) NOT NULL DEFAULT 'Ambos'`);
  await pool.query(`ALTER TABLE gasto_pagos ADD COLUMN IF NOT EXISTS iva NUMERIC(10,2)`);
  // Plazos previstos: lo que hay que pagar y cuándo, antes de pagarlo. Al
  // marcar uno como pagado se crea el pago real (gasto_pagos) y se enlaza
  // aquí, así el calendario y el historial de pagos no se pueden desincronizar.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS gasto_plazos (
      id SERIAL PRIMARY KEY,
      gasto_id INTEGER NOT NULL REFERENCES gastos(id) ON DELETE CASCADE,
      importe NUMERIC(10,2) NOT NULL,
      fecha DATE NOT NULL,
      notas TEXT NOT NULL DEFAULT '',
      pago_id INTEGER REFERENCES gasto_pagos(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

function hoy() {
  return new Date().toISOString().slice(0, 10);
}

function fechaValida(f) {
  return /^\d{4}-\d{2}-\d{2}$/.test(f);
}

// Quita espacios y pone en mayúsculas, como se guarda el IBAN de la boda.
function normalizarIban(valor) {
  return String(valor || '').replace(/\s+/g, '').toUpperCase().slice(0, 34);
}

function validarProveedor(body) {
  const nombre = String(body.nombre || '').trim().slice(0, 200);
  if (!nombre) return { error: 'Escribe el nombre del proveedor.' };
  const iban = normalizarIban(body.iban);
  if (iban && !/^[A-Z]{2}\d{2}[A-Z0-9]{4,30}$/.test(iban)) return { error: 'IBAN no válido.' };
  const contrato = String(body.contrato || '').trim().slice(0, 500);
  const notas = String(body.notas || '').trim().slice(0, 2000);
  return { datos: { nombre, iban, contrato, notas } };
}

// Encuentra el proveedor por id, o por nombre (reutilizando uno existente
// con el mismo nombre, sin distinguir mayúsculas, o creándolo si no hay).
async function resolverProveedor(client, body) {
  const idDado = Number(body.proveedorId);
  if (Number.isInteger(idDado) && idDado > 0) {
    const r = await client.query('SELECT id FROM proveedores WHERE id = $1', [idDado]);
    if (!r.rowCount) return { error: 'Proveedor no válido.' };
    return { proveedorId: idDado };
  }
  const nombre = String(body.proveedorNombre || '').trim().slice(0, 200);
  if (!nombre) return { error: 'Elige o escribe un proveedor.' };
  const existente = await client.query('SELECT id FROM proveedores WHERE lower(nombre) = lower($1) AND deleted_at IS NULL', [nombre]);
  if (existente.rowCount) return { proveedorId: existente.rows[0].id };
  const creado = await client.query('INSERT INTO proveedores (nombre) VALUES ($1) RETURNING id', [nombre]);
  return { proveedorId: creado.rows[0].id };
}

function validarGasto(body) {
  const categoria = CATEGORIAS.includes(body.categoria) ? body.categoria : 'otros';
  const concepto = String(body.concepto || '').trim().slice(0, 1000);
  let importeTotal = leerImporte(body.importeTotal);
  if (importeTotal === null) importeTotal = 0;
  if (Number.isNaN(importeTotal) || importeTotal < 0) return { error: 'Importe total no válido.' };
  const fechaLimite = body.fechaLimite ? String(body.fechaLimite) : null;
  if (fechaLimite && !fechaValida(fechaLimite)) return { error: 'Fecha límite no válida.' };
  const documento = String(body.documento || '').trim().slice(0, 500);
  const notas = String(body.notas || '').trim().slice(0, 2000);
  return { datos: { categoria, concepto, importeTotal, fechaLimite, documento, notas } };
}

function validarPago(body) {
  const importe = leerImporte(body.importe);
  if (importe === null || Number.isNaN(importe) || importe <= 0) return { error: 'Importe de pago no válido.' };
  const fecha = body.fecha ? String(body.fecha) : hoy();
  if (!fechaValida(fecha)) return { error: 'Fecha no válida.' };
  const metodo = METODOS.includes(body.metodo) ? body.metodo : 'transferencia';
  const pagadoPor = PAGADORES.includes(body.pagadoPor) ? body.pagadoPor : 'Ambos';
  const iva = leerImporte(body.iva);
  if (Number.isNaN(iva) || (iva !== null && iva < 0)) return { error: 'IVA no válido.' };
  const notas = String(body.notas || '').trim().slice(0, 500);
  return { datos: { importe, fecha, metodo, pagadoPor, iva, notas } };
}

function validarPlazo(body) {
  const importe = leerImporte(body.importe);
  if (importe === null || Number.isNaN(importe) || importe <= 0) return { error: 'Importe del plazo no válido.' };
  const fecha = String(body.fecha || '');
  if (!fechaValida(fecha)) return { error: 'Fecha del plazo no válida.' };
  const notas = String(body.notas || '').trim().slice(0, 500);
  return { datos: { importe, fecha, notas } };
}

function estadoGasto(total, pagado) {
  if (total <= 0 || pagado >= total) return 'pagado';
  if (pagado > 0) return 'parcial';
  return 'pendiente';
}

async function listarProveedores(pool) {
  const { rows } = await pool.query('SELECT * FROM proveedores WHERE deleted_at IS NULL ORDER BY nombre ASC');
  return rows;
}

async function listarGastos(pool) {
  // Los proveedores se juntan sin filtrar deleted_at: un proveedor archivado
  // no debe hacer desaparecer el nombre/IBAN de sus gastos ya existentes.
  const [gastosRes, pagosRes, plazosRes] = await Promise.all([
    pool.query(`SELECT g.*, to_char(g.fecha_limite, 'YYYY-MM-DD') AS fecha_limite,
                p.nombre AS proveedor_nombre, p.iban AS proveedor_iban, p.contrato AS proveedor_contrato
                FROM gastos g LEFT JOIN proveedores p ON p.id = g.proveedor_id
                WHERE g.deleted_at IS NULL ORDER BY COALESCE(g.fecha_limite, g.created_at::date) ASC, g.id DESC`),
    pool.query(`SELECT p.*, to_char(p.fecha, 'YYYY-MM-DD') AS fecha
                FROM gasto_pagos p JOIN gastos g ON g.id = p.gasto_id
                WHERE g.deleted_at IS NULL ORDER BY p.fecha ASC NULLS LAST, p.id ASC`),
    pool.query(`SELECT pl.*, to_char(pl.fecha, 'YYYY-MM-DD') AS fecha
                FROM gasto_plazos pl JOIN gastos g ON g.id = pl.gasto_id
                WHERE g.deleted_at IS NULL ORDER BY pl.fecha ASC, pl.id ASC`)
  ]);
  const pagosPorGasto = new Map();
  for (const p of pagosRes.rows) {
    if (!pagosPorGasto.has(p.gasto_id)) pagosPorGasto.set(p.gasto_id, []);
    pagosPorGasto.get(p.gasto_id).push({
      id: p.id, importe: Number(p.importe), fecha: p.fecha, metodo: p.metodo, pagado_por: p.pagado_por,
      iva: p.iva === null ? null : Number(p.iva), notas: p.notas
    });
  }
  const plazosPorGasto = new Map();
  for (const pl of plazosRes.rows) {
    if (!plazosPorGasto.has(pl.gasto_id)) plazosPorGasto.set(pl.gasto_id, []);
    plazosPorGasto.get(pl.gasto_id).push({
      id: pl.id, importe: Number(pl.importe), fecha: pl.fecha, notas: pl.notas, pago_id: pl.pago_id
    });
  }
  return gastosRes.rows.map(g => {
    const pagos = pagosPorGasto.get(g.id) || [];
    const importeTotal = Number(g.importe_total);
    const importePagado = Math.round(pagos.reduce((n, p) => n + p.importe + (p.iva || 0), 0) * 100) / 100;
    return {
      ...g,
      importe_total: importeTotal,
      importe_pagado: importePagado,
      importe_pendiente: Math.round(Math.max(importeTotal - importePagado, 0) * 100) / 100,
      estado: estadoGasto(importeTotal, importePagado),
      pagos,
      plazos: plazosPorGasto.get(g.id) || []
    };
  });
}

function registrarRutas(app, pool, requireAdmin) {
  app.get('/api/gastos', requireAdmin, async (req, res) => {
    try {
      res.json(await listarGastos(pool));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error al obtener los gastos.' });
    }
  });

  app.get('/api/proveedores', requireAdmin, async (req, res) => {
    try {
      res.json(await listarProveedores(pool));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error al obtener los proveedores.' });
    }
  });

  app.post('/api/proveedores', requireAdmin, async (req, res) => {
    const { error, datos: d } = validarProveedor(req.body);
    if (error) return res.status(400).json({ error });
    try {
      const { rows } = await pool.query(
        'INSERT INTO proveedores (nombre, iban, contrato, notas) VALUES ($1,$2,$3,$4) RETURNING id',
        [d.nombre, d.iban, d.contrato, d.notas]
      );
      res.json({ ok: true, id: rows[0].id });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error al guardar el proveedor.' });
    }
  });

  app.put('/api/proveedores/:id', requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Id inválido.' });
    const { error, datos: d } = validarProveedor(req.body);
    if (error) return res.status(400).json({ error });
    try {
      const { rowCount } = await pool.query(
        `UPDATE proveedores SET nombre=$1, iban=$2, contrato=$3, notas=$4, updated_at=NOW()
         WHERE id=$5 AND deleted_at IS NULL`,
        [d.nombre, d.iban, d.contrato, d.notas, id]
      );
      if (!rowCount) return res.status(404).json({ error: 'No encontrado.' });
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error al guardar el proveedor.' });
    }
  });

  // Borrado no destructivo: los gastos que ya tenga ese proveedor siguen
  // mostrando su nombre e IBAN con normalidad, solo deja de salir en el
  // buscador para gastos nuevos.
  app.delete('/api/proveedores/:id', requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Id inválido.' });
    try {
      const { rowCount } = await pool.query(
        'UPDATE proveedores SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL', [id]
      );
      if (!rowCount) return res.status(404).json({ error: 'No encontrado.' });
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error al eliminar el proveedor.' });
    }
  });

  app.post('/api/gastos', requireAdmin, async (req, res) => {
    const { error: errorGasto, datos: d } = validarGasto(req.body);
    if (errorGasto) return res.status(400).json({ error: errorGasto });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { error: errorProv, proveedorId } = await resolverProveedor(client, req.body);
      if (errorProv) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: errorProv });
      }
      const { rows } = await client.query(
        `INSERT INTO gastos (proveedor_id, categoria, concepto, importe_total, fecha_limite, documento, notas)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [proveedorId, d.categoria, d.concepto, d.importeTotal, d.fechaLimite, d.documento, d.notas]
      );
      await client.query('COMMIT');
      res.json({ ok: true, id: rows[0].id });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(err);
      res.status(500).json({ error: 'Error al guardar el gasto.' });
    } finally {
      client.release();
    }
  });

  app.put('/api/gastos/:id', requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Id inválido.' });
    const { error: errorGasto, datos: d } = validarGasto(req.body);
    if (errorGasto) return res.status(400).json({ error: errorGasto });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { error: errorProv, proveedorId } = await resolverProveedor(client, req.body);
      if (errorProv) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: errorProv });
      }
      const { rowCount } = await client.query(
        `UPDATE gastos SET proveedor_id=$1, categoria=$2, concepto=$3, importe_total=$4, fecha_limite=$5,
                documento=$6, notas=$7, updated_at=NOW()
         WHERE id=$8 AND deleted_at IS NULL`,
        [proveedorId, d.categoria, d.concepto, d.importeTotal, d.fechaLimite, d.documento, d.notas, id]
      );
      if (!rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'No encontrado.' });
      }
      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(err);
      res.status(500).json({ error: 'Error al guardar el gasto.' });
    } finally {
      client.release();
    }
  });

  // Borrado no destructivo, como las respuestas y los regalos.
  app.delete('/api/gastos/:id', requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Id inválido.' });
    try {
      const { rowCount } = await pool.query(
        'UPDATE gastos SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL', [id]
      );
      if (!rowCount) return res.status(404).json({ error: 'No encontrado.' });
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error al eliminar el gasto.' });
    }
  });

  app.post('/api/gastos/:id/pagos', requireAdmin, async (req, res) => {
    const gastoId = Number(req.params.id);
    if (!Number.isInteger(gastoId)) return res.status(400).json({ error: 'Id inválido.' });
    const { error, datos: d } = validarPago(req.body);
    if (error) return res.status(400).json({ error });
    try {
      const existe = await pool.query('SELECT 1 FROM gastos WHERE id = $1 AND deleted_at IS NULL', [gastoId]);
      if (!existe.rowCount) return res.status(404).json({ error: 'No encontrado.' });
      const { rows } = await pool.query(
        `INSERT INTO gasto_pagos (gasto_id, importe, fecha, metodo, pagado_por, iva, notas) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [gastoId, d.importe, d.fecha, d.metodo, d.pagadoPor, d.iva, d.notas]
      );
      res.json({ ok: true, id: rows[0].id });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error al guardar el pago.' });
    }
  });

  app.delete('/api/gastos/:id/pagos/:pagoId', requireAdmin, async (req, res) => {
    const gastoId = Number(req.params.id);
    const pagoId = Number(req.params.pagoId);
    if (!Number.isInteger(gastoId) || !Number.isInteger(pagoId)) return res.status(400).json({ error: 'Id inválido.' });
    try {
      const { rowCount } = await pool.query(
        'DELETE FROM gasto_pagos WHERE id = $1 AND gasto_id = $2', [pagoId, gastoId]
      );
      if (!rowCount) return res.status(404).json({ error: 'No encontrado.' });
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error al eliminar el pago.' });
    }
  });

  app.post('/api/gastos/:id/plazos', requireAdmin, async (req, res) => {
    const gastoId = Number(req.params.id);
    if (!Number.isInteger(gastoId)) return res.status(400).json({ error: 'Id inválido.' });
    const { error, datos: d } = validarPlazo(req.body);
    if (error) return res.status(400).json({ error });
    try {
      const existe = await pool.query('SELECT 1 FROM gastos WHERE id = $1 AND deleted_at IS NULL', [gastoId]);
      if (!existe.rowCount) return res.status(404).json({ error: 'No encontrado.' });
      const { rows } = await pool.query(
        `INSERT INTO gasto_plazos (gasto_id, importe, fecha, notas) VALUES ($1,$2,$3,$4) RETURNING id`,
        [gastoId, d.importe, d.fecha, d.notas]
      );
      res.json({ ok: true, id: rows[0].id });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error al guardar el plazo.' });
    }
  });

  // Solo se puede editar un plazo mientras no se haya pagado: una vez
  // pagado, el importe/fecha reales ya viven en el pago enlazado.
  app.put('/api/gastos/:id/plazos/:plazoId', requireAdmin, async (req, res) => {
    const gastoId = Number(req.params.id);
    const plazoId = Number(req.params.plazoId);
    if (!Number.isInteger(gastoId) || !Number.isInteger(plazoId)) return res.status(400).json({ error: 'Id inválido.' });
    const { error, datos: d } = validarPlazo(req.body);
    if (error) return res.status(400).json({ error });
    try {
      const { rowCount } = await pool.query(
        `UPDATE gasto_plazos SET importe=$1, fecha=$2, notas=$3, updated_at=NOW()
         WHERE id=$4 AND gasto_id=$5 AND pago_id IS NULL`,
        [d.importe, d.fecha, d.notas, plazoId, gastoId]
      );
      if (!rowCount) return res.status(404).json({ error: 'No encontrado o ya está pagado.' });
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error al guardar el plazo.' });
    }
  });

  app.delete('/api/gastos/:id/plazos/:plazoId', requireAdmin, async (req, res) => {
    const gastoId = Number(req.params.id);
    const plazoId = Number(req.params.plazoId);
    if (!Number.isInteger(gastoId) || !Number.isInteger(plazoId)) return res.status(400).json({ error: 'Id inválido.' });
    try {
      const { rowCount } = await pool.query(
        'DELETE FROM gasto_plazos WHERE id = $1 AND gasto_id = $2', [plazoId, gastoId]
      );
      if (!rowCount) return res.status(404).json({ error: 'No encontrado.' });
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error al eliminar el plazo.' });
    }
  });

  // Marcar un plazo previsto como pagado: crea el pago real y lo enlaza,
  // para que el calendario y el historial de pagos no se desincronicen.
  app.post('/api/gastos/:id/plazos/:plazoId/pagar', requireAdmin, async (req, res) => {
    const gastoId = Number(req.params.id);
    const plazoId = Number(req.params.plazoId);
    if (!Number.isInteger(gastoId) || !Number.isInteger(plazoId)) return res.status(400).json({ error: 'Id inválido.' });
    const { error, datos: d } = validarPago(req.body);
    if (error) return res.status(400).json({ error });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const plazo = await client.query(
        'SELECT * FROM gasto_plazos WHERE id = $1 AND gasto_id = $2 AND pago_id IS NULL', [plazoId, gastoId]
      );
      if (!plazo.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'No encontrado o ya estaba pagado.' });
      }
      const pago = await client.query(
        `INSERT INTO gasto_pagos (gasto_id, importe, fecha, metodo, pagado_por, iva, notas) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [gastoId, d.importe, d.fecha, d.metodo, d.pagadoPor, d.iva, d.notas]
      );
      await client.query('UPDATE gasto_plazos SET pago_id = $1, updated_at = NOW() WHERE id = $2', [pago.rows[0].id, plazoId]);
      await client.query('COMMIT');
      res.json({ ok: true, pagoId: pago.rows[0].id });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(err);
      res.status(500).json({ error: 'Error al marcar el plazo como pagado.' });
    } finally {
      client.release();
    }
  });
}

module.exports = { initDB, registrarRutas, CATEGORIAS, CATEGORIA_TEXTO, METODOS, METODO_TEXTO, PAGADORES };
