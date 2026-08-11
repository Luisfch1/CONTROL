import JSZip from 'jszip';

const wNs = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

// --- Helpers de Conversión ---
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

function escapeXML(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// --- Generador de Documento Vacío (ZIP mínimo de Word) ---
function createBlankDocx(): JSZip {
  const zip = new JSZip();

  // 1. [Content_Types].xml
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="jpg" ContentType="image/jpeg"/>
  <Default Extension="jpeg" ContentType="image/jpeg"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);

  // 2. _rels/.rels
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);

  // 3. word/_rels/document.xml.rels
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`);

  return zip;
}

// --- Generadores de XML en Arial 11pt para Párrafos ---
function generateParagraphXML(text: string, options?: { bold?: boolean; italic?: boolean; align?: 'left' | 'center' | 'right' | 'justify'; sizeHalfPt?: number; spacingBefore?: number; spacingAfter?: number }): string {
  const align = options?.align || 'left';
  const size = options?.sizeHalfPt || 22; // 22 half-points = 11pt
  const boldStr = options?.bold ? '<w:b/>' : '';
  const italicStr = options?.italic ? '<w:i/>' : '';
  
  let spacing = '';
  if (options?.spacingBefore !== undefined || options?.spacingAfter !== undefined) {
    const before = options.spacingBefore !== undefined ? ` w:before="${options.spacingBefore}"` : '';
    const after = options.spacingAfter !== undefined ? ` w:after="${options.spacingAfter}"` : '';
    spacing = `<w:spacing${before}${after}/>`;
  }

  return `<w:p>
    <w:pPr>
      <w:jc w:val="${align}"/>
      ${spacing}
    </w:pPr>
    <w:r>
      <w:rPr>
        <w:rFonts w:ascii="Arial" w:hAnsi="Arial"/>
        <w:sz w:val="${size}"/>
        ${boldStr}
        ${italicStr}
      </w:rPr>
      <w:t>${escapeXML(text)}</w:t>
    </w:r>
  </w:p>`;
}

// --- Generador de Tablas Nativas en Calibri 9pt ---
function generateTableXML(headers: string[], rows: string[][], colWidthsDxa?: number[]): string {
  let xml = `<w:tbl>`;
  xml += `<w:tblPr>
    <w:tblW w:w="5000" w:type="pct"/>
    <w:tblBorders>
      <w:top w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>
      <w:bottom w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>
      <w:left w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>
      <w:right w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>
      <w:insideH w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/>
      <w:insideV w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/>
    </w:tblBorders>
  </w:tblPr>`;

  // Encabezados (Calibri 9pt Bold)
  xml += `<w:tr><w:trPr><w:tblHeader/></w:trPr>`;
  headers.forEach((hdr, idx) => {
    const w = colWidthsDxa ? colWidthsDxa[idx] : 1500;
    xml += `<w:tc>
      <w:tcPr>
        <w:tcW w:w="${w}" w:type="dxa"/>
        <w:shd w:val="clear" w:color="auto" w:fill="F1F5F9"/>
      </w:tcPr>
      <w:p>
        <w:pPr><w:jc w:val="center"/></w:pPr>
        <w:r>
          <w:rPr>
            <w:b/>
            <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>
            <w:sz w:val="18"/> <!-- 18 half-points = 9pt -->
          </w:rPr>
          <w:t>${escapeXML(hdr)}</w:t>
        </w:r>
      </w:p>
    </w:tc>`;
  });
  xml += `</w:tr>`;

  // Filas (Calibri 9pt)
  rows.forEach(row => {
    // Detectar si la fila representa un total o subtotales
    const firstCellUpper = row[0]?.toUpperCase() || "";
    const isBoldRow = firstCellUpper.includes("TOTAL") || firstCellUpper.includes("AIU") || firstCellUpper.includes("COSTO DIRECTO");
    const boldStr = isBoldRow ? '<w:b/>' : '';
    const rowFill = isBoldRow ? 'F8FAFC' : 'auto';

    xml += `<w:tr>`;
    row.forEach((cell, idx) => {
      const w = colWidthsDxa ? colWidthsDxa[idx] : 1500;
      let alignment = "left";
      
      const cleanVal = cell.trim();
      if (cleanVal.startsWith("$") || cleanVal.endsWith("%") || /^[0-9]+([.,][0-9]+)?$/.test(cleanVal.replace(/[$% ]/g, ''))) {
        alignment = "right";
      } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(cleanVal) || cleanVal.length <= 6) {
        alignment = "center";
      }

      xml += `<w:tc>
        <w:tcPr>
          <w:tcW w:w="${w}" w:type="dxa"/>
          ${isBoldRow ? `<w:shd w:val="clear" w:color="auto" w:fill="${rowFill}"/>` : ''}
        </w:tcPr>
        <w:p>
          <w:pPr><w:jc w:val="${alignment}"/></w:pPr>
          <w:r>
            <w:rPr>
              <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>
              <w:sz w:val="18"/>
              ${boldStr}
            </w:rPr>
            <w:t>${escapeXML(cell)}</w:t>
          </w:r>
        </w:p>
      </w:tc>`;
    });
    xml += `</w:tr>`;
  });

  xml += `</w:tbl>`;
  return xml;
}

// --- Generador de XML de Dibujo para Imágenes ---
function generateImageXML(rId: string, widthCm: number = 14, heightCm: number = 9.5): string {
  const cx = Math.round(widthCm * 360000);
  const cy = Math.round(heightCm * 360000);
  const imgId = Math.floor(Math.random() * 1000000);

  return `<w:p>
    <w:pPr><w:jc w:val="center"/></w:pPr>
    <w:r>
      <w:drawing>
        <wp:inline distT="0" distB="0" distL="0" distR="0">
          <wp:extent cx="${cx}" cy="${cy}"/>
          <wp:effectExtent l="0" t="0" r="0" b="0"/>
          <wp:docPr id="${imgId}" name="Imagen_${imgId}"/>
          <wp:cNvGraphicFramePr>
            <a:graphicFrameLocks noChangeAspect="1"/>
          </wp:cNvGraphicFramePr>
          <a:graphic>
            <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
              <pic:pic>
                <pic:nvPicPr>
                  <pic:cNvPr id="${imgId}" name="Imagen_${imgId}"/>
                  <pic:cNvPicPr/>
                </pic:nvPicPr>
                <pic:blipFill>
                  <a:blip r:embed="${rId}"/>
                  <a:stretch><a:fillRect/></a:stretch>
                </pic:blipFill>
                <pic:spPr>
                  <a:xfrm>
                    <a:off x="0" y="0"/>
                    <a:ext cx="${cx}" cy="${cy}"/>
                  </a:xfrm>
                  <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
                </pic:spPr>
              </pic:pic>
            </a:graphicData>
          </a:graphic>
        </wp:inline>
      </w:drawing>
    </w:r>
  </w:p>`;
}

// --- Generador de Tabla para Rejilla de Fotos sin bordes (2 fotos por fila) ---
function generatePhotosGridXML(photoRIds: { rId: string; label: string }[]): string {
  let xml = `<w:tbl>`;
  xml += `<w:tblPr>
    <w:tblW w:w="5000" w:type="pct"/>
    <w:tblBorders>
      <w:top w:val="none"/><w:bottom w:val="none"/><w:left w:val="none"/><w:right w:val="none"/>
      <w:insideH w:val="none"/><w:insideV w:val="none"/>
    </w:tblBorders>
  </w:tblPr>`;

  for (let i = 0; i < photoRIds.length; i += 2) {
    // Fila para las imágenes
    xml += `<w:tr>`;
    for (let col = 0; col < 2; col++) {
      const pIdx = i + col;
      xml += `<w:tc><w:tcPr><w:tcW w:w="2500" w:type="pct"/></w:tcPr>`;
      if (pIdx < photoRIds.length) {
        const item = photoRIds[pIdx];
        const cx = Math.round(6.8 * 360000); // 6.8cm de ancho
        const cy = Math.round(5.1 * 360000); // 5.1cm de alto
        const imgId = Math.floor(Math.random() * 1000000);

        xml += `<w:p>
          <w:pPr><w:jc w:val="center"/></w:pPr>
          <w:r>
            <w:drawing>
              <wp:inline distT="0" distB="0" distL="0" distR="0">
                <wp:extent cx="${cx}" cy="${cy}"/>
                <wp:effectExtent l="0" t="0" r="0" b="0"/>
                <wp:docPr id="${imgId}" name="Imagen_${imgId}"/>
                <wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>
                <a:graphic>
                  <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
                    <pic:pic>
                      <pic:nvPicPr>
                        <pic:cNvPr id="${imgId}" name="Imagen_${imgId}"/>
                        <pic:cNvPicPr/>
                      </pic:nvPicPr>
                      <pic:blipFill>
                        <a:blip r:embed="${item.rId}"/>
                        <a:stretch><a:fillRect/></a:stretch>
                      </pic:blipFill>
                      <pic:spPr>
                        <a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>
                        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
                      </pic:spPr>
                    </pic:pic>
                  </a:graphicData>
                </a:graphic>
              </wp:inline>
            </w:drawing>
          </w:r>
        </w:p>`;
      } else {
        xml += `<w:p><w:r><w:t></w:t></w:r></w:p>`;
      }
      xml += `</w:tc>`;
    }
    xml += `</w:tr>`;

    // Fila para los pies de foto descriptivos (Arial 11pt Italic)
    xml += `<w:tr>`;
    for (let col = 0; col < 2; col++) {
      const pIdx = i + col;
      xml += `<w:tc><w:tcPr><w:tcW w:w="2500" w:type="pct"/></w:tcPr>`;
      if (pIdx < photoRIds.length) {
        xml += `<w:p>
          <w:pPr>
            <w:jc w:val="center"/>
            <w:spacing w:after="240"/>
          </w:pPr>
          <w:r>
            <w:rPr>
              <w:rFonts w:ascii="Arial" w:hAnsi="Arial"/>
              <w:sz w:val="22"/> <!-- Arial 11pt -->
              <w:i/> <!-- Italic -->
            </w:rPr>
            <w:t>${escapeXML(photoRIds[pIdx].label)}</w:t>
          </w:r>
        </w:p>`;
      } else {
        xml += `<w:p><w:r><w:t></w:t></w:r></w:p>`;
      }
      xml += `</w:tc>`;
    }
    xml += `</w:tr>`;
  }

  xml += `</w:tbl>`;
  return xml;
}

// Helper para descargar imagen remota
async function fetchImageBuffer(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.statusText}`);
  }
  return response.arrayBuffer();
}

