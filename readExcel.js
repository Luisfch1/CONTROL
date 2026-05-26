import pkg from 'xlsx';
const { readFile, utils } = pkg;

const filePath = './Insumos Luis/Presupuesto ejemplo.xlsx';
const workbook = readFile(filePath);
const sheetName = 'Presupuesto';
const worksheet = workbook.Sheets[sheetName];
const data = utils.sheet_to_json(worksheet, { header: 1 });
console.log('--- First 20 Rows of Sheet:', sheetName, '---');
for (let i = 0; i < 20 && i < data.length; i++) {
  console.log(`Row ${i + 1}:`, JSON.stringify(data[i]));
}
