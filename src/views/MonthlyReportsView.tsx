import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useProjects, globalBlobUrlCache } from '../context/ProjectsContext';
import { photoDB } from '../services/PhotoDatabase';
import {
  X, Settings, FileText, Plus, Trash2, Download,
  ChevronDown, ChevronUp, Calendar, Info, Users, Eye, CheckCircle2,
  FileCheck, Mail, Image as ImageIcon, Sparkles, RefreshCw, Folder
} from 'lucide-react';
import type { ReportConfig, ReportStaff, BudgetItem, LogiEntry, ExecutiveReport } from '../types/projectTypes';
import { format, parseISO, startOfMonth, endOfMonth, isValid, differenceInDays, eachMonthOfInterval, isBefore, isAfter, eachWeekOfInterval, max, isSameDay } from 'date-fns';
import { es } from 'date-fns/locale';
import { exportDocxReport } from '../services/docxService';
import { parseRobustNumber } from '../utils/mathUtils';
import { exportExecutiveReportToWord } from '../utils/executiveReportExporter';

import { calculatePlannedPctAtCutoff, calculateProgressData, fmtCurrency, fmtPct, fmtQty } from '../utils/progressCalculator';

const DEFAULT_CHART_CONFIG = {
  axisFontSize: 10,
  labelFontSize: 9,
  legendFontSize: 11,
  axisColor: '#94a3b8',
  gridVisible: true,
  gridColor: 'rgba(128, 128, 128, 0.15)',
  pointSize: 3,
  
  // Planned (PV)
  plannedColor: '#00E5FF',
  plannedWidth: 1.2,
  plannedDashArray: '4 2',
  plannedGlow: false,
  plannedGlowRadius: 2,
  
  // Executed (EV)
  executedColor: '#c5ff00',
  executedWidth: 3,
  executedFillOpacity: 0.08,
  executedGlow: true,
  executedGlowRadius: 4,
  
  // Financial (FI)
  financialColor: '#FFAB00',
  financialWidth: 1,
  financialDashArray: '3 3',
  financialGlow: false,
  financialGlowRadius: 2,
};

// Convierte un elemento SVG a un dataURI PNG de alta resolución (2x retina)
const exportSvgToPngBase64 = (svgElement: SVGSVGElement): Promise<string> => {
  return new Promise((resolve) => {
    try {
      const serializer = new XMLSerializer();
      let svgString = serializer.serializeToString(svgElement);
      const svgBase64 = btoa(unescape(encodeURIComponent(svgString)));
      const svgUrl = `data:image/svg+xml;base64,${svgBase64}`;
      
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
      console.error("Error serializando SVG a PNG:", e);
      resolve('');
    }
  });
};

