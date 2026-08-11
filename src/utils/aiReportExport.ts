import type { Project, BudgetItem } from '../types/projectTypes';
import { format, parseISO, differenceInDays, isBefore, isAfter, eachMonthOfInterval, max, isValid, isSameDay } from 'date-fns';
import { es } from 'date-fns/locale';

/**
 * Calcula los puntos de avance del proyecto (PV, EV, FI) para graficar en Word.
 */
const getChartData = (project: Project) => {
  const startDateStr = project.startDate;
  const duration = project.durationMonths;
  if (!startDateStr || isNaN(duration)) return [];

  const activeVersion = project.budgetVersions?.find(v => v.id === project.activeBudgetVersionId);
  const budgetItems = activeVersion?.items || project.budgetItems || [];

  const globalStart = parseISO(startDateStr);
  const totalDaysDuration = Math.round(duration * 30.4375);
  const globalEnd = new Date(globalStart);
  globalEnd.setDate(globalEnd.getDate() + totalDaysDuration);

  const reports = project.progressReports || [];
  const reportDates = reports.map(r => parseISO(r.date));
  const lastReportDate = reportDates.length > 0 ? max(reportDates) : null;

  let intervals: Date[] = [];
  try {
    const rawIntervals = eachMonthOfInterval({ start: globalStart, end: globalEnd });
    intervals = [
      globalStart,
      ...rawIntervals.filter(d => isAfter(d, globalStart) && isBefore(d, globalEnd)),
      globalEnd
    ];
    if (lastReportDate && isAfter(lastReportDate, globalStart) && isBefore(lastReportDate, globalEnd)) {
      intervals.push(lastReportDate);
    }
    intervals = intervals.filter((d, i) => intervals.findIndex(x => isSameDay(x, d)) === i);
    intervals.sort((a, b) => a.getTime() - b.getTime());
  } catch (e) {
    return [];
  }

  const aiu = project.aiu || { administracion: 0, imprevistos: 0, utilidad: 0 };
  const aiuFactor = 1 + (((aiu.administracion || 0) + (aiu.imprevistos || 0) + (aiu.utilidad || 0)) / 100);
  const baseValue = budgetItems.reduce((acc, item) => acc + (item.type === 'item' && item.vlrTotal > 0 ? item.vlrTotal : 0), 0);
  const totalContractValue = (baseValue || 1) * aiuFactor;

  const firstReportTime = reportDates.length > 0 ? Math.min(...reportDates.map(d => d.getTime())) : 0;
  const lastReportTime = lastReportDate ? lastReportDate.getTime() : 0;

  const partials = project.partialReports || [];
  const partialDates = partials.map(p => parseISO(p.date));
  const firstPartialTime = partialDates.length > 0 ? Math.min(...partialDates.map(d => d.getTime())) : 0;
  const lastPartialTime = partialDates.length > 0 ? Math.max(...partialDates.map(d => d.getTime())) : 0;

  const getExactPlannedValue = (targetDate: Date) => {
    let total = 0;
    budgetItems.forEach(item => {
      if (item.type !== 'item' || item.vlrTotal <= 0 || !item.startDate || !item.endDate) return;
      const start = new Date(item.startDate + 'T12:00:00');
      const end = new Date(item.endDate + 'T12:00:00');
      const now = new Date(targetDate);
      now.setHours(12, 0, 0, 0);

      if (now >= end) {
        total += item.vlrTotal;
      } else if (now >= start) {
        const totalDays = Math.max(1, differenceInDays(end, start) + 1);
        const elapsedDays = Math.max(0, differenceInDays(now, start) + 1);
        total += item.vlrTotal * (Math.min(1, elapsedDays / totalDays));
      }
    });
    return total * aiuFactor;
  };

  const chartData = intervals.map(date => {
    const dateTime = date.getTime();
    const isAfterLastReport = lastReportTime > 0 && dateTime > lastReportTime;
    const isBeforeFirstReport = firstReportTime > 0 && dateTime < firstReportTime && !isSameDay(date, globalStart);

    const plannedValueTotal = getExactPlannedValue(date);

    let executedValueTotal = 0;
    const shouldHaveValue = !isAfterLastReport && !isBeforeFirstReport;
    if (shouldHaveValue || reports.length === 0 || isSameDay(date, globalStart)) {
      const reportsBefore = reports
        .filter(r => parseISO(r.date).getTime() <= dateTime)
        .sort((a, b) => parseISO(b.date).getTime() - parseISO(a.date).getTime());

      let executedValueDirect = 0;
      if (reportsBefore.length > 0) {
        const latestReport = reportsBefore[0];
        latestReport.entries.forEach(entry => {
          const item = budgetItems.find(i => i.item === entry.itemCode || String(i.item) === String(entry.itemCode));
          if (item) executedValueDirect += (entry.accumulatedQuantity || 0) * (item.vlrUnitario || 0);
        });
      }
      executedValueTotal = executedValueDirect * aiuFactor;
    }

    let financialValueTotal = 0;
    const isAfterLastPartial = lastPartialTime > 0 && dateTime > lastPartialTime;
    const isBeforeFirstPartial = firstPartialTime > 0 && dateTime < firstPartialTime && !isSameDay(date, globalStart);
    const isFinancialPoint = !isAfterLastPartial && !isBeforeFirstPartial;

    if (isFinancialPoint || partials.length === 0 || isSameDay(date, globalStart)) {
      const partialsBefore = partials.filter(p => parseISO(p.date).getTime() <= dateTime);
      const financialValueDirect = partialsBefore.reduce((sum, report) => {
        return sum + (report.entries || []).reduce((repSum, entry) => repSum + (entry.partialValue || 0), 0);
      }, 0);
      financialValueTotal = financialValueDirect * aiuFactor;
    }

    const isDataPoint = !isAfterLastReport && !isBeforeFirstReport;

    return {
      date,
      label: format(date, 'MMM yy', { locale: es }).toUpperCase(),
      planned: (plannedValueTotal / totalContractValue) * 100,
      executed: (isDataPoint || isSameDay(date, globalStart))
        ? (executedValueTotal / totalContractValue) * 100
        : null,
      financial: (isFinancialPoint || isSameDay(date, globalStart))
        ? (financialValueTotal / totalContractValue) * 100
        : null
    };
  });

  return chartData;
};

