import { format, parseISO, startOfMonth, endOfMonth, isValid, differenceInDays, eachMonthOfInterval, eachWeekOfInterval, isBefore, isAfter, isSameDay, max } from 'date-fns';
import { es } from 'date-fns/locale';
import type { Project, BudgetItem } from '../types/projectTypes';
import { parseRobustNumber } from './mathUtils';

// Robust Colombian currency formatter
export const fmtCurrency = (v: number) => {
  const num = typeof v === 'number' ? v : parseFloat(String(v));
  if (isNaN(num)) return '$0,00';
  const rounded = num.toFixed(2);
  const parts = rounded.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `$${parts[0]},${parts[1]}`;
};

// Robust Colombian percentage formatter
export const fmtPct = (v: number) => {
  const num = typeof v === 'number' ? v : parseFloat(String(v));
  if (isNaN(num)) return '0,00%';
  const rounded = num.toFixed(2);
  const parts = rounded.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${parts[0]},${parts[1]}%`;
};

// Robust Colombian quantity formatter
export const fmtQty = (v: any) => {
  const num = typeof v === 'number' ? v : parseFloat(String(v));
  if (isNaN(num)) return '0';
  const rounded = Math.round(num * 100) / 100;
  const parts = rounded.toString().split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  if (parts[1]) {
    return `${parts[0]},${parts[1]}`;
  }
  return parts[0];
};

export function calculateProgressData(project: Project, dateEndStr: string) {
  if (!project || !dateEndStr) return null;
  const endD = parseISO(dateEndStr);

  const activeVersion = project.budgetVersions?.find(v => v.id === project.activeBudgetVersionId);
  const budgetItems: BudgetItem[] = activeVersion?.items || project.budgetItems || [];
  
  const structuredRows: any[] = [];
  
  const aiu = project.aiu || { administracion: 0, imprevistos: 0, utilidad: 0 };
  const aiuFactor = 1 + ((parseRobustNumber(aiu.administracion || 0) + parseRobustNumber(aiu.imprevistos || 0) + parseRobustNumber(aiu.utilidad || 0)) / 100);

  const reports = (project.progressReports || [])
    .filter(r => parseISO(r.date) <= endD)
    .sort((a, b) => parseISO(a.date).getTime() - parseISO(b.date).getTime());
  const latestReport = reports.length > 0 ? reports[reports.length - 1] : null;

  let costoDirectoContratado = 0;
  let costoDirectoEjecutado = 0;

  budgetItems.forEach(item => {
    if (item.type === 'title' || item.type === 'subtitle') {
      structuredRows.push({
        item: item.item,
        description: item.descripcion,
        unit: '',
        contractedQty: 0,
        unitPrice: 0,
        contractedTotal: 0,
        acumQty: 0,
        acumValue: 0,
        pctExecution: 0,
        isTitle: true,
        isSubtitle: item.type === 'subtitle'
      });
    } else {
      const contractedQty = parseRobustNumber(item.cantidad);
      const unitPrice = parseRobustNumber(item.vlrUnitario);
      const contractedTotal = parseRobustNumber(item.vlrTotal) || (contractedQty * unitPrice);

      const entry = latestReport?.entries.find(e => String(e.itemCode) === String(item.item));
      const acumQty = entry ? parseRobustNumber(entry.accumulatedQuantity) : 0;
      const acumValue = acumQty * unitPrice;
      const pctExecution = contractedTotal > 0 ? (acumValue / contractedTotal) * 100 : 0;

      costoDirectoContratado += contractedTotal;
      costoDirectoEjecutado += acumValue;

      structuredRows.push({
        item: item.item,
        description: item.descripcion,
        unit: item.unidad,
        contractedQty,
        unitPrice,
        contractedTotal,
        acumQty,
        acumValue,
        pctExecution,
        isTitle: false,
        isSubtitle: false
      });
    }
  });

  const pctCostoDirecto = costoDirectoContratado > 0 ? (costoDirectoEjecutado / costoDirectoContratado) * 100 : 0;

  const aiuPct = parseRobustNumber(aiu.administracion || 0) + parseRobustNumber(aiu.imprevistos || 0) + parseRobustNumber(aiu.utilidad || 0);
  const aiuContratado = costoDirectoContratado * (aiuPct / 100);
  const aiuEjecutado = costoDirectoEjecutado * (aiuPct / 100);
  const pctAiu = aiuContratado > 0 ? (aiuEjecutado / aiuContratado) * 100 : 0;

  const totalContratado = costoDirectoContratado + aiuContratado;
  const totalEjecutado = costoDirectoEjecutado + aiuEjecutado;
  const pctTotal = totalContratado > 0 ? (totalEjecutado / totalContratado) * 100 : 0;

  return {
    tableRows: structuredRows,
    costoDirectoContratado,
    costoDirectoEjecutado,
    pctCostoDirecto,
    aiuPct,
    aiuContratado,
    aiuEjecutado,
    pctAiu,
    totalContratado,
    totalEjecutado,
    pctTotal
  };
}

export function calculatePlannedPctAtCutoff(project: Project, dateEndStr: string): number {
  if (!project || !dateEndStr) return 0;
  const endD = parseISO(dateEndStr);
  endD.setHours(12, 0, 0, 0);

  const activeVersion = project.budgetVersions?.find(v => v.id === project.activeBudgetVersionId);
  const budgetItems: BudgetItem[] = activeVersion?.items || project.budgetItems || [];

  const aiu = project.aiu || { administracion: 0, imprevistos: 0, utilidad: 0 };
  const aiuFactor = 1 + ((parseRobustNumber(aiu.administracion || 0) + parseRobustNumber(aiu.imprevistos || 0) + parseRobustNumber(aiu.utilidad || 0)) / 100);

  const baseValue = budgetItems.reduce((acc: number, item: any) => acc + (item.type === 'item' && item.vlrTotal > 0 ? item.vlrTotal : 0), 0);
  const totalContractValue = (baseValue || 1) * aiuFactor;

  let totalPlanned = 0;
  budgetItems.forEach((item: any) => {
    if (item.type !== 'item' || item.vlrTotal <= 0 || !item.startDate || !item.endDate) return;
    const start = new Date(item.startDate + 'T12:00:00');
    const end = new Date(item.endDate + 'T12:00:00');

    if (endD >= end) {
      totalPlanned += item.vlrTotal;
    } else if (endD >= start) {
      const totalDays = Math.max(1, differenceInDays(end, start) + 1);
      const elapsedDays = Math.max(0, differenceInDays(endD, start) + 1);
      totalPlanned += item.vlrTotal * (Math.min(1, elapsedDays / totalDays));
    }
  });

  const val = ((totalPlanned * aiuFactor) / totalContractValue) * 100;
  return Math.min(100, Math.max(0, val));
}

// Generate S-Curve SVG as a XML string (fully matching frontend layout and parameters)
export function generateSCurveSvg(
  project: Project,
  dateEndStr: string,
  chartConfig: any,
  granularity: 'weeks' | 'months',
  showStatusLine: boolean,
  visibleCurves: { planned: boolean; executed: boolean; financial: boolean }
): string {
  const startDateStr = project.startDate;
  const duration = project.durationMonths;
  if (!startDateStr || isNaN(duration)) return `<svg viewBox="0 0 1000 500" xmlns="http://www.w3.org/2000/svg"><text x="500" y="250" text-anchor="middle">Datos insuficientes para graficar</text></svg>`;

  const activeVersion = project.budgetVersions?.find((v: any) => v.id === project.activeBudgetVersionId);
  const budgetItems = activeVersion?.items || project.budgetItems || [];

  const globalStart = parseISO(startDateStr);
  const totalDaysDuration = Math.round(duration * 30.4375);
  const globalEnd = new Date(globalStart);
  globalEnd.setDate(globalEnd.getDate() + totalDaysDuration);

  const reports = project.progressReports || [];
  const reportDates = reports.map((r: any) => parseISO(r.date));
  const lastReportDate = reportDates.length > 0 ? max(reportDates) : null;

  let intervals: Date[] = [];
  try {
    const rawIntervals = granularity === 'weeks'
      ? eachWeekOfInterval({ start: globalStart, end: globalEnd })
      : eachMonthOfInterval({ start: globalStart, end: globalEnd });

    intervals = [
      globalStart,
      ...rawIntervals.filter(d => isAfter(d, globalStart) && isBefore(d, globalEnd)),
      globalEnd
    ];

    if (lastReportDate && isAfter(lastReportDate, globalStart) && isBefore(lastReportDate, globalEnd)) {
      intervals.push(lastReportDate);
    }
    const sDateObj = dateEndStr ? parseISO(dateEndStr) : null;
    if (sDateObj && isValid(sDateObj) && isAfter(sDateObj, globalStart) && isBefore(sDateObj, globalEnd)) {
      intervals.push(sDateObj);
    }

    intervals = intervals.filter((d, i) => intervals.findIndex(x => isSameDay(x, d)) === i);
    intervals.sort((a, b) => a.getTime() - b.getTime());
  } catch (e) {
    return `<svg viewBox="0 0 1000 500" xmlns="http://www.w3.org/2000/svg"><text x="500" y="250" text-anchor="middle">Error procesando fechas</text></svg>`;
  }

  const aiu = project.aiu || { administracion: 0, imprevistos: 0, utilidad: 0 };
  const aiuFactor = 1 + (((aiu.administracion || 0) + (aiu.imprevistos || 0) + (aiu.utilidad || 0)) / 100);
  const baseValue = budgetItems.reduce((acc: number, item: any) => acc + (item.type === 'item' && item.vlrTotal > 0 ? item.vlrTotal : 0), 0);
  const totalContractValue = (baseValue || 1) * aiuFactor;

  const firstReportTime = reportDates.length > 0 ? Math.min(...reportDates.map((d: any) => d.getTime())) : 0;
  const lastReportTime = lastReportDate ? lastReportDate.getTime() : 0;

  const partials = project.partialReports || [];
  const partialDates = partials.map((p: any) => parseISO(p.date));
  const firstPartialTime = partialDates.length > 0 ? Math.min(...partialDates.map((d: any) => d.getTime())) : 0;
  const lastPartialTime = partialDates.length > 0 ? Math.max(...partialDates.map((d: any) => d.getTime())) : 0;

  const getExactPlannedVal = (targetDate: Date) => {
    let total = 0;
    budgetItems.forEach((item: any) => {
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

    const plannedValueTotal = getExactPlannedVal(date);
    let executedValueTotal = 0;
    const shouldHaveValue = !isAfterLastReport && !isBeforeFirstReport;

    if (shouldHaveValue || reports.length === 0 || isSameDay(date, globalStart)) {
      const reportsBefore = reports
        .filter((r: any) => parseISO(r.date).getTime() <= dateTime)
        .sort((a: any, b: any) => parseISO(b.date).getTime() - parseISO(a.date).getTime());

      let executedValueDirect = 0;
      if (reportsBefore.length > 0) {
        const latestReport = reportsBefore[0];
        latestReport.entries.forEach((entry: any) => {
          const item = budgetItems.find((i: any) => i.item === entry.itemCode || String(i.item) === String(entry.itemCode));
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
      const partialsBefore = partials.filter((p: any) => parseISO(p.date).getTime() <= dateTime);
      const financialValueDirect = partialsBefore.reduce((sum: number, report: any) => {
        return sum + (report.entries || []).reduce((repSum: number, entry: any) => repSum + (entry.partialValue || 0), 0);
      }, 0);
      financialValueTotal = financialValueDirect * aiuFactor;
    }

    const isDataPoint = !isAfterLastReport && !isBeforeFirstReport;

    return {
      date,
      label: granularity === 'weeks'
        ? format(date, 'MMM d', { locale: es }).toUpperCase()
        : format(date, 'MMM yyyy', { locale: es }).toUpperCase(),
      planned: (plannedValueTotal / totalContractValue) * 100,
      executed: (isDataPoint || isSameDay(date, globalStart))
        ? (executedValueTotal / totalContractValue) * 100
        : null,
      financial: (isFinancialPoint || isSameDay(date, globalStart))
        ? (financialValueTotal / totalContractValue) * 100
        : null,
    };
  });

  const width = 1000;
  const height = 500;
  const paddingX = 80;
  const paddingYTop = 50;
  const paddingYBottom = 60;
  const chartWidth = width - paddingX * 2;
  const chartHeight = height - paddingYTop - paddingYBottom;

  const getXFromDate = (date: Date) => {
    const totalDays = Math.max(1, differenceInDays(globalEnd, globalStart));
    const days = differenceInDays(date, globalStart);
    const ratio = Math.max(0, Math.min(1, days / totalDays));
    return paddingX + ratio * chartWidth;
  };

  const getY = (val: number) => {
    const safeVal = isNaN(val) ? 0 : val;
    return height - paddingYBottom - (Math.min(105, safeVal) / 100) * chartHeight;
  };

  const getInterpolatedVal = (date: Date, key: 'planned' | 'executed' | 'financial') => {
    if (isBefore(date, globalStart)) return 0;
    if (key === 'planned') {
      return (getExactPlannedVal(date) / totalContractValue) * 100;
    }
    if (key === 'executed' || key === 'financial') {
      const validPoints = chartData.filter(d => d[key] !== null);
      if (validPoints.length === 0) return 0;
      const lastValid = validPoints[validPoints.length - 1];
      if (!isBefore(date, lastValid.date)) return lastValid[key] as number;
    }
    if (isAfter(date, globalEnd)) return chartData[chartData.length - 1][key] || 0;

    for (let i = 0; i < chartData.length - 1; i++) {
      const iStart = chartData[i].date;
      const iEnd = chartData[i + 1].date;
      if (!isAfter(iStart, date) && isBefore(date, iEnd)) {
        const valStart = chartData[i][key] || 0;
        let valEnd = chartData[i + 1][key];
        if (valEnd === null) valEnd = valStart;
        const totalIntDays = Math.max(1, differenceInDays(iEnd, iStart));
        const elapsed = differenceInDays(date, iStart);
        return valStart + (valEnd - valStart) * (elapsed / totalIntDays);
      }
    }
    return chartData[chartData.length - 1][key] || 0;
  };

  const createPath = (key: 'planned' | 'executed' | 'financial') => {
    const validPoints = chartData.filter(d => d[key] !== null);
    if (validPoints.length === 0) return "";
    return validPoints.map((d, i) => {
      return `${i === 0 ? 'M' : 'L'} ${getXFromDate(d.date)} ${getY(d[key] as number)}`;
    }).join(' ');
  };

  const getLabelOffset = (id: string) => {
    return project?.labelOffsets?.[id] || { x: 0, y: 0 };
  };

  // Build SVG parts
  let svgContent = '';

  // Defs
  svgContent += `
    <defs>
      <filter id="glow-ev-rep" filterUnits="userSpaceOnUse" x="0" y="0" width="1000" height="500">
        <feGaussianBlur stdDeviation="${chartConfig.executedGlowRadius || 4}" result="blur" />
        <feComposite in="SourceGraphic" in2="blur" operator="over" />
      </filter>
      <filter id="glow-pv-rep" filterUnits="userSpaceOnUse" x="0" y="0" width="1000" height="500">
        <feGaussianBlur stdDeviation="${chartConfig.plannedGlowRadius || 2}" result="blur" />
        <feComposite in="SourceGraphic" in2="blur" operator="over" />
      </filter>
      <filter id="glow-fi-rep" filterUnits="userSpaceOnUse" x="0" y="0" width="1000" height="500">
        <feGaussianBlur stdDeviation="${chartConfig.financialGlowRadius || 2}" result="blur" />
        <feComposite in="SourceGraphic" in2="blur" operator="over" />
      </filter>
      <linearGradient id="areaGradientRep" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${chartConfig.executedColor || '#c5ff00'}" stop-opacity="${chartConfig.executedFillOpacity || 0.08}" />
        <stop offset="100%" stop-color="${chartConfig.executedColor || '#c5ff00'}" stop-opacity="0" />
      </linearGradient>
    </defs>
  `;

  // Legends
  const activeLegends = [];
  if (visibleCurves.planned) {
    activeLegends.push({
      label: "PROG. (PV)",
      color: chartConfig.plannedColor || '#00E5FF',
      dashArray: chartConfig.plannedDashArray === 'none' ? undefined : (chartConfig.plannedDashArray || '4 2')
    });
  }
  if (visibleCurves.executed) {
    activeLegends.push({
      label: "EJEC. REAL (EV)",
      color: chartConfig.executedColor || '#c5ff00',
      dashArray: undefined
    });
  }
  if (visibleCurves.financial) {
    activeLegends.push({
      label: "FINANCIERO (FI)",
      color: chartConfig.financialColor || '#FFAB00',
      dashArray: chartConfig.financialDashArray === 'none' ? undefined : (chartConfig.financialDashArray || '3 3')
    });
  }

  const itemWidth = 180;
  const totalW = activeLegends.length * itemWidth;
  const startX = (width - totalW) / 2;

  activeLegends.forEach((leg, idx) => {
    const x = startX + idx * itemWidth;
    const y = 25;
    svgContent += `
      <g>
        <line x1="${x}" y1="${y}" x2="${x + 30}" y2="${y}" stroke="${leg.color}" stroke-width="2.5" ${leg.dashArray ? `stroke-dasharray="${leg.dashArray}"` : ''} />
        <circle cx="${x + 15}" cy="${y}" r="3.5" fill="${leg.color}" />
        <text x="${x + 38}" y="${y + 4}" style="font-size: ${chartConfig.legendFontSize || 11}px; fill: #334155; font-weight: bold; font-family: monospace;">${leg.label}</text>
      </g>
    `;
  });

  // Grid Lines Y
  [0, 20, 40, 60, 80, 100].forEach(val => {
    if (chartConfig.gridVisible) {
      svgContent += `<line x1="${paddingX}" y1="${getY(val)}" x2="${width - paddingX}" y2="${getY(val)}" stroke="${chartConfig.gridColor || 'rgba(128, 128, 128, 0.15)'}" stroke-width="0.5" />`;
    }
    svgContent += `<text x="${paddingX - 12}" y="${getY(val) + 4}" text-anchor="end" style="font-size: ${chartConfig.axisFontSize || 10}px; fill: #475569; font-weight: bold; font-family: monospace;">${val}%</text>`;
  });

  // Grid Lines X (Vertical cut lines matching labels)
  const cutoffDate = dateEndStr ? parseISO(dateEndStr) : null;
  const labeledData = chartData.filter((d) => {
    const isMonthEnd = isSameDay(d.date, endOfMonth(d.date));
    const isProjectEnd = isSameDay(d.date, globalEnd);
    const isCutoff = cutoffDate && isValid(cutoffDate) && isSameDay(d.date, cutoffDate);
    return isMonthEnd || isProjectEnd || isCutoff;
  });

  if (chartConfig.gridVisible) {
    labeledData.forEach((d, idx) => {
      const xPos = getXFromDate(d.date);
      svgContent += `<line x1="${xPos}" y1="${paddingYTop}" x2="${xPos}" y2="${height - paddingYBottom}" stroke="${chartConfig.gridColor || 'rgba(128, 128, 128, 0.15)'}" stroke-width="0.5" />`;
    });
  }

  // Area under Executed Curve
  if (visibleCurves.executed) {
    const lastReportIdx = chartData.findLastIndex(d => d.executed !== null);
    if (lastReportIdx !== -1) {
      const lastDate = chartData[lastReportIdx].date;
      svgContent += `<path d="${createPath('executed')} L ${getXFromDate(lastDate)} ${getY(0)} L ${getXFromDate(globalStart)} ${getY(0)} Z" fill="url(#areaGradientRep)" />`;
    }
  }

  // Draw Curves
  if (visibleCurves.planned) {
    svgContent += `
      <path d="${createPath('planned')}" fill="none" stroke="${chartConfig.plannedColor || '#00E5FF'}" stroke-width="${chartConfig.plannedWidth || 1.2}" ${chartConfig.plannedDashArray !== 'none' ? `stroke-dasharray="${chartConfig.plannedDashArray || '4 2'}"` : ''} opacity="0.8" />
    `;
  }
  if (visibleCurves.executed) {
    svgContent += `
      <path d="${createPath('executed')}" fill="none" stroke="${chartConfig.executedColor || '#c5ff00'}" stroke-width="${chartConfig.executedWidth || 3}" />
    `;
  }
  if (visibleCurves.financial) {
    svgContent += `
      <path d="${createPath('financial')}" fill="none" stroke="${chartConfig.financialColor || '#FFAB00'}" stroke-width="${chartConfig.financialWidth || 1}" ${chartConfig.financialDashArray !== 'none' ? `stroke-dasharray="${chartConfig.financialDashArray || '3 3'}"` : ''} />
    `;
  }

  // Axis Labels X
  const renderedXPositions: number[] = [];
  labeledData.forEach((d) => {
    const xPos = getXFromDate(d.date);
    const yPos = height - paddingYBottom + 20;

    let textAnchor = 'middle';
    let dx = 0;

    // Anticolisión
    const minSpacing = 55;
    const tooCloseIndex = renderedXPositions.findIndex(pos => Math.abs(pos - xPos) < minSpacing);
    if (tooCloseIndex !== -1) {
      const otherPos = renderedXPositions[tooCloseIndex];
      if (xPos > otherPos) {
        textAnchor = 'start';
        dx = 5;
      } else {
        textAnchor = 'end';
        dx = -5;
      }
    }
    renderedXPositions.push(xPos);

    svgContent += `
      <text x="${xPos}" y="${yPos}" dx="${dx}" text-anchor="${textAnchor}" style="font-size: ${chartConfig.axisFontSize || 10}px; fill: #475569; font-weight: bold; font-family: monospace;">
        ${d.label}
      </text>
    `;
  });

  // Markers and Labels for Planned
  if (visibleCurves.planned) {
    const lastExecutedIdx = chartData.findLastIndex(d => d.executed !== null);
    chartData.forEach((d, i) => {
      const prev = i > 0 ? chartData[i - 1] : null;
      const isStatusPoint = i === lastExecutedIdx;
      const isSignificant = isStatusPoint || !prev || Math.abs(d.planned - prev.planned) > 5 || i === chartData.length - 1;
      if (!isSignificant) return;

      const offset = getLabelOffset(`planned-${i}`);
      const baseX = getXFromDate(d.date);
      const baseY = getY(d.planned);
      const hasOffset = offset.x !== 0 || offset.y !== 0;

      if (isStatusPoint) {
        svgContent += `<circle cx="${baseX}" cy="${baseY}" r="${(chartConfig.pointSize || 3) + 0.5}" fill="${chartConfig.plannedColor || '#00E5FF'}" stroke="#64748b" stroke-width="1" />`;
      }
      if (hasOffset || isStatusPoint) {
        svgContent += `<line x1="${baseX}" y1="${baseY}" x2="${baseX + offset.x}" y2="${baseY - 12 + offset.y}" stroke="${chartConfig.plannedColor || '#00E5FF'}" stroke-width="${isStatusPoint ? 1 : 0.5}" ${isStatusPoint ? '' : 'stroke-dasharray="2 1"'} opacity="0.8" />`;
      }
      svgContent += `
        <text x="${baseX + offset.x}" y="${baseY - 12 + offset.y}" text-anchor="middle" style="font-size: ${isStatusPoint ? (chartConfig.labelFontSize || 9) + 2 : (chartConfig.labelFontSize || 9)}px; fill: ${chartConfig.plannedColor || '#00E5FF'}; font-weight: bold; font-family: monospace;">
          ${d.planned.toFixed(2)}%
        </text>
      `;
    });
  }

  // Markers and Labels for Executed
  if (visibleCurves.executed) {
    const lastIdx = chartData.findLastIndex(item => item.executed !== null);
    chartData.forEach((d, i) => {
      if (d.executed === null) return;
      const prev = i > 0 ? chartData[i - 1] : null;
      const isSignificant = !prev || prev.executed === null || Math.abs(d.executed - prev.executed) > 0.1 || i === lastIdx;
      const baseX = getXFromDate(d.date);
      const baseY = getY(d.executed);

      svgContent += `<circle cx="${baseX}" cy="${baseY}" r="${i === lastIdx ? (chartConfig.pointSize || 3) + 1 : (chartConfig.pointSize || 3)}" fill="${chartConfig.executedColor || '#c5ff00'}" />`;

      if (isSignificant) {
        const offset = getLabelOffset(`executed-${i}`);
        const hasOffset = offset.x !== 0 || offset.y !== 0;
        if (hasOffset) {
          svgContent += `<line x1="${baseX}" y1="${baseY}" x2="${baseX + offset.x}" y2="${baseY + 15 + offset.y}" stroke="${chartConfig.executedColor || '#c5ff00'}" stroke-width="0.5" stroke-dasharray="2 1" opacity="0.6" />`;
        }
        svgContent += `
          <text x="${baseX + offset.x}" y="${baseY + 15 + offset.y}" text-anchor="middle" style="font-size: ${chartConfig.labelFontSize || 9}px; fill: ${chartConfig.executedColor || '#c5ff00'}; font-weight: bold; font-family: monospace;">
            ${d.executed.toFixed(2)}%
          </text>
        `;
      }
    });
  }

  // Red vertical status date line
  if (dateEndStr && showStatusLine && isValid(parseISO(dateEndStr))) {
    const dateObj = parseISO(dateEndStr);
    const clampedDate = isBefore(dateObj, globalStart)
      ? globalStart
      : (isAfter(dateObj, globalEnd) ? globalEnd : dateObj);

    const xPos = getXFromDate(clampedDate);
    const pVal = getInterpolatedVal(clampedDate, 'planned');
    const eVal = getInterpolatedVal(clampedDate, 'executed');
    const fVal = getInterpolatedVal(clampedDate, 'financial');

    const pvBaseY = getY(pVal);
    const evBaseY = getY(eVal);
    const fvBaseY = getY(fVal);

    const pvOff = getLabelOffset('status-pv');
    const evOff = getLabelOffset('status-ev');
    const fvOff = getLabelOffset('status-fv');

    let pvFinalY = pvBaseY;
    let evFinalY = evBaseY;
    let fvFinalY = fvBaseY;

    if (pvOff.x === 0 && pvOff.y === 0 && evOff.x === 0 && evOff.y === 0 && fvOff.x === 0 && fvOff.y === 0) {
      if (Math.abs(pvBaseY - evBaseY) < 16) {
        pvFinalY -= 12;
        evFinalY += 12;
      }
      if (Math.abs(evFinalY - fvBaseY) < 16) {
        fvFinalY += 24;
      }
    }

    svgContent += `<line x1="${xPos}" y1="${paddingYTop}" x2="${xPos}" y2="${height - paddingYBottom}" stroke="#ef4444" stroke-width="1.5" stroke-dasharray="4 2" />`;

    if (visibleCurves.planned) {
      svgContent += `
        <circle cx="${xPos}" cy="${pvBaseY}" r="${(chartConfig.pointSize || 3) + 2}" fill="${chartConfig.plannedColor || '#00E5FF'}" stroke="#fff" stroke-width="1.5" />
        <text x="${xPos + 8 + pvOff.x}" y="${pvFinalY + 4 + pvOff.y}" style="font-size: ${(chartConfig.labelFontSize || 9) + 1}px; fill: #0097a7; font-weight: bold; font-family: monospace;">PV: ${pVal.toFixed(2)}%</text>
      `;
    }
    if (visibleCurves.executed && eVal !== null) {
      svgContent += `
        <circle cx="${xPos}" cy="${evBaseY}" r="${(chartConfig.pointSize || 3) + 2}" fill="${chartConfig.executedColor || '#c5ff00'}" stroke="#fff" stroke-width="1.5" />
        <text x="${xPos + 8 + evOff.x}" y="${evFinalY + 4 + evOff.y}" style="font-size: ${(chartConfig.labelFontSize || 9) + 1}px; fill: #558b2f; font-weight: bold; font-family: monospace;">EV: ${eVal.toFixed(2)}%</text>
      `;
    }
    if (visibleCurves.financial && fVal !== null) {
      svgContent += `
        <circle cx="${xPos}" cy="${fvBaseY}" r="${(chartConfig.pointSize || 3) + 2}" fill="${chartConfig.financialColor || '#FFAB00'}" stroke="#fff" stroke-width="1.5" />
        <text x="${xPos + 8 + fvOff.x}" y="${fvFinalY + 4 + fvOff.y}" style="font-size: ${(chartConfig.labelFontSize || 9) + 1}px; fill: #ef6c00; font-weight: bold; font-family: monospace;">FI: ${fVal.toFixed(2)}%</text>
      `;
    }
  }

  // Draw chart boundaries
  svgContent += `
    <line x1="${paddingX}" y1="${paddingYTop}" x2="${paddingX}" y2="${height - paddingYBottom}" stroke="${chartConfig.axisColor || '#94a3b8'}" stroke-width="1" />
    <line x1="${paddingX}" y1="${height - paddingYBottom}" x2="${width - paddingX}" y2="${height - paddingYBottom}" stroke="${chartConfig.axisColor || '#94a3b8'}" stroke-width="1" />
  `;

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" style="background:#ffffff; overflow:visible;">${svgContent}</svg>`;
}

// Render SVG S-Curve to Base64 PNG programmatically (Retina 2x resolution)
export function generateSCurvePng(
  project: Project,
  dateEndStr: string,
  chartConfig: any,
  granularity: 'weeks' | 'months',
  showStatusLine: boolean,
  visibleCurves: { planned: boolean; executed: boolean; financial: boolean }
): Promise<string> {
  const svgString = generateSCurveSvg(project, dateEndStr, chartConfig, granularity, showStatusLine, visibleCurves);
  return new Promise((resolve) => {
    try {
      const svgUrl = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgString)))}`;
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 1160;
        canvas.height = 540;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/png'));
        } else {
          resolve('');
        }
      };
      img.onerror = () => resolve('');
      img.src = svgUrl;
    } catch (e) {
      console.error("Error programmatically generating PNG curve S:", e);
      resolve('');
    }
  });
}
