// Lee la primera hoja de un .xlsx o un .csv (extractos del banco) y devuelve
// las filas como arrays de texto. Sin dependencias: un .xlsx es un zip con XML.
const zlib = require('zlib');

function decodificarXml(texto) {
  return texto
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

// Ficheros de un zip leyendo el directorio central (fiable aunque el zip use
// "data descriptors", como hacen Excel y muchos bancos).
function leerZip(buf) {
  let fin = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { fin = i; break; }
  }
  if (fin < 0) throw new Error('El archivo no es un Excel válido.');
  const total = buf.readUInt16LE(fin + 10);
  let p = buf.readUInt32LE(fin + 16);
  const ficheros = {};
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const metodo = buf.readUInt16LE(p + 10);
    const tamComprimido = buf.readUInt32LE(p + 20);
    const largoNombre = buf.readUInt16LE(p + 28);
    const largoExtra = buf.readUInt16LE(p + 30);
    const largoComentario = buf.readUInt16LE(p + 32);
    const offsetLocal = buf.readUInt32LE(p + 42);
    const nombre = buf.toString('utf8', p + 46, p + 46 + largoNombre);
    const inicioDatos = offsetLocal + 30 + buf.readUInt16LE(offsetLocal + 26) + buf.readUInt16LE(offsetLocal + 28);
    const datos = buf.subarray(inicioDatos, inicioDatos + tamComprimido);
    ficheros[nombre] = () => (metodo === 0 ? datos : zlib.inflateRawSync(datos)).toString('utf8');
    p += 46 + largoNombre + largoExtra + largoComentario;
  }
  return ficheros;
}

function indiceColumna(ref) {
  const letras = /^[A-Z]+/.exec(ref);
  if (!letras) return -1;
  let n = 0;
  for (const c of letras[0]) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

function leerXlsx(buf) {
  const zip = leerZip(buf);
  const textos = [];
  if (zip['xl/sharedStrings.xml']) {
    for (const [, si] of zip['xl/sharedStrings.xml']().matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      textos.push(decodificarXml([...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => m[1]).join('')));
    }
  }
  // Primera hoja según el libro (no siempre se llama sheet1.xml)
  let rutaHoja = 'xl/worksheets/sheet1.xml';
  if (zip['xl/workbook.xml'] && zip['xl/_rels/workbook.xml.rels']) {
    const primera = /<sheet\b[^>]*r:id="([^"]+)"/.exec(zip['xl/workbook.xml']());
    if (primera) {
      const rel = new RegExp(`<Relationship\\b[^>]*Id="${primera[1]}"[^>]*Target="([^"]+)"`).exec(zip['xl/_rels/workbook.xml.rels']())
        || new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${primera[1]}"`).exec(zip['xl/_rels/workbook.xml.rels']());
      if (rel) rutaHoja = rel[1].startsWith('/') ? rel[1].slice(1) : 'xl/' + rel[1].replace(/^\.\//, '');
    }
  }
  if (!zip[rutaHoja]) throw new Error('No se encuentra la hoja en el Excel.');
  const filas = [];
  for (const [, contenido] of zip[rutaHoja]().matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const fila = [];
    let siguiente = 0;
    for (const [, attrs, interior] of contenido.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs);
      const col = ref ? indiceColumna(ref[1]) : siguiente;
      siguiente = col + 1;
      const tipo = (/\bt="([^"]+)"/.exec(attrs) || [])[1];
      let valor = '';
      if (interior) {
        if (tipo === 'inlineStr') valor = [...interior.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => m[1]).join('');
        else {
          const v = /<v>([\s\S]*?)<\/v>/.exec(interior);
          valor = v ? v[1] : '';
          if (tipo === 's') valor = textos[Number(valor)] || '';
        }
      }
      fila[col] = decodificarXml(String(valor));
    }
    filas.push(Array.from(fila, v => (v === undefined ? '' : v)));
  }
  return filas;
}

function leerCsv(buf) {
  let texto = buf.toString('utf8');
  if (texto.includes('�')) texto = buf.toString('latin1'); // bancos que exportan en Windows-1252
  texto = texto.replace(/^﻿/, '');
  const muestra = texto.split(/\r?\n/).slice(0, 20).join('\n');
  const separador = [';', '\t', ','].sort((a, b) => muestra.split(b).length - muestra.split(a).length)[0];
  const filas = [];
  let fila = [];
  let campo = '';
  let entreComillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (entreComillas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') entreComillas = false;
      else campo += c;
    } else if (c === '"') entreComillas = true;
    else if (c === separador) { fila.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      fila.push(campo); filas.push(fila); fila = []; campo = '';
    } else campo += c;
  }
  if (campo || fila.length) { fila.push(campo); filas.push(fila); }
  return filas;
}

function leerTabla(buf, nombre) {
  const esZip = buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50;
  const esXlsAntiguo = buf.length > 8 && buf.readUInt32LE(0) === 0xE011CFD0;
  if (esXlsAntiguo) {
    throw new Error('Es un Excel antiguo (.xls). Ábrelo y guárdalo como .xlsx o .csv, y vuelve a subirlo.');
  }
  const filas = (esZip ? leerXlsx(buf) : leerCsv(buf))
    .map(f => f.map(v => String(v).trim()))
    .filter(f => f.some(Boolean));
  if (!filas.length) throw new Error('El archivo está vacío.');
  return filas;
}

module.exports = { leerTabla };
