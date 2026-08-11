export interface BudgetItem {
  item: string;
  descripcion: string;
  unidad: string;
  cantidad: number;
  vlrUnitario: number;
  vlrTotal: number;
  type: 'title' | 'subtitle' | 'item';
  startDate?: string;
  endDate?: string;
}

export interface ProgressEntry {
  itemCode: string;
  accumulatedQuantity: number;
}

export interface ProgressReport {
  id: string;
  date: string;
  name: string;
  entries: ProgressEntry[];
}

export interface PartialEntry {
  itemCode: string;
  partialQuantity: number;
  partialValue: number;
  partialPercentage: number;
}

export interface PartialReport {
  id: string;
  date: string;
  name: string;
  entries: PartialEntry[];
}


export interface LogiEntry {
  id: string;
  date: string;
  itemCode: string;
  description: string;
  imageUrl: string;
  isLocal?: boolean; // Flag para indicar si la foto reside en IndexedDB (lchp) o en la nube
  status: 'pending' | 'integrated';
  aiProposal?: {
    itemCode: string;
    description: string;
    confidence?: number;
  };
}

export interface BudgetVersion {
  id: string;
  name: string;
  createdAt: string;
  items: BudgetItem[];
}

export interface ReportFormat {
  id: string;
  name: string;
  isBase?: boolean;
  config: {
    columns: number;
    photoHeightCm: number;
    photoWidthCm: number;
    showItemCode: boolean;
    showDescription: boolean;
    showUnit: boolean;
    showQuantity: boolean;
    showHeader: boolean;
    showFooter: boolean;
  };
}

export interface PhotoReport {
  id: string;
  name: string;
  createdAt: string;
  dateFrom?: string;
  dateTo?: string;
  itemFilter?: string;
  textFilter?: string;
  photoIds: string[]; // Lista de IDs de fotos que conforman este informe
}

export interface ExecutiveReport {
  id: string;
  name: string;
  createdAt: string;
  selectedMonth: string;
  dateFrom: string;
  dateTo: string;
  narrativeText: string;
  excludedPhotoIds: string[]; // Fotos excluidas en este reporte
  sCurveCaption?: string; // Comentario técnico debajo de la curva S
}

export interface ReportStaff {
  name: string;
  idCard: string;
  role: string;
}

export interface ReportElement {
  id: string;
  type: 'text' | 'artifact';
  content?: string;
  artifactType?: string;
}

export interface ReportSection {
  id: string;
  title: string;
  visible: boolean;
  type: string;
  elements?: ReportElement[];
  content?: string;
}

export interface DocxBlock {
  id: string;
  type: 'paragraph' | 'table' | 'widget';
  text?: string;
  widgetType?: 'progress-table' | 'photos' | 'curve-s' | 'staff-obra' | 'staff-interventoria' | 'contract-data' | 'committees' | 'correspondence';
  originalXmlString?: string;
  rows?: string[][];
  align?: 'left' | 'center' | 'right' | 'justify';
}

export interface ReportConfig {
  objetoObra?: string;
  noContrato?: string;
  contratistaObra?: string;
  repLegalObra?: string;
  nitObra?: string;
  contratistaInterventoria?: string;
  repLegalInterventoria?: string;
  nitInterventoria?: string;
  supervisorFfie?: string;
  fiduciaria?: string;
  jornadasTrabajo?: string;
  personalObra?: ReportStaff[];
  personalInterventoria?: ReportStaff[];
  sections?: ReportSection[];
  docxTemplateBase64?: string;
  docxBlocks?: DocxBlock[];
  additionalPhotoItems?: string[];
  executiveNarratives?: Record<string, string>; // Mapea selectedMonth (ej: '2026-05') a su narrativa técnica
  sCurveCaptions?: Record<string, string>; // Mapea selectedMonth (ej: '2026-05') a su descripción de curva S
}

