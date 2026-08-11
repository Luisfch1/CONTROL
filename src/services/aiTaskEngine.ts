import { chatWithAgent } from './aiService';
import type { AIConfig, ChatMessage } from './aiService';
import type { Project, BudgetItem } from '../types/projectTypes';
import { buildProjectSystemInstruction } from './aiContextBuilder';

export interface TaskProgress {
  totalChunks: number;
  currentChunk: number;
  statusText: string;
}

export type ProgressCallback = (progress: TaskProgress) => void;
export type LogCallback = (message: string) => void;

/**
 * Esquema oficial para Function Calling de Gemini de la herramienta export_report_data
 */
export const EXPORT_REPORT_DATA_TOOL = {
  functionDeclarations: [
    {
      name: "export_report_data",
      description: "Genera y exporta datos tabulares estructurados de control de obra a un archivo físico Excel (.xlsx) o Word (.doc) en LCH Ingeniería.",
      parameters: {
        type: "OBJECT",
        properties: {
          title: {
            type: "STRING",
            description: "Título oficial y descriptivo del reporte técnico."
          },
          summary: {
            type: "STRING",
            description: "Resumen técnico ejecutivo del estado general del proyecto."
          },
          format: {
            type: "STRING",
            enum: ["excel", "word", "both"],
            description: "El formato de archivo físico final a exportar."
          },
          tableData: {
            type: "ARRAY",
            description: "Filas de datos estructurados para las tablas del reporte.",
            items: {
              type: "OBJECT",
              properties: {
                itemCode: {
                  type: "STRING",
                  description: "Código del ítem en el presupuesto (ej. '1.1.1', '2.1.3')."
                },
                description: {
                  type: "STRING",
                  description: "Descripción de la actividad o ítem."
                },
                unit: {
                  type: "STRING",
                  description: "Unidad de medida (ej. M3, ML, M2, UN)."
                },
                quantity: {
                  type: "NUMBER",
                  description: "Cantidad total presupuestada en el diseño."
                },
                unitPrice: {
                  type: "NUMBER",
                  description: "Valor unitario del ítem en pesos."
                },
                totalPrice: {
                  type: "NUMBER",
                  description: "Costo total presupuestado para este ítem."
                },
                executedQuantity: {
                  type: "NUMBER",
                  description: "Cantidad ejecutada acumulada a la fecha de corte."
                },
                status: {
                  type: "STRING",
                  description: "Estado de ejecución: 'Pendiente', 'En Progreso', 'Completado', 'Atrasado'."
                },
                notes: {
                  type: "STRING",
                  description: "Observaciones técnicas sobre rendimientos o causas de retrasos."
                }
              },
              required: ["itemCode", "description"]
            }
          }
        },
        required: ["title", "summary", "format", "tableData"]
      }
    }
  ]
};

export const ADD_TODO_TOOL = {
  functionDeclarations: [
    {
      name: "add_todo",
      description: "Agrega una nueva tarea o pendiente de obra al archivo PENDIENTES.md del proyecto para recordarlo.",
      parameters: {
        type: "OBJECT",
        properties: {
          text: {
            type: "STRING",
            description: "Texto descriptivo de la tarea o actividad pendiente a realizar."
          }
        },
        required: ["text"]
      }
    }
  ]
};

export const DELETE_TODO_TOOL = {
  functionDeclarations: [
    {
      name: "delete_todo",
      description: "Elimina, borra o marca como completada una tarea pendiente existente de la lista del proyecto en PENDIENTES.md.",
      parameters: {
        type: "OBJECT",
        properties: {
          text: {
            type: "STRING",
            description: "El texto o descripción del pendiente que ya fue realizado y se desea eliminar."
          }
        },
        required: ["text"]
      }
    }
  ]
};

/**
 * Esquema oficial para Function Calling de Gemini de la herramienta generate_photo_report
 */
export const GENERATE_PHOTO_REPORT_TOOL = {
  functionDeclarations: [
    {
      name: "generate_photo_report",
      description: "Genera y descarga un reporte fotográfico oficial de interventoría (.doc) o un archivo comprimido (.zip) con las fotos de obra filtradas por rango de fechas, ítem de presupuesto o texto descriptivo en LCH Ingeniería.",
      parameters: {
        type: "OBJECT",
        properties: {
          dateFrom: {
            type: "STRING",
            description: "Fecha de inicio para filtrar las fotos en formato YYYY-MM-DD (ej. '2026-05-18') (opcional)."
          },
          dateTo: {
            type: "STRING",
            description: "Fecha de fin para filtrar las fotos en formato YYYY-MM-DD (ej. '2026-05-24') (opcional)."
          },
          itemFilter: {
            type: "STRING",
            description: "Código de ítem presupuestal específico para filtrar (ej. '1.1.1') (opcional)."
          },
          textFilter: {
            type: "STRING",
            description: "Filtro por texto de descripción o código de la foto (ej. 'concreto') (opcional)."
          },
          format: {
            type: "STRING",
            enum: ["word", "zip"],
            description: "El formato del reporte físico final: 'word' para descargar el documento estructurado Word (.doc) o 'zip' para el archivo comprimido."
          }
        },
        required: ["format"]
      }
    }
  ]
};

