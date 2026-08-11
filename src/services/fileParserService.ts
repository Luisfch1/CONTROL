import * as XLSX from 'xlsx';
import JSZip from 'jszip';

export interface ProcessedFile {
  name: string;
  mimeType: string;
  url: string; // Base64 data URL for native Gemini processing (PDF, image, audio, video)
  extractedText?: string; // Extracted text for text-based, Word, Excel files
  isTextBased: boolean;
}

/**
 * Processes any uploaded file and prepares it for sending to Gemini.
 */
export async function processUploadedFile(file: File): Promise<ProcessedFile> {
  const name = file.name;
  const mimeType = file.type || getMimeTypeFromExtension(name);
  
  // 1. Check if Excel
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mimeType === 'application/vnd.ms-excel' ||
    name.toLowerCase().endsWith('.xlsx') ||
    name.toLowerCase().endsWith('.xls')
  ) {
    try {
      const text = await parseExcelFile(file);
      return {
        name,
        mimeType: 'text/plain',
        url: '',
        extractedText: text,
        isTextBased: true
      };
    } catch (err) {
      console.error('Error parsing Excel file:', err);
      throw new Error(`No se pudo leer el archivo Excel: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  
  // 2. Check if Word (.docx)
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    name.toLowerCase().endsWith('.docx')
  ) {
    try {
      const text = await parseDocxFile(file);
      return {
        name,
        mimeType: 'text/plain',
        url: '',
        extractedText: text,
        isTextBased: true
      };
    } catch (err) {
      console.error('Error parsing Word document:', err);
      throw new Error(`No se pudo leer el documento Word: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 3. Check if Text-based
  const textExtensions = ['.txt', '.csv', '.json', '.xml', '.md', '.js', '.ts', '.html', '.css', '.yaml', '.yml'];
  const isTextExtension = textExtensions.some(ext => name.toLowerCase().endsWith(ext));
  
  if (mimeType.startsWith('text/') || isTextExtension) {
    try {
      const text = await readTextFile(file);
      return {
        name,
        mimeType: mimeType || 'text/plain',
        url: '',
        extractedText: text,
        isTextBased: true
      };
    } catch (err) {
      console.error('Error reading text file:', err);
      throw new Error(`No se pudo leer el archivo de texto: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 4. Default to Base64 (multimodal) for native Gemini supported files
  // Images, PDFs, Audio, Video are sent natively to Gemini.
  try {
    const dataUrl = await fileToDataUrl(file);
    return {
      name,
      mimeType,
      url: dataUrl,
      isTextBased: false
    };
  } catch (err) {
    console.error('Error reading file as data URL:', err);
    throw new Error(`No se pudo procesar el archivo: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function getMimeTypeFromExtension(filename: string): string {
  const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
  switch (ext) {
    case '.pdf': return 'application/pdf';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.gif': return 'image/gif';
    case '.webp': return 'image/webp';
    case '.csv': return 'text/csv';
    case '.json': return 'application/json';
    case '.txt': return 'text/plain';
    case '.mp3': return 'audio/mp3';
    case '.wav': return 'audio/wav';
    case '.mp4': return 'video/mp4';
    default: return 'application/octet-stream';
  }
}

function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function parseExcelFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        let resultText = '';
        workbook.SheetNames.forEach((sheetName) => {
          const sheet = workbook.Sheets[sheetName];
          const csv = XLSX.utils.sheet_to_csv(sheet);
          resultText += `[Hoja de Cálculo: ${sheetName}]\n${csv}\n\n`;
        });
        resolve(resultText.trim());
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

async function parseDocxFile(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);
  const docXmlText = await zip.file('word/document.xml')?.async('text');
  if (!docXmlText) {
    throw new Error('No se pudo encontrar el archivo word/document.xml en el archivo .docx');
  }
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(docXmlText, 'application/xml');
  const textNodes = xmlDoc.getElementsByTagName('w:t');
  let textContent = '';
  for (let i = 0; i < textNodes.length; i++) {
    textContent += textNodes[i].textContent + ' ';
  }
  return textContent.trim();
}
