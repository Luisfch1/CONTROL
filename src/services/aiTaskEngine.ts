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