// Almacén temporal de imágenes para compilar en formato MHTML
let mhtmlImages: { cid: string; data: string; mime: string }[] = [];

/**
 * Genera una imagen PNG en base64 usando Canvas 2D para representar la curva S.
 */
const generateCanvasChartPng = (chartData: any[], showFinancial = false): string => {
  if (chartData.length < 2) return '';

  const width = 1200; // Doble resolución para nitidez
  const height = 560; // Doble resolución para nitidez
  const scale = 2;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // Fondo blanco sólido
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  const paddingX = 60 * scale;
  const paddingYTop = 30 * scale;
  const paddingYBottom = 45 * scale;
  const chartWidth = width - paddingX * 2;
  const chartHeight = height - paddingYTop - paddingYBottom;

  const totalPoints = chartData.length;
  const getX = (idx: number) => paddingX + (idx / (totalPoints - 1)) * chartWidth;
  const getY = (val: number) => height - paddingYBottom - (val / 100) * chartHeight;

  // Rejilla y etiquetas Y
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 0.5 * scale;
  ctx.fillStyle = '#7f8c8d';
  ctx.font = `${8 * scale}pt Arial`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'end';

  [0, 20, 40, 60, 80, 100].forEach(val => {
    const y = getY(val);
    ctx.beginPath();
    ctx.moveTo(paddingX, y);
    ctx.lineTo(width - paddingX, y);
    ctx.stroke();
    ctx.fillText(`${val}%`, paddingX - 10 * scale, y);
  });

  // Rejilla y etiquetas X
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  chartData.forEach((d, idx) => {
    if (idx === 0 || idx === totalPoints - 1 || idx % Math.max(1, Math.ceil(totalPoints / 6)) === 0) {
      const x = getX(idx);
      
      // Línea vertical punteada
      ctx.strokeStyle = '#e2e8f0';
      ctx.setLineDash([2 * scale, 2 * scale]);
      ctx.beginPath();
      ctx.moveTo(x, paddingYTop);
      ctx.lineTo(x, height - paddingYBottom);
      ctx.stroke();
      ctx.setLineDash([]); // Reset

      // Texto X
      ctx.fillStyle = '#7f8c8d';
      ctx.font = `${7 * scale}pt Arial`;
      ctx.fillText(d.label, x, height - paddingYBottom + 10 * scale);
    }
  });

  // Curva Programada (PV) - Gris oscuro / Trazo discontinuo
  ctx.strokeStyle = '#7f8c8d';
  ctx.lineWidth = 1.5 * scale;
  ctx.setLineDash([4 * scale, 2 * scale]);
  ctx.beginPath();
  chartData.forEach((d, idx) => {
    const x = getX(idx);
    const y = getY(d.planned);
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.setLineDash([]); // Reset

  // Curva Financiera (FI) - Gris claro / Trazo punteado (si aplica)
  if (showFinancial) {
    ctx.strokeStyle = '#bdc3c7';
    ctx.lineWidth = 1.5 * scale;
    ctx.setLineDash([2 * scale, 2 * scale]);
    ctx.beginPath();
    let first = true;
    chartData.forEach((d, idx) => {
      if (d.financial !== null) {
        const x = getX(idx);
        const y = getY(d.financial);
        if (first) {
          ctx.moveTo(x, y);
          first = false;
        } else {
          ctx.lineTo(x, y);
        }
      }
    });
    ctx.stroke();
    ctx.setLineDash([]); // Reset
  }

  // Curva Ejecutada (EV) - Negro / Trazo grueso continuo
  const validExecuted = chartData.filter(d => d.executed !== null);
  if (validExecuted.length > 0) {
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 3 * scale;
    ctx.beginPath();
    let first = true;
    chartData.forEach((d, idx) => {
      if (d.executed !== null) {
        const x = getX(idx);
        const y = getY(d.executed);
        if (first) {
          ctx.moveTo(x, y);
          first = false;
        } else {
          ctx.lineTo(x, y);
        }
      }
    });
    ctx.stroke();

    // Dibujar círculos en los nodos
    ctx.fillStyle = '#000000';
    chartData.forEach((d, idx) => {
      if (d.executed !== null) {
        const x = getX(idx);
        const y = getY(d.executed);
        ctx.beginPath();
        ctx.arc(x, y, 3.5 * scale, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  // Leyenda en la parte inferior
  const legendY = height - 18 * scale;
  ctx.font = `${8 * scale}pt Arial`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  if (!showFinancial) {
    // Curva S Física: PV vs EV
    const leg1X = width / 2 - 140 * scale;
    ctx.strokeStyle = '#7f8c8d';
    ctx.lineWidth = 1.5 * scale;
    ctx.setLineDash([4 * scale, 2 * scale]);
    ctx.beginPath();
    ctx.moveTo(leg1X, legendY);
    ctx.lineTo(leg1X + 20 * scale, legendY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#333333';
    ctx.fillText('Programación (PV)', leg1X + 25 * scale, legendY);

    const leg2X = width / 2 + 20 * scale;
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 3 * scale;
    ctx.beginPath();
    ctx.moveTo(leg2X, legendY);
    ctx.lineTo(leg2X + 20 * scale, legendY);
    ctx.stroke();

    ctx.fillStyle = '#333333';
    ctx.fillText('Ejecución Real (EV)', leg2X + 25 * scale, legendY);
  } else {
    // Curva S Financiera: FI vs EV
    const leg1X = width / 2 - 140 * scale;
    ctx.strokeStyle = '#bdc3c7';
    ctx.lineWidth = 1.5 * scale;
    ctx.setLineDash([2 * scale, 2 * scale]);
    ctx.beginPath();
    ctx.moveTo(leg1X, legendY);
    ctx.lineTo(leg1X + 20 * scale, legendY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#333333';
    ctx.fillText('Financiero (FI)', leg1X + 25 * scale, legendY);

    const leg2X = width / 2 + 20 * scale;
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 3 * scale;
    ctx.beginPath();
    ctx.moveTo(leg2X, legendY);
    ctx.lineTo(leg2X + 20 * scale, legendY);
    ctx.stroke();

    ctx.fillStyle = '#333333';
    ctx.fillText('Ejecución Real (EV)', leg2X + 25 * scale, legendY);
  }

  return canvas.toDataURL('image/png');
};

/**
 * Genera el contenedor HTML e inyecta la gráfica como imagen PNG base64.
 */
const generateSvgChart = (chartData: any[], chartTitle: string, showFinancial = false) => {
  const pngBase64 = generateCanvasChartPng(chartData, showFinancial);
  if (!pngBase64) return '';

  const rawData = pngBase64.split(',')[1];
  const cid = `chart_${showFinancial ? 'financial' : 'physical'}@lch`;
  mhtmlImages.push({
    cid,
    data: rawData,
    mime: 'image/png'
  });

  return `
    <div style="text-align: center; margin-top: 15px; margin-bottom: 20px; page-break-inside: avoid;">
      <p style="font-family: Arial, sans-serif; font-size: 9.5pt; font-weight: bold; color: #333333; margin-bottom: 8px; text-align: center;">${chartTitle}</p>
      <img src="cid:${cid}" width="600" height="280" style="display: block; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 4px; padding: 5px; width: 600px; height: 280px;" />
    </div>
  `;
};

/**
 * Exporta un reporte consolidado estructurado a formato Microsoft Word (.doc).
 * Admite sobrecarga de firmas para ser 100% compatible con los flujos de la aplicación.
 */
export const exportAIReportToWord = (
  project: Project,
  titleOrMarkdown: string,
  summary?: string
) => {
  mhtmlImages = [];
  let title = '';
  let finalSummary = '';
  let isExecutive = false;

  if (summary !== undefined) {
    // Invocado con (project, title, summary) desde AgentContext
    title = titleOrMarkdown;
    finalSummary = summary;
    isExecutive = title.toLowerCase().includes('ejecutivo') || title.toLowerCase().includes('estado de obra');
  } else {
    // Invocado con (project, markdown) desde el botón del AgentPanel
    const markdown = titleOrMarkdown;
    
    // Intentar extraer el título de la primera línea de Markdown (empezando con #)
    const lines = markdown.split('\n');
    const firstLine = lines[0] || '';
    if (firstLine.trim().startsWith('#')) {
      title = firstLine.replace(/^#\s*/, '').trim();
    } else {
      title = 'Reporte Técnico';
    }

    isExecutive = title.toLowerCase().includes('ejecutivo') || title.toLowerCase().includes('estado de obra');

    if (isExecutive) {
      // Intentar extraer el resumen ejecutivo del markdown
      const summaryMatch = markdown.match(/## Resumen Ejecutivo([\s\S]*?)(##|$)/i);
      if (summaryMatch) {
        finalSummary = summaryMatch[1].trim();
      } else {
        finalSummary = markdown; // fallback
      }
    } else {
      finalSummary = markdown; // fallback
    }
  }

  let bodyContent = '';

  if (isExecutive) {
    // 1. OBTENER DATOS COMPLETOS DE PRESUPUESTO Y AVANCES
    const activeVersion = project.budgetVersions?.find(v => v.id === project.activeBudgetVersionId);
    const budgetItems = activeVersion?.items || project.budgetItems || [];

    const reports = project.progressReports || [];
    const latestReport = reports.length > 0 
      ? [...reports].sort((a, b) => parseISO(b.date).getTime() - parseISO(a.date).getTime())[0]
      : null;

    const getExecutedQty = (itemCode: string) => {
      if (!latestReport) return 0;
      const entry = latestReport.entries.find(e => e.itemCode === itemCode || String(e.itemCode) === String(itemCode));
      return entry ? entry.accumulatedQuantity : 0;
    };

    // 2. CONSTRUIR TABLA DE AVANCE GENERAL DE TODOS LOS ÍTEMS
    let tableRows = '';
    let totalContractualCostoDirecto = 0;
    let totalExecutedCostoDirecto = 0;

    budgetItems.forEach((item) => {
      if (item.type === 'title') {
        tableRows += `
          <tr style="background-color:#eaeaea; font-weight:bold; border:1px solid #cccccc; page-break-inside:avoid;">
            <td colspan="6" style="padding:5px; font-family:Arial, sans-serif; font-size:8.5pt; color:#333333; border-right:2px solid #999999;">${item.item} ${item.descripcion.toUpperCase()}</td>
            <td style="border-right:2px solid #999999; background-color:#ffffff;"></td>
            <td colspan="3" style="padding:5px; background-color:#eaeaea; border:1px solid #cccccc;"></td>
          </tr>
        `;
      } else if (item.type === 'subtitle') {
        tableRows += `
          <tr style="background-color:#f9f9f9; font-weight:bold; border:1px solid #cccccc; page-break-inside:avoid;">
            <td colspan="6" style="padding:4px 5px; font-family:Arial, sans-serif; font-size:8pt; color:#555555; border-right:2px solid #999999; padding-left:15px;">${item.item} ${item.descripcion}</td>
            <td style="border-right:2px solid #999999; background-color:#ffffff;"></td>
            <td colspan="3" style="padding:4px 5px; background-color:#f9f9f9; border:1px solid #cccccc;"></td>
          </tr>
        `;
      } else {
        // Item ejecutable
        const qContractual = Number(item.cantidad) || 0;
        const uPrice = Number(item.vlrUnitario) || 0;
        const tPrice = Number(item.vlrTotal) || (qContractual * uPrice);
        const qExecuted = getExecutedQty(item.item);
        const vExecuted = qExecuted * uPrice;
        const pProgress = tPrice > 0 ? (vExecuted / tPrice) * 100 : 0;

        totalContractualCostoDirecto += tPrice;
        totalExecutedCostoDirecto += vExecuted;

        tableRows += `
          <tr style="border:1px solid #cccccc; page-break-inside:avoid;">
            <td style="padding:4px; font-family:Arial, sans-serif; font-size:8pt; border:1px solid #cccccc;">${item.item}</td>
            <td style="padding:4px; font-family:Arial, sans-serif; font-size:8pt; border:1px solid #cccccc; padding-left:10px;">${item.descripcion}</td>
            <td style="padding:4px; font-family:Arial, sans-serif; font-size:8pt; border:1px solid #cccccc; text-align:center;">${item.unidad}</td>
            <td style="padding:4px; font-family:Arial, sans-serif; font-size:8pt; border:1px solid #cccccc; text-align:right;">${qContractual.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td style="padding:4px; font-family:Arial, sans-serif; font-size:8pt; border:1px solid #cccccc; text-align:right;">$${uPrice.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td style="padding:4px; font-family:Arial, sans-serif; font-size:8pt; border:1px solid #cccccc; text-align:right; border-right:2px solid #999999;">$${tPrice.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td style="border-right:2px solid #999999; background-color:#ffffff; width:6px;"></td>
            <td style="padding:4px; font-family:Arial, sans-serif; font-size:8pt; border:1px solid #cccccc; text-align:right;">${qExecuted.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td style="padding:4px; font-family:Arial, sans-serif; font-size:8pt; border:1px solid #cccccc; text-align:right;">$${vExecuted.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td style="padding:4px; font-family:Arial, sans-serif; font-size:8pt; border:1px solid #cccccc; text-align:right; font-weight:bold;">${pProgress.toFixed(2)}%</td>
          </tr>
        `;
      }
    });

    // Cálculos de AIU
    const adminPerc = Number(project.aiu?.administracion) || 15;
    const imprevPerc = Number(project.aiu?.imprevistos) || 1;
    const utilPerc = Number(project.aiu?.utilidad) || 4;

    const adminContractual = totalContractualCostoDirecto * (adminPerc / 100);
    const adminExecuted = totalExecutedCostoDirecto * (adminPerc / 100);

    const imprevContractual = totalContractualCostoDirecto * (imprevPerc / 100);
    const imprevExecuted = totalExecutedCostoDirecto * (imprevPerc / 100);

    const utilContractual = totalContractualCostoDirecto * (utilPerc / 100);
    const utilExecuted = totalExecutedCostoDirecto * (utilPerc / 100);

    const totalContractual = totalContractualCostoDirecto + adminContractual + imprevContractual + utilContractual;
    const totalExecuted = totalExecutedCostoDirecto + adminExecuted + imprevExecuted + utilExecuted;

    const totalProgress = totalContractual > 0 ? (totalExecuted / totalContractual) * 100 : 0;

    const tableTotals = `
      <!-- Subtotal Costo Directo -->
      <tr style="font-weight:bold; border:1px solid #cccccc; background-color:#eaeaea; page-break-inside:avoid;">
        <td colspan="5" style="padding:5px; font-family:Arial, sans-serif; font-size:8pt; border:1px solid #cccccc; text-align:left;">SUBTOTAL COSTO DIRECTO</td>
        <td style="padding:5px; font-family:Arial, sans-serif; font-size:8pt; border:1px solid #cccccc; text-align:right; border-right:2px solid #999999;">$${totalContractualCostoDirecto.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td style="border-right:2px solid #999999; background-color:#ffffff;"></td>
        <td style="padding:5px; font-family:Arial, sans-serif; font-size:8pt; border:1px solid #cccccc; text-align:right;"></td>
        <td style="padding:5px; font-family:Arial, sans-serif; font-size:8pt; border:1px solid #cccccc; text-align:right;">$${totalExecutedCostoDirecto.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td style="padding:5px; font-family:Arial, sans-serif; font-size:8pt; border:1px solid #cccccc; text-align:right;">${(totalContractualCostoDirecto > 0 ? (totalExecutedCostoDirecto / totalContractualCostoDirecto) * 100 : 0).toFixed(2)}%</td>
      </tr>
      <!-- Administración -->
      <tr style="border:1px solid #cccccc; page-break-inside:avoid;">
        <td colspan="5" style="padding:4px; font-family:Arial, sans-serif; font-size:8pt; border:1px solid #cccccc; text-align:left;">ADMINISTRACIÓN (${adminPerc}%)</td>
        <td style="padding:4px; font-family:Arial, sans-serif; font-size:8pt; border:1px solid #cccccc; text-align:right; border-right:2px solid #999999;">$${adminContractual.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td style="border-right:2px solid #999999; background-color:#ffffff;"></td>
        <td style="padding:4px; font-family:Arial, sans-serif; font-size:8pt; border:1px solid #cccccc; text-align:right;"></td>
        <td style="padding:4px; font-family:Arial, sans-serif; font-size:8pt; border:1px solid #cccccc; text-align:right;">$${adminExecuted.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td style="padding:4px; border:1px solid #cccccc; text-align:right; background-color:#fafafa;"></td>
      </tr>
      <!-- Imprevistos -->
      <tr style="border:1px solid #cccccc; page-break-inside:avoid;">
        <td colspan="5" style="padding:4px; font-family:Arial, sans-serif; font-size:8pt; border:1px solid #cccccc; text-align:left;">IMPREVISTOS (${imprevPerc}%)</td>
        <td style="padding:4px; font-family:Arial, sans-serif; font-size:8pt; border:1px solid #cccccc; text-align:right; border-right:2px solid #999999;">$${imprevContractual.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td style="border-right:2px solid #999999; background-color:#ffffff;"></td>
        <td style="padding:4px; font-family:Arial, sans-serif; font-size:8pt; border:1px solid #cccccc; text-align:right;"></td>
        <td style="padding:4px; font-family:Arial, sans-serif; font-size:8pt; border:1px solid #cccccc; text-align:right;">$${imprevExecuted.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td style="padding:4px; border:1px solid #cccccc; text-align:right; background-color:#fafafa;"></td>
      </tr>
      <!-- Utilidad -->
      <tr style="border:1px solid #cccccc; page-break-inside:avoid;">
        <td colspan="5" style="padding:4px; font-family:Arial, sans-serif; font-size:8pt; border:1px solid #cccccc; text-align:left;">UTILIDAD (${utilPerc}%)</td>
        <td style="padding:4px; font-family:Arial, sans-serif; font-size:8pt; border:1px solid #cccccc; text-align:right; border-right:2px solid #999999;">$${utilContractual.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td style="border-right:2px solid #999999; background-color:#ffffff;"></td>
        <td style="padding:4px; font-family:Arial, sans-serif; font-size:8pt; border:1px solid #cccccc; text-align:right;"></td>
        <td style="padding:4px; font-family:Arial, sans-serif; font-size:8pt; border:1px solid #cccccc; text-align:right;">$${utilExecuted.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td style="padding:4px; border:1px solid #cccccc; text-align:right; background-color:#fafafa;"></td>
      </tr>
      <!-- Total General -->
      <tr style="font-weight:bold; border:1px solid #cccccc; background-color:#eaeaea; page-break-inside:avoid;">
        <td colspan="5" style="padding:5px; font-family:Arial, sans-serif; font-size:8.5pt; border:1px solid #cccccc; text-align:left; color:#111111;">TOTAL GENERAL CONTRATO (CON AIU)</td>
        <td style="padding:5px; font-family:Arial, sans-serif; font-size:8.5pt; border:1px solid #cccccc; text-align:right; border-right:2px solid #999999; color:#111111;">$${totalContractual.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td style="border-right:2px solid #999999; background-color:#ffffff;"></td>
        <td style="padding:5px; font-family:Arial, sans-serif; font-size:8.5pt; border:1px solid #cccccc; text-align:right;"></td>
        <td style="padding:5px; font-family:Arial, sans-serif; font-size:8.5pt; border:1px solid #cccccc; text-align:right; color:#111111;">$${totalExecuted.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td style="padding:5px; font-family:Arial, sans-serif; font-size:8.5pt; border:1px solid #cccccc; text-align:right; color:#111111;">${totalProgress.toFixed(2)}%</td>
      </tr>
    `;

    // 3. GENERAR CURVA S (GRÁFICAS)
    const chartData = getChartData(project);
    const physicalChartSvg = generateSvgChart(chartData, "GRÁFICA 1: AVANCE FÍSICO (PROGRAMADO VS. EJECUTADO REAL)", false);
    const financialChartSvg = generateSvgChart(chartData, "GRÁFICA 2: AVANCE FINANCIERO (PAGOS DE ACTAS VS. EJECUTADO REAL)", true);

    // 4. DETECTAR ACTIVIDADES ATRASADAS
    let delayedRows = '';
    let hasDelayed = false;
    const executableItems = budgetItems.filter(i => i.type === 'item');

    executableItems.forEach((item) => {
      const executedQty = getExecutedQty(item.item);
      let progQty = 0;
      if (item.startDate && item.endDate) {
        const start = new Date(item.startDate + 'T00:00:00').getTime();
        const end = new Date(item.endDate + 'T23:59:59').getTime();
        const now = new Date().getTime();
        if (now >= end) {
          progQty = item.cantidad || 0;
        } else if (now >= start) {
          progQty = (item.cantidad || 0) * ((now - start) / Math.max(1, end - start));
        }
      }

      if (executedQty < progQty - 0.001) {
        hasDelayed = true;
        const delayPerc = progQty > 0 ? ((progQty - executedQty) / progQty) * 100 : 0;
        delayedRows += `
          <tr style="border:1px solid #cccccc; page-break-inside:avoid;">
            <td style="padding:4px; font-family:Arial, sans-serif; font-size:8.5pt; border:1px solid #cccccc;">${item.item}</td>
            <td style="padding:4px; font-family:Arial, sans-serif; font-size:8.5pt; border:1px solid #cccccc; padding-left:10px;">${item.descripcion}</td>
            <td style="padding:4px; font-family:Arial, sans-serif; font-size:8.5pt; border:1px solid #cccccc; text-align:center;">${item.unidad}</td>
            <td style="padding:4px; font-family:Arial, sans-serif; font-size:8.5pt; border:1px solid #cccccc; text-align:right;">${progQty.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td style="padding:4px; font-family:Arial, sans-serif; font-size:8.5pt; border:1px solid #cccccc; text-align:right;">${executedQty.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td style="padding:4px; font-family:Arial, sans-serif; font-size:8.5pt; border:1px solid #cccccc; text-align:right; color:#c0392b; font-weight:bold;">${delayPerc.toFixed(2)}%</td>
          </tr>
        `;
      }
    });

    let delayedSection = '';
    if (hasDelayed) {
      delayedSection = `
        <table style="width:100%; border-collapse:collapse; margin-top:10px; margin-bottom:15px;">
          <thead>
            <tr style="background-color:#eaeaea; font-weight:bold; border:1px solid #cccccc;">
              <th style="padding:4px; border:1px solid #cccccc; font-family:Arial; font-size:8.5pt; text-align:left; width:10%;">ÍTEM</th>
              <th style="padding:4px; border:1px solid #cccccc; font-family:Arial; font-size:8.5pt; text-align:left; width:50%;">DESCRIPCIÓN</th>
              <th style="padding:4px; border:1px solid #cccccc; font-family:Arial; font-size:8.5pt; width:8%;">UNID</th>
              <th style="padding:4px; border:1px solid #cccccc; font-family:Arial; font-size:8.5pt; text-align:right; width:11%;">CANT PROG</th>
              <th style="padding:4px; border:1px solid #cccccc; font-family:Arial; font-size:8.5pt; text-align:right; width:11%;">CANT EJEC</th>
              <th style="padding:4px; border:1px solid #cccccc; font-family:Arial; font-size:8.5pt; text-align:right; width:10%;">% ATRASO</th>
            </tr>
          </thead>
          <tbody>
            ${delayedRows}
          </tbody>
        </table>
      `;
    } else {
      delayedSection = `<p style="font-family:Arial, sans-serif; font-size:9pt; font-style:italic; color:#7f8c8d; margin-top:10px; margin-bottom:15px;">"No se encuentran actividades atrasadas."</p>`;
    }

    // 5. ENSAMBLAR EL CONTENIDO EN HTML ESTILIZADO DE WORD
    bodyContent = `
      <div style="font-family:Arial, sans-serif;">
        <h1 style="text-align:center; font-family:Arial; font-size:16pt; font-weight:bold; color:#333333; margin-bottom:5px;">${title.toUpperCase()}</h1>
        <p style="text-align:center; font-family:Arial; font-size:10pt; color:#555555; margin-top:0; margin-bottom:20px;">
          <b>PROYECTO:</b> ${project.name.toUpperCase()} &nbsp;&nbsp;|&nbsp;&nbsp; 
          <b>CONTRATISTA:</b> LCH INGENIERÍA &nbsp;&nbsp;|&nbsp;&nbsp; 
          <b>FECHA DE CORTE:</b> ${new Date().toLocaleDateString('es-CO')}
        </p>

        <h2 style="font-family:Arial; font-size:12pt; font-weight:bold; color:#333333; border-bottom:2px solid #333333; padding-bottom:3px; margin-top:25px;">1. RESUMEN EJECUTIVO</h2>
        <p style="font-family:Arial; font-size:10.5pt; line-height:1.5; color:#000000; text-align:justify; margin-top:10px; margin-bottom:20px;">
          ${finalSummary.replace(/\n/g, '<br/>')}
        </p>

        <h2 style="font-family:Arial; font-size:12pt; font-weight:bold; color:#333333; border-bottom:2px solid #333333; padding-bottom:3px; margin-top:25px; page-break-before:always;">2. CUADRO DE AVANCE GENERAL DE ACTIVIDADES</h2>
        <table style="width:100%; border-collapse:collapse; margin-top:15px; margin-bottom:15px;">
          <thead>
            <tr style="background-color:#dddddd; font-weight:bold; border:1px solid #cccccc;">
              <th colspan="6" style="padding:5px; font-family:Arial; font-size:8.5pt; text-align:center; border-right:2px solid #999999;">CONDICIONES CONTRACTUALES</th>
              <th style="width:6px; border-right:2px solid #999999; background-color:#ffffff;"></th>
              <th colspan="3" style="padding:5px; font-family:Arial; font-size:8.5pt; text-align:center;">AVANCE ACUMULADO</th>
            </tr>
            <tr style="background-color:#eaeaea; font-weight:bold; border:1px solid #cccccc;">
              <th style="padding:4px; border:1px solid #cccccc; font-family:Arial; font-size:8pt; text-align:left; width:8%;">ÍTEM</th>
              <th style="padding:4px; border:1px solid #cccccc; font-family:Arial; font-size:8pt; text-align:left; width:35%;">DESCRIPCIÓN DE LA ACTIVIDAD</th>
              <th style="padding:4px; border:1px solid #cccccc; font-family:Arial; font-size:8pt; width:6%;">UNID</th>
              <th style="padding:4px; border:1px solid #cccccc; font-family:Arial; font-size:8pt; text-align:right; width:8%;">CANT</th>
              <th style="padding:4px; border:1px solid #cccccc; font-family:Arial; font-size:8pt; text-align:right; width:11%;">VLR UNIT</th>
              <th style="padding:4px; border:1px solid #cccccc; font-family:Arial; font-size:8pt; text-align:right; width:12%; border-right:2px solid #999999;">VLR TOTAL</th>
              <th style="width:6px; border-right:2px solid #999999; background-color:#ffffff;"></th>
              <th style="padding:4px; border:1px solid #cccccc; font-family:Arial; font-size:8pt; text-align:right; width:8%;">CANT</th>
              <th style="padding:4px; border:1px solid #cccccc; font-family:Arial; font-size:8pt; text-align:right; width:12%;">VALOR</th>
              <th style="padding:4px; border:1px solid #cccccc; font-family:Arial; font-size:8pt; text-align:right; width:8%;">% AV.</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
            ${tableTotals}
          </tbody>
        </table>

        <h2 style="font-family:Arial; font-size:12pt; font-weight:bold; color:#333333; border-bottom:2px solid #333333; padding-bottom:3px; margin-top:25px; page-break-before:always;">3. GRÁFICOS DE CURVA S DE PROGRESO</h2>
        <p style="font-family:Arial; font-size:9.5pt; color:#555555; margin-bottom:15px;">
          Las siguientes curvas S ilustran el comportamiento y la tendencia de la ejecución del proyecto a la fecha de corte actual:
        </p>
        ${physicalChartSvg}
        ${financialChartSvg}

        <h2 style="font-family:Arial; font-size:12pt; font-weight:bold; color:#333333; border-bottom:2px solid #333333; padding-bottom:3px; margin-top:25px; page-break-before:always;">4. SEGUIMIENTO A LA PROGRAMACIÓN (ACTIVIDADES ATRASADAS)</h2>
        <p style="font-family:Arial; font-size:9.5pt; color:#555555; margin-bottom:10px;">
          Actividades del cronograma que presentan un atraso en su cantidad ejecutada acumulada frente al avance programado teórico:
        </p>
        ${delayedSection}
      </div>
    `;
  } else {
    // FALLBACK ORIGINAL PARA REPORTES COMUNES
    let htmlContent = finalSummary
      .replace(/^### (.*$)/gim, '<h3 style="color: #2c3e50; border-bottom: 1px solid #eee; padding-bottom: 5px; margin-top: 20px;">$1</h3>')
      .replace(/^## (.*$)/gim, '<h2 style="color: #1a252f; border-bottom: 2px solid #ccc; padding-bottom: 5px; margin-top: 25px;">$1</h2>')
      .replace(/^# (.*$)/gim, '<h1 style="text-align: center; color: #000; margin-bottom: 20px;">$1</h1>')
      .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
      .replace(/\*(.*?)\*/g, '<i>$1</i>')
      .replace(/^\- (.*$)/gim, '<li style="margin-bottom: 5px;">$1</li>')
      .replace(/\n/g, '<br/>');

    htmlContent = htmlContent.replace(/(<li.*<\/li>)/s, '<ul style="margin-top: 10px; margin-bottom: 15px;">$1</ul>');

    let photos = project.logiEntries || [];
    let photosHtml = '<h2 style="color: #1a252f; border-bottom: 2px solid #ccc; margin-top: 30px; page-break-before: always;">Anexo Fotográfico</h2>';
    
    if (photos.length === 0) {
      photosHtml += '<p>No se encontraron registros fotográficos para este periodo.</p>';
    } else {
      photosHtml += `<table border="0" cellspacing="0" cellpadding="5" style="width: 100%; table-layout: fixed;">`;
      for (let i = 0; i < photos.length; i += 2) {
        photosHtml += `<tr>`;
        const renderCell = (photo: any) => {
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
        photosHtml += renderCell(photos[i]);
        photosHtml += renderCell(photos[i + 1]);
        photosHtml += `</tr>`;
      }
      photosHtml += `</table>`;
    }

    bodyContent = `
      ${htmlContent}
      ${photosHtml}
    `;
  }

  // 6. GENERAR ESTRUCTURA DE ARCHIVO WORD COMPATIBLE EN MHTML (MULTIPART MIME)
  const htmlHead = `
    <html xmlns:o='urn:schemas-microsoft-com:office:office' 
          xmlns:w='urn:schemas-microsoft-com:office:word' 
          xmlns='http://www.w3.org/TR/REC-html40'>
    <head>
      <meta charset='utf-8'>
      <title>${title}</title>
      <style>
        @page { size: 21.59cm 27.94cm; margin: 2.54cm; }
        body { font-family: 'Arial', sans-serif; font-size: 11pt; line-height: 1.5; color: #000000; }
        table { width: 100%; border-collapse: collapse; }
        th { font-family: 'Arial', sans-serif; font-weight: bold; color: #333333; }
        td { font-family: 'Arial', sans-serif; }
      </style>
    </head>
    <body>
  `;

  const htmlFooter = `</body></html>`;

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

  const htmlBase64 = encodeUTF8Base64(htmlHead + bodyContent + htmlFooter);

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

  // 7. DESCARGAR COMO ARCHIVO .DOC EN MHTML
  const blob = new Blob([mhtml], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  
  const safeName = project?.name ? project.name.replace(/[^a-zA-Z0-9]/g, '_') : 'Proyecto';
  const fileName = `${title.replace(/[^a-zA-Z0-9]/g, '_')}_${safeName}_${new Date().toISOString().split('T')[0]}.doc`;
  
  link.setAttribute('download', fileName);
  link.setAttribute('target', '_blank');
  link.style.display = 'none';
  
  document.body.appendChild(link);
  
  setTimeout(() => {
    link.click();
    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 100);
  }, 0);
};