export interface Project {
  id: string;
  name: string;
  code: string;
  location: string;
  startDate: string;
  endDate?: string;
  createdAt?: string;
  durationMonths: number;
  aiu: {
    administracion: number;
    imprevistos: number;
    utilidad: number;
  };
  budgetTotalBase: number;
  budgetItems: BudgetItem[];
  budgetVersions?: BudgetVersion[];
  activeBudgetVersionId?: string;
  progressReports: ProgressReport[];
  partialReports?: PartialReport[];
  logiEntries: LogiEntry[];
  reportFormats?: ReportFormat[];
  photoReports?: PhotoReport[];
  executiveReports?: ExecutiveReport[];
  cloudConfig?: {
    provider: 'supabase' | 'firebase';
    url: string;
    apiKey: string;
    projectId: string;
  };
  geminiApiKey?: string;
  agentCustomInstructions?: string;
  labelOffsets?: Record<string, { x: number, y: number }>;
  showStatusLine?: boolean;
  visibleCurves?: { planned: boolean; executed: boolean; financial: boolean };
  agentTodos?: AgentTodo[];
  filePath?: string;
  correspondenceFolders?: CorrespondenceFolder[];
  correspondenceFiles?: CorrespondenceFile[];
  activityAPUs?: ActivityAPU[];
  costResources?: CostResource[];
  costTransactions?: CostTransaction[];
  apuFiles?: string[];
  reportConfig?: ReportConfig;
  calculationMemories?: CalculationMemory[];
  gmailConfig?: GmailConfig;
  gmailEmails?: ImportedEmail[];
  gmailCorrespondenceReports?: GmailCorrespondenceReport[];
  budgetRawText?: string;
  budgetDraft?: {
    versionName: string;
    items: BudgetItem[];
  };
}

export interface GmailConfig {
  email: string;
  isConnected: boolean;
  lastSync?: string;
  addressRules?: Record<string, 'obra' | 'supervision' | 'interventoria' | 'general'>;
}

export interface ImportedEmail {
  id: string;
  date: string;
  dateTime: string;
  direction: 'inbound' | 'outbound';
  sender: string;
  receiver: string;
  subject: string;
  bodySnippet?: string;
  category: 'obra' | 'supervision' | 'interventoria' | 'general';
  attachmentsCount?: number;
}

export interface GmailCorrespondenceReport {
  id: string;
  name: string;
  createdAt: string;
  dateFrom?: string;
  dateTo?: string;
  categoryFilter?: string;
  textFilter?: string;
  emailIds: string[];
}


export interface APUResource {
  description: string;
  unit: string;
  quantity: number;
  price: number;
  total: number;
}

export interface ActivityAPU {
  itemCode: string;
  materials: APUResource[];
  labor: APUResource[];
  equipment: APUResource[];
  transport: APUResource[];
  pdfFileName?: string;
}

export interface CostResource {
  id: string;
  code: string;
  description: string;
  type: 'material' | 'labor' | 'equipment' | 'transport' | 'other';
  unit: string;
  referencePrice: number;
}

export interface CostTransaction {
  id: string;
  date: string;
  itemCode: string;
  resourceId?: string;
  resourceType: 'material' | 'labor' | 'equipment' | 'transport' | 'other';
  description: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  provider?: string;
  invoiceNumber?: string;
}


export interface AgentTodo {
  id: string;
  text: string;
  createdAt: string;
  completedAt?: string;
  completed: boolean;
}

export interface CorrespondenceFile {
  id: string;
  name: string;
  uploadDate: string;
  fileData?: string; // base64 del PDF
  text?: string;
  folderId: string;
  metadata?: {
    date?: string;
    sender?: string;
    receiver?: string;
    subject?: string;
    summary?: string;
    status: 'pending' | 'answered' | 'no_action_needed';
    followUpDeadline?: string;
    notes?: string;
  };
}

export interface CorrespondenceFolder {
  id: string;
  name: string;
  parentId: string | null;
}

export interface CalculationMemory {
  id: string;
  code: string;
  title: string;
  description: string;
  author: string;
  revision: string;
  date: string;
  fileUrl?: string;
  fileName?: string;
  fileSize?: string;
}