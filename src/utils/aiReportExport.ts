import type { Project, LogiEntry } from '../types/projectTypes';

export const exportAIReportToWord = (
  project: Project, 
  reportMarkdown: string, 
  dateFrom?: string, 
  dateTo?: string
) => {
  // 1. Filtrar las fotos del proyecto en el rango de fechas
  let photos = project.logiEntries || [];
  if (dateFrom) photos = photos.filter(p => p.date >= dateFrom);
  if (dateTo) photos = photos.filter(p => p.date <= dateTo);

  // 2. Convertir el Markdown básico a HTML básico para Word
  // Reemplazamos ### Titulo por <h3>, **negrita** por <b>, etc.
  let htmlContent = reportMarkdown
    .replace(/^### (.*$)/gim, '<h3 style="color: #2c3e50; border-bottom: 1px solid #eee; padding-bottom: 5px; margin-top: 20px;">$1</h3>')
    .replace(/^## (.*$)/gim, '<h2 style="color: #1a252f; border-bottom: 2px solid #ccc; padding-bottom: 5px; margin-top: 25px;">$1</h2>')
    .replace(/^# (.*$)/gim, '<h1 style="text-align: center; color: #000; margin-bottom: 20px;">$1</h1>')
    .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
    .replace(/\*(.*?)\*/g, '<i>$1</i>')
    .replace(/^\- (.*$)/gim, '<li style="margin-bottom: 5px;">$1</li>')
    .replace(/\n/g, '<br/>');

  // Arreglar listas (envolver <li> consecutivos en <ul>)
  htmlContent = htmlContent.replace(/(<li.*<\/li>)/s, '<ul style="margin-top: 10px; margin-bottom: 15px;">$1</ul>');

  // 3. Inyectar fotos correspondientes a las actividades mencionadas
  // Estrategia simple: Si la IA menciona un ítem (ej. [NP 01] o "1.2.3"), buscamos fotos de ese ítem y las anexamos.
  // Para hacerlo robusto en HTML, ponemos una galería al final si no logramos inyectarlas en medio, 
  // o las agrupamos por ítem al final del reporte.

  let photosHtml = '<h2 style="color: #1a252f; border-bottom: 2px solid #ccc; margin-top: 30px; page-break-before: always;">Anexo Fotográfico</h2>';
  
  if (photos.length === 0) {
    photosHtml += '<p>No se encontraron registros fotográficos para este periodo.</p>';
  } else {
    photosHtml += `<table border="0" cellspacing="0" cellpadding="5" style="width: 100%; table-layout: fixed;">`;
    for (let i = 0; i < photos.length; i += 2) {
      photosHtml += `<tr>`;
      
      const renderCell = (photo: LogiEntry, idx: number) => {
        if (!photo) return `<td style="width: 50%;"></td>`;
        return `
          <td style="width: 50%; vertical-align: top; padding: 10px;">
            <div style="width: 7.73cm; height: 4.79cm; border: 1px solid #ddd; overflow: hidden;">
              <img src="${photo.imageUrl}" width="292" height="181" style="width: 7.73cm; height: 4.79cm; display: block;" />
            </div>
            <div style="margin-top: 8px; font-family: Arial;">
              <span style="background: #000; color: #fff; font-size: 8pt; font-weight: bold; padding: 2px 5px;">EVIDENCIA</span>
              <span style="font-size: 8pt; font-weight: bold; margin-left: 5px;">ÍTEM ${photo.itemCode || 'N/A'} - ${photo.date}</span>
              <div style="font-size: 9pt; color: #333; margin-top: 5px; line-height: 1.2;">${photo.description || ''}</div>
            </div>
          </td>
        `;
      };

      photosHtml += renderCell(photos[i], i);
      photosHtml += renderCell(photos[i + 1], i + 1);
      photosHtml += `</tr>`;
    }
    photosHtml += `</table>`;
  }

  // 4. Estructura de Word
  const wordDocument = `
    <html xmlns:o='urn:schemas-microsoft-com:office:office' 
          xmlns:w='urn:schemas-microsoft-com:office:word' 
          xmlns='http://www.w3.org/TR/REC-html40'>
    <head>
      <meta charset='utf-8'>
      <title>Reporte IA</title>
      <style>
        @page { size: 21.59cm 27.94cm; margin: 2.54cm; }
        body { font-family: 'Arial', sans-serif; font-size: 11pt; line-height: 1.5; color: #000; }
        table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        img { width: 7.73cm; height: 4.79cm; }
      </style>
    </head>
    <body>
      ${htmlContent}
      ${photosHtml}
    </body>
    </html>
  `;

  // 5. Descargar
  const blob = new Blob([wordDocument], { type: 'application/msword' });
  
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  
  const safeName = project?.name ? project.name.replace(/[^a-zA-Z0-9]/g, '_') : 'Proyecto';
  const fileName = `Informe_IA_${safeName}_${new Date().toISOString().split('T')[0]}.doc`;
  
  link.setAttribute('download', fileName);
  link.setAttribute('target', '_blank');
  link.style.display = 'none';
  
  document.body.appendChild(link);
  
  // Timeout para asegurar que el DOM haya renderizado el ancla antes del click
  setTimeout(() => {
    link.click();
    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 100);
  }, 0);
};