// ─── Componente del Gráfico de Curva S (SVG + Canvas exportador de alta resolución) ───
export function SvgCurveS({
  project,
  dateEndStr,
  chartConfig,
  granularity,
  showStatusLine,
  visibleCurves,
  onRender
}: {
  project: any;
  dateEndStr: string;
  chartConfig: typeof DEFAULT_CHART_CONFIG;
  granularity: 'weeks' | 'months';
  showStatusLine: boolean;
  visibleCurves: { planned: boolean; executed: boolean; financial: boolean };
  onRender?: (base64: string) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragState, setDragState] = useState<{ id: string, startX: number, startY: number, initialOffset: { x: number, y: number } } | null>(null);

  const reportData = useMemo(() => {
    if (!project) return null;

    const startDateStr = project.startDate;
    const duration = project.durationMonths;

    if (!startDateStr || isNaN(duration)) return null;

    const activeVersion = project.budgetVersions?.find((v: any) => v.id === project.activeBudgetVersionId);
    const budgetItems = activeVersion?.items || project.budgetItems || [];

    const globalStart = parseISO(startDateStr);
    const totalDaysDuration = Math.round(duration * 30.4375);
    const globalEnd = new Date(globalStart);
    globalEnd.setDate(globalEnd.getDate() + totalDaysDuration);

    const reports = project.progressReports || [];
    const reportDates = reports.map((r: any) => parseISO(r.date));
    const lastReportDate = reportDates.length > 0 ? max(reportDates) : null;

    if (!isValid(globalStart) || !isValid(globalEnd)) return null;

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
      return null;
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

    const getExactPlannedValue = (targetDate: Date) => {
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

      const plannedValueTotal = getExactPlannedValue(date);
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
        evValue: executedValueTotal,
      };
    });

    return { chartData, totalContractValue };
  }, [project, granularity, dateEndStr]);

  const width = 1000;
  const height = 500;
  const paddingX = 80;
  const paddingYTop = 50;
  const paddingYBottom = 60;
  const chartWidth = width - paddingX * 2;
  const chartHeight = height - paddingYTop - paddingYBottom;

  const getXFromDate = useCallback((date: Date) => {
    if (!reportData) return paddingX;
    const globalStart = reportData.chartData[0].date;
    const globalEnd = reportData.chartData[reportData.chartData.length - 1].date;
    const totalDays = Math.max(1, differenceInDays(globalEnd, globalStart));
    const days = differenceInDays(date, globalStart);
    const ratio = Math.max(0, Math.min(1, days / totalDays));
    return paddingX + ratio * chartWidth;
  }, [reportData, chartWidth]);

  const getY = useCallback((val: number) => {
    const safeVal = isNaN(val) ? 0 : val;
    return height - paddingYBottom - (Math.min(105, safeVal) / 100) * chartHeight;
  }, [chartHeight]);

  const getInterpolatedValue = useCallback((date: Date, key: 'planned' | 'executed' | 'financial') => {
    if (!reportData || !project) return 0;
    const start = reportData.chartData[0].date;
    const end = reportData.chartData[reportData.chartData.length - 1].date;

    if (isBefore(date, start)) return 0;

    if (key === 'planned') {
      const aiu = project.aiu || { administracion: 0, imprevistos: 0, utilidad: 0 };
      const aiuFactor = 1 + (((aiu.administracion || 0) + (aiu.imprevistos || 0) + (aiu.utilidad || 0)) / 100);

      const activeVersion = project.budgetVersions?.find((v: any) => v.id === project.activeBudgetVersionId);
      const items = activeVersion?.items || project.budgetItems || [];

      let total = 0;
      const normalizedDate = new Date(date);
      normalizedDate.setHours(12, 0, 0, 0);

      items.forEach((item: any) => {
        if (item.type !== 'item' || item.vlrTotal <= 0 || !item.startDate || !item.endDate) return;
        const s = new Date(item.startDate + 'T12:00:00');
        const e = new Date(item.endDate + 'T12:00:00');
        if (normalizedDate >= e) total += item.vlrTotal;
        else if (normalizedDate >= s) {
          const totalDays = Math.max(1, differenceInDays(e, s) + 1);
          const elapsedDays = Math.max(0, differenceInDays(normalizedDate, s) + 1);
          total += item.vlrTotal * (Math.min(1, elapsedDays / totalDays));
        }
      });
      return ((total * aiuFactor) / reportData.totalContractValue) * 100;
    }

    if (key === 'executed' || key === 'financial') {
      const validPoints = reportData.chartData.filter(d => d[key] !== null);
      if (validPoints.length === 0) return 0;
      const lastValid = validPoints[validPoints.length - 1];
      if (!isBefore(date, lastValid.date)) return lastValid[key] as number;
    }

    if (isAfter(date, end)) return reportData.chartData[reportData.chartData.length - 1][key] || 0;

    for (let i = 0; i < reportData.chartData.length - 1; i++) {
      const iStart = reportData.chartData[i].date;
      const iEnd = reportData.chartData[i + 1].date;
      if (!isAfter(iStart, date) && isBefore(date, iEnd)) {
        const valStart = reportData.chartData[i][key] || 0;
        let valEnd = reportData.chartData[i + 1][key];
        if (valEnd === null) valEnd = valStart;

        const totalIntDays = Math.max(1, differenceInDays(iEnd, iStart));
        const elapsed = differenceInDays(date, iStart);
        return valStart + (valEnd - valStart) * (elapsed / totalIntDays);
      }
    }
    return reportData.chartData[reportData.chartData.length - 1][key] || 0;
  }, [reportData, project]);

  const createPath = useCallback((key: 'planned' | 'executed' | 'financial') => {
    if (!reportData) return "";
    const validPoints = reportData.chartData.filter(d => d[key] !== null);
    if (validPoints.length === 0) return "";
    return validPoints.map((d, i) => {
      return `${i === 0 ? 'M' : 'L'} ${getXFromDate(d.date)} ${getY(d[key] as number)}`;
    }).join(' ');
  }, [reportData, getXFromDate, getY]);

  const getLabelOffset = (id: string) => {
    return project?.labelOffsets?.[id] || { x: 0, y: 0 };
  };

  const handleMouseDown = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    const currentOffset = getLabelOffset(id);
    setDragState({
      id,
      startX: e.clientX,
      startY: e.clientY,
      initialOffset: currentOffset
    });
  };

  const { updateProject } = useProjects();
  useEffect(() => {
    if (!dragState || !project) return;
    const handleMouseMove = (e: MouseEvent) => {
      if (!svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const scaleX = 1000 / rect.width;
      const scaleY = 500 / rect.height;
      const dx = (e.clientX - dragState.startX) * scaleX;
      const dy = (e.clientY - dragState.startY) * scaleY;
      const newOffsets = {
        ...(project.labelOffsets || {}),
        [dragState.id]: {
          x: dragState.initialOffset.x + dx,
          y: dragState.initialOffset.y + dy
        }
      };
      updateProject(project.id, { labelOffsets: newOffsets });
    };
    const handleMouseUp = () => {
      setDragState(null);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragState, project, updateProject]);

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (svgRef.current && onRender) {
        const base64 = await exportSvgToPngBase64(svgRef.current);
        if (base64) {
          onRender(base64);
        }
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [reportData, chartConfig, granularity, showStatusLine, visibleCurves, dateEndStr, onRender, project?.labelOffsets]);

  if (!reportData || reportData.chartData.length < 2) {
    return (
      <div style={{ fontSize: '8.5pt', color: '#94a3b8', fontStyle: 'italic', padding: '20px', border: '1px dashed #cbd5e1', borderRadius: '6px', textAlign: 'center' }}>
        No hay datos suficientes para graficar la curva S en el período seleccionado.
      </div>
    );
  }

  const { chartData } = reportData;
  const globalStart = chartData[0].date;
  const globalEnd = chartData[chartData.length - 1].date;

  return (
    <svg
      ref={svgRef}
      width="100%"
      height="100%"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      style={{
        overflow: 'visible',
        width: '100%',
        maxWidth: '480px',
        maxHeight: '220px',
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: '4px',
        display: 'block',
        margin: '10px auto'
      }}
    >
      <defs>
        <filter id="glow-ev-rep" filterUnits="userSpaceOnUse" x="0" y="0" width="1000" height="500">
          <feGaussianBlur stdDeviation={chartConfig.executedGlowRadius} result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
        <filter id="glow-pv-rep" filterUnits="userSpaceOnUse" x="0" y="0" width="1000" height="500">
          <feGaussianBlur stdDeviation={chartConfig.plannedGlowRadius} result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
        <filter id="glow-fi-rep" filterUnits="userSpaceOnUse" x="0" y="0" width="1000" height="500">
          <feGaussianBlur stdDeviation={chartConfig.financialGlowRadius} result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
        <linearGradient id="areaGradientRep" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={chartConfig.executedColor.startsWith('hsl') ? '#c5ff00' : chartConfig.executedColor} stopOpacity={chartConfig.executedFillOpacity} />
          <stop offset="100%" stopColor={chartConfig.executedColor.startsWith('hsl') ? '#c5ff00' : chartConfig.executedColor} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Legend inside SVG */}
      {(() => {
        const activeLegends = [];
        if (visibleCurves.planned) {
          activeLegends.push({
            label: "PROG. (PV)",
            color: chartConfig.plannedColor,
            dashArray: chartConfig.plannedDashArray === 'none' ? undefined : chartConfig.plannedDashArray
          });
        }
        if (visibleCurves.executed) {
          activeLegends.push({
            label: "EJEC. REAL (EV)",
            color: chartConfig.executedColor.startsWith('hsl') ? '#c5ff00' : chartConfig.executedColor,
            dashArray: undefined
          });
        }
        if (visibleCurves.financial) {
          activeLegends.push({
            label: "FINANCIERO (FI)",
            color: chartConfig.financialColor,
            dashArray: chartConfig.financialDashArray === 'none' ? undefined : chartConfig.financialDashArray
          });
        }

        const itemWidth = 180;
        const totalW = activeLegends.length * itemWidth;
        const startX = (width - totalW) / 2;

        return activeLegends.map((leg, idx) => {
          const x = startX + idx * itemWidth;
          const y = 25;
          return (
            <g key={`leg-${idx}`}>
              <line
                x1={x} y1={y}
                x2={x + 30} y2={y}
                stroke={leg.color}
                strokeWidth="2.5"
                strokeDasharray={leg.dashArray}
              />
              <circle
                cx={x + 15} cy={y}
                r="3.5"
                fill={leg.color}
              />
              <text
                x={x + 38} y={y + 4}
                style={{
                  fontSize: `${chartConfig.legendFontSize || 11}px`,
                  fill: '#334155',
                  fontWeight: 'bold',
                  fontFamily: 'monospace'
                }}
              >
                {leg.label}
              </text>
            </g>
          );
        });
      })()}

      {/* Grid Lines Y */}
      {[0, 20, 40, 60, 80, 100].map(val => (
        <g key={`gy-${val}`}>
          {chartConfig.gridVisible && (
            <line
              x1={paddingX} y1={getY(val)}
              x2={width - paddingX} y2={getY(val)}
              stroke={chartConfig.gridColor} strokeWidth="0.5"
            />
          )}
          <text x={paddingX - 12} y={getY(val) + 4} textAnchor="end" style={{ fontSize: `${chartConfig.axisFontSize}px`, fill: '#475569', fontWeight: 'bold', fontFamily: 'monospace' }}>{val}%</text>
        </g>
      ))}

      {/* Grid Lines X (Vertical cut lines matching labels) */}
      {chartConfig.gridVisible && (() => {
        const cutoffDate = dateEndStr ? parseISO(dateEndStr) : null;
        const labeledData = chartData.filter((d) => {
          const isMonthEnd = isSameDay(d.date, endOfMonth(d.date));
          const isProjectEnd = isSameDay(d.date, globalEnd);
          const isCutoff = cutoffDate && isValid(cutoffDate) && isSameDay(d.date, cutoffDate);
          return isMonthEnd || isProjectEnd || isCutoff;
        });
        return labeledData.map((d, idx) => {
          const xPos = getXFromDate(d.date);
          return (
            <line
              key={`gx-${idx}`}
              x1={xPos} y1={paddingYTop}
              x2={xPos} y2={height - paddingYBottom}
              stroke={chartConfig.gridColor}
              strokeWidth="0.5"
            />
          );
        });
      })()}

      {/* Area under Executed Curve */}
      {visibleCurves.executed && (() => {
        const lastReportIdx = chartData.findLastIndex(d => d.executed !== null);
        if (lastReportIdx === -1) return null;
        const lastDate = chartData[lastReportIdx].date;
        return <path d={`${createPath('executed')} L ${getXFromDate(lastDate)} ${getY(0)} L ${getXFromDate(globalStart)} ${getY(0)} Z`} fill="url(#areaGradientRep)" />;
      })()}

      {/* Curves */}
      {visibleCurves.planned && (
        <path
          d={createPath('planned')}
          fill="none"
          stroke={chartConfig.plannedColor}
          strokeWidth={chartConfig.plannedWidth}
          strokeDasharray={chartConfig.plannedDashArray === 'none' ? undefined : chartConfig.plannedDashArray}
          filter={chartConfig.plannedGlow ? 'url(#glow-pv-rep)' : undefined}
          opacity="0.8"
        />
      )}
      {visibleCurves.executed && (
        <path
          d={createPath('executed')}
          fill="none"
          stroke={chartConfig.executedColor.startsWith('hsl') ? 'hsl(var(--primary-neon))' : chartConfig.executedColor}
          strokeWidth={chartConfig.executedWidth}
          filter={chartConfig.executedGlow ? 'url(#glow-ev-rep)' : undefined}
        />
      )}
      {visibleCurves.financial && (
        <path
          d={createPath('financial')}
          fill="none"
          stroke={chartConfig.financialColor}
          strokeWidth={chartConfig.financialWidth}
          strokeDasharray={chartConfig.financialDashArray === 'none' ? undefined : chartConfig.financialDashArray}
          filter={chartConfig.financialGlow ? 'url(#glow-fi-rep)' : undefined}
        />
      )}

      {/* Markers / Labels for Planned */}
      {visibleCurves.planned && (() => {
        const lastExecutedIdx = chartData.findLastIndex(d => d.executed !== null);
        return chartData.map((d, i) => {
          const prev = i > 0 ? chartData[i - 1] : null;
          const isStatusPoint = i === lastExecutedIdx;
          const isSignificant = isStatusPoint || !prev || Math.abs(d.planned - prev.planned) > 5 || i === chartData.length - 1;
          if (!isSignificant) return null;

          const offset = getLabelOffset(`planned-${i}`);
          const baseX = getXFromDate(d.date);
          const baseY = getY(d.planned);
          const hasOffset = offset.x !== 0 || offset.y !== 0;

          return (
            <g key={`p-group-${i}`}>
              {isStatusPoint && (
                <circle cx={baseX} cy={baseY} r={chartConfig.pointSize > 0 ? chartConfig.pointSize + 0.5 : 3.5} fill={chartConfig.plannedColor} stroke="#64748b" strokeWidth="1" />
              )}
              {(hasOffset || isStatusPoint) && (
                <line
                  x1={baseX} y1={baseY}
                  x2={baseX + offset.x} y2={baseY - 12 + offset.y}
                  stroke={chartConfig.plannedColor} strokeWidth={isStatusPoint ? "1" : "0.5"} strokeDasharray={isStatusPoint ? "" : "2 1"} opacity="0.8"
                />
              )}
              <text
                x={baseX + offset.x}
                y={baseY - 12 + offset.y}
                textAnchor="middle"
                onMouseDown={(e) => handleMouseDown(e, `planned-${i}`)}
                style={{
                  fontSize: isStatusPoint ? `${chartConfig.labelFontSize + 2}px` : `${chartConfig.labelFontSize}px`,
                  fill: chartConfig.plannedColor,
                  fontWeight: 'bold',
                  fontFamily: 'monospace',
                  cursor: 'move', userSelect: 'none'
                }}
              >
                {d.planned.toFixed(2)}%
              </text>
            </g>
          );
        });
      })()}

      {/* Markers / Labels for Executed */}
      {visibleCurves.executed && chartData.map((d, i) => {
        if (d.executed === null) return null;
        const lastIdx = chartData.findLastIndex(item => item.executed !== null);
        const prev = i > 0 ? chartData[i - 1] : null;
        const isSignificant = !prev || prev.executed === null || Math.abs(d.executed - prev.executed) > 0.1 || i === lastIdx;
        return (
          <g key={i}>
            <circle cx={getXFromDate(d.date)} cy={getY(d.executed)} r={i === lastIdx ? (chartConfig.pointSize > 0 ? chartConfig.pointSize + 1 : 4) : (chartConfig.pointSize > 0 ? chartConfig.pointSize : 2)} fill={chartConfig.executedColor.startsWith('hsl') ? '#c5ff00' : chartConfig.executedColor} />
            {isSignificant && (() => {
              const offset = getLabelOffset(`executed-${i}`);
              const baseX = getXFromDate(d.date);
              const baseY = getY(d.executed);
              const hasOffset = offset.x !== 0 || offset.y !== 0;

              return (
                <g>
                  {hasOffset && (
                    <line
                      x1={baseX} y1={baseY}
                      x2={baseX + offset.x} y2={baseY + 15 + offset.y}
                      stroke={chartConfig.executedColor.startsWith('hsl') ? '#c5ff00' : chartConfig.executedColor} strokeWidth="0.5" strokeDasharray="2 1" opacity="0.6"
                    />
                  )}
                  <text
                    x={baseX + offset.x}
                    y={baseY + 15 + offset.y}
                    textAnchor="middle"
                    onMouseDown={(e) => handleMouseDown(e, `executed-${i}`)}
                    style={{
                      fontSize: `${chartConfig.labelFontSize}px`,
                      fill: chartConfig.executedColor.startsWith('hsl') ? '#334155' : chartConfig.executedColor,
                      fontWeight: 'bold',
                      fontFamily: 'monospace',
                      cursor: 'move', userSelect: 'none'
                    }}
                  >
                    {d.executed.toFixed(2)}%
                  </text>
                </g>
              );
            })()}
          </g>
        );
      })}

      {/* Red vertical status date line */}
      {dateEndStr && showStatusLine && isValid(parseISO(dateEndStr)) && (() => {
        const dateObj = parseISO(dateEndStr);
        // Clamp status date to project start and end dates
        const clampedDate = isBefore(dateObj, globalStart) 
          ? globalStart 
          : (isAfter(dateObj, globalEnd) ? globalEnd : dateObj);

        const xPos = getXFromDate(clampedDate);
        const pVal = getInterpolatedValue(clampedDate, 'planned');
        const eVal = getInterpolatedValue(clampedDate, 'executed');
        const fVal = getInterpolatedValue(clampedDate, 'financial');

        let pvBaseY = getY(pVal);
        let evBaseY = getY(eVal);
        let fvBaseY = getY(fVal);

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

        return (
          <g>
            <line x1={xPos} y1={paddingYTop} x2={xPos} y2={height - paddingYBottom} stroke="#ef4444" strokeWidth="1.5" strokeDasharray="4 2" />
            {visibleCurves.planned && (
              <g>
                <circle cx={xPos} cy={pvBaseY} r={chartConfig.pointSize > 0 ? chartConfig.pointSize + 2 : 5} fill={chartConfig.plannedColor} stroke="#fff" strokeWidth="1.5" />
                <text
                  x={xPos + 8 + pvOff.x}
                  y={pvFinalY + 4 + pvOff.y}
                  onMouseDown={(e) => handleMouseDown(e, 'status-pv')}
                  style={{ fontSize: `${chartConfig.labelFontSize + 1}px`, fill: '#0097a7', fontWeight: 'bold', fontFamily: 'monospace', cursor: 'move', userSelect: 'none' }}
                >
                  PV: {pVal.toFixed(2)}%
                </text>
              </g>
            )}
            {visibleCurves.executed && eVal !== null && (
              <g>
                <circle cx={xPos} cy={evBaseY} r={chartConfig.pointSize > 0 ? chartConfig.pointSize + 2 : 5} fill={chartConfig.executedColor.startsWith('hsl') ? '#c5ff00' : chartConfig.executedColor} stroke="#fff" strokeWidth="1.5" />
                <text
                  x={xPos + 8 + evOff.x}
                  y={evFinalY + 4 + evOff.y}
                  onMouseDown={(e) => handleMouseDown(e, 'status-ev')}
                  style={{ fontSize: `${chartConfig.labelFontSize + 1}px`, fill: '#33691e', fontWeight: 'bold', fontFamily: 'monospace', cursor: 'move', userSelect: 'none' }}
                >
                  EV: {eVal.toFixed(2)}%
                </text>
              </g>
            )}
            {visibleCurves.financial && fVal !== null && (
              <g>
                <circle cx={xPos} cy={fvBaseY} r={chartConfig.pointSize > 0 ? chartConfig.pointSize + 2 : 5} fill={chartConfig.financialColor} stroke="#fff" strokeWidth="1.5" />
                <text
                  x={xPos + 8 + fvOff.x}
                  y={fvFinalY + 4 + fvOff.y}
                  onMouseDown={(e) => handleMouseDown(e, 'status-fv')}
                  style={{ fontSize: `${chartConfig.labelFontSize + 1}px`, fill: '#b58900', fontWeight: 'bold', fontFamily: 'monospace', cursor: 'move', userSelect: 'none' }}
                >
                  FI: {fVal.toFixed(2)}%
                </text>
              </g>
            )}
          </g>
        );
      })()}

      <line x1={paddingX} y1={height - paddingYBottom} x2={width - paddingX} y2={height - paddingYBottom} stroke="#cbd5e1" strokeWidth="1.5" />

      {/* Axis Labels X */}
      {(() => {
        const cutoffDate = dateEndStr ? parseISO(dateEndStr) : null;
        const labeledData = chartData.filter((d) => {
          const isMonthEnd = isSameDay(d.date, endOfMonth(d.date));
          const isProjectEnd = isSameDay(d.date, globalEnd);
          const isCutoff = cutoffDate && isValid(cutoffDate) && isSameDay(d.date, cutoffDate);
          return isMonthEnd || isProjectEnd || isCutoff;
        });

        return labeledData.map((d, i) => {
          const xPos = getXFromDate(d.date);
          const next = labeledData[i + 1];
          const prev = labeledData[i - 1];

          const isCloseToNext = next && (getXFromDate(next.date) - xPos) < 55;
          const wasCloseToPrev = prev && (xPos - getXFromDate(prev.date)) < 55;

          let anchor: "start" | "middle" | "end" = "middle";
          let dx = 0;

          if (isCloseToNext) {
            anchor = "end";
            dx = -6;
          } else if (wasCloseToPrev) {
            anchor = "start";
            dx = 6;
          }

          return (
            <text
              key={i}
              x={xPos + dx}
              y={height - paddingYBottom + 35}
              textAnchor={anchor}
              style={{ fontSize: `${chartConfig.axisFontSize + 1}px`, fill: '#475569', fontWeight: 'bold', fontFamily: 'monospace' }}
            >
              {d.label}
            </text>
          );
        });
      })()}
    </svg>
  );
}