// --- Generador de Documento desde Cero ---
export async function exportDocxReport(
  reportData: any,
  curveS1Base64?: string,
  curveS2Base64?: string
): Promise<Blob> {
  const zip = createBlankDocx();

  const parser = new DOMParser();
  const serializer = new XMLSerializer();

  // 1. Cargar relaciones
  const relsFile = zip.file('word/_rels/document.xml.rels')!;
  const relsText = await relsFile.async('text');
  const relsDoc = parser.parseFromString(relsText, 'application/xml');
  const relationships = relsDoc.getElementsByTagName('Relationships')[0];

  let relIdCounter = 1000;
  const addImageToDoc = async (buffer: ArrayBuffer, ext: string = 'png'): Promise<string> => {
    const rId = `rIdImg${relIdCounter++}`;
    const filename = `media/image_${rId}.${ext}`;
    
    zip.file(`word/${filename}`, buffer);

    const newRel = relsDoc.createElement('Relationship');
    newRel.setAttribute('Id', rId);
    newRel.setAttribute('Type', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image');
    newRel.setAttribute('Target', filename);
    relationships.appendChild(newRel);

    return rId;
  };

  // 2. Procesar imágenes en segundo plano (Curvas S)
  let curveS1Id: string | null = null;
  let curveS2Id: string | null = null;

  if (curveS1Base64) {
    try {
      const cleanB64 = curveS1Base64.replace(/^data:image\/\w+;base64,/, "");
      curveS1Id = await addImageToDoc(base64ToArrayBuffer(cleanB64), 'png');
    } catch (e) {
      console.error("Error embedding Curve S1:", e);
    }
  }

  if (curveS2Base64) {
    try {
      const cleanB64 = curveS2Base64.replace(/^data:image\/\w+;base64,/, "");
      curveS2Id = await addImageToDoc(base64ToArrayBuffer(cleanB64), 'png');
    } catch (e) {
      console.error("Error embedding Curve S2:", e);
    }
  }

  // Pre-procesar todas las fotos agrupadas por ítem
  const groupedPhotoRIds: Record<string, { rId: string; label: string }[]> = {};
  if (reportData.photoGroups && Array.isArray(reportData.photoGroups)) {
    for (const group of reportData.photoGroups) {
      groupedPhotoRIds[group.itemCode] = [];
      for (const p of group.photos) {
        try {
          let buffer: ArrayBuffer | null = null;
          let ext = 'jpg';

          if (p.base64Data) {
            if (p.base64Data.startsWith('blob:')) {
              buffer = await fetchImageBuffer(p.base64Data);
            } else {
              const cleanB64 = p.base64Data.replace(/^data:image\/\w+;base64,/, "");
              const match = p.base64Data.match(/^data:image\/(\w+);base64,/);
              if (match) ext = match[1];
              buffer = base64ToArrayBuffer(cleanB64);
            }
          } else if (p.imageUrl) {
            buffer = await fetchImageBuffer(p.imageUrl);
            if (p.imageUrl.endsWith('.png')) ext = 'png';
          }

          if (buffer) {
            const rId = await addImageToDoc(buffer, ext);
            groupedPhotoRIds[group.itemCode].push({
              rId,
              label: `${p.date || ""} - ${p.description || ""}`
            });
          }
        } catch (e) {
          console.error(`Error processing photo in item ${group.itemCode}:`, e);
        }
      }
    }
  }

  let bodyXml = `<w:document xmlns:w="${wNs}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">`;
  bodyXml += `<w:body>`;

  // --- TÍTULO PRINCIPAL (Arial 11pt Bold Centered) ---
  bodyXml += generateParagraphXML("INFORME DE INSUMOS DE CONTROL MENSUAL", { bold: true, align: 'center', spacingAfter: 240, sizeHalfPt: 26 });
  bodyXml += generateParagraphXML(`Periodo de Corte: ${reportData.periodLabel || ""}`, { bold: true, align: 'center', spacingAfter: 360 });

  // --- METADATOS DEL CONTRATO ---
  bodyXml += generateParagraphXML("DATOS GENERALES DEL CONTRATO", { bold: true, spacingAfter: 120 });
  const metaRows = [
    ["Objeto de la Obra", reportData.objetoObra || ""],
    ["Número de Contrato", reportData.noContrato || ""],
    ["Contratista de Obra", `${reportData.contratistaObra || ""} (NIT: ${reportData.nitObra || ""})`],
    ["Representante Obra", reportData.repLegalObra || ""],
    ["Interventoría", reportData.contratistaInterventoria || ""],
    ["Representante Interventoría", reportData.repLegalInterventoria || ""],
    ["Supervisor FFIE", reportData.supervisorFfie || ""],
    ["Jornada de Trabajo", reportData.jornadasTrabajo || ""]
  ];
  bodyXml += generateTableXML(["Concepto Contractual", "Detalle"], metaRows, [2200, 3800]);
  bodyXml += generateParagraphXML("", { spacingAfter: 300 });

  // --- CUADRO DE AVANCE (Calibri 9pt) ---
  bodyXml += generateParagraphXML("1. CUADRO DE AVANCE DE OBRA ACUMULADO", { bold: true, spacingAfter: 120 });
  bodyXml += generateTableXML(reportData.progressHeaders, reportData.progressRows);
  bodyXml += generateParagraphXML("", { spacingAfter: 360 });

  // --- GRÁFICAS DE AVANCE ---
  bodyXml += generateParagraphXML("2. GRÁFICAS DE CONTROL Y AVANCE (CURVA S)", { bold: true, spacingAfter: 120 });
  
  if (curveS1Id) {
    bodyXml += generateParagraphXML("2.1 Avance Físico Real vs. Programación Planificada", { bold: true, italic: true, spacingAfter: 60 });
    bodyXml += generateImageXML(curveS1Id, 13.5, 7.2);
    bodyXml += generateParagraphXML("", { spacingAfter: 180 });
  }

  if (curveS2Id) {
    bodyXml += generateParagraphXML("2.2 Avance Financiero vs. Avance Físico Real", { bold: true, italic: true, spacingAfter: 60 });
    bodyXml += generateImageXML(curveS2Id, 13.5, 7.2);
    bodyXml += generateParagraphXML("", { spacingAfter: 300 });
  }

  // --- REGISTRO FOTOGRÁFICO ---
  bodyXml += generateParagraphXML("3. REGISTRO FOTOGRÁFICO DEL PERIODO", { bold: true, spacingAfter: 120 });
  if (reportData.photoGroups && reportData.photoGroups.length > 0) {
    for (const group of reportData.photoGroups) {
      const rIds = groupedPhotoRIds[group.itemCode] || [];
      if (rIds.length > 0) {
        // Título del Ítem
        bodyXml += generateParagraphXML(`Actividad: Ítem. ${group.itemCode} ${group.description}.`, { bold: true, spacingBefore: 120, spacingAfter: 100 });
        // Rejilla compacta de fotos
        bodyXml += generatePhotosGridXML(rIds);
        bodyXml += generateParagraphXML("", { spacingAfter: 120 });
      }
    }
  } else {
    bodyXml += generateParagraphXML("(No se registran fotos de avance para actividades en el periodo seleccionado)", { italic: true, spacingAfter: 120 });
  }
  bodyXml += generateParagraphXML("", { spacingAfter: 240 });

  // --- CORRESPONDENCIA ---
  bodyXml += generateParagraphXML("4. RADICADOS DE CORRESPONDENCIA DEL PERIODO", { bold: true, spacingAfter: 120 });
  
  bodyXml += generateParagraphXML("4.1 Correspondencia Recibida", { bold: true, italic: true, spacingAfter: 60 });
  bodyXml += generateTableXML(reportData.recReceivedHeaders, reportData.recReceivedRows);
  bodyXml += generateParagraphXML("", { spacingAfter: 180 });

  bodyXml += generateParagraphXML("4.2 Correspondencia Enviada", { bold: true, italic: true, spacingAfter: 60 });
  bodyXml += generateTableXML(reportData.recSentHeaders, reportData.recSentRows);
  bodyXml += generateParagraphXML("", { spacingAfter: 300 });

  // SectPr de la página Carta estándar
  bodyXml += `<w:sectPr>
    <w:pgSz w:w="12240" w:h="15840"/>
    <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
  </w:sectPr>`;

  bodyXml += `</w:body>`;

  // 4. Escribir word/document.xml final
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + bodyXml + `</w:document>`);

  // Guardar relaciones actualizadas
  const newRelsText = serializer.serializeToString(relsDoc);
  zip.file('word/_rels/document.xml.rels', newRelsText);

  // 5. Devolver Blob final
  return await zip.generateAsync({ type: 'blob' });
}

