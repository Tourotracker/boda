// Cómo se rotula el sobre de la invitación de cada respuesta:
// - Matrimonio (la mujer es "Sra."; "Srta." indica que no está casada):
//   una sola invitación a "Sres. de <apellidos del marido>".
// - Pareja no casada: los dos nombres en el mismo sobre.
// - Sin acompañante: el nombre del invitado.

function tratamientoSobre(tratamiento) {
  if (tratamiento === 'Sr.') return 'D.';
  if (tratamiento === 'Sra.' || tratamiento === 'Srta.') return 'Dña.';
  return '';
}

function nombreSobre(tratamiento, nombre, apellidos) {
  return [tratamientoSobre(tratamiento), nombre, apellidos]
    .map(s => String(s || '').trim())
    .filter(Boolean)
    .join(' ');
}

function tieneAcompanante(r) {
  return r.con_acompanante === 'si' &&
    Boolean(String(r.acompanante_nombre || '').trim() || String(r.acompanante_apellidos || '').trim());
}

function estanCasados(r) {
  return tieneAcompanante(r) && (r.tratamiento === 'Sra.' || r.acompanante_tratamiento === 'Sra.');
}

function sobre(r) {
  const avisos = [];
  const titular = nombreSobre(r.tratamiento, r.nombre, r.apellidos);

  let tipo;
  let destinatario;
  let personas;

  if (!tieneAcompanante(r)) {
    tipo = 'Individual';
    destinatario = titular;
    personas = 1;
  } else if (estanCasados(r)) {
    tipo = 'Matrimonio';
    personas = 2;
    const titularEsHombre = r.tratamiento === 'Sr.';
    const acompEsHombre = r.acompanante_tratamiento === 'Sr.';
    let apellidos;
    if (acompEsHombre && !titularEsHombre) {
      apellidos = r.acompanante_apellidos;
    } else {
      apellidos = r.apellidos;
      if (titularEsHombre === acompEsHombre) {
        avisos.push('No se distingue al marido por el tratamiento (Sr./Sra.): se han usado los apellidos del invitado principal');
      }
    }
    apellidos = String(apellidos || '').trim();
    if (!apellidos) avisos.push('Faltan los apellidos del marido');
    destinatario = 'Sres. de ' + apellidos;
  } else {
    tipo = 'Pareja';
    personas = 2;
    destinatario = titular + ' y ' +
      nombreSobre(r.acompanante_tratamiento, r.acompanante_nombre, r.acompanante_apellidos);
  }

  if (!String(r.calle || '').trim() || !String(r.cp || '').trim() || !String(r.ciudad || '').trim()) {
    avisos.push('Falta la dirección postal');
  }

  // Solo los nombres de pila ("Javier y Elena"), para distinguir sobres de
  // familiares que comparten apellidos.
  const nombres = [r.nombre, tieneAcompanante(r) ? r.acompanante_nombre : '']
    .map(n => String(n || '').trim())
    .filter(Boolean)
    .join(' y ');

  return {
    destinatario,
    nombres,
    tipo,
    personas,
    calle: r.calle || '',
    cp: r.cp || '',
    ciudad: r.ciudad || '',
    provincia: r.provincia || '',
    avisos
  };
}

// Quien ha dicho que no viene no recibe invitación por correo.
function sobresParaEnviar(respuestas) {
  return respuestas
    .filter(r => r.asiste !== 'no')
    .slice()
    .sort((a, b) =>
      String(a.apellidos || '').localeCompare(String(b.apellidos || ''), 'es', { sensitivity: 'base' }) ||
      String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es', { sensitivity: 'base' }))
    .map(r => ({ ...sobre(r), asiste: r.asiste, invitadoPor: r.invitado_por || '', grupo: r.grupo || '' }));
}

module.exports = { sobre, sobresParaEnviar, tratamientoSobre, estanCasados };
