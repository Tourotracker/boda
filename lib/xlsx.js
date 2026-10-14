// Generador mínimo de ficheros .xlsx (una hoja, texto y números), sin
// dependencias: un .xlsx es un zip con unos cuantos XML dentro.
const zlib = require('zlib');

function escapeXml(str) {
  return String(str)
    // Caracteres de control que no admite XML 1.0 (romperían el fichero)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function nombreColumna(indice) {
  let n = indice + 1;
  let s = '';
  while (n > 0) {
    const resto = (n - 1) % 26;
    s = String.fromCharCode(65 + resto) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function celda(ref, valor, estilo) {
  const s = estilo ? ` s="${estilo}"` : '';
  if (typeof valor === 'number' && Number.isFinite(valor)) {
    return `<c r="${ref}"${s}><v>${valor}</v></c>`;
  }
  // Todo lo demás va como texto literal: así los códigos postales conservan
  // el 0 inicial y nada se interpreta nunca como fórmula.
  const texto = valor === null || valor === undefined ? '' : String(valor);
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escapeXml(texto)}</t></is></c>`;
}

function hojaXml(columnas, filas) {
  const ultimaCol = nombreColumna(columnas.length - 1);
  const ultimaFila = filas.length + 1;
  const cols = columnas
    .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.ancho || 15}" customWidth="1"/>`)
    .join('');
  const cabecera = `<row r="1">${columnas.map((c, i) => celda(nombreColumna(i) + '1', c.titulo, 1)).join('')}</row>`;
  const cuerpo = filas.map((fila, f) => {
    const r = f + 2;
    return `<row r="${r}">${columnas.map((c, i) => celda(nombreColumna(i) + r, fila[i], 2)).join('')}</row>`;
  }).join('');

  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    `<cols>${cols}</cols>` +
    `<sheetData>${cabecera}${cuerpo}</sheetData>` +
    `<autoFilter ref="A1:${ultimaCol}${ultimaFila}"/>` +
    '</worksheet>';
}

const ESTILOS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFF1DCD3"/><bgColor indexed="64"/></patternFill></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="3">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
  '<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

function zip(ficheros) {
  const locales = [];
  const centrales = [];
  let offset = 0;
  // Fecha fija (1/1/2026 00:00 en formato DOS): no aporta nada y así el
  // resultado es reproducible.
  const fecha = ((2026 - 1980) << 9) | (1 << 5) | 1;

  for (const { nombre, contenido } of ficheros) {
    const nombreBuf = Buffer.from(nombre, 'utf8');
    const datos = Buffer.from(contenido, 'utf8');
    const comprimido = zlib.deflateRawSync(datos);
    const crc = zlib.crc32(datos);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // nombres en UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(fecha, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comprimido.length, 18);
    local.writeUInt32LE(datos.length, 22);
    local.writeUInt16LE(nombreBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locales.push(local, nombreBuf, comprimido);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(fecha, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comprimido.length, 20);
    central.writeUInt32LE(datos.length, 24);
    central.writeUInt16LE(nombreBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrales.push(central, nombreBuf);

    offset += local.length + nombreBuf.length + comprimido.length;
  }

  const tamCentral = centrales.reduce((n, b) => n + b.length, 0);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(ficheros.length, 8);
  fin.writeUInt16LE(ficheros.length, 10);
  fin.writeUInt32LE(tamCentral, 12);
  fin.writeUInt32LE(offset, 16);

  return Buffer.concat([...locales, ...centrales, fin]);
}

// columnas: [{ titulo, ancho }], filas: [[valor, ...], ...]
function generarXlsx(nombreHoja, columnas, filas) {
  const hoja = escapeXml(String(nombreHoja).replace(/[\\/?*[\]:]/g, '').slice(0, 31) || 'Hoja1');
  return zip([
    {
      nombre: '[Content_Types].xml',
      contenido: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '</Types>'
    },
    {
      nombre: '_rels/.rels',
      contenido: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>'
    },
    {
      nombre: 'xl/workbook.xml',
      contenido: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        `<sheets><sheet name="${hoja}" sheetId="1" r:id="rId1"/></sheets>` +
        `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${hoja.replace(/'/g, "''")}'!$A$1:$${nombreColumna(columnas.length - 1)}$${filas.length + 1}</definedName></definedNames>` +
        '</workbook>'
    },
    {
      nombre: 'xl/_rels/workbook.xml.rels',
      contenido: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '</Relationships>'
    },
    { nombre: 'xl/styles.xml', contenido: ESTILOS },
    { nombre: 'xl/worksheets/sheet1.xml', contenido: hojaXml(columnas, filas) }
  ]);
}

module.exports = { generarXlsx };
