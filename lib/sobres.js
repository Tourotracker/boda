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

// Partículas que en España van en minúscula dentro de un nombre completo
// ("José María de la Fuente", "Ortega y Gasset", "Puig i Cadafalch").
const PARTICULAS_NOMBRE = new Set(['de', 'del', 'y', 'e', 'i', 'da', 'das', 'do', 'dos', 'di', 'van', 'von', 'der']);
// En direcciones y topónimos, además: "Camino al Monte", "Carretera a Madrid".
const PARTICULAS_LUGAR = new Set([...PARTICULAS_NOMBRE, 'al', 'a', 'en']);
// El artículo solo va en minúscula tras una partícula ("Paseo de la
// Castellana"); si no, es parte del nombre propio ("Urb. Los Pinos",
// "Calle El Greco").
const ARTICULOS = new Set(['el', 'la', 'las', 'los']);
// Abreviaturas que van en minúscula: "nº 5", "s/n", "km 3".
const ABREVIATURAS_MINUSCULA = new Set(['nº', 'n.º', 's/n', 'km']);
const ROMANO = /^(?=[mdclxvi]{2,}$)m*(c[md]|d?c{0,3})(x[cl]|l?x{0,3})(i[xv]|v?i{0,3})$/;

function capitalizarPalabra(palabra) {
  // Mayúscula en la primera letra y tras guion, apóstrofo o barra:
  // "García-Pérez", "D'Ors", "C/Mayor", "Valencia/València".
  return palabra.toLocaleLowerCase('es')
    .replace(/(^[^\p{L}\d]*|[-'’/])(\p{L})/gu, (_, antes, letra) => antes + letra.toLocaleUpperCase('es'));
}

function formatoTexto(texto, particulas, esLugar) {
  const palabras = String(texto || '').trim().split(/\s+/).filter(Boolean);
  const limpiar = p => p.toLocaleLowerCase('es').replace(/[,;:()]/g, '').replace(/\.$/, '');
  return palabras
    .map((palabra, i) => {
      const minuscula = palabra.toLocaleLowerCase('es');
      const limpia = limpiar(palabra);
      if (i > 0 && particulas.has(limpia)) return minuscula;
      if (i > 0 && ARTICULOS.has(limpia) && particulas.has(limpiar(palabras[i - 1]))) return minuscula;
      if (esLugar) {
        if (ABREVIATURAS_MINUSCULA.has(limpia) || ABREVIATURAS_MINUSCULA.has(minuscula.replace(/[,;:()]/g, ''))) return minuscula;
        if (ROMANO.test(limpia)) return palabra.toLocaleUpperCase('es'); // "Alfonso XIII"
        // Letra suelta o con número (piso/puerta): "3º B", "12-A", "4ºb" -> "4ºB"
        if (/^\p{L}$/u.test(limpia) || /\d/.test(limpia)) return palabra.toLocaleUpperCase('es');
      }
      return capitalizarPalabra(palabra);
    })
    .join(' ');
}

// "JOSÉ MARÍA DE LA FUENTE" / "josé maría de la fuente" -> "José María de la Fuente".
// La primera palabra siempre va en mayúscula: un apellido que empieza por
// partícula y va sin nombre de pila se escribe "De la Fuente" (norma RAE).
function formatoNombre(texto) {
  return formatoTexto(texto, PARTICULAS_NOMBRE, false);
}

// "AVDA. DE LA CONSTITUCIÓN 12, 3º b" -> "Avda. de la Constitución 12, 3º B"
function formatoLugar(texto) {
  return formatoTexto(texto, PARTICULAS_LUGAR, true);
}

// Los códigos postales españoles tienen 5 cifras: "4001" -> "04001".
function formatoCp(cp) {
  const limpio = String(cp || '').replace(/\s+/g, '');
  return /^\d{4}$/.test(limpio) ? '0' + limpio : limpio;
}

function nombreSobre(tratamiento, nombre, apellidos) {
  const completo = formatoNombre([nombre, apellidos].map(s => String(s || '').trim()).filter(Boolean).join(' '));
  return [tratamientoSobre(tratamiento), completo].filter(Boolean).join(' ');
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
    destinatario = 'Sres. de ' + formatoNombre(apellidos);
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
    .map(n => formatoNombre(n))
    .filter(Boolean)
    .join(' y ');

  return {
    destinatario,
    nombres,
    tipo,
    personas,
    calle: formatoLugar(r.calle),
    cp: formatoCp(r.cp),
    ciudad: formatoLugar(r.ciudad),
    provincia: formatoLugar(r.provincia),
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

module.exports = { sobre, sobresParaEnviar, tratamientoSobre, estanCasados, formatoNombre, formatoLugar, formatoCp };