export const GENERATE_PROGRESS_REPORT_TOOL = {
  functionDeclarations: [
    {
      name: "generate_progress_report",
      description: "Genera un nuevo balance o informe de avance de obra (reporte de progreso) a partir de los datos indicados por el usuario, actualizando los acumulados de las actividades específicas basándose en el último reporte y dejando el resto igual.",
      parameters: {
        type: "OBJECT",
        properties: {
          reportName: {
            type: "STRING",
            description: "Nombre descriptivo para el nuevo reporte de avance (ej. 'Balance Fin de Mes - Mayo 2026', 'Corte de Obra 25 de Mayo')."
          },
          reportDate: {
            type: "STRING",
            description: "Fecha de corte del avance en formato YYYY-MM-DD (ej. '2026-05-25')."
          },
          updates: {
            type: "ARRAY",
            description: "Lista de actividades con sus nuevas cantidades acumuladas.",
            items: {
              type: "OBJECT",
              properties: {
                itemCode: {
                  type: "STRING",
                  description: "Código del ítem en el presupuesto o descripción clara de la actividad (ej. '1.1.1', 'zapatas')."
                },
                accumulatedQuantity: {
                  type: "NUMBER",
                  description: "La nueva cantidad acumulada total ejecutada a la fecha de corte."
                }
              },
              required: ["itemCode", "accumulatedQuantity"]
            }
          }
        },
        required: ["reportName", "reportDate", "updates"]
      }
    }
  ]
};

export const CREATE_NEW_BUDGET_TOOL = {
  functionDeclarations: [
    {
      name: "create_new_budget",
      description: "Crea una nueva versión de presupuesto o escenario comparativo en el proyecto a partir de una lista de ítems detallada.",
      parameters: {
        type: "OBJECT",
        properties: {
          versionName: {
            type: "STRING",
            description: "Nombre descriptivo del nuevo escenario de presupuesto (ej. 'Presupuesto Modificado V1', 'Adicionales de Obra Junio')."
          },
          items: {
            type: "ARRAY",
            description: "La lista de ítems completa que conformará esta versión de presupuesto.",
            items: {
              type: "OBJECT",
              properties: {
                item: {
                  type: "STRING",
                  description: "Código del ítem presupuestal (ej. '1.1', '1.2.1')."
                },
                descripcion: {
                  type: "STRING",
                  description: "Descripción de la actividad o capítulo."
                },
                unidad: {
                  type: "STRING",
                  description: "Unidad de medida (ej. M3, ML, M2, UN, GL)."
                },
                cantidad: {
                  type: "NUMBER",
                  description: "Cantidad de obra presupuestada."
                },
                vlrUnitario: {
                  type: "NUMBER",
                  description: "Precio unitario del ítem."
                },
                type: {
                  type: "STRING",
                  enum: ["item", "subtitle", "title"],
                  description: "Tipo de fila: 'item' para actividades con precio, 'title' para capítulos principales, 'subtitle' para subcapítulos."
                }
              },
              required: ["item", "descripcion", "type"]
            }
          }
        },
        required: ["versionName", "items"]
      }
    }
  ]
};

export const READ_BUDGET_TOOL = {
  functionDeclarations: [
    {
      name: "read_budget",
      description: "Retorna el presupuesto activo completo del proyecto (lista de ítems, descripciones, unidades, cantidades y precios).",
      parameters: {
        type: "OBJECT",
        properties: {}
      }
    }
  ]
};

export const READ_PROGRESS_REPORTS_TOOL = {
  functionDeclarations: [
    {
      name: "read_progress_reports",
      description: "Retorna el histórico de todos los reportes de avance físico registrados (cantidades acumuladas ejecutadas a diferentes fechas).",
      parameters: {
        type: "OBJECT",
        properties: {}
      }
    }
  ]
};

export const READ_PARTIAL_REPORTS_TOOL = {
  functionDeclarations: [
    {
      name: "read_partial_reports",
      description: "Retorna el histórico de actas parciales de cobro emitidas al cliente.",
      parameters: {
        type: "OBJECT",
        properties: {}
      }
    }
  ]
};

export const READ_APUS_TOOL = {
  functionDeclarations: [
    {
      name: "read_apus",
      description: "Retorna el Análisis de Precios Unitarios (APUs) con el desglose de insumos (materiales, mano de obra, equipos, transporte) para las actividades del proyecto.",
      parameters: {
        type: "OBJECT",
        properties: {
          itemCode: {
            type: "STRING",
            description: "Código de actividad opcional para filtrar un APU específico (ej. '1.1.1'). Si no se envía, retorna todos los APUs."
          }
        }
      }
    }
  ]
};

export const READ_COST_RESOURCES_TOOL = {
  functionDeclarations: [
    {
      name: "read_cost_resources",
      description: "Retorna el listado general de recursos e insumos con sus unidades y precios contractuales/estimados de referencia.",
      parameters: {
        type: "OBJECT",
        properties: {}
      }
    }
  ]
};