// ─── Componente Principal ───
export default function MonthlyReportsView() {
  const { getActiveProject, updateProject, getPhotoLocalUrl, addExecutiveReport, removeExecutiveReport, updateExecutiveReport, setCurrentView } = useProjects();
  const project = getActiveProject();

  // Estados de paneles del acordeón lateral
  const [panelOpen, setPanelOpen] = useState({
    general: true,
    contract: false,
    staff: false,
    photos: false,
    chart: false,
    saved: false
  });

  const [currentSavedReport, setCurrentSavedReport] = useState<ExecutiveReport | null>(null);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [reportNameInput, setReportNameInput] = useState('');
  const [isEditing, setIsEditing] = useState(false);

  const [granularity, setGranularity] = useState<'weeks' | 'months'>('months');
  const [showStatusLine, setShowStatusLine] = useState(project?.showStatusLine ?? true);
  const [visibleCurves, setVisibleCurves] = useState(project?.visibleCurves ?? { planned: true, executed: true, financial: true });

  useEffect(() => {
    if (project) {
      setShowStatusLine(project.showStatusLine ?? true);
      setVisibleCurves(project.visibleCurves ?? { planned: true, executed: true, financial: true });
    }
  }, [project?.id, project?.showStatusLine, project?.visibleCurves]);

  const [chartConfig, setChartConfig] = useState<typeof DEFAULT_CHART_CONFIG>(() => {
    try {
      const saved = localStorage.getItem(`lch-control-chart-config-${project?.id ?? 'default'}`);
      if (saved) {
        return { ...DEFAULT_CHART_CONFIG, ...JSON.parse(saved) };
      }
    } catch (e) {
      console.error(e);
    }
    return DEFAULT_CHART_CONFIG;
  });

  const updateChartConfig = (updates: Partial<typeof DEFAULT_CHART_CONFIG>) => {
    setChartConfig(prev => {
      const updated = { ...prev, ...updates };
      try {
        localStorage.setItem(`lch-control-chart-config-${project?.id ?? 'default'}`, JSON.stringify(updated));
      } catch (e) {
        console.error(e);
      }
      return updated;
    });
  };

  const resetChartConfig = () => {
    setChartConfig(DEFAULT_CHART_CONFIG);
    try {
      localStorage.removeItem(`lch-control-chart-config-${project?.id ?? 'default'}`);
    } catch (e) {
      console.error(e);
    }
  };

  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  };

  // Configuración del Reporte
  const [config, setConfig] = useState<ReportConfig>(() => project?.reportConfig || {});
  const [manualItemCode, setManualItemCode] = useState('');

  // Sincronizar estado local si cambia el proyecto
  useEffect(() => {
    if (project?.reportConfig) {
      setConfig(project.reportConfig);
    }
  }, [project?.id]);

  // Mes de corte seleccionado
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  // Fechas del rango de periodo
  const [dateStartStr, setDateStartStr] = useState('');
  const [dateEndStr, setDateEndStr] = useState('');

  // Inicializar rango al cambiar el mes seleccionado
  useEffect(() => {
    if (selectedMonth) {
      const [yearStr, monthStr] = selectedMonth.split('-');
      const year = parseInt(yearStr);
      const month = parseInt(monthStr) - 1;
      const start = startOfMonth(new Date(year, month, 1));
      const end = endOfMonth(new Date(year, month, 1));
      setDateStartStr(format(start, 'yyyy-MM-dd'));
      setDateEndStr(format(end, 'yyyy-MM-dd'));
    }
  }, [selectedMonth]);

  // Lista de meses de corte disponibles
  const availableMonths = useMemo(() => {
    if (!project?.startDate) return [];
    const start = parseISO(project.startDate);
    const endDate = project.endDate ? parseISO(project.endDate) : new Date();
    const realEnd = new Date(Math.max(endDate.getTime(), new Date().getTime()));
    if (!isValid(start) || !isValid(realEnd)) return [];
    try {
      const months = eachMonthOfInterval({ start, end: realEnd });
      return months.map(m => ({
        value: format(m, 'yyyy-MM'),
        label: format(m, 'MMMM yyyy', { locale: es }).toUpperCase()
      }));
    } catch {
      return [];
    }
  }, [project?.startDate, project?.endDate]);

  // Estado para capturas base64 de la curva S
  const [curveS1Base64, setCurveS1Base64] = useState<string>('');

  // 1. Cargar URLs y caché de fotos locales
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const photoUrlsLoaded = useRef(false);

  const loadPhotoUrls = useCallback(async () => {
    if (!project || photoUrlsLoaded.current) return;
    photoUrlsLoaded.current = true;
    const urls: Record<string, string> = {};
    for (const photo of project.logiEntries || []) {
      if (globalBlobUrlCache.has(photo.id)) {
        urls[photo.id] = globalBlobUrlCache.get(photo.id)!;
      } else if (photo.isLocal) {
        try {
          const url = await getPhotoLocalUrl(photo.id);
          if (url) {
            urls[photo.id] = url;
          } else if (photo.imageUrl) {
            urls[photo.id] = photo.imageUrl;
          }
        } catch (e) {
          console.error("Error cargando url local de foto:", e);
          if (photo.imageUrl) {
            urls[photo.id] = photo.imageUrl;
          }
        }
      } else if (photo.imageUrl) {
        urls[photo.id] = photo.imageUrl;
      }
    }
    setPhotoUrls(prev => ({ ...prev, ...urls }));
  }, [project, getPhotoLocalUrl]);

  useEffect(() => {
    photoUrlsLoaded.current = false;
    loadPhotoUrls();
  }, [project?.id, loadPhotoUrls]);

  // ─── Lógica del Bloque Narrativo ───
  const [narrativeText, setNarrativeText] = useState('');
  useEffect(() => {
    if (project?.reportConfig?.executiveNarratives) {
      setNarrativeText(project.reportConfig.executiveNarratives[selectedMonth] || '');
    } else {
      setNarrativeText('');
    }
  }, [selectedMonth, project?.id]);

  const handleNarrativeChange = (text: string) => {
    if (!project) return;
    setNarrativeText(text);
    const currentNarratives = project.reportConfig?.executiveNarratives || {};
    const updatedNarratives = { ...currentNarratives, [selectedMonth]: text };
    const newConfig = {
      ...(project.reportConfig || {}),
      executiveNarratives: updatedNarratives
    };
    updateProject(project.id, { reportConfig: newConfig });
  };

  // ─── Lógica de Fotos Excluidas en React State ───
  const [excludedPhotoIds, setExcludedPhotoIds] = useState<Set<string>>(new Set());

  // Limpiar exclusión al cambiar periodo
  useEffect(() => {
    setExcludedPhotoIds(new Set());
  }, [selectedMonth]);

  // 2. Cómputo del Cuadro de Avance de Obra (Con parseRobustNumber)
  const progressData = useMemo(() => {
    if (!project) return null;
    return calculateProgressData(project, dateEndStr);
  }, [project, dateEndStr]);

  const plannedPctAtCutoff = useMemo(() => {
    if (!project) return 0;
    return calculatePlannedPctAtCutoff(project, dateEndStr);
  }, [project, dateEndStr]);

  const [sCurveCaption, setSCurveCaption] = useState('');

  const defaultSCurveCaption = useMemo(() => {
    const x = progressData?.pctTotal ?? 0;
    const y = plannedPctAtCutoff ?? 0;
    return `Al corte del presente informe, el proyecto expone un avance ejecutado por el orden del ${fmtPct(x)}, contra una programación que, a la misma fecha de corte, exige un avance del ${fmtPct(y)}.`;
  }, [progressData?.pctTotal, plannedPctAtCutoff]);

  useEffect(() => {
    if (project?.reportConfig?.sCurveCaptions && project.reportConfig.sCurveCaptions[selectedMonth] !== undefined) {
      setSCurveCaption(project.reportConfig.sCurveCaptions[selectedMonth]);
    } else {
      setSCurveCaption(defaultSCurveCaption);
    }
  }, [selectedMonth, project?.id, defaultSCurveCaption]);

  const handleSCurveCaptionChange = (text: string) => {
    if (!project) return;
    setSCurveCaption(text);
    const currentCaptions = project.reportConfig?.sCurveCaptions || {};
    const updatedCaptions = { ...currentCaptions, [selectedMonth]: text };
    const newConfig = {
      ...(project.reportConfig || {}),
      sCurveCaptions: updatedCaptions
    };
    updateProject(project.id, { reportConfig: newConfig });
  };

  // Formato simple de filas para la exportación de Word
  const progressTableRowsForExport = useMemo(() => {
    if (!progressData) return [];
    
    const rows: string[][] = [];

    progressData.tableRows.forEach(r => {
      if (r.isTitle) {
        rows.push([r.item + " " + r.description, "", "", "", "", "", "", "", ""]);
      } else {
        rows.push([
          r.item,
          r.description,
          r.unit,
          fmtQty(r.contractedQty),
          fmtCurrency(r.unitPrice),
          fmtCurrency(r.contractedTotal),
          fmtQty(r.acumQty),
          fmtCurrency(r.acumValue),
          fmtPct(r.pctExecution)
        ]);
      }
    });

    rows.push([
      "COSTO DIRECTO",
      "",
      "",
      "",
      "",
      fmtCurrency(progressData.costoDirectoContratado),
      "",
      fmtCurrency(progressData.costoDirectoEjecutado),
      fmtPct(progressData.pctCostoDirecto)
    ]);

    rows.push([
      `AIU (${progressData.aiuPct}%)`,
      "",
      "",
      "",
      "",
      fmtCurrency(progressData.aiuContratado),
      "",
      fmtCurrency(progressData.aiuEjecutado),
      fmtPct(progressData.pctAiu)
    ]);

    rows.push([
      "TOTAL DE OBRA",
      "",
      "",
      "",
      "",
      fmtCurrency(progressData.totalContratado),
      "",
      fmtCurrency(progressData.totalEjecutado),
      fmtPct(progressData.pctTotal)
    ]);

    return rows;
  }, [progressData]);

  // 3. Cómputo del Registro Fotográfico
  const allPeriodPhotos = useMemo(() => {
    if (!project || !dateStartStr || !dateEndStr) return [];
    const startD = parseISO(dateStartStr);
    const endD = parseISO(dateEndStr);

    return (project.logiEntries || [])
      .filter(entry => {
        if (entry.status !== 'integrated') return false; // Solo integradas en obra
        const entryDate = parseISO(entry.date);
        return entryDate >= startD && entryDate <= endD;
      })
      .map(entry => ({
        ...entry,
        imageUrl: photoUrls[entry.id] || entry.imageUrl
      }));
  }, [project, dateStartStr, dateEndStr, photoUrls]);

  // Rejilla de fotos activas (Excluyendo las marcadas en el estado)
  const activePhotos = useMemo(() => {
    return allPeriodPhotos.filter(p => !excludedPhotoIds.has(p.id));
  }, [allPeriodPhotos, excludedPhotoIds]);

  // Lista de fotos excluidas para poder restaurarlas
  const excludedPhotos = useMemo(() => {
    return allPeriodPhotos.filter(p => excludedPhotoIds.has(p.id));
  }, [allPeriodPhotos, excludedPhotoIds]);

  // Excluir foto
  const handleExcludePhoto = (id: string) => {
    setExcludedPhotoIds(prev => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    showToast("✓ Foto excluida de este informe");
  };

  // Restaurar foto
  const handleRestorePhoto = (id: string) => {
    setExcludedPhotoIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    showToast("✓ Foto restaurada al informe");
  };

  if (!project) {
    return (
      <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', color: 'hsl(var(--text-muted))', padding: '40px' }}>
        No hay un proyecto activo seleccionado.
      </div>
    );
  }

  // --- Operaciones de Configuración General ---
  const handleConfigChange = (key: keyof ReportConfig, value: any) => {
    const newConfig = { ...config, [key]: value };
    setConfig(newConfig);
    updateProject(project.id, { reportConfig: newConfig });
  };

  // --- Manejo de Ítems Adicionales Manuales para Fotos ---
  const handleAddManualItem = () => {
    const code = manualItemCode.trim();
    if (!code) return;
    
    const activeVersion = project.budgetVersions?.find(v => v.id === project.activeBudgetVersionId);
    const budgetItems = activeVersion?.items || project.budgetItems || [];
    const itemExists = budgetItems.some(i => String(i.item) === String(code));
    if (!itemExists) {
      alert(`El ítem con código "${code}" no existe en el presupuesto actual.`);
      return;
    }

    const currentList = config.additionalPhotoItems || [];
    if (currentList.includes(code)) {
      alert(`El ítem "${code}" ya está agregado.`);
      return;
    }

    const newConfig = {
      ...config,
      additionalPhotoItems: [...currentList, code]
    };
    setConfig(newConfig);
    setManualItemCode('');
    updateProject(project.id, { reportConfig: newConfig });
    showToast("✓ Ítem agregado al registro de fotos");
  };

  const handleRemoveManualItem = (code: string) => {
    const currentList = config.additionalPhotoItems || [];
    const newConfig = {
      ...config,
      additionalPhotoItems: currentList.filter(c => c !== code)
    };
    setConfig(newConfig);
    updateProject(project.id, { reportConfig: newConfig });
    showToast("✓ Ítem manual removido");
  };

  // --- Operaciones del Personal ---
  const [staffDraft, setStaffDraft] = useState<{ name: string; idCard: string; role: string }>({ name: '', idCard: '', role: '' });
  const [staffTarget, setStaffTarget] = useState<'personalObra' | 'personalInterventoria'>('personalObra');

  const addStaff = () => {
    if (!staffDraft.name.trim()) return;
    const listKey = staffTarget;
    const currentList = config[listKey] || [];
    const newConfig = {
      ...config,
      [listKey]: [...currentList, { ...staffDraft }]
    };
    setConfig(newConfig);
    setStaffDraft({ name: '', idCard: '', role: '' });
    updateProject(project.id, { reportConfig: newConfig });
    showToast("✓ Profesional agregado al personal");
  };

  const removeStaff = (target: 'personalObra' | 'personalInterventoria', idx: number) => {
    const list = config[target] || [];
    const newConfig = {
      ...config,
      [target]: list.filter((_, i) => i !== idx)
    };
    setConfig(newConfig);
    updateProject(project.id, { reportConfig: newConfig });
    showToast("✓ Profesional removido");
  };

  // --- Exportación al Informe Ejecutivo Mensual MHTML (.doc) ---
  const handleExportExecutiveReport = async () => {
    if (!dateStartStr || !dateEndStr) {
      alert("Por favor configure el rango de fechas primero.");
      return;
    }

    showToast("Generando Informe Ejecutivo...");

    try {
      const monthLabel = availableMonths.find(m => m.value === selectedMonth)?.label || selectedMonth;

      const exportOptions = {
        projectName: config.objetoObra || project.name,
        projectCode: config.noContrato || project.code,
        periodLabel: `${monthLabel} (del ${format(parseISO(dateStartStr), 'dd/MM/yyyy')} al ${format(parseISO(dateEndStr), 'dd/MM/yyyy')})`,
        narrativeText: narrativeText,
        tableRows: progressTableRowsForExport,
        curveSBase64: curveS1Base64,
        photos: activePhotos,
        sCurveCaption: sCurveCaption
      };

      await exportExecutiveReportToWord(project, exportOptions);
      showToast("✓ Informe Ejecutivo descargado correctamente (.doc)");
    } catch (e: any) {
      console.error(e);
      alert(`Error al generar Informe: ${e.message || e}`);
    }
  };

  // --- Lógica de Informes Guardados ---
  const hasChanges = useMemo(() => {
    if (!currentSavedReport) return false;
    const savedExcluded = new Set(currentSavedReport.excludedPhotoIds || []);
    if (excludedPhotoIds.size !== savedExcluded.size) return true;
    for (const id of excludedPhotoIds) {
      if (!savedExcluded.has(id)) return true;
    }
    return (
      selectedMonth !== currentSavedReport.selectedMonth ||
      dateStartStr !== currentSavedReport.dateFrom ||
      dateEndStr !== currentSavedReport.dateTo ||
      narrativeText !== currentSavedReport.narrativeText ||
      sCurveCaption !== (currentSavedReport.sCurveCaption || '')
    );
  }, [currentSavedReport, selectedMonth, dateStartStr, dateEndStr, narrativeText, sCurveCaption, excludedPhotoIds]);

  const handleSaveExistingReport = () => {
    if (!project || !currentSavedReport) return;
    updateExecutiveReport(project.id, currentSavedReport.id, {
      selectedMonth,
      dateFrom: dateStartStr,
      dateTo: dateEndStr,
      narrativeText,
      sCurveCaption,
      excludedPhotoIds: Array.from(excludedPhotoIds)
    });
    setCurrentSavedReport(prev => prev ? {
      ...prev,
      selectedMonth,
      dateFrom: dateStartStr,
      dateTo: dateEndStr,
      narrativeText,
      sCurveCaption,
      excludedPhotoIds: Array.from(excludedPhotoIds)
    } : null);
    showToast("✓ Cambios guardados correctamente");
  };

  const handleSaveNewReport = () => {
    if (!project || !reportNameInput.trim()) return;
    addExecutiveReport(project.id, {
      name: reportNameInput.trim(),
      selectedMonth,
      dateFrom: dateStartStr,
      dateTo: dateEndStr,
      narrativeText,
      sCurveCaption,
      excludedPhotoIds: Array.from(excludedPhotoIds)
    });
    setShowSaveModal(false);
    showToast("✓ Informe guardado correctamente");
  };

  const handleLoadSavedReport = (report: ExecutiveReport) => {
    setSelectedMonth(report.selectedMonth);
    setDateStartStr(report.dateFrom);
    setDateEndStr(report.dateTo);
    setNarrativeText(report.narrativeText);
    setSCurveCaption(report.sCurveCaption || '');
    setExcludedPhotoIds(new Set(report.excludedPhotoIds || []));
    setCurrentSavedReport(report);
    
    // Sincronizar narratives y captions en caliente
    if (project) {
      const currentNarratives = project.reportConfig?.executiveNarratives || {};
      const updatedNarratives = { ...currentNarratives, [report.selectedMonth]: report.narrativeText };
      const currentCaptions = project.reportConfig?.sCurveCaptions || {};
      const updatedCaptions = { ...currentCaptions, [report.selectedMonth]: report.sCurveCaption || '' };
      const newConfig = {
        ...(project.reportConfig || {}),
        executiveNarratives: updatedNarratives,
        sCurveCaptions: updatedCaptions
      };
      updateProject(project.id, { reportConfig: newConfig });
    }
    showToast("✓ Informe cargado");
  };

  const handleDeleteSavedReport = (reportId: string) => {
    if (!project) return;
    if (confirm("¿Está seguro de que desea eliminar este informe ejecutivo guardado?")) {
      removeExecutiveReport(project.id, reportId);
      if (currentSavedReport?.id === reportId) {
        setCurrentSavedReport(null);
      }
      showToast("✓ Informe eliminado");
    }
  };

  const handleNewReport = () => {
    setCurrentSavedReport(null);
    setExcludedPhotoIds(new Set());
    showToast("✓ Iniciado nuevo informe limpio");
  };

  // Limpiar informe seleccionado si se cambia de mes manualmente
  useEffect(() => {
    setCurrentSavedReport(null);
  }, [selectedMonth]);

  // ─── Estilos de Configuración ───
  const labelStyle: React.CSSProperties = {
    fontSize: '0.65rem',
    color: 'hsl(var(--text-muted))',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    fontFamily: 'var(--font-technical)',
    marginBottom: '2px'
  };

  const inputStyle: React.CSSProperties = {
    background: 'hsl(var(--bg-tertiary))',
    border: '1px solid var(--border-color)',
    color: 'hsl(var(--text-primary))',
    borderRadius: 'var(--radius-sm)',
    padding: '6px 10px',
    fontSize: '0.75rem',
    outline: 'none',
    width: '100%',
    fontFamily: 'var(--font-body)',
  };

  const panelHeaderStyle = (isOpen: boolean): React.CSSProperties => ({
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 14px',
    background: isOpen ? 'hsla(var(--primary-neon-hsl), 0.08)' : 'hsl(var(--bg-tertiary))',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-sm)',
    fontSize: '0.75rem',
    fontWeight: 'bold',
    fontFamily: 'var(--font-technical)',
    color: isOpen ? 'hsl(var(--primary-neon))' : 'hsl(var(--text-secondary))',
    cursor: 'pointer',
    marginBottom: '8px',
    textTransform: 'uppercase',
    letterSpacing: '1px',
    transition: 'all 0.2s'
  });

  const reports = project?.executiveReports || [];

  if (!isEditing) {
    return (
      <div className="dashboard-container animate-in" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <div className="page-header" style={{ flexShrink: 0, paddingBottom: '12px', borderBottom: '1px solid var(--border-color)', marginBottom: '20px' }}>
          <div>
            <h2 className="page-title">Informes Ejecutivos</h2>
            <p style={{ color: 'hsl(var(--text-muted))', fontSize: '0.7rem', fontWeight: '600', margin: '4px 0 0 0', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              {reports.length} INFORMES GUARDADOS
            </p>
          </div>

          <button 
            className="btn btn-primary" 
            onClick={() => {
              handleNewReport();
              setIsEditing(true);
            }}
            style={{ 
              fontWeight: '700', 
              background: 'hsl(var(--accent-primary))', 
              color: '#000',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              height: '36px'
            }}
          >
            <Plus size={16} /> NUEVO INFORME
          </button>
        </div>

        <div className="custom-scrollbar" style={{ padding: '0 4px 24px 4px', flex: 1, overflowY: 'auto' }}>
          {reports.length === 0 ? (
            <div 
              className="flex-center" 
              style={{ 
                height: '40vh', 
                flexDirection: 'column', 
                gap: '16px',
                border: '1px dashed hsl(var(--border-color))',
                borderRadius: '8px',
                background: 'hsla(var(--bg-secondary-hsl), 0.1)',
                marginTop: '20px'
              }}
            >
              <FileText size={48} style={{ opacity: 0.15, color: 'hsl(var(--accent-primary))' }} />
              <div style={{ textAlign: 'center' }}>
                <p style={{ margin: 0, fontWeight: 'bold', color: 'hsl(var(--text-secondary))' }}>No hay informes ejecutivos guardados</p>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.75rem', color: 'hsl(var(--text-muted))' }}>
                  Haga clic en "NUEVO INFORME" para generar y guardar un informe ejecutivo.
                </p>
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px', paddingTop: '20px' }}>
              {reports.map((report) => (
                <div 
                  key={report.id}
                  onClick={() => {
                    handleLoadSavedReport(report);
                    setIsEditing(true);
                  }}
                  style={{
                    background: 'hsla(var(--bg-secondary-hsl, 222 15% 15%), 0.4)',
                    backdropFilter: 'blur(10px)',
                    border: '1px solid hsla(var(--border-color-hsl, 222 15% 30%), 0.5)',
                    borderRadius: '12px',
                    padding: '20px',
                    cursor: 'pointer',
                    transition: 'all 0.3s ease',
                    position: 'relative',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'hsl(var(--accent-primary))';
                    e.currentTarget.style.boxShadow = '0 0 15px hsla(var(--accent-primary-hsl), 0.15)';
                    e.currentTarget.style.transform = 'translateY(-2px)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'hsla(var(--border-color-hsl), 0.5)';
                    e.currentTarget.style.boxShadow = 'none';
                    e.currentTarget.style.transform = 'translateY(0)';
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{
                      background: 'hsla(var(--accent-primary-hsl), 0.1)',
                      border: '1px solid hsl(var(--accent-primary))',
                      borderRadius: '8px',
                      padding: '8px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'hsl(var(--accent-primary))'
                    }}>
                      <Folder size={20} />
                    </div>
                    
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteSavedReport(report.id);
                      }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'hsl(var(--danger))',
                        opacity: 0.7,
                        transition: 'opacity 0.2s',
                        padding: '4px'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
                      onMouseLeave={(e) => e.currentTarget.style.opacity = '0.7'}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  
                  <div>
                    <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 'bold', color: 'hsl(var(--text-primary))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {report.name}
                    </h3>
                    <p style={{ margin: '4px 0 0 0', fontSize: '0.7rem', color: 'hsl(var(--text-muted))' }}>
                      Creado: {new Date(report.createdAt).toLocaleDateString()} {new Date(report.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>

                  <div style={{ height: '1px', background: 'hsl(var(--border-color))', opacity: 0.3 }}></div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.75rem', color: 'hsl(var(--text-secondary))' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Mes de corte:</span>
                      <span style={{ fontWeight: 'bold', color: 'hsl(var(--accent-primary))' }}>{report.selectedMonth}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Rango:</span>
                      <span style={{ fontSize: '0.65rem', color: 'hsl(var(--text-muted))' }}>{report.dateFrom} a {report.dateTo}</span>
                    </div>
                    {report.narrativeText && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '4px' }}>
                        <span style={{ fontSize: '0.65rem', color: 'hsl(var(--text-muted))' }}>Narrativa Técnica:</span>
                        <span style={{ fontSize: '0.7rem', fontStyle: 'italic', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: '1.3' }}>
                          {report.narrativeText}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="report-wizard-overlay animate-in" style={{
      position: 'fixed',
      inset: 0,
      background: 'hsl(var(--bg-primary))',
      zIndex: 999,
      display: 'flex',
      flexDirection: 'column',
      color: 'hsl(var(--text-primary))',
      padding: '20px 24px 0 24px'
    }}>
      
      {/* Cabecera de Página */}
      <div className="page-header" style={{ marginBottom: '20px', paddingBottom: '12px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button onClick={() => setIsEditing(false)} className="btn-icon" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'hsl(var(--text-muted))', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px' }} title="Cerrar">
            <X size={24} />
          </button>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <h2 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: 0 }}>
              <FileCheck size={24} style={{ color: 'hsl(var(--primary-neon))' }} />
              Informe Ejecutivo Mensual y Control Gerencial
            </h2>
            <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))', marginTop: '2px' }}>
              Consolida narrativa técnica, cuadro de avance sismorresistente con NPs, Curva S vectorial y rejilla de fotos de avance interactiva en Word (.doc).
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {currentSavedReport && (
            <>
              <button
                onClick={handleNewReport}
                className="btn btn-secondary"
                title="Cerrar informe guardado y empezar uno nuevo"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  height: '36px',
                  fontSize: '0.75rem',
                  fontWeight: 'bold',
                  borderColor: 'var(--border-color)',
                  color: 'hsl(var(--text-secondary))'
                }}
              >
                Nuevo Informe
              </button>
              <button
                onClick={() => setCurrentSavedReport(null)}
                className="btn btn-secondary"
                title="Cerrar informe guardado (sin eliminar)"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '36px',
                  height: '36px',
                  padding: 0,
                  borderColor: 'hsla(0, 80%, 60%, 0.4)',
                  color: 'hsl(0, 72%, 65%)',
                  background: 'hsla(0, 80%, 40%, 0.1)',
                  borderRadius: 'var(--radius-sm)',
                  flexShrink: 0
                }}
              >
                <X size={16} />
              </button>
            </>
          )}

          {currentSavedReport ? (
            <button
              onClick={handleSaveExistingReport}
              className="btn btn-secondary"
              disabled={!hasChanges}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                height: '36px',
                fontSize: '0.75rem',
                fontWeight: 'bold',
                background: hasChanges ? 'hsl(var(--accent-primary))' : 'transparent',
                color: hasChanges ? '#000' : 'hsl(var(--text-muted))',
                borderColor: hasChanges ? 'hsl(var(--accent-primary))' : 'var(--border-color)',
                cursor: hasChanges ? 'pointer' : 'not-allowed'
              }}
            >
              Guardar Cambios
            </button>
          ) : (
            <button
              onClick={() => {
                if (!dateStartStr || !dateEndStr) {
                  alert("Por favor configure el rango de fechas primero.");
                  return;
                }
                const monthLabel = availableMonths.find(m => m.value === selectedMonth)?.label || selectedMonth;
                setReportNameInput(`Informe Ejecutivo - ${monthLabel}`);
                setShowSaveModal(true);
              }}
              className="btn btn-secondary"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                height: '36px',
                fontSize: '0.75rem',
                fontWeight: 'bold',
                color: 'hsl(var(--text-primary))',
                borderColor: 'var(--border-color)'
              }}
            >
              Guardar Reporte
            </button>
          )}

          <button
            onClick={handleExportExecutiveReport}
            className="btn btn-primary"
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '8px', 
              height: '36px', 
              fontSize: '0.75rem', 
              fontWeight: 'bold',
              background: 'hsl(var(--primary-neon))',
              color: '#000',
              boxShadow: '0 0 10px hsla(var(--primary-neon-hsl), 0.3)'
            }}
          >
            <Sparkles size={15} /> Generar Word (.doc)
          </button>
        </div>
      </div>

      {/* Toast de notificación */}
      {toastMsg && (
        <div style={{
          position: 'fixed', bottom: '20px', right: '20px',
          background: 'hsl(var(--accent-primary))', color: '#000',
          padding: '10px 20px', borderRadius: 'var(--radius-sm)',
          fontWeight: 'bold', zIndex: 100000, fontSize: '0.75rem',
          fontFamily: 'var(--font-technical)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)'
        }}>
          {toastMsg}
        </div>
      )}

      {/* Cuerpo principal */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        
        {/* Panel Izquierdo: Parámetros del Mes, Fechas y Datos */}
        <aside className="custom-scrollbar" style={{
          width: '320px',
          background: 'hsl(var(--bg-secondary))',
          borderRight: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto',
          padding: '16px',
          flexShrink: 0
        }}>
          
          {/* Panel 1: Parámetros del Periodo */}
          <div>
            <div style={panelHeaderStyle(panelOpen.general)} onClick={() => setPanelOpen(p => ({ ...p, general: !p.general }))}>
              <span>1. Periodo de Reporte</span>
              {panelOpen.general ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </div>
            {panelOpen.general && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '0 4px 16px 4px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <label style={labelStyle}>Mes de Corte</label>
                  <select
                    style={{ ...inputStyle, cursor: 'pointer' }}
                    value={selectedMonth}
                    onChange={e => setSelectedMonth(e.target.value)}
                  >
                    {availableMonths.map(m => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </div>
                
                <div style={{ display: 'flex', gap: '10px' }}>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <label style={labelStyle}>Fecha Inicio</label>
                    <input
                      type="date"
                      style={{ ...inputStyle, cursor: 'pointer' }}
                      value={dateStartStr}
                      onChange={e => setDateStartStr(e.target.value)}
                    />
                  </div>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <label style={labelStyle}>Fecha Fin</label>
                    <input
                      type="date"
                      style={{ ...inputStyle, cursor: 'pointer' }}
                      value={dateEndStr}
                      onChange={e => setDateEndStr(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Panel 2: Datos Contractuales */}
          <div>
            <div style={panelHeaderStyle(panelOpen.contract)} onClick={() => setPanelOpen(p => ({ ...p, contract: !p.contract }))}>
              <span>2. Datos Contractuales</span>
              {panelOpen.contract ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </div>
            {panelOpen.contract && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '0 4px 16px 4px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <label style={labelStyle}>Objeto de la Obra</label>
                  <textarea
                    style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }}
                    value={config.objetoObra || ''}
                    onChange={e => handleConfigChange('objetoObra', e.target.value)}
                    placeholder="Objeto contractual..."
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <label style={labelStyle}>No. Contrato</label>
                  <input style={inputStyle} value={config.noContrato || ''} onChange={e => handleConfigChange('noContrato', e.target.value)} placeholder="Número de contrato..." />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <label style={labelStyle}>Contratista de Obra</label>
                  <input style={inputStyle} value={config.contratistaObra || ''} onChange={e => handleConfigChange('contratistaObra', e.target.value)} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <label style={labelStyle}>NIT Contratista</label>
                  <input style={inputStyle} value={config.nitObra || ''} onChange={e => handleConfigChange('nitObra', e.target.value)} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <label style={labelStyle}>Representante Obra</label>
                  <input style={inputStyle} value={config.repLegalObra || ''} onChange={e => handleConfigChange('repLegalObra', e.target.value)} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <label style={labelStyle}>Interventoría</label>
                  <input style={inputStyle} value={config.contratistaInterventoria || ''} onChange={e => handleConfigChange('contratistaInterventoria', e.target.value)} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <label style={labelStyle}>Supervisor / FFIE</label>
                  <input style={inputStyle} value={config.supervisorFfie || ''} onChange={e => handleConfigChange('supervisorFfie', e.target.value)} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <label style={labelStyle}>Jornada de Trabajo</label>
                  <input style={inputStyle} value={config.jornadasTrabajo || ''} onChange={e => handleConfigChange('jornadasTrabajo', e.target.value)} />
                </div>
              </div>
            )}
          </div>

          {/* Panel 3: Equipo de Trabajo (Personal) */}
          <div>
            <div style={panelHeaderStyle(panelOpen.staff)} onClick={() => setPanelOpen(p => ({ ...p, staff: !p.staff }))}>
              <span>3. Equipo de Trabajo</span>
              {panelOpen.staff ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </div>
            {panelOpen.staff && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '0 4px 16px 4px' }}>
                <div style={{ background: 'rgba(255,255,255,0.02)', padding: '10px', borderRadius: '4px', border: '1px solid var(--border-color)' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <label style={labelStyle}>Cuadrilla</label>
                      <select style={inputStyle} value={staffTarget} onChange={e => setStaffTarget(e.target.value as any)}>
                        <option value="personalObra">Obra</option>
                        <option value="personalInterventoria">Interventoría</option>
                      </select>
                    </div>
                    <input style={inputStyle} value={staffDraft.name} onChange={e => setStaffDraft(p => ({ ...p, name: e.target.value }))} placeholder="Nombre completo" />
                    <input style={inputStyle} value={staffDraft.idCard} onChange={e => setStaffDraft(p => ({ ...p, idCard: e.target.value }))} placeholder="Identificación" />
                    <input style={inputStyle} value={staffDraft.role} onChange={e => setStaffDraft(p => ({ ...p, role: e.target.value }))} placeholder="Cargo" />
                    <button onClick={addStaff} className="btn btn-secondary" style={{ width: '100%', height: '28px', fontSize: '0.7rem' }}>
                      + Agregar al Equipo
                    </button>
                  </div>
                </div>

                {/* Lista Obra */}
                {(config.personalObra || []).length > 0 && (
                  <div style={{ marginTop: '6px' }}>
                    <div style={{ fontSize: '0.6rem', color: 'hsl(var(--primary-neon))', fontWeight: 'bold', marginBottom: '4px' }}>PERSONAL DE OBRA:</div>
                    {(config.personalObra || []).map((staff, idx) => (
                      <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.01)', padding: '4px 6px', borderBottom: '1px solid var(--border-color)', fontSize: '0.7rem' }}>
                        <div>
                          <strong>{staff.name}</strong> <span style={{ color: 'hsl(var(--text-muted))' }}>({staff.role})</span>
                        </div>
                        <Trash2 size={12} style={{ color: 'hsl(var(--danger))', cursor: 'pointer' }} onClick={() => removeStaff('personalObra', idx)} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Panel 4: Personalizar Curva S */}
          <div>
            <div style={panelHeaderStyle(panelOpen.chart)} onClick={() => setPanelOpen(p => ({ ...p, chart: !p.chart }))}>
              <span>4. Personalizar Curva S</span>
              {panelOpen.chart ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </div>
            {panelOpen.chart && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '0 4px 16px 4px' }}>
                
                {/* Granularidad */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <label style={labelStyle}>Granularidad</label>
                  <select
                    style={inputStyle}
                    value={granularity}
                    onChange={e => setGranularity(e.target.value as any)}
                  >
                    <option value="months">MENSUAL</option>
                    <option value="weeks">SEMANAL</option>
                  </select>
                </div>

                {/* Línea de estado y Curvas Visibles */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '0.7rem', color: 'hsl(var(--text-secondary))' }}>Línea de Estado</span>
                    <input 
                      type="checkbox"
                      checked={showStatusLine}
                      onChange={e => {
                        const val = e.target.checked;
                        setShowStatusLine(val);
                        if (project) updateProject(project.id, { showStatusLine: val });
                      }}
                      style={{ accentColor: 'hsl(var(--primary-neon))', cursor: 'pointer' }}
                    />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '0.7rem', color: 'hsl(var(--text-secondary))' }}>Ver Prog. (PV)</span>
                    <input 
                      type="checkbox"
                      checked={visibleCurves.planned}
                      onChange={e => {
                        const val = e.target.checked;
                        const newVisible = { ...visibleCurves, planned: val };
                        setVisibleCurves(newVisible);
                        if (project) updateProject(project.id, { visibleCurves: newVisible });
                      }}
                      style={{ accentColor: 'hsl(var(--primary-neon))', cursor: 'pointer' }}
                    />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '0.7rem', color: 'hsl(var(--text-secondary))' }}>Ver Ejec. Real (EV)</span>
                    <input 
                      type="checkbox"
                      checked={visibleCurves.executed}
                      onChange={e => {
                        const val = e.target.checked;
                        const newVisible = { ...visibleCurves, executed: val };
                        setVisibleCurves(newVisible);
                        if (project) updateProject(project.id, { visibleCurves: newVisible });
                      }}
                      style={{ accentColor: 'hsl(var(--primary-neon))', cursor: 'pointer' }}
                    />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '0.7rem', color: 'hsl(var(--text-secondary))' }}>Ver Financiero (FI)</span>
                    <input 
                      type="checkbox"
                      checked={visibleCurves.financial}
                      onChange={e => {
                        const val = e.target.checked;
                        const newVisible = { ...visibleCurves, financial: val };
                        setVisibleCurves(newVisible);
                        if (project) updateProject(project.id, { visibleCurves: newVisible });
                      }}
                      style={{ accentColor: 'hsl(var(--primary-neon))', cursor: 'pointer' }}
                    />
                  </div>
                </div>

                {/* Colores */}
                <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '0.7rem', color: 'hsl(var(--text-secondary))' }}>Color Prog. (PV)</span>
                    <input 
                      type="color"
                      value={chartConfig.plannedColor}
                      onChange={e => updateChartConfig({ plannedColor: e.target.value })}
                      style={{ width: '24px', height: '16px', border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}
                    />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '0.7rem', color: 'hsl(var(--text-secondary))' }}>Color Ejec. (EV)</span>
                    <input 
                      type="color"
                      value={chartConfig.executedColor.startsWith('hsl') ? '#c5ff00' : chartConfig.executedColor}
                      onChange={e => updateChartConfig({ executedColor: e.target.value })}
                      style={{ width: '24px', height: '16px', border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}
                    />
                  </div>
                </div>

                {/* Grosores de Líneas */}
                <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <label style={{ ...labelStyle, display: 'flex', justifyContent: 'space-between' }}>
                      <span>Grosor Prog. (PV)</span>
                      <span>{chartConfig.plannedWidth}px</span>
                    </label>
                    <input 
                      type="range" min="0.5" max="6" step="0.1"
                      value={chartConfig.plannedWidth}
                      onChange={e => updateChartConfig({ plannedWidth: parseFloat(e.target.value) })}
                      style={{ width: '100%', accentColor: 'hsl(var(--primary-neon))', cursor: 'pointer' }}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <label style={{ ...labelStyle, display: 'flex', justifyContent: 'space-between' }}>
                      <span>Grosor Ejec. (EV)</span>
                      <span>{chartConfig.executedWidth}px</span>
                    </label>
                    <input 
                      type="range" min="1" max="8" step="0.2"
                      value={chartConfig.executedWidth}
                      onChange={e => updateChartConfig({ executedWidth: parseFloat(e.target.value) })}
                      style={{ width: '100%', accentColor: 'hsl(var(--primary-neon))', cursor: 'pointer' }}
                    />
                  </div>
                </div>

                {/* Tamaños y Cuadrícula */}
                <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <label style={{ ...labelStyle, display: 'flex', justifyContent: 'space-between' }}>
                      <span>Tamaño Texto Ejes</span>
                      <span>{chartConfig.axisFontSize}px</span>
                    </label>
                    <input 
                      type="range" min="8" max="16" step="0.5"
                      value={chartConfig.axisFontSize}
                      onChange={e => updateChartConfig({ axisFontSize: parseFloat(e.target.value) })}
                      style={{ width: '100%', accentColor: 'hsl(var(--primary-neon))', cursor: 'pointer' }}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <label style={{ ...labelStyle, display: 'flex', justifyContent: 'space-between' }}>
                      <span>Tamaño Letra Hitos</span>
                      <span>{chartConfig.labelFontSize}px</span>
                    </label>
                    <input 
                      type="range" min="8" max="18" step="0.5"
                      value={chartConfig.labelFontSize}
                      onChange={e => updateChartConfig({ labelFontSize: parseFloat(e.target.value) })}
                      style={{ width: '100%', accentColor: 'hsl(var(--primary-neon))', cursor: 'pointer' }}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <label style={{ ...labelStyle, display: 'flex', justifyContent: 'space-between' }}>
                      <span>Tamaño Título Curvas</span>
                      <span>{chartConfig.legendFontSize || 11}px</span>
                    </label>
                    <input 
                      type="range" min="8" max="16" step="0.5"
                      value={chartConfig.legendFontSize || 11}
                      onChange={e => updateChartConfig({ legendFontSize: parseFloat(e.target.value) })}
                      style={{ width: '100%', accentColor: 'hsl(var(--primary-neon))', cursor: 'pointer' }}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <label style={{ ...labelStyle, display: 'flex', justifyContent: 'space-between' }}>
                      <span>Tamaño de Puntos</span>
                      <span>{chartConfig.pointSize}px</span>
                    </label>
                    <input 
                      type="range" min="0" max="8" step="0.5"
                      value={chartConfig.pointSize}
                      onChange={e => updateChartConfig({ pointSize: parseFloat(e.target.value) })}
                      style={{ width: '100%', accentColor: 'hsl(var(--primary-neon))', cursor: 'pointer' }}
                    />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '2px' }}>
                    <span style={{ fontSize: '0.7rem', color: 'hsl(var(--text-secondary))' }}>Mostrar Cuadrícula</span>
                    <input 
                      type="checkbox"
                      checked={chartConfig.gridVisible}
                      onChange={e => updateChartConfig({ gridVisible: e.target.checked })}
                      style={{ accentColor: 'hsl(var(--primary-neon))', cursor: 'pointer' }}
                    />
                  </div>
                </div>

                {/* Botón Restaurar */}
                <button
                  onClick={resetChartConfig}
                  className="btn btn-secondary"
                  style={{
                    width: '100%',
                    height: '28px',
                    fontSize: '0.7rem',
                    background: 'rgba(239, 68, 68, 0.15)',
                    border: '1px solid rgb(239, 68, 68)',
                    color: 'rgb(252, 165, 165)',
                    marginTop: '4px'
                  }}
                >
                  Restablecer Valores
                </button>
              </div>
            )}
          </div>

          {/* Panel 5: Informes Guardados */}
          <div>
            <div style={panelHeaderStyle(panelOpen.saved)} onClick={() => setPanelOpen(p => ({ ...p, saved: !p.saved }))}>
              <span>5. Informes Guardados</span>
              {panelOpen.saved ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </div>
            {panelOpen.saved && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '0 4px 16px 4px' }}>
                {(!project?.executiveReports || project.executiveReports.length === 0) ? (
                  <div style={{ fontSize: '0.7rem', color: 'hsl(var(--text-muted))', fontStyle: 'italic', textAlign: 'center', padding: '10px 0' }}>
                    No hay informes ejecutivos guardados.
                  </div>
                ) : (
                  project.executiveReports.map(rep => {
                    const isSelected = currentSavedReport?.id === rep.id;
                    return (
                      <div
                        key={rep.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '6px 8px',
                          background: isSelected ? 'hsla(var(--primary-neon-hsl), 0.15)' : 'rgba(255, 255, 255, 0.02)',
                          border: isSelected ? '1px solid hsl(var(--primary-neon))' : '1px solid var(--border-color)',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          transition: 'all 0.2s'
                        }}
                        onClick={() => handleLoadSavedReport(rep)}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                          <FileText size={14} style={{ color: isSelected ? 'hsl(var(--primary-neon))' : 'hsl(var(--text-muted))', flexShrink: 0 }} />
                          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                            <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'hsl(var(--text-primary))', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {rep.name}
                            </span>
                            <span style={{ fontSize: '0.6rem', color: 'hsl(var(--text-muted))' }}>
                              {rep.selectedMonth} | {new Date(rep.createdAt).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteSavedReport(rep.id);
                          }}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            color: 'hsl(var(--danger))',
                            padding: '4px',
                            display: 'flex',
                            alignItems: 'center'
                          }}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </aside>

        {/* Panel Central/Derecha: Hoja de Edición de Reporte Ejecutivo */}
        <main className="custom-scrollbar" style={{
          flex: 1,
          background: 'hsl(var(--bg-tertiary))',
          padding: '24px',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center'
        }}>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', width: '100%', maxWidth: '850px' }}>
            
            {currentSavedReport && (
              <div style={{
                background: hasChanges ? 'rgba(234, 179, 8, 0.1)' : 'rgba(16, 185, 129, 0.1)',
                border: hasChanges ? '1px solid #eab308' : '1px solid #10b981',
                borderRadius: '6px',
                padding: '12px 16px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                color: hasChanges ? '#eab308' : '#10b981',
                fontSize: '0.8rem',
                fontWeight: 'bold',
                fontFamily: 'var(--font-technical)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <FileText size={16} />
                  <span>
                    {hasChanges ? '⚠ CAMBIOS SIN GUARDAR — INFORME: ' : 'MODO EDICIÓN — INFORME GUARDADO: '}
                    <span style={{ color: 'hsl(var(--text-primary))' }}>{currentSavedReport.name}</span>
                  </span>
                </div>
                {hasChanges && (
                  <span style={{ fontSize: '0.7rem', color: 'hsl(var(--text-muted))', fontWeight: 'normal' }}>
                    Haga clic en "Guardar Cambios" para guardar su avance.
                  </span>
                )}
              </div>
            )}
            
            {/* Hoja Virtual de Vista Previa */}
            <div style={{
              background: '#ffffff',
              color: '#334155',
              padding: '40px 50px',
              borderRadius: '6px',
              boxShadow: '0 10px 30px rgba(0, 0, 0, 0.25)',
              fontFamily: 'Arial, sans-serif',
              fontSize: '11pt',
              lineHeight: '1.4'
            }}>
              
              {/* Cabecera del Reporte de Insumos */}
              <div style={{ textAlign: 'center', borderBottom: '2px solid #e2e8f0', paddingBottom: '12px', marginBottom: '24px' }}>
                <h1 style={{ fontSize: '13pt', fontWeight: 'bold', color: '#0f172a', margin: '0 0 6px 0', fontFamily: 'Space Grotesk, Arial' }}>
                  INFORME EJECUTIVO DE ESTADO DE OBRA
                </h1>
                <div style={{ fontSize: '9.5pt', color: '#475569', fontWeight: 'bold' }}>
                  PERIODO: {availableMonths.find(m => m.value === selectedMonth)?.label || selectedMonth}
                </div>
                {dateStartStr && dateEndStr && (
                  <div style={{ fontSize: '8.5pt', color: '#64748b', marginTop: '2px', fontFamily: 'monospace' }}>
                    Rango evaluado: {format(parseISO(dateStartStr), 'dd/MM/yyyy')} al {format(parseISO(dateEndStr), 'dd/MM/yyyy')}
                  </div>
                )}
              </div>

              {/* 1. Bloque Narrativo (Introducción de Ingeniería) */}
              <div style={{ marginBottom: '24px' }}>
                <h3 style={{ fontSize: '10pt', fontWeight: 'bold', color: '#0f172a', borderBottom: '1px solid #cbd5e1', paddingBottom: '4px', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>1.</span> INTRODUCCIÓN Y NARRATIVA TÉCNICA
                </h3>
                <div style={{ position: 'relative', marginTop: '8px' }}>
                  <textarea
                    style={{
                      width: '100%',
                      minHeight: '120px',
                      padding: '12px',
                      fontSize: '9.5pt',
                      color: '#0f172a',
                      background: '#fafafa',
                      border: '1px solid #cbd5e1',
                      borderRadius: '6px',
                      fontFamily: 'Arial, sans-serif',
                      lineHeight: '1.5',
                      resize: 'vertical',
                      outline: 'none',
                      boxSizing: 'border-box'
                    }}
                    value={narrativeText}
                    onChange={e => handleNarrativeChange(e.target.value)}
                    placeholder="Escribe o deja que el Agente IA redacte la narrativa técnica con terminología de interventoría..."
                  />
                  <div style={{
                    fontSize: '7.5pt',
                    color: '#64748b',
                    textAlign: 'right',
                    marginTop: '4px'
                  }}>
                    Conteo de caracteres: {narrativeText.length} | Persistido en caliente
                  </div>
                </div>
              </div>

              {/* 2. Sección Cuadro de Avance */}
              <div style={{ marginBottom: '28px' }}>
                <h3 style={{ fontSize: '10pt', fontWeight: 'bold', color: '#0f172a', borderBottom: '1px solid #cbd5e1', paddingBottom: '4px', marginBottom: '12px' }}>
                  <span>2.</span> CUADRO DE AVANCE DE OBRA ACUMULADO (Fuente: Calibri 9pt)
                </h3>
                {!progressData ? (
                  <div style={{ fontSize: '8.5pt', color: '#94a3b8', fontStyle: 'italic', padding: '20px', border: '1px dashed #cbd5e1', borderRadius: '6px', textAlign: 'center' }}>
                    Configure las fechas de inicio y fin del periodo en el panel lateral para cargar el cuadro de avance.
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto', border: '1px solid #cbd5e1', borderRadius: '6px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '8.5pt', fontFamily: 'Calibri, Arial, sans-serif' }}>
                      <thead>
                        <tr style={{ background: '#f8fafc', borderBottom: '1.5pt solid #cbd5e1', color: '#0f172a', fontWeight: 'bold' }}>
                          <th style={{ padding: '6px 4px', textAlign: 'left', width: '70px', border: '0.5pt solid #cbd5e1' }}>Ítem</th>
                          <th style={{ padding: '6px 4px', textAlign: 'left', border: '0.5pt solid #cbd5e1' }}>Descripción de la Actividad</th>
                          <th style={{ padding: '6px 4px', textAlign: 'center', width: '35px', border: '0.5pt solid #cbd5e1' }}>Unid</th>
                          <th style={{ padding: '6px 4px', textAlign: 'right', width: '60px', border: '0.5pt solid #cbd5e1' }}>Cant Cont</th>
                          <th style={{ padding: '6px 4px', textAlign: 'right', width: '80px', border: '0.5pt solid #cbd5e1' }}>Vlr. Unit</th>
                          <th style={{ padding: '6px 4px', textAlign: 'right', width: '100px', border: '0.5pt solid #cbd5e1' }}>Vlr. Total</th>
                          <th style={{ padding: '6px 4px', textAlign: 'right', width: '60px', border: '0.5pt solid #cbd5e1' }}>Cant Ejec</th>
                          <th style={{ padding: '6px 4px', textAlign: 'right', width: '100px', border: '0.5pt solid #cbd5e1' }}>Vlr. Ejec</th>
                          <th style={{ padding: '6px 4px', textAlign: 'right', width: '60px', border: '0.5pt solid #cbd5e1' }}>% Avance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {progressData.tableRows.map((row, idx) => {
                          if (row.isTitle) {
                            return (
                              <tr key={idx} style={{ background: '#eaeaea', fontWeight: 'bold', borderBottom: '0.5pt solid #cbd5e1' }}>
                                <td colSpan={9} style={{ padding: '6px', fontSize: '9pt', color: '#1e293b', border: '0.5pt solid #cbd5e1' }}>
                                  {row.item} {row.description.toUpperCase()}
                                </td>
                              </tr>
                            );
                          }

                          // Resaltar Nuevos Precios (NPs)
                          const isNP = row.item?.toUpperCase().startsWith('NP');

                          return (
                            <tr key={idx} style={{ borderBottom: '0.5pt solid #f1f5f9', background: isNP ? 'rgba(202, 253, 0, 0.05)' : '#ffffff' }}>
                              <td style={{ padding: '5px 4px', fontWeight: 'bold', border: '0.5pt solid #cbd5e1' }}>
                                {row.item}
                                {isNP && <span style={{ fontSize: '6pt', background: '#000', color: '#CAFD00', padding: '1px 3px', borderRadius: '3px', marginLeft: '3px' }}>NP</span>}
                              </td>
                              <td style={{ padding: '5px 4px', border: '0.5pt solid #cbd5e1' }}>{row.description}</td>
                              <td style={{ padding: '5px 4px', textAlign: 'center', border: '0.5pt solid #cbd5e1' }}>{row.unit}</td>
                              <td style={{ padding: '5px 4px', textAlign: 'right', border: '0.5pt solid #cbd5e1' }}>{fmtQty(row.contractedQty)}</td>
                              <td style={{ padding: '5px 4px', textAlign: 'right', border: '0.5pt solid #cbd5e1' }}>{fmtCurrency(row.unitPrice)}</td>
                              <td style={{ padding: '5px 4px', textAlign: 'right', border: '0.5pt solid #cbd5e1' }}>{fmtCurrency(row.contractedTotal)}</td>
                              <td style={{ padding: '5px 4px', textAlign: 'right', fontWeight: row.acumQty > 0 ? 'bold' : 'normal', border: '0.5pt solid #cbd5e1' }}>{fmtQty(row.acumQty)}</td>
                              <td style={{ padding: '5px 4px', textAlign: 'right', border: '0.5pt solid #cbd5e1' }}>{fmtCurrency(row.acumValue)}</td>
                              <td style={{ padding: '5px 4px', textAlign: 'right', color: '#2563eb', fontWeight: 'bold', border: '0.5pt solid #cbd5e1' }}>{fmtPct(row.pctExecution)}</td>
                            </tr>
                          );
                        })}
                        
                        {/* Costo Directo */}
                        <tr style={{ background: '#f8fafc', borderTop: '1.5pt solid #cbd5e1', fontWeight: 'bold', color: '#0f172a' }}>
                          <td style={{ padding: '6px 4px', border: '0.5pt solid #cbd5e1' }} colSpan={2}>SUBTOTAL COSTO DIRECTO</td>
                          <td colSpan={3} style={{ border: '0.5pt solid #cbd5e1' }}></td>
                          <td style={{ padding: '6px 4px', textAlign: 'right', border: '0.5pt solid #cbd5e1' }}>{fmtCurrency(progressData.costoDirectoContratado)}</td>
                          <td style={{ border: '0.5pt solid #cbd5e1' }}></td>
                          <td style={{ padding: '6px 4px', textAlign: 'right', border: '0.5pt solid #cbd5e1' }}>{fmtCurrency(progressData.costoDirectoEjecutado)}</td>
                          <td style={{ padding: '6px 4px', textAlign: 'right', color: '#10b981', border: '0.5pt solid #cbd5e1' }}>{fmtPct(progressData.pctCostoDirecto)}</td>
                        </tr>

                        {/* AIU */}
                        <tr style={{ background: '#f8fafc', fontWeight: 'bold', color: '#0f172a' }}>
                          <td style={{ padding: '6px 4px', border: '0.5pt solid #cbd5e1' }} colSpan={2}>AIU (${progressData.aiuPct || 0}%)</td>
                          <td colSpan={3} style={{ border: '0.5pt solid #cbd5e1' }}></td>
                          <td style={{ padding: '6px 4px', textAlign: 'right', border: '0.5pt solid #cbd5e1' }}>{fmtCurrency(progressData.aiuContratado)}</td>
                          <td style={{ border: '0.5pt solid #cbd5e1' }}></td>
                          <td style={{ padding: '6px 4px', textAlign: 'right', border: '0.5pt solid #cbd5e1' }}>{fmtCurrency(progressData.aiuEjecutado)}</td>
                          <td style={{ padding: '6px 4px', textAlign: 'right', color: '#10b981', border: '0.5pt solid #cbd5e1' }}>{fmtPct(progressData.pctAiu)}</td>
                        </tr>

                        {/* Total General (EV / PV) */}
                        <tr style={{ background: '#f1f5f9', borderTop: '2px solid #94a3b8', fontWeight: 'bold', color: '#0f172a', fontSize: '9pt' }}>
                          <td style={{ padding: '8px 4px', border: '0.5pt solid #cbd5e1' }} colSpan={2}>TOTAL DE OBRA (CON AIU)</td>
                          <td colSpan={3} style={{ border: '0.5pt solid #cbd5e1' }}></td>
                          <td style={{ padding: '8px 4px', textAlign: 'right', border: '0.5pt solid #cbd5e1' }}>{fmtCurrency(progressData.totalContratado)}</td>
                          <td style={{ border: '0.5pt solid #cbd5e1' }}></td>
                          <td style={{ padding: '8px 4px', textAlign: 'right', border: '0.5pt solid #cbd5e1' }}>{fmtCurrency(progressData.totalEjecutado)}</td>
                          <td style={{ padding: '8px 4px', textAlign: 'right', color: '#10b981', fontSize: '10pt', border: '0.5pt solid #cbd5e1' }}>{fmtPct(progressData.pctTotal)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* 3. Sección Curva S */}
              <div style={{ marginBottom: '28px' }}>
                <h3 style={{ fontSize: '10pt', fontWeight: 'bold', color: '#0f172a', borderBottom: '1px solid #cbd5e1', paddingBottom: '4px', marginBottom: '12px' }}>
                  <span>3.</span> GRÁFICOS DE CONTROL Y AVANCE (CURVA S) (Fuente: Arial 10.5pt)
                </h3>
                {!dateEndStr ? (
                  <div style={{ fontSize: '8.5pt', color: '#94a3b8', fontStyle: 'italic', padding: '20px', border: '1px dashed #cbd5e1', borderRadius: '6px', textAlign: 'center' }}>
                    Configure las fechas de inicio y fin del periodo en el panel lateral para cargar las gráficas de control.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
                      <div style={{ width: '100%', maxWidth: '480px' }}>
                        <SvgCurveS
                          project={project}
                          dateEndStr={dateEndStr}
                          chartConfig={chartConfig}
                          granularity={granularity}
                          showStatusLine={showStatusLine}
                          visibleCurves={visibleCurves}
                          onRender={setCurveS1Base64}
                        />
                      </div>
                    </div>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid #cbd5e1', paddingTop: '12px', width: '100%' }}>
                      <textarea
                        value={sCurveCaption}
                        onChange={e => handleSCurveCaptionChange(e.target.value)}
                        placeholder="Escriba aquí los comentarios analíticos sobre la curva S..."
                        style={{
                          width: '100%',
                          minHeight: '80px',
                          padding: '12px',
                          fontSize: '10pt',
                          fontFamily: 'Arial, sans-serif',
                          border: '1px solid #cbd5e1',
                          borderRadius: '6px',
                          resize: 'vertical',
                          lineHeight: '1.5',
                          outline: 'none',
                          color: '#0f172a'
                        }}
                      />
                      <div style={{
                        fontSize: '7.5pt',
                        color: '#64748b',
                        textAlign: 'right',
                        marginTop: '4px'
                      }}>
                        Conteo de caracteres: {sCurveCaption.length} | Persistido en caliente
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* 4. Registro Fotográfico (Rejilla de Edición) */}
              <div style={{ marginBottom: '28px' }}>
                <h3 style={{ fontSize: '10pt', fontWeight: 'bold', color: '#0f172a', borderBottom: '1px solid #cbd5e1', paddingBottom: '4px', marginBottom: '12px' }}>
                  <span>4.</span> REGISTRO FOTOGRÁFICO DE AVANCE (REJILLA DE EDICIÓN)
                </h3>
                
                {activePhotos.length === 0 && excludedPhotos.length === 0 ? (
                  <div style={{ fontSize: '8.5pt', color: '#94a3b8', fontStyle: 'italic', padding: '12px 0', textAlign: 'center' }}>
                    No se registran fotos de avance de obra integradas en este rango de fechas.
                  </div>
                ) : (
                  <div>
                    {activePhotos.length > 0 ? (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '12px' }}>
                        {activePhotos.map((p, idx) => (
                          <div 
                            key={p.id} 
                            style={{ 
                              border: '1px solid #cbd5e1', 
                              padding: '10px', 
                              borderRadius: '8px', 
                              background: '#f8fafc',
                              position: 'relative',
                              display: 'flex',
                              flexDirection: 'column'
                            }}
                          >
                            <div style={{ height: '140px', background: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px', overflow: 'hidden' }}>
                              {p.imageUrl ? (
                                <img src={p.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              ) : (
                                <Eye size={20} style={{ color: '#94a3b8' }} />
                              )}
                            </div>

                            <button
                              onClick={() => handleExcludePhoto(p.id)}
                              style={{
                                position: 'absolute',
                                top: '15px',
                                right: '15px',
                                background: 'rgba(239, 68, 68, 0.95)',
                                color: '#ffffff',
                                border: 'none',
                                borderRadius: '50%',
                                width: '24px',
                                height: '24px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: 'pointer',
                                boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                                transition: 'all 0.2s',
                                zIndex: 10
                              }}
                              title="Excluir del reporte"
                              onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.1)'}
                              onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                            >
                              <X size={12} />
                            </button>

                            <div style={{ padding: '8px 2px 0 2px', flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '7.5pt', fontWeight: 'bold', color: '#1e293b' }}>
                                <span>Foto No. {idx + 1}</span>
                                <span style={{ color: '#2563eb' }}>{p.itemCode ? `Ítem ${p.itemCode}` : 'General'}</span>
                              </div>
                              <div style={{ fontSize: '8pt', color: '#334155', lineHeight: '1.3', fontStyle: 'italic', wordBreak: 'break-word' }}>
                                {p.description || "Sin descripción"}
                              </div>
                              <div style={{ fontSize: '7pt', color: '#64748b', textAlign: 'right', marginTop: 'auto' }}>
                                {p.date}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ fontSize: '8.5pt', color: '#ef4444', fontStyle: 'italic', padding: '16px', background: 'rgba(239, 68, 68, 0.05)', border: '1px dashed rgba(239, 68, 68, 0.3)', borderRadius: '6px', textAlign: 'center' }}>
                        Has excluido todas las fotos disponibles de este mes.
                      </div>
                    )}

                    {/* Sección de fotos excluidas para restaurar */}
                    {excludedPhotos.length > 0 && (
                      <div style={{ marginTop: '24px', borderTop: '1px dashed #cbd5e1', paddingTop: '16px' }}>
                        <div style={{ fontSize: '7.5pt', fontWeight: 'bold', color: '#e11d48', letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: '8px' }}>
                          Fotos Excluidas de este reporte ({excludedPhotos.length})
                        </div>
                        <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', padding: '4px 0' }} className="custom-scrollbar">
                          {excludedPhotos.map((p) => (
                            <div 
                              key={p.id} 
                              style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: '8px', 
                                padding: '6px', 
                                border: '1px solid #fda4af', 
                                borderRadius: '6px', 
                                background: '#fff1f2', 
                                flexShrink: 0,
                                width: '180px'
                              }}
                            >
                              <div style={{ width: '40px', height: '40px', background: '#cbd5e1', borderRadius: '3px', overflow: 'hidden', flexShrink: 0 }}>
                                <img src={p.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              </div>
                              <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column' }}>
                                <span style={{ fontSize: '7pt', fontWeight: 'bold', color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {p.description || "Sin descripción"}
                                </span>
                                <button
                                  onClick={() => handleRestorePhoto(p.id)}
                                  style={{
                                    background: 'none',
                                    border: 'none',
                                    color: '#e11d48',
                                    fontSize: '7pt',
                                    fontWeight: 'bold',
                                    cursor: 'pointer',
                                    padding: '2px 0',
                                    textAlign: 'left',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '2px'
                                  }}
                                >
                                  <RefreshCw size={8} /> Incluir
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

            </div>

          </div>

        </main>
      </div>

      {showSaveModal && (
        <div style={{
          position: 'fixed', inset: 0,
          background: 'rgba(15, 23, 42, 0.75)',
          backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 100001
        }}>
          <div style={{
            background: 'hsl(var(--bg-secondary))',
            border: '1px solid var(--border-color)',
            borderRadius: '12px',
            padding: '24px',
            width: '400px',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
            display: 'flex', flexDirection: 'column', gap: '16px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 'bold', color: 'hsl(var(--text-primary))', fontFamily: 'var(--font-technical)' }}>
                Guardar Informe Ejecutivo
              </h3>
              <button onClick={() => setShowSaveModal(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'hsl(var(--text-muted))' }}>
                <X size={16} />
              </button>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={labelStyle}>Nombre del Informe</label>
              <input
                type="text"
                value={reportNameInput}
                onChange={e => setReportNameInput(e.target.value)}
                placeholder="Ej: Informe Ejecutivo Junio 2026"
                style={{ ...inputStyle, width: '100%' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
              <button
                onClick={() => setShowSaveModal(false)}
                className="btn btn-secondary"
                style={{ height: '32px', fontSize: '0.75rem', fontWeight: 'bold' }}
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveNewReport}
                className="btn btn-primary"
                style={{ height: '32px', fontSize: '0.75rem', fontWeight: 'bold', background: 'hsl(var(--primary-neon))', color: '#000' }}
              >
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}
      
    </div>
  );
}
