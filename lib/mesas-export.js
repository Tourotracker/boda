// Datos para los dos Excel del plano de mesas: uno agrupado por mesa (para
// los carteles de cada mesa) y otro alfabético por invitado (para el
// cartel de "busca tu nombre" en la entrada).
const { sobre, formatoNombre, tieneAcompanante } = require('./sobres');

function personasFila(r) {
  return 1 + (r.con_acompanante === 'si' ? 1 : 0);
}

// El mismo nombre que en el sobre de la invitación. Si en el Excel hay más
// de un matrimonio con el mismo sobre ("Sres. de Pérez García"), se añaden
// sus nombres entre paréntesis para distinguirlos: "Sres. de Pérez García
// (Juan y Ana)". Devuelve una función id -> nombre para esas fichas.
// "Camacho Rodríguez", "CAMACHO RODRIGUEZ" y "Camacho Rodri\u0301guez" (tilde
// guardada aparte, como hacen algunos móviles) cuentan como el mismo sobre.
function claveSobre(texto) {
  return String(texto).normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('es').replace(/\s+/g, ' ').trim();
}

function nombresDeSobre(fichas) {
  const sobres = new Map(fichas.map(r => [r.id, sobre(r)]));
  const veces = new Map();
  for (const s of sobres.values()) {
    if (s.tipo !== 'Matrimonio') continue;
    const clave = claveSobre(s.destinatario);
    veces.set(clave, (veces.get(clave) || 0) + 1);
  }
  return r => {
    const s = sobres.get(r.id) || sobre(r);
    const repetido = s.tipo === 'Matrimonio' && veces.get(claveSobre(s.destinatario)) > 1;
    return repetido && s.nombres ? `${s.destinatario} (${s.nombres})` : s.destinatario;
  };
}

// Solo quienes vienen a toda la boda necesitan mesa (igual que en mesas.html).
function necesitaMesa(r) {
  return r.asiste === 'completa' || r.asiste === 'si';
}

function comparar(a, b) {
  return String(a || '').localeCompare(String(b || ''), 'es', { sensitivity: 'base' });
}

// "Mesa 2" antes que "Mesa 10": compara los números dentro del nombre en
// vez de letra a letra (si no, "Mesa 10" queda antes que "Mesa 2").
function compararMesas(a, b) {
  return String(a || '').localeCompare(String(b || ''), 'es', { sensitivity: 'base', numeric: true });
}

// Nombre de una persona tal cual se apuntó en su ficha: el tratamiento que
// eligió (Sr./Sra./Srta. o el texto libre de "Otro"), no el que le
// correspondería como "Sr. D." del sobre de la invitación.
function nombreIndividual(tratamiento, nombre, apellidos) {
  return [tratamiento, nombre, apellidos]
    .map(t => formatoNombre(String(t || '').trim()))
    .filter(Boolean)
    .join(' ');
}

// Alfabetiza por los apellidos del sobre (en un matrimonio, los del marido,
// que son los que se ven en el Excel como "Sres. de ..."), no por los
// apellidos en crudo de la ficha: si no, el orden visible no cuadraría con
// el nombre que de verdad se lee en cada fila.
function ordenNombre(a, b) {
  return comparar(sobre(a).apellidosOrden + ' ' + a.nombre, sobre(b).apellidosOrden + ' ' + b.nombre);
}

function filasPorMesa(mesas, respuestas) {
  const columnas = [
    { titulo: 'Mesa', ancho: 24 },
    { titulo: 'Capacidad', ancho: 12 },
    { titulo: 'Invitado', ancho: 36 },
    { titulo: 'Personas', ancho: 10 },
    { titulo: 'Grupo', ancho: 24 }
  ];
  const mesasOrdenadas = [...mesas].sort((a, b) => compararMesas(a.nombre, b.nombre));
  const filas = [];
  const idsMesas = new Set(mesas.map(m => m.id));
  const nombreFicha = nombresDeSobre(respuestas.filter(r => idsMesas.has(r.mesa_id) || (necesitaMesa(r) && !r.mesa_id)));

  for (const mesa of mesasOrdenadas) {
    const asignados = respuestas.filter(r => r.mesa_id === mesa.id).sort(ordenNombre);
    if (!asignados.length) {
      filas.push([mesa.nombre, mesa.capacidad, '— sin invitados asignados —', '', '']);
      continue;
    }
    asignados.forEach((r, i) => {
      filas.push([
        i === 0 ? mesa.nombre : '',
        i === 0 ? mesa.capacidad : '',
        nombreFicha(r),
        personasFila(r),
        r.grupo || ''
      ]);
    });
  }

  const sinMesa = respuestas.filter(r => necesitaMesa(r) && !r.mesa_id).sort(ordenNombre);
  if (sinMesa.length) {
    sinMesa.forEach((r, i) => {
      filas.push([
        i === 0 ? 'SIN MESA ASIGNADA' : '',
        '',
        nombreFicha(r),
        personasFila(r),
        r.grupo || ''
      ]);
    });
  }

  return { columnas, filas };
}

// Una fila por persona (no por ficha): a quien venga con acompañante se le
// da su propia línea, con su propio tratamiento, para el cartel de "busca tu
// nombre" en la entrada (ahí cada uno busca el suyo, no el de la pareja).
function filasPorInvitado(mesas, respuestas) {
  const columnas = [
    { titulo: 'Invitado', ancho: 36 },
    { titulo: 'Mesa', ancho: 24 },
    { titulo: 'Grupo', ancho: 24 }
  ];
  const mapaMesas = new Map(mesas.map(m => [m.id, m.nombre]));

  const personas = [];
  for (const r of respuestas.filter(necesitaMesa)) {
    personas.push({ texto: nombreIndividual(r.tratamiento, r.nombre, r.apellidos), apellidos: r.apellidos, nombre: r.nombre, ficha: r });
    if (tieneAcompanante(r)) {
      personas.push({
        texto: nombreIndividual(r.acompanante_tratamiento, r.acompanante_nombre, r.acompanante_apellidos),
        apellidos: r.acompanante_apellidos, nombre: r.acompanante_nombre, ficha: r
      });
    }
  }

  const filas = personas
    .sort((a, b) => comparar(a.apellidos + ' ' + a.nombre, b.apellidos + ' ' + b.nombre))
    .map(p => [
      p.texto,
      p.ficha.mesa_id ? (mapaMesas.get(p.ficha.mesa_id) || '—') : 'Sin asignar',
      p.ficha.grupo || ''
    ]);
  return { columnas, filas };
}

module.exports = { filasPorMesa, filasPorInvitado, personasFila, nombresDeSobre, necesitaMesa };
