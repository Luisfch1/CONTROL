/**
 * Convierte de forma robusta cualquier valor (string, formatted text, etc.)
 * a un número de JavaScript válido, soportando símbolos de moneda, espacios,
 * y formatos regionales de miles y decimales (español/americano).
 */
export const parseRobustNumber = (val: any): number => {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return val;
  
  let str = String(val).trim();
  
  // Ignorar errores de Excel comunes (#REF!, #VALUE!, etc.) o NaN
  if (str.startsWith('#') || str.toUpperCase() === 'NAN' || str.toUpperCase() === 'N/A') return 0;
  
  // Eliminar símbolos de moneda ($), comillas y espacios en blanco
  str = str.replace(/[\$\s'\u00a0]/g, '');
  
  const lastComma = str.lastIndexOf(',');
  const lastDot = str.lastIndexOf('.');
  
  if (lastComma > lastDot) {
    // Caso 1: Formato español (ej: 1.234.567,89)
    // El punto representa miles y la coma representa decimales.
    // Removemos todos los puntos y cambiamos la coma por punto.
    str = str.replace(/\./g, '').replace(/,/g, '.');
  } else if (lastDot > lastComma) {
    // Caso 2: Formato americano (ej: 1,234,567.89)
    // La coma representa miles y el punto representa decimales.
    // Removemos todas las comas.
    str = str.replace(/,/g, '');
  } else {
    // Caso 3: Solo hay comas o solo hay puntos o ninguno.
    if (lastComma !== -1) {
      // Si hay comas, evaluamos si es decimal o miles
      const parts = str.split(',');
      if (parts.length === 2 && parts[1].length !== 3) {
        // Ej: 12,5 -> Decimal
        str = str.replace(/,/g, '.');
      } else {
        // Ej: 1,000 -> Miles
        str = str.replace(/,/g, '');
      }
    }
  }
  
  const parsed = parseFloat(str);
  return isNaN(parsed) ? 0 : parsed;
};
