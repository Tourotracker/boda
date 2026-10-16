// Datos para los dos Excel del plano de mesas: uno agrupado por mesa (para
// los carteles de cada mesa) y otro alfabético por invitado (para el
// cartel de "busca tu nombre" en la entrada).

function personasFila(r) {
  return 1 + (r.con_acompanante === 'si' ? 1 : 0);
}

function nombreFicha(r) {
  const acomp = r.con_acompanante === 'si' && (r.acompanante_nombre || r.acompanante_apellidos)
    ? ` + ${r.acompanante_nombre || ''}` : '';
  return `${r.nombre} ${r.apellidos}${acomp}`.replace(/\s+/g, ' ').trim();
}

// Solo quienes vienen a toda la boda necesitan mesa (igual que en mesas.html).
function necesitaMesa(r) {
  return r.asiste === 'completa' || r.asiste === 'si';
}

function comparar(a, b) {
  return String(a || '').localeCompare(String(b || ''), 'es', { sensitivity: 'base' });
}

function ordenNombre(a, b) {
  return comparar(a.apellidos + ' ' + a.nombre, b.apellidos + ' ' + b.nombre);
}

function filasPorMesa(mesas, respuestas) {
  const columnas = [
    { titulo: 'Mesa', ancho: 24 },
    { titulo: 'Capacidad', ancho: 12 },
    { titulo: 'Invitado', ancho: 36 },
    { titulo: 'Personas', ancho: 10 },
    { titulo: 'Grupo', ancho: 24 }
  ];
  const mesasOrdenadas = [...mesas].sort((a, b) => comparar(a.nombre, b.nombre));
  const filas = [];

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

function filasPorInvitado(mesas, respuestas) {
  const columnas = [
    { titulo: 'Invitado', ancho: 36 },
    { titulo: 'Mesa', ancho: 24 },
    { titulo: 'Personas', ancho: 10 },
    { titulo: 'Grupo', ancho: 24 }
  ];
  const mapaMesas = new Map(mesas.map(m => [m.id, m.nombre]));
  const filas = respuestas
    .filter(necesitaMesa)
    .sort(ordenNombre)
    .map(r => [
      nombreFicha(r),
      r.mesa_id ? (mapaMesas.get(r.mesa_id) || '—') : 'Sin asignar',
      personasFila(r),
      r.grupo || ''
    ]);
  return { columnas, filas };
}

module.exports = { filasPorMesa, filasPorInvitado, personasFila, nombreFicha, necesitaMesa };
