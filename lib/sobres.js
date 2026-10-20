// Cómo se rotula el sobre de la invitación de cada respuesta:
// - Matrimonio (la mujer es "Sra."; "Srta." indica que no está casada):
//   una sola invitación a "Sres. de <los dos apellidos del marido>", o, si
//   se marca, "Sres. <1er apellido del marido> <1er apellido de la mujer>".
// - Pareja no casada: los dos nombres en el mismo sobre.
// - Sin acompañante: el nombre del invitado.

function tratamientoSobre(tratamiento) {
  if (tratamiento === 'Sr.') return 'Sr. D.';
  if (tratamiento === 'Sra.') return 'Sra. Dña.';
  if (tratamiento === 'Srta.') return 'Srta. Dña.';
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

// Ortografía: apellidos, nombres y lugares españoles que llevan tilde y se
// suelen escribir sin ella ("Rodriguez" -> "Rodríguez"), y algunos que se
// escriben con tilde y no la llevan ("Ruíz" -> "Ruiz"). Solo se tocan palabras
// de esta lista; lo que no está se deja como se escribió.
const CON_TILDE = [
  // Apellidos
  'Ábalos', 'Alarcón', 'Álvarez', 'Aragón', 'Ávila', 'Báez', 'Benítez', 'Bermúdez', 'Calderón', 'Cánovas',
  'Cárdenas', 'Castellón', 'Chávez', 'Colón', 'Cortázar', 'Cortés', 'Díaz', 'Domínguez', 'Durán', 'Echevarría',
  'Echeverría', 'Estévez', 'Fernández', 'Galán', 'Gálvez', 'Galván', 'Garcés', 'García', 'Giménez', 'Godínez',
  'Gómez', 'González', 'Guzmán', 'Gutiérrez', 'Hernández', 'Ibáñez', 'Íñiguez', 'Jiménez', 'Juárez', 'Lázaro',
  'León', 'López', 'Marín', 'Mármol', 'Márquez', 'Martín', 'Martínez', 'Méndez', 'Montalbán', 'Morán',
  'Narváez', 'Núñez', 'Ordóñez', 'Páez', 'Peláez', 'Pérez', 'Pinzón', 'Ramírez', 'Rincón', 'Ríos',
  'Rodríguez', 'Román', 'Rubén', 'Sáenz', 'Sáez', 'Sánchez', 'Santamaría', 'Simón', 'Solís', 'Suárez', 'Téllez',
  'Valdés', 'Vázquez', 'Velázquez', 'Vélez', 'Yáñez', 'Zúñiga', 'Alcántara', 'Cáceres',
  'Ferrándiz', 'Hernán', 'Valcárcel', 'Villalón', 'Andújar',
  // Nombres
  'Adrián', 'Agustín', 'Álvaro', 'Ángel', 'Ángela', 'Ángeles', 'Andrés', 'Aarón', 'Asunción', 'Bárbara',
  'Belén', 'Benjamín', 'César', 'Concepción', 'Cristóbal', 'Darío', 'Débora', 'Elías', 'Encarnación', 'Fátima',
  'Félix', 'Fermín', 'Germán', 'Héctor', 'Inés', 'Íñigo', 'Iván', 'Jerónimo', 'Jesús', 'Joaquín', 'José',
  'Julián', 'Lucía', 'María', 'Matías', 'Moisés', 'Mónica', 'Nicolás', 'Noé', 'Noemí', 'Óscar', 'Purificación',
  'Ramón', 'Raúl', 'Rocío', 'Rosalía', 'Saúl', 'Sebastián', 'Sofía', 'Tomás', 'Verónica', 'Víctor', 'Damián', 'Fabián',
  // Lugares y palabras de direcciones
  'Alcalá', 'Alcorcón', 'Almería', 'Almuñécar', 'Andalucía', 'Ático', 'Avilés', 'Benalmádena',
  'Cádiz', 'Callejón', 'Chamartín', 'Chamberí', 'Constitución', 'Córdoba', 'Écija', 'Gijón', 'Jaén', 'Leganés',
  'Mahón', 'Málaga', 'Mérida', 'Móstoles', 'Príncipe', 'Río', 'Tetuán', 'Torrejón', 'Travesía',
  'Úbeda', 'Urbanización', 'Pío', 'Génova', 'París'
];
const SIN_TILDE = ['Ruiz', 'Ortiz', 'Muñiz', 'Sainz', 'Saiz', 'Luis', 'Ruth', 'Feijoo', 'Garcia'];

function claveOrtografia(t) {
  return t.toLocaleLowerCase('es').replace(/[áàä]/g, 'a').replace(/[éèë]/g, 'e').replace(/[íìï]/g, 'i')
    .replace(/[óòö]/g, 'o').replace(/[úùü]/g, 'u');
}
const ORTOGRAFIA = new Map();
for (const w of CON_TILDE) if (!w.includes(' ')) ORTOGRAFIA.set(claveOrtografia(w), w.toLocaleLowerCase('es'));
// "Garcia" está en SIN_TILDE solo para no duplicarla: García sí lleva tilde.
for (const w of SIN_TILDE) if (w !== 'Garcia') ORTOGRAFIA.set(claveOrtografia(w), w.toLocaleLowerCase('es'));

// Corrige la tilde de cada parte de la palabra (también "Garcia-Perez"),
// respetando la puntuación que lleve pegada ("Rodriguez," -> "Rodríguez,").
function corregirOrtografia(palabra) {
  return palabra.replace(/\p{L}+/gu, parte => {
    const correcta = ORTOGRAFIA.get(claveOrtografia(parte));
    return correcta && correcta !== parte.toLocaleLowerCase('es') ? correcta : parte;
  });
}

function capitalizarPalabra(palabra) {
  // Mayúscula en la primera letra y tras guion, apóstrofo o barra:
  // "García-Pérez", "D'Ors", "C/Mayor", "Valencia/València".
  return palabra.toLocaleLowerCase('es')
    .replace(/(^[^\p{L}\d]*|[-'’/])(\p{L})/gu, (_, antes, letra) => antes + letra.toLocaleUpperCase('es'));
}

function formatoTexto(texto, particulas, esLugar) {
  // NFC: la tilde junto a su letra, aunque el móvil la guardara aparte.
  const palabras = String(texto || '').normalize('NFC').trim().split(/\s+/).filter(Boolean);
  const limpiar = p => p.toLocaleLowerCase('es').replace(/[,;:()]/g, '').replace(/\.$/, '');
  return palabras
    .map(corregirOrtografia)
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

// Primer apellido, con sus partículas: "Pérez García" -> "Pérez",
// "de la Fuente García" -> "de la Fuente", "García-Pérez Ruiz" -> "García-Pérez".
function primerApellido(apellidos) {
  const palabras = String(apellidos || '').trim().split(/\s+/).filter(Boolean);
  const resultado = [];
  for (const palabra of palabras) {
    resultado.push(palabra);
    const minuscula = palabra.toLocaleLowerCase('es');
    if (!PARTICULAS_NOMBRE.has(minuscula) && !ARTICULOS.has(minuscula)) break;
  }
  return resultado.join(' ');
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
    let apellidosMujer;
    if (acompEsHombre && !titularEsHombre) {
      apellidos = r.acompanante_apellidos;
      apellidosMujer = r.apellidos;
    } else {
      apellidos = r.apellidos;
      apellidosMujer = r.acompanante_apellidos;
      if (titularEsHombre === acompEsHombre) {
        avisos.push('No se distingue al marido por el tratamiento (Sr./Sra.): se han usado los apellidos del invitado principal');
      }
    }
    apellidos = String(apellidos || '').trim();
    if (!apellidos) avisos.push('Faltan los apellidos del marido');
    // La marca solo afecta a matrimonios: en el resto no hace nada (así se
    // puede marcar un grupo entero en bloque sin efectos raros).
    if (r.sobre_dos_apellidos) {
      // "Sres. <1er apellido del marido> <1er apellido de la mujer>" (sin "de")
      const deLaMujer = primerApellido(apellidosMujer);
      if (!deLaMujer) avisos.push('Faltan los apellidos de la mujer: se ha puesto solo el del marido');
      destinatario = 'Sres. ' + formatoNombre([primerApellido(apellidos), deLaMujer].filter(Boolean).join(' '));
    } else {
      destinatario = 'Sres. de ' + formatoNombre(apellidos);
    }
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

// Quien ha dicho que no viene no recibe invitación por correo, salvo que se
// haya marcado "enviar invitación aunque no venga".
function sobresParaEnviar(respuestas) {
  return respuestas
    .filter(r => r.asiste !== 'no' || r.enviar_invitacion)
    .slice()
    .sort((a, b) =>
      String(a.apellidos || '').localeCompare(String(b.apellidos || ''), 'es', { sensitivity: 'base' }) ||
      String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es', { sensitivity: 'base' }))
    .map(r => ({ ...sobre(r), asiste: r.asiste, invitadoPor: r.invitado_por || '', grupo: r.grupo || '' }));
}

module.exports = { sobre, sobresParaEnviar, tratamientoSobre, estanCasados, formatoNombre, formatoLugar, formatoCp, primerApellido };
