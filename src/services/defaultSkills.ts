export const LOCAL_DEFAULT_SKILLS: Record<string, string> = {
  generate_executive_report: `# Habilidad: Generación de Informe Ejecutivo (generate_executive_report)

Esta habilidad genera y descarga el Informe Ejecutivo Mensual de Interventoría en formato Microsoft Word (.doc). El motor de la aplicación calcula todos los datos reales automáticamente.

## ⚠️ REGLA DE ORO — PROHIBICIÓN ABSOLUTA DE INVENTAR DATOS

**NUNCA inventes, estimes ni asumas porcentajes de avance, valores monetarios, fechas de ejecución ni cualquier cifra técnica o financiera.** Todos esos datos los calcula el motor interno de la aplicación a partir del registro real de obra. Si inventas números, el informe quedará incorrecto y engañará a la interventoría.

## Instrucciones de Uso

### 1. Cuándo usar esta herramienta
Úsala cuando el usuario pida:
- "Genera el informe ejecutivo de [mes]"
- "Exporta el reporte mensual"
- "Descarga el informe de avance de [mes]"
- "Crea el informe de estado de obra de [mes]"

### 2. Cómo llamar la herramienta (SOLO UNA VEZ)

\`\`\`json
{
  "name": "generate_executive_report",
  "args": {
    "selectedMonth": "YYYY-MM"
  }
}
\`\`\`

- **selectedMonth** (OBLIGATORIO): El mes de corte en formato \`YYYY-MM\`. Dedúcelo del contexto de la conversación.
- **dateFrom / dateTo** (OPCIONALES): Úsalos solo si el usuario especificó un rango distinto al mes completo.
- **narrativeText** (PROHIBIDO USAR): NO pases este parámetro. El motor ignora la narrativa del modelo y usa EXCLUSIVAMENTE la narrativa escrita y guardada por el usuario en la interfaz de Informes Mensuales.
- **sCurveCaption** (PROHIBIDO USAR): NO pases este parámetro. El caption se genera automáticamente con los porcentajes reales calculados por la aplicación.

### 3. Lo que hace el motor automáticamente (sin tu intervención)
- Calcula el avance ejecutado real (\`execPct\`) sumando todas las cantidades ingresadas en Avance de Obra.
- Calcula el avance programado teórico (\`plannedPct\`) interpolando la programación a la fecha de corte.
- Construye la tabla completa de avance con todos los ítems, cantidades, valores y porcentajes.
- Renderiza la Curva S vectorial igual a la vista CONTROL CURVA S.
- Incluye las fotos de avance integradas en el período seleccionado.
- Usa la narrativa técnica que el usuario escribió y guardó en la sección de Informes Mensuales.

### 4. Respuesta al usuario después de llamar la herramienta
Espera la confirmación del sistema. Cuando el handler confirme la descarga, reporta al usuario:
- El período del informe
- El avance ejecutado real (dato que te devuelve la app, no inventado)
- El avance programado real (dato que te devuelve la app, no inventado)
- La cantidad de fotos incluidas`,

  export_report_data: `# Habilidad: Exportación Tabular de Reportes (export_report_data)

Esta habilidad permite al Agente IA generar y exportar reportes de interventoría física y financiera de las actividades del proyecto en formatos Word (.doc) y Excel (.xlsx).

## Reglas de Trabajo e Instrucciones
1. **Consistencia de Datos:** Toda exportación tabular debe utilizar los datos del presupuesto activo y los reportes acumulados de avance físico y financiero.
2. **Formato:** Los reportes de Excel deben presentar la estructura de capítulos y subcapítulos con su sangría y jerarquía visual.
3. **Moneda:** Los valores financieros deben formatearse en pesos colombianos (COP).
4. **Resumen de Avance:** Siempre debe incluirse una fila de totales generales del proyecto calculando el avance ponderado real vs. programado.`,

  generate_photo_report: `# Habilidad: Generación de Informes Fotográficos (generate_photo_report)

Esta habilidad permite filtrar, ordenar y exportar las fotos de avance de obra (evidencias de campo) a documentos de reporte Word (.doc) o a un archivo comprimido (.zip) con su respectiva información técnica.

## Reglas de Trabajo e Instrucciones
1. **Filtros de Fecha:** Si el usuario solicita un reporte de fotos para un período específico, se deben filtrar estrictamente los registros cuya fecha se encuentre en ese rango.
2. **Asociación de Ítems:** Cada foto debe estar vinculada a su código de ítem presupuestal correspondiente (ej: 1.2.1). Si no tiene ítem, se categoriza como "General" o "S/N".
3. **Ordenamiento:** Las fotos deben ordenarse cronológicamente de forma ascendente para mostrar el avance de la obra secuencialmente.
4. **Nombres de Archivos:** Las imágenes deben nombrarse siguiendo el patrón \`fecha_item_fotoNumero.ext\` y acompañarse de un archivo \`.txt\` con su descripción para reportes comprimidos.`,

  generate_progress_report: `# Habilidad: Registro e Informe de Avances (generate_progress_report)

Esta habilidad permite calcular cantidades acumuladas de obra y generar reportes periódicos (semanales o mensuales) basados en las descripciones de avance técnico ingresadas por el usuario.

## Reglas de Trabajo e Instrucciones
1. **Cálculo de Acumulados:** La cantidad acumulada de una actividad es la suma de la cantidad del reporte anterior más la cantidad ejecutada en el período actual.
2. **Límites de Cantidad:** La cantidad acumulada no debe exceder la cantidad total contratada/presupuestada a menos que exista un adicional aprobado.
3. **Validación de Fechas:** Las fechas de los reportes de avance deben ser consecutivas y no solaparse con períodos anteriores.`,

  add_todo: `# Habilidad: Gestión de Pendientes - Creación (add_todo)

Esta habilidad permite al Agente IA detectar compromisos, tareas y pendientes pendientes durante el análisis o chat con el usuario, redactarlos de forma técnica y agregarlos al archivo físico \`PENDIENTES.md\`.

## Reglas de Trabajo e Instrucciones
1. **Redacción Técnica:** Las tareas deben ser claras, indicar el responsable si se conoce y usar verbos de acción (ej: "Verificar vaciado de losa", "Revisar correspondencia de interventoría").
2. **Priorización:** Clasificar la tarea según su criticidad en el avance de la obra (Alta, Media, Baja).
3. **Estructura en PENDIENTES.md:** Cada pendiente debe insertarse con formato de lista de verificación (\`- [ ]\`) bajo el capítulo del proyecto correspondiente.`,

  delete_todo: `# Habilidad: Gestión de Pendientes - Cierre (delete_todo)

Esta habilidad permite al Agente IA marcar tareas pendientes como completadas (\`- [x]\`) o eliminarlas físicamente de \`PENDIENTES.md\` una vez que el usuario confirme verbalmente su finalización.

## Reglas de Trabajo e Instrucciones
1. **Verificación Conversacional:** Antes de cerrar o eliminar una tarea, se debe comprobar que el usuario explícitamente confirme que el trabajo asociado ha sido terminado o descartado.
2. **Preservar Historial:** Se prefiere marcar las tareas como completadas (\`[x]\`) en lugar de eliminarlas físicamente para mantener la trazabilidad, a menos que el usuario solicite borrarla.
3. **Actualización:** Registrar la fecha de cierre de la tarea en la misma línea del pendiente.`,

  generate_new_budget: `# Habilidad: Generar Nuevo Presupuesto (generate_new_budget)

Esta habilidad permite al Agente IA analizar un archivo Excel cargado que contiene modificaciones del presupuesto (adicionales, variaciones de cantidades o precios) y estructurar un nuevo presupuesto o escenario comparativo.

## Reglas de Trabajo e Instrucciones

1. **Acción Principal (Crear Nueva Versión):**
   - El agente debe tomar el presupuesto activo del proyecto como base (presupuesto anterior).
   - Debe proponer la creación de un nuevo escenario o versión del presupuesto usando la herramienta o indicando los cambios para que se guarde como una nueva versión en la aplicación.

2. **Comparación e Incorporación de Datos (Columnas a la Derecha):**
   - El nuevo presupuesto debe mantener la estructura del presupuesto anterior, pero agregar columnas de comparación para el análisis técnico:
     - **Presupuesto Anterior (LCH Base):** Cantidad, Precio Unitario, Valor Total.
     - **Presupuesto Modificado (Nuevos datos):** Nuevas Cantidades, Nuevos Precios Unitarios, Nuevos Valores Totales.
     - **Diferencia / Variación:** Variación de Cantidad, Variación de Precio, Desviación de Valor Total.
   - Debe identificar claramente:
     - **Ítems Adicionales:** Nuevas actividades que no existían en el presupuesto contractual anterior.
     - **Ítems con Aumento/Disminución de Cantidad:** Actividades con variación en volumen de obra.
     - **Ítems con Variación de Precio:** Actividades con costos unitarios diferentes.

3. **Cálculo y Presentación Visual:**
   - Realizar las sumas de costo directo para ambos escenarios (anterior y modificado), calcular el AIU correspondiente y contrastar el valor total de contrato resultante.
   - Presentar el reporte comparativo en formato de tabla Markdown limpia siguiendo la paleta de colores de LCH Ingeniería (texto negro, títulos gris oscuro, cabeceras gris claro, sin amarillos/dorados).`
};
