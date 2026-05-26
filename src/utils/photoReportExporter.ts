import type { Project, LogiEntry } from '../types/projectTypes';
import logo from '../assets/logo.png';
import JSZip from 'jszip';
import { photoDB } from '../services/PhotoDatabase';

export interface ExportOptions {
  dateFrom?: string;
  dateTo?: string;
  itemFilter?: string;
  textFilter?: string;
  onProgress?: (progress: number) => void;
}

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
 * Filtra las fotos del proyecto según los criterios dados
 */
export const getFilteredPhotos = (project: Project, options: ExportOptions): LogiEntry[] => {
  let filtered = [...(project.logiEntries || [])];
  const { dateFrom, dateTo, itemFilter, textFilter } = options;

  if (dateFrom) filtered = filtered.filter(p => p.date >= dateFrom);
  if (dateTo) filtered = filtered.filter(p => p.date <= dateTo);
  if (itemFilter) filtered = filtered.filter(p => p.itemCode.includes(itemFilter));
  if (textFilter) {
    const q = textFilter.toLowerCase();
    filtered = filtered.filter(p => 
      p.description.toLowerCase().includes(q) || 
      p.itemCode.toLowerCase().includes(q)
    );
  }
  
  filtered.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  return filtered;
};

/**
 * Exporta el reporte fotográfico consolidado a Word (.doc) en formato MHTML
 */