export async function exportCorrespondenceDocx(
  projectName: string,
  sentEmails: any[],
  receivedEmails: any[],
  periodLabel: string
): Promise<Blob> {
  const zip = createBlankDocx();

  let bodyXml = `<w:document xmlns:w="${wNs}" xmlns:wp="http://schemas.openxmlformats.org/wordprocessingDrawing" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">`;
  bodyXml += `<w:body>`;

  // Título
  bodyXml += generateParagraphXML(projectName.toUpperCase(), { bold: true, align: 'center', spacingAfter: 120, sizeHalfPt: 26 });
  bodyXml += generateParagraphXML("INFORME DE CONTROL DE CORRESPONDENCIA", { bold: true, align: 'center', spacingAfter: 120, sizeHalfPt: 20 });
  bodyXml += generateParagraphXML(periodLabel.toUpperCase(), { bold: true, align: 'center', spacingAfter: 360, sizeHalfPt: 16 });

  // 6.1 CORRESPONDENCIA ENVIADA
  bodyXml += generateParagraphXML("6.1 CORRESPONDENCIA ENVIADA", { bold: true, spacingBefore: 240, spacingAfter: 120, sizeHalfPt: 22 });
  if (sentEmails.length === 0) {
    bodyXml += generateParagraphXML("No se registra correspondencia enviada en este rango de tiempo.", { italic: true, spacingAfter: 240 });
  } else {
    const headers = ["Fecha", "Remitente", "Destinatario", "Asunto", "Anexos"];
    const rows = sentEmails.map(e => [
      e.date || "",
      (e.sender || "").split(' <')[0],
      (e.receiver || "").split(' <')[0],
      e.subject || "",
      String(e.attachmentsCount || 0)
    ]);
    bodyXml += generateTableXML(headers, rows, [1400, 2000, 2000, 2960, 1000]);
  }
  bodyXml += generateParagraphXML("", { spacingAfter: 240 });

  // 6.2 CORRESPONDENCIA RECIBIDA
  bodyXml += generateParagraphXML("6.2 CORRESPONDENCIA RECIBIDA", { bold: true, spacingBefore: 240, spacingAfter: 120, sizeHalfPt: 22 });
  if (receivedEmails.length === 0) {
    bodyXml += generateParagraphXML("No se registra correspondencia recibida en este rango de tiempo.", { italic: true, spacingAfter: 240 });
  } else {
    const headers = ["Fecha", "Remitente", "Destinatario", "Asunto", "Anexos"];
    const rows = receivedEmails.map(e => [
      e.date || "",
      (e.sender || "").split(' <')[0],
      (e.receiver || "").split(' <')[0],
      e.subject || "",
      String(e.attachmentsCount || 0)
    ]);
    bodyXml += generateTableXML(headers, rows, [1400, 2000, 2000, 2960, 1000]);
  }

  // Configuración de página Carta estándar
  bodyXml += `<w:sectPr>
    <w:pgSz w:w="12240" w:h="15840"/>
    <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
  </w:sectPr>`;

  bodyXml += `</w:body>`;
  bodyXml += `</w:document>`;

  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + bodyXml);

  return await zip.generateAsync({ type: 'blob' });
}