export const READ_COST_TRANSACTIONS_TOOL = {
  functionDeclarations: [
    {
      name: "read_cost_transactions",
      description: "Retorna el registro detallado de egresos y costos reales generados en el proyecto (transacciones, facturas y pagos a proveedores).",
      parameters: {
        type: "OBJECT",
        properties: {}
      }
    }
  ]
};

export const READ_CORRESPONDENCE_TOOL = {
  functionDeclarations: [
    {
      name: "read_correspondence",
      description: "Retorna el catálogo de correspondencia (oficios, actas, cartas) y correos Gmail importados, incluyendo metadatos, resúmenes IA y estado de seguimiento.",
      parameters: {
        type: "OBJECT",
        properties: {}
      }
    }
  ]
};

export const READ_TODOS_TOOL = {
  functionDeclarations: [
    {
      name: "read_todos",
      description: "Retorna la agenda completa de tareas pendientes y compromisos registrados para la interventoría.",
      parameters: {
        type: "OBJECT",
        properties: {}
      }
    }
  ]
};

export const READ_RAW_BUDGET_CHUNK_TOOL = {
  functionDeclarations: [
    {
      name: "read_raw_budget_chunk",
      description: "Lee un fragmento (chunk) del presupuesto extenso que fue pegado por el usuario (almacenado en budgetRawText).",
      parameters: {
        type: "OBJECT",
        properties: {
          lineStart: {
            type: "NUMBER",
            description: "Número de línea (1-indexed) desde el cual empezar a leer."
          },
          chunkSize: {
            type: "NUMBER",
            description: "Cantidad de líneas a retornar en este fragmento (ej. 20 o 30)."
          }
        },
        required: ["lineStart", "chunkSize"]
      }
    }
  ]
};

export const WRITE_BUDGET_DRAFT_CHUNK_TOOL = {
  functionDeclarations: [
    {
      name: "write_budget_draft_chunk",
      description: "Agrega, concatena o actualiza ítems interpretados en la versión preliminar del presupuesto (budgetDraft).",
      parameters: {
        type: "OBJECT",
        properties: {
          versionName: {
            type: "STRING",
            description: "Nombre de la versión del borrador (ej. 'Presupuesto Modificado V1')."
          },
          items: {
            type: "ARRAY",
            description: "Lista de ítems analizados en este bloque para agregar al borrador.",
            items: {
              type: "OBJECT",
              properties: {
                item: {
                  type: "STRING",
                  description: "Código del ítem (ej. '1.1', '1.2.1')."
                },
                descripcion: {
                  type: "STRING",
                  description: "Descripción de la actividad o capítulo."
                },
                unidad: {
                  type: "STRING",
                  description: "Unidad de medida (ej. M3, ML, M2, UN, GL)."
                },
                cantidad: {
                  type: "NUMBER",
                  description: "Cantidad presupuestada."
                },
                vlrUnitario: {
                  type: "NUMBER",
                  description: "Valor unitario."
                },
                type: {
                  type: "STRING",
                  enum: ["item", "subtitle", "title"],
                  description: "Tipo de fila: 'item' para actividades, 'title' para capítulos, 'subtitle' para subcapítulos."
                }
              },
              required: ["item", "descripcion", "type"]
            }
          }
        },
        required: ["versionName", "items"]
      }
    }
  ]
};

export const GENERATE_EXECUTIVE_REPORT_TOOL = {
  functionDeclarations: [
    {
      name: "generate_executive_report",
      description: "Genera y descarga el Informe Ejecutivo Mensual de Interventoría en formato Word (.doc). Consolida la tabla de avance de obra, la curva S y las fotos de avance del período seleccionado. Úsalo cuando el usuario pida generar, exportar o descargar el informe ejecutivo, el informe mensual o el reporte de avance de obra.",
      parameters: {
        type: "OBJECT",
        properties: {
          selectedMonth: {
            type: "STRING",
            description: "Mes de corte del informe en formato YYYY-MM (ej. '2026-06'). Si no se especifica, se usa el mes actual."
          },
          dateFrom: {
            type: "STRING",
            description: "Fecha de inicio del período en formato YYYY-MM-DD (ej. '2026-06-01'). Opcional; si no se envía, se usa el primer día del mes."
          },
          dateTo: {
            type: "STRING",
            description: "Fecha de fin del período en formato YYYY-MM-DD (ej. '2026-06-30'). Opcional; si no se envía, se usa el último día del mes."
          },
          narrativeText: {
            type: "STRING",
            description: "Narrativa técnica ejecutiva que describe el estado del proyecto, avances logrados, causas de atrasos y recomendaciones técnicas. Si no se provee, se usa el texto guardado del informe si existe."
          },
          sCurveCaption: {
            type: "STRING",
            description: "Comentario analítico sobre la curva S que indica el porcentaje ejecutado vs. el programado a la fecha de corte. Si no se provee, se usa el texto guardado o se genera automáticamente."
          }
        },
        required: ["selectedMonth"]
      }
    }
  ]
};