export const exportPhotosToWord = async (project: Project, options: ExportOptions): Promise<void> => {
  const { dateFrom, dateTo, itemFilter, textFilter, onProgress } = options;
  const reportPhotos = getFilteredPhotos(project, options);

  if (reportPhotos.length === 0) {
    throw new Error("No hay fotos que coincidan con los filtros activos para exportar.");
  }

  const PHOTOS_PER_PAGE = 6;
  const pages: LogiEntry[][] = [];
  for (let i = 0; i < reportPhotos.length; i += PHOTOS_PER_PAGE) {
    pages.push(reportPhotos.slice(i, i + PHOTOS_PER_PAGE));
  }

  const getHeaderText = () => {
    if (dateFrom && dateTo) return `REPORTE FOTOGRÁFICO: ${dateFrom} AL ${dateTo}`;
    if (dateFrom) return `REPORTE FOTOGRÁFICO: DESDE ${dateFrom}`;
    if (textFilter) return `REPORTE DE EVIDENCIAS: BÚSQUEDA "${textFilter.toUpperCase()}"`;
    if (itemFilter) return `REPORTE DE EVIDENCIAS: ÍTEM ${itemFilter}`;
    return "REPORTE FOTOGRÁFICO GENERAL";
  };

  const BRAND_DARK = '#0B1220';
  const BRAND_MID = '#172554';
  const BRAND_ACC = '#3B82F6';
  const GRID_COL = '#2F6FED';

  const htmlHead = `
    <html xmlns:o='urn:schemas-microsoft-com:office:office' 
          xmlns:w='urn:schemas-microsoft-com:office:word' 
          xmlns='http://www.w3.org/TR/REC-html40'>
    <head><meta charset='utf-8'><title>Logi Reporte</title>
    <style>
      @page WordSection1 { 
        size: 21.59cm 27.94cm; 
        margin: 1.27cm; 
        mso-header-margin: 0.5cm;
        mso-footer-margin: 0.5cm;
        mso-header: h1;
        mso-footer: f1;
      }
      div.WordSection1 { page: WordSection1; }
      body { font-family: 'Calibri', 'Segoe UI', 'Arial', sans-serif; color: #111; margin: 0; padding: 0; }
      table { width: 100%; border-collapse: collapse; table-layout: fixed; border: 0.5pt solid ${GRID_COL}; }
      td { border: 0.5pt solid ${GRID_COL}; }
    </style>
    </head><body>
  `;

  let htmlBody = `<div class="WordSection1">`;
  const totalPages = pages.length;

  const mhtmlImages: { cid: string; data: string; mime: string }[] = [];
  let imageCounter = 0;

  // Función auxiliar para convertir imagen a base64 y guardarla para MHTML
  const getOptimizedBase64 = async (photo: LogiEntry): Promise<string> => {
    try {
      if (photo.isLocal) {
        // Resolver foto local directo de IndexedDB para Word
        const localB64 = await photoDB.getPhoto(photo.id);
        if (localB64) {
          const base64Data = localB64.startsWith('data:') ? localB64.split(',')[1] : localB64;
          const cid = `img_${++imageCounter}@logi`;
          mhtmlImages.push({ cid, data: base64Data, mime: 'image/jpeg' });
          return `cid:${cid}`;
        }
      }

      return await new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(photo.imageUrl), 3000);
        
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.onload = () => {
          clearTimeout(timeout);
          const canvas = document.createElement('canvas');
          const maxW = 600; 
          const scale = Math.min(1, maxW / img.width);
          canvas.width = img.width * scale;
          canvas.height = img.height * scale;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.65);
            
            const base64Data = dataUrl.split(',')[1];
            const cid = `img_${++imageCounter}@logi`;
            mhtmlImages.push({ cid, data: base64Data, mime: 'image/jpeg' });
            
            canvas.width = 0;
            canvas.height = 0;
            resolve(`cid:${cid}`);
          } else {
            resolve(photo.imageUrl);
          }
        };
        img.onerror = () => {
          clearTimeout(timeout);
          resolve(photo.imageUrl);
        };
        img.src = photo.imageUrl;
      });
    } catch (e) {
      return photo.imageUrl;
    }
  };

  // Cargar y convertir logo
  const logoBase64 = await getLogoBase64();
  let logoUrl = logoBase64;
  if (logoBase64 && logoBase64.startsWith('data:')) {
     const logoData = logoBase64.split(',')[1];
     const logoMime = logoBase64.split(';')[0].split(':')[1];
     const logoCid = 'logo@logi';
     mhtmlImages.push({ cid: logoCid, data: logoData, mime: logoMime });
     logoUrl = `cid:${logoCid}`;
  }

  // Iniciar tabla continua
  htmlBody += `
    <table border="0" cellspacing="0" cellpadding="0" style="width: 100%; table-layout: fixed; border: 0.5pt solid ${GRID_COL};">
  `;

  for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
    const pagePhotos = pages[pageIdx];
    if (onProgress) {
      onProgress(Math.round((pageIdx / totalPages) * 100));
    }
    
    await new Promise(r => setTimeout(r, 20));

    const pageB64Images = await Promise.all(
      pagePhotos.map(photo => photo ? getOptimizedBase64(photo) : Promise.resolve(''))
    );

    for (let i = 0; i < pagePhotos.length; i += 2) {
      const left = pagePhotos[i];
      const right = pagePhotos[i+1];
      
      // Fila de Imágenes
      htmlBody += `<tr>`;
      for (let idx = 0; idx < 2; idx++) {
        const photo = [left, right][idx];
        if (!photo) {
          htmlBody += `<td style="width: 50%; border: none;"></td>`;
          continue;
        }
        const b64 = pageB64Images[i + idx];
        htmlBody += `
          <td style="width: 50%; padding: 8pt; vertical-align: top; border: 0.5pt solid ${GRID_COL}; border-bottom: none; text-align: center;">
            <div style="width: 7.59cm; height: 4.6cm; overflow: hidden; background: transparent; margin: 0 auto;">
              <img src="${b64}" 
                   width="287" height="174" 
                   style="width: 7.59cm; height: 4.6cm; display: block; object-fit: cover;" 
              />
            </div>
          </td>
        `;
      }
      htmlBody += `</tr>`;

      // Fila de Captions
      htmlBody += `<tr>`;
      for (let idx = 0; idx < 2; idx++) {
        const photo = [left, right][idx];
        if (!photo) {
          htmlBody += `<td style="width: 50%; border: none;"></td>`;
          continue;
        }
        const globalIdx = (pageIdx * PHOTOS_PER_PAGE) + (i + idx) + 1;
        const showItem = photo.itemCode && photo.itemCode !== 'N/A' && photo.itemCode !== 'General' && photo.itemCode.trim() !== '';
        
        let captionHTML = `Foto No. ${globalIdx}`;
        if (showItem) {
          const activeItems = project.activeBudgetVersionId 
            ? project.budgetVersions?.find(v => v.id === project.activeBudgetVersionId)?.items || project.budgetItems
            : project.budgetItems;
          const budgetItem = activeItems?.find(b => b.item === photo.itemCode);
          let itemDesc = budgetItem ? budgetItem.descripcion : '';
          if (itemDesc.length > 45) {
            itemDesc = itemDesc.substring(0, 45).trim() + '...';
          }
          if (itemDesc) {
            captionHTML += `, ítem ${photo.itemCode}. "${itemDesc}"`;
          } else {
            captionHTML += `, ítem ${photo.itemCode}.`;
          }
        } else {
          captionHTML += `.`;
        }

        if (photo.description && photo.description.trim() !== '') {
          captionHTML += ` ${photo.description}`;
        }

        htmlBody += `
          <td style="width: 50%; padding: 10pt; vertical-align: top; border: 0.5pt solid ${GRID_COL}; border-top: none;">
            <div style="font-family: 'Calibri', Arial, sans-serif; min-height: 45pt; background: #ffffff;">
              <p style="font-size: 10.5pt; color: #111; margin: 0; line-height: 1.2;">${captionHTML}</p>
            </div>
          </td>
        `;
      }
      htmlBody += `</tr>`;
    }
  }

  // Cerrar tabla
  htmlBody += `</table>`;

  // Definir Encabezado y Pie de página Nativos de Word
  htmlBody += `
    <!-- HEADER -->
    <div style='mso-element:header; display:none;' id=h1>
      <table border="0" cellspacing="0" cellpadding="0" style="width: 100%; table-layout: fixed; border: none; margin-bottom: 10pt;">
        <tr>
          <td colspan="2" style="padding: 0; border: none; background: ${BRAND_MID};">
            <table border="0" cellspacing="0" cellpadding="0" style="width: 100%; table-layout: fixed;">
              <tr>
                <td style="width: 18%; background: ${BRAND_DARK}; padding: 12pt; vertical-align: middle; text-align: center; border: none;">
                  <img src="${logoUrl}" width="38" height="38" style="width: 38px; height: 38px; filter: invert(1);" />
                </td>
                <td style="width: 82%; background: ${BRAND_MID}; padding: 12pt; vertical-align: middle; border: none;">
                  <table border="0" cellspacing="0" cellpadding="0" style="width: 100%;">
                    <tr>
                      <td style="width: 70%; vertical-align: middle; border: none;">
                        <div style="color: #ffffff; font-size: 16pt; font-weight: bold; font-family: Arial;">${project.name.toUpperCase()}</div>
                      </td>
                      <td style="width: 30%; vertical-align: middle; text-align: right; border: none;">
                        <div style="color: #ffffff; font-size: 20pt; font-weight: bold; font-family: Arial;">Logi</div>
                      </td>
                    </tr>
                  </table>
                  <div style="color: #E5E7EB; font-size: 8.5pt; font-weight: bold; font-family: Arial; text-align: right; margin-top: 4pt;">
                    ${getHeaderText().toUpperCase()}
                  </div>
                </td>
              </tr>
              <tr>
                <td colspan="2" style="height: 3.5pt; background: ${BRAND_ACC}; line-height: 1pt; font-size: 1pt; border: none;">&nbsp;</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>

    <!-- FOOTER -->
    <div style='mso-element:footer; display:none;' id=f1>
      <div style="font-size: 7.5pt; color: #999; text-align: center; margin-top: 10pt; font-family: Calibri;">
        PÁGINA <span style='mso-field-code:" PAGE "'></span> DE <span style='mso-field-code:" NUMPAGES "'></span> | GENERADO POR LOGI ENGINE (CONTROL)
      </div>
    </div>
  </div>`;

  const htmlFooter = "</body></html>";
  
  // Ensamblar MHTML
  const boundary = "=_NEXT_PART_" + Math.random().toString(36).substring(2);
  
  const encodeUTF8Base64 = (str: string) => {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  };

  const htmlBase64 = encodeUTF8Base64(htmlHead + htmlBody + htmlFooter);

  let mhtml = `MIME-Version: 1.0\n`;
  mhtml += `Content-Type: multipart/related; boundary="${boundary}"\n\n`;
  
  mhtml += `--${boundary}\n`;
  mhtml += `Content-Type: text/html; charset="utf-8"\n`;
  mhtml += `Content-Transfer-Encoding: base64\n`;
  mhtml += `Content-Location: file:///C:/fake/document.html\n\n`;
  mhtml += htmlBase64.replace(/(.{76})/g, "$1\n") + '\n\n';

  for (const img of mhtmlImages) {
    mhtml += `--${boundary}\n`;
    mhtml += `Content-Type: ${img.mime}\n`;
    mhtml += `Content-Transfer-Encoding: base64\n`;
    mhtml += `Content-Location: ${img.cid}\n\n`;
    mhtml += img.data.replace(/(.{76})/g, "$1\n") + '\n\n';
  }
  
  mhtml += `--${boundary}--\n`;

  const blob = new Blob([mhtml], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `LOGI_REPORTE_${project.name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.doc`;
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, 100);

  if (onProgress) {
    onProgress(100);
  }
};

