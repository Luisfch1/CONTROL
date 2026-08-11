import type { Project, LogiEntry } from '../types/projectTypes';
import logo from '../assets/logo.png';
import { photoDB } from '../services/PhotoDatabase';

export interface ExecutiveExportOptions {
  projectName: string;
  projectCode: string;
  periodLabel: string;
  narrativeText: string;
  tableRows: string[][]; // Ítem, Descripción, Unidad, Cant. Contratada, Vlr. Unitario, Vlr. Total, Cant. Ejecutada, Vlr. Ejecutado, % Avance
  curveSBase64: string;
  photos: LogiEntry[];
  sCurveCaption?: string; // Comentario técnico debajo de la curva S
}

// Helper to load and optimize image to Base64 (resolves blob/IndexedDB or remote URLs)
const getOptimizedBase64 = async (
  photo: LogiEntry,
  imageCounter: number,
  mhtmlImages: { cid: string; data: string; mime: string }[]
): Promise<string> => {
  try {
    if (photo.isLocal) {
      const localB64 = await photoDB.getPhoto(photo.id);
      if (localB64) {
        const mimeMatch = localB64.match(/^data:([^;]+);base64,/);
        const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
        const base64Data = localB64.startsWith('data:') ? localB64.split(',')[1] : localB64;
        const cid = `photo_${imageCounter}@control`;
        mhtmlImages.push({ cid, data: base64Data, mime });
        return `cid:${cid}`;
      }
    }

    if (photo.imageUrl && photo.imageUrl.startsWith('data:')) {
      const mime = photo.imageUrl.split(';')[0].split(':')[1];
      const data = photo.imageUrl.split(',')[1];
      const cid = `photo_${imageCounter}@control`;
      mhtmlImages.push({ cid, data, mime });
      return `cid:${cid}`;
    }

    if (photo.imageUrl && !photo.imageUrl.startsWith('blob:')) {
      return await new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(photo.imageUrl || ''), 3000);
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.onload = () => {
          clearTimeout(timeout);
          const canvas = document.createElement('canvas');
          const maxW = 1600;
          const scale = Math.min(1, maxW / img.width);
          canvas.width = img.width * scale;
          canvas.height = img.height * scale;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.90);
            const base64Data = dataUrl.split(',')[1];
            const cid = `photo_${imageCounter}@control`;
            mhtmlImages.push({ cid, data: base64Data, mime: 'image/jpeg' });
            resolve(`cid:${cid}`);
          } else {
            resolve(photo.imageUrl || '');
          }
        };
        img.onerror = () => {
          clearTimeout(timeout);
          resolve(photo.imageUrl || '');
        };
        img.src = photo.imageUrl || '';
      });
    }
  } catch (e) {
    console.error("Error optimizando base64 para foto:", e);
  }
  return photo.imageUrl || '';
};

const getLogoBase64 = (): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      } else {
        resolve('');
      }
    };
    img.onerror = () => resolve('');
    img.src = logo;
  });
};

/**
 * Helper to encode UTF-8 to Base64 in a safe way for browser download.
 */
const encodeUTF8Base64 = (str: string): string => {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

export const exportExecutiveReportToWord = async (
  project: Project,
  options: ExecutiveExportOptions
): Promise<void> => {
  const { projectName, projectCode, periodLabel, narrativeText, tableRows, curveSBase64, photos } = options;

  const mhtmlImages: { cid: string; data: string; mime: string }[] = [];
  const boundary = "=_NEXT_PART_" + Math.random().toString(36).substring(2);

  // 1. Procesar Logo
  const logoBase64 = await getLogoBase64();
  let logoCid = 'logo@control';
  if (logoBase64 && logoBase64.startsWith('data:')) {
    const logoData = logoBase64.split(',')[1];
    const logoMime = logoBase64.split(';')[0].split(':')[1];
    mhtmlImages.push({ cid: logoCid, data: logoData, mime: logoMime });
  }

  // 2. Procesar Curva S
  let curveCid = 'curva_s@control';
  if (curveSBase64 && curveSBase64.startsWith('data:')) {
    const curveData = curveSBase64.split(',')[1];
    const curveMime = curveSBase64.split(';')[0].split(':')[1];
    mhtmlImages.push({ cid: curveCid, data: curveData, mime: curveMime });
  }

  // 3. Procesar Fotos del Informe
  const photoCids: string[] = [];
  for (let i = 0; i < photos.length; i++) {
    const p = photos[i];
    const cid = await getOptimizedBase64(p, i, mhtmlImages);
    photoCids.push(cid);
  }

  // 4. HTML del Reporte (Arial 11pt, Tablas Calibri 9pt)
  const BRAND_MID = '#172554';
  const BRAND_DARK = '#0B1220';
  const BRAND_ACC = '#3B82F6';
  const GRID_COL = '#cbd5e1';

  // Construir filas de la tabla
  const colWidths = ["7%", "31%", "5%", "8%", "10%", "13%", "8%", "13%", "5%"];
  let tableRowsHtml = '';
  tableRows.forEach((row) => {
    const isTotalRow = row[0] === 'COSTO DIRECTO' || row[0]?.startsWith('AIU') || row[0] === 'TOTAL DE OBRA';
    const isTitleRow = row[1] === '' && row[2] === '' && row[3] === '' && !isTotalRow;
    
    let rowBg = '#ffffff';
    let fontWeight = 'normal';
    let fontSize = '9pt';
    
    if (isTotalRow) {
      rowBg = '#f1f5f9';
      fontWeight = 'bold';
    } else if (isTitleRow) {
      rowBg = '#f8fafc';
      fontWeight = 'bold';
    }

    tableRowsHtml += `<tr style="background-color: ${rowBg}; font-weight: ${fontWeight}; border-bottom: 0.5pt solid ${GRID_COL};">`;
    row.forEach((cell, idx) => {
      let align = 'left';
      // Alineaciones de celda según el tipo de dato
      if (idx === 0) {
        align = 'left';
      } else if (idx === 2) {
        align = 'center';
      } else if (idx >= 3) {
        align = 'right';
      }

      // Si es fila de título, expandir la primera celda
      if (isTitleRow && idx === 0) {
        tableRowsHtml += `<td colspan="9" style="padding: 6px; font-family: Arial, sans-serif; font-size: 9.5pt; border: 0.5pt solid ${GRID_COL};">${cell}</td>`;
      } else if (isTitleRow) {
        // Ignorar otras celdas en la fila de título
      } else {
        const wAttr = colWidths[idx] ? `width="${colWidths[idx]}"` : '';
        const wStyle = colWidths[idx] ? `width: ${colWidths[idx]};` : '';
        tableRowsHtml += `<td ${wAttr} align="${align}" style="${wStyle} padding: 5px; font-family: Calibri, Arial, sans-serif; font-size: ${fontSize}; text-align: ${align}; border: 0.5pt solid ${GRID_COL};">${cell || ''}</td>`;
      }
    });
    tableRowsHtml += `</tr>`;
  });

  // Construir rejilla de fotos de 2 columnas
  let photoGridHtml = '';
  if (photos.length > 0) {
    photoGridHtml += `<table border="0" cellspacing="0" cellpadding="0" style="width: 100%; border: none; margin-top: 15px;">`;
    for (let i = 0; i < photos.length; i += 2) {
      const leftPhoto = photos[i];
      const rightPhoto = photos[i + 1];
      const leftCid = photoCids[i];
      const rightCid = photoCids[i + 1];

      // Fila de imágenes
      photoGridHtml += `<tr>`;
      // Celda izquierda
      photoGridHtml += `
        <td style="width: 50%; padding: 8pt; vertical-align: top; text-align: center; border: none;">
          <div style="width: 7.59cm; height: 4.6cm; overflow: hidden; background: transparent; margin: 0 auto;">
            <img src="${leftCid}" width="287" height="174" style="width: 7.59cm; height: 4.6cm; display: block;" />
          </div>
        </td>
      `;
      // Celda derecha
      if (rightPhoto) {
        photoGridHtml += `
          <td style="width: 50%; padding: 8pt; vertical-align: top; text-align: center; border: none;">
            <div style="width: 7.59cm; height: 4.6cm; overflow: hidden; background: transparent; margin: 0 auto;">
              <img src="${rightCid}" width="287" height="174" style="width: 7.59cm; height: 4.6cm; display: block;" />
            </div>
          </td>
        `;
      } else {
        photoGridHtml += `<td style="width: 50%; border: none;"></td>`;
      }
      photoGridHtml += `</tr>`;

      // Fila de descripciones
      photoGridHtml += `<tr>`;
      // Caption izquierda
      const leftItemStr = leftPhoto.itemCode ? `ítem ${leftPhoto.itemCode}` : 'General';
      photoGridHtml += `
        <td style="width: 50%; padding: 4pt 8pt 16pt 8pt; vertical-align: top; border: none; text-align: center;">
          <p style="font-family: Arial, sans-serif; font-size: 8.5pt; font-style: italic; color: #475569; margin: 0; line-height: 1.3;">
            <b>Foto ${i + 1}:</b> ${leftPhoto.date || ''} - [${leftItemStr}] ${leftPhoto.description || 'Sin descripción'}
          </p>
        </td>
      `;
      // Caption derecha
      if (rightPhoto) {
        const rightItemStr = rightPhoto.itemCode ? `ítem ${rightPhoto.itemCode}` : 'General';
        photoGridHtml += `
          <td style="width: 50%; padding: 4pt 8pt 16pt 8pt; vertical-align: top; border: none; text-align: center;">
            <p style="font-family: Arial, sans-serif; font-size: 8.5pt; font-style: italic; color: #475569; margin: 0; line-height: 1.3;">
              <b>Foto ${i + 2}:</b> ${rightPhoto.date || ''} - [${rightItemStr}] ${rightPhoto.description || 'Sin descripción'}
            </p>
          </td>
        `;
      } else {
        photoGridHtml += `<td style="width: 50%; border: none;"></td>`;
      }
      photoGridHtml += `</tr>`;
    }
    photoGridHtml += `</table>`;
  } else {
    photoGridHtml = `<p style="font-family: Arial; font-size: 10pt; font-style: italic; color: #7f8c8d; margin-top: 10px;">No se registran fotos de avance en este informe.</p>`;
  }

  const htmlHead = `
    <html xmlns:o='urn:schemas-microsoft-com:office:office' 
          xmlns:w='urn:schemas-microsoft-com:office:word' 
          xmlns='http://www.w3.org/TR/REC-html40'>
    <head><meta charset='utf-8'><title>Informe Ejecutivo Mensual</title>
    <style>
      @page WordSection1 { 
        size: 21.59cm 27.94cm; 
        margin: 2.54cm; 
        mso-header-margin: 1.25cm;
        mso-footer-margin: 1.25cm;
      }
      div.WordSection1 { page: WordSection1; }
      body { font-family: 'Arial', sans-serif; color: #000000; line-height: 1.4; }
      h1 { font-family: 'Arial', sans-serif; font-size: 14pt; font-weight: bold; text-align: center; color: #000000; margin-top: 0; margin-bottom: 5px; }
      h2 { font-family: 'Arial', sans-serif; font-size: 11pt; font-weight: bold; color: #000000; border-bottom: 1px solid #000000; padding-bottom: 2px; margin-top: 24px; margin-bottom: 10px; }
      p { font-family: 'Arial', sans-serif; font-size: 10.5pt; text-align: justify; margin-top: 0; margin-bottom: 12px; }
      table { width: 100%; border-collapse: collapse; margin-top: 10px; margin-bottom: 15px; }
      th { font-family: 'Arial', sans-serif; font-weight: bold; font-size: 9pt; background-color: #f1f5f9; border: 0.5pt solid ${GRID_COL}; padding: 6px 4px; text-align: center; }
    </style>
    </head><body>
  `;

  const htmlBody = `
    <div class="WordSection1">
      <!-- Encabezado Fijo -->
      <table border="0" cellspacing="0" cellpadding="0" style="width: 100%; border: none; margin-bottom: 25px;">
        <tr>
          <td style="width: 15%; padding: 0; border: none; vertical-align: middle; text-align: center;">
            <img src="cid:${logoCid}" width="42" height="42" style="width: 42px; height: 42px;" />
          </td>
          <td style="width: 85%; padding: 0; border: none; vertical-align: middle; padding-left: 12px;">
            <div style="font-family: Arial; font-size: 13pt; font-weight: bold; letter-spacing: 0.5px;">${projectName.toUpperCase()}</div>
            <div style="font-family: Arial; font-size: 8.5pt; color: #475569; font-weight: bold; text-transform: uppercase; margin-top: 2px;">
              INFORME EJECUTIVO MENSUAL DE INTERVENTORÍA | CÓDIGO: ${projectCode}
            </div>
          </td>
        </tr>
      </table>

      <h1>INFORME EJECUTIVO DE ESTADO DE OBRA</h1>
      <p style="text-align: center; font-size: 10pt; color: #475569; font-weight: bold; margin-bottom: 30px;">
        PERIODO: ${periodLabel.toUpperCase()}
      </p>

      <h2>1. INTRODUCCIÓN Y NARRATIVA TÉCNICA</h2>
      <p style="white-space: pre-wrap; font-family: Arial; font-size: 10.5pt; line-height: 1.5; color: #000000; text-align: justify;">${narrativeText || 'No se ingresó narrativa técnica en este periodo.'}</p>

      <h2 style="clear: both;">2. CUADRO DE AVANCE DE OBRA ACUMULADO</h2>
      <p style="font-size: 9.5pt; color: #475569; margin-bottom: 8px;">
        A continuación se consolidan las cantidades de obra ejecutadas acumuladas y sus correspondientes valores económicos frente al contrato original:
      </p>
      <table>
        <thead>
          <tr>
            <th width="7%" style="width: 7%;">ÍTEM</th>
            <th width="31%" style="width: 31%; text-align: left; padding-left: 6px;">DESCRIPCIÓN DE LA ACTIVIDAD</th>
            <th width="5%" style="width: 5%;">UNID</th>
            <th width="8%" style="width: 8%;">CANT CONTR</th>
            <th width="10%" style="width: 10%;">VLR UNIT</th>
            <th width="13%" style="width: 13%;">VLR TOTAL</th>
            <th width="8%" style="width: 8%;">CANT EJEC</th>
            <th width="13%" style="width: 13%;">VLR EJEC</th>
            <th width="5%" style="width: 5%;">% AVANCE</th>
          </tr>
        </thead>
        <tbody>
          ${tableRowsHtml}
        </tbody>
      </table>

      <h2 style="clear: both;">3. GRÁFICOS DE CONTROL DE AVANCE (CURVA S)</h2>
      <p style="font-size: 9.5pt; color: #475569; margin-bottom: 15px;">
        Tendencia de avance físico real acumulado de obra frente a la programación teórica planificada:
      </p>
      <div style="text-align: center; margin-top: 15px; margin-bottom: 20px;">
        <img src="cid:${curveCid}" width="580" height="270" style="display: block; margin: 0 auto; width: 580px; height: 270px; border: 0.5pt solid ${GRID_COL};" />
      </div>
      <p style="white-space: pre-wrap; font-family: Arial; font-size: 10.5pt; line-height: 1.5; color: #000000; text-align: justify; margin-top: 15px;">${options.sCurveCaption || ''}</p>

      <h2 style="page-break-before: always; clear: both;">4. REGISTRO FOTOGRÁFICO DE AVANCE DE OBRA</h2>
      <p style="font-size: 9.5pt; color: #475569; margin-bottom: 12px;">
        Evidencias fotográficas del progreso físico de las actividades en obra correspondientes al periodo evaluado:
      </p>
      ${photoGridHtml}

    </div>
  `;

  const htmlFooter = "</body></html>";

  // Ensamblar archivo MHTML completo
  const htmlBase64 = encodeUTF8Base64(htmlHead + htmlBody + htmlFooter);

  let mhtml = `MIME-Version: 1.0\r\n`;
  mhtml += `Content-Type: multipart/related; boundary="${boundary}"\r\n\r\n`;
  
  mhtml += `--${boundary}\r\n`;
  mhtml += `Content-Type: text/html; charset="utf-8"\r\n`;
  mhtml += `Content-Transfer-Encoding: base64\r\n`;
  mhtml += `Content-Location: file:///C:/fake/document.html\r\n\r\n`;
  mhtml += htmlBase64.replace(/(.{76})/g, "$1\r\n") + '\r\n\r\n';

  for (const img of mhtmlImages) {
    mhtml += `--${boundary}\r\n`;
    mhtml += `Content-Type: ${img.mime}\r\n`;
    mhtml += `Content-Transfer-Encoding: base64\r\n`;
    mhtml += `Content-Location: ${img.cid}\r\n\r\n`;
    mhtml += img.data.replace(/(.{76})/g, "$1\r\n") + '\r\n\r\n';
  }
  
  mhtml += `--${boundary}--\r\n`;

  const blob = new Blob([mhtml], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  
  const safeProjectName = projectName.replace(/[^a-zA-Z0-9]/g, '_');
  const safeMonth = periodLabel.replace(/[^a-zA-Z0-9]/g, '_');
  link.download = `INFORME_EJECUTIVO_${safeProjectName}_${safeMonth}.doc`;
  
  document.body.appendChild(link);
  link.click();
  
  setTimeout(() => {
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, 150);
};