/**
 * Exporta fotos filtradas organizadas en un archivo comprimido .zip
 */
export const exportPhotosToZip = async (project: Project, options: ExportOptions): Promise<void> => {
  const { dateFrom, dateTo, onProgress } = options;
  const reportPhotos = getFilteredPhotos(project, options);

  if (reportPhotos.length === 0) {
    throw new Error("No hay fotos que cumplan con los filtros activos para exportar.");
  }

  const zip = new JSZip();
  const sanitizedProjectName = project.name.replace(/[^a-zA-Z0-9_\-]/g, '_');
  const start = dateFrom || 'inicio';
  const end = dateTo || 'fin';
  const folderName = `${sanitizedProjectName}_Evidencias_${start}_a_${end}`;
  const rootFolder = zip.folder(folderName);

  if (!rootFolder) throw new Error("No se pudo crear el contenedor ZIP.");

  const totalPhotos = reportPhotos.length;
  let processed = 0;
  const dayCounters: Record<string, number> = {};

  for (const photo of reportPhotos) {
    const photoDate = photo.date || new Date().toISOString().split('T')[0];
    const dayFolder = rootFolder.folder(photoDate);
    if (!dayFolder) continue;

    dayCounters[photoDate] = (dayCounters[photoDate] || 0) + 1;
    const photoNum = dayCounters[photoDate];

    const cleanItemCode = (photo.itemCode || 'General').replace(/[^a-zA-Z0-9_\-]/g, '_');
    const filename = `${photoDate}_Item_${cleanItemCode}_Foto_${photoNum}.jpg`;

    let base64Data: string | null = null;

    if (photo.isLocal) {
      try {
        base64Data = await photoDB.getPhoto(photo.id);
      } catch (e) {
        console.warn("Error leyendo de base de datos local:", e);
      }
    }

    if (!base64Data && photo.imageUrl) {
      try {
        const res = await fetch(photo.imageUrl);
        const blob = await res.blob();
        base64Data = await new Promise<string | null>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(blob);
        });
      } catch (e) {
        console.error("Error descargando foto remota:", e);
      }
    }

    if (base64Data) {
      let pureBase64 = base64Data;
      if (base64Data.startsWith('data:')) {
        pureBase64 = base64Data.split(',')[1];
      }

      dayFolder.file(filename, pureBase64, { base64: true });

      const descText = [
        `Proyecto: ${project.name}`,
        `Fecha: ${photoDate}`,
        `Item de Presupuesto: ${photo.itemCode || 'S/N'}`,
        `Descripción: ${photo.description || 'Sin descripción.'}`
      ].join('\n');
      
      dayFolder.file(filename.replace(/\.jpg$/i, '.txt'), descText);
    }

    processed++;
    if (onProgress) {
      onProgress(Math.round((processed / totalPhotos) * 100));
    }
    
    await new Promise(r => setTimeout(r, 10));
  }

  const content = await zip.generateAsync({ type: 'blob' }, (metadata) => {
    if (onProgress) {
      onProgress(Math.round(metadata.percent));
    }
  });

  const url = window.URL.createObjectURL(content);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${folderName}.zip`;
  document.body.appendChild(link);
  link.click();
  
  setTimeout(() => {
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  }, 100);
};
