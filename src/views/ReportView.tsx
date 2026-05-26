import { useState, useMemo, useEffect, useRef } from 'react';
import { useProjects } from '../context/ProjectsContext';
import { Activity, DollarSign, Zap, Clock, Download, Eye, EyeOff, X, Settings } from 'lucide-react';
import { exportToExcel } from '../utils/excelExport';
import { format, parseISO, differenceInDays, isBefore, isAfter, eachWeekOfInterval, eachMonthOfInterval, max, isValid, isSameDay } from 'date-fns';
import { es } from 'date-fns/locale';

const DEFAULT_CHART_CONFIG = {
  axisFontSize: 10,
  labelFontSize: 9,
  axisColor: '#94a3b8', // slate-400
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

export default function ReportView() {
  const { getActiveProject, updateProject } = useProjects();
  const project = getActiveProject();
  const [granularity, setGranularity] = useState<'weeks' | 'months'>('weeks');
  const [statusDate, setStatusDate] = useState<string>('');

  // Persistencia de estados de visualización
  const [showStatusLine, setShowStatusLine] = useState(project?.showStatusLine ?? true);
  const [visibleCurves, setVisibleCurves] = useState(project?.visibleCurves ?? { planned: true, executed: true, financial: true });

  // Estado del personalizador de gráfico
  const [showCustomizer, setShowCustomizer] = useState(false);
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

  const toggleStatusLine = () => {
    const newVal = !showStatusLine;
    setShowStatusLine(newVal);
    if (project) updateProject(project.id, { showStatusLine: newVal });
  };

  const toggleCurve = (key: 'planned' | 'executed' | 'financial') => {
    const newVisible = { ...visibleCurves, [key]: !visibleCurves[key] };
    setVisibleCurves(newVisible);
    if (project) updateProject(project.id, { visibleCurves: newVisible });
  };

  // Estado para el arrastre de etiquetas
  const [dragState, setDragState] = useState<{ id: string, startX: number, startY: number, initialOffset: { x: number, y: number } } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (project?.progressReports?.length) {
      const sorted = [...project.progressReports].sort((a, b) =>
        parseISO(b.date).getTime() - parseISO(a.date).getTime()
      );
      setStatusDate(sorted[0].date);
    }
  }, [project?.id]);

  const reportData = useMemo(() => {
    if (!project) return null;

    const startDateStr = project.startDate;
    const duration = project.durationMonths;

    if (!startDateStr || isNaN(duration)) return { error: 'CONFIG_MISSING' };

    // --- VERSION-AWARE BUDGET ITEMS ---
    const activeVersion = project.budgetVersions?.find(v => v.id === project.activeBudgetVersionId);
    const budgetItems = activeVersion?.items || project.budgetItems || [];


    // Obtener fechas clave
    const globalStart = parseISO(startDateStr);
    // Calcular fin considerando meses fraccionales (30.44 días por mes promedio)
    const totalDaysDuration = Math.round(duration * 30.4375);
    const globalEnd = new Date(globalStart);
    globalEnd.setDate(globalEnd.getDate() + totalDaysDuration);

    const reports = project.progressReports || [];
    const reportDates = reports.map(r => parseISO(r.date));
    const lastReportDate = reportDates.length > 0 ? max(reportDates) : null;

    if (!isValid(globalStart) || !isValid(globalEnd)) return { error: 'INVALID_DATES' };

    let intervals: Date[] = [];
    try {
      const rawIntervals = granularity === 'weeks'
        ? eachWeekOfInterval({ start: globalStart, end: globalEnd })
        : eachMonthOfInterval({ start: globalStart, end: globalEnd });

      // Forzar que inicie, termine e INCLUYA el último reporte
      intervals = [
        globalStart,
        ...rawIntervals.filter(d => isAfter(d, globalStart) && isBefore(d, globalEnd)),
        globalEnd
      ];

      if (lastReportDate && isAfter(lastReportDate, globalStart) && isBefore(lastReportDate, globalEnd)) {
        intervals.push(lastReportDate);
      }

      // FORZAR punto en la fecha de estado para que la línea de la curva pase exactamente por el punto calculado
      const sDateObj = statusDate ? parseISO(statusDate) : null;
      if (sDateObj && isValid(sDateObj) && isAfter(sDateObj, globalStart) && isBefore(sDateObj, globalEnd)) {
        intervals.push(sDateObj);
      }


      // Limpiar duplicados y ordenar cronológicamente
      intervals = intervals.filter((d, i) => intervals.findIndex(x => isSameDay(x, d)) === i);
      intervals.sort((a, b) => a.getTime() - b.getTime());
    } catch (e) {
      return { error: 'INTERVAL_ERROR' };
    }

    if (intervals.length === 0) return { error: 'NO_INTERVALS' };

    // Multiplicador AIU (con protección contra valores nulos)
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

        // Usar T12:00:00 para evitar desfases de zona horaria
        const start = new Date(item.startDate + 'T12:00:00');
        const end = new Date(item.endDate + 'T12:00:00');
        // Normalizar la fecha objetivo a medio día para consistencia
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

      // A. Valor Programado (PV) - Cálculo Exacto
      const plannedValueTotal = getExactPlannedValue(date);

      // B. Valor Ejecutado (EV)
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

      // C. Valor Financiero (FI) - Cálculo Real de Actas Parciales
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

    const scheduledBudget = budgetItems.reduce((acc, item) =>
      (item.type === 'item' && item.startDate && item.endDate) ? acc + item.vlrTotal : acc, 0
    );
    const schedulingCoverage = (scheduledBudget / (baseValue || 1)) * 100;


    return {
      chartData,
      totalContractValue: (baseValue || 1) * aiuFactor,
      schedulingCoverage
    };
  }, [project, granularity]);

  if (!project) return null;

  if (reportData && 'error' in reportData) {
    return (
      <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', color: 'hsl(var(--text-muted))', textAlign: 'center', padding: '40px', flexDirection: 'column', gap: '16px' }}>
        <Activity size={48} opacity={0.2} />
        <div>
          <h3 style={{ color: 'hsl(var(--text-primary))', marginBottom: '8px' }}>CONFIGURACIÓN INCOMPLETA</h3>
          <p style={{ fontSize: '0.8rem', maxWidth: '400px', lineHeight: '1.5' }}>
            Para generar la Curva S, asegúrese de:<br />
            1. Definir la <b>Fecha de Inicio</b> y <b>Plazo (Meses)</b> en el proyecto.<br />
            2. Tener ítems con fechas de inicio y fin en el presupuesto.<br />
            3. Que la fecha de inicio sea anterior al fin del plazo.
          </p>
        </div>
      </div>
    );
  }

  if (!reportData || reportData.chartData.length < 2) {
    return (
      <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', color: 'hsl(var(--text-muted))', textAlign: 'center', padding: '40px' }}>
        DATOS INSUFICIENTES PARA GRAFICAR.
      </div>
    );
  }

  const { chartData, totalContractValue, schedulingCoverage } = reportData;

  // Dimensiones
  const width = 1000;
  const height = 500;
  const paddingX = 80;
  const paddingYTop = 50;
  const paddingYBottom = 60;
  const chartWidth = width - paddingX * 2;
  const chartHeight = height - paddingYTop - paddingYBottom;

  const globalStart = chartData[0].date;
  const globalEnd = chartData[chartData.length - 1].date;
  const totalDays = Math.max(1, differenceInDays(globalEnd, globalStart));

  const getXFromDate = (date: Date) => {
    const days = differenceInDays(date, globalStart);
    const ratio = Math.max(0, Math.min(1, days / totalDays));
    return paddingX + ratio * chartWidth;
  };

  const getY = (val: number) => {
    const safeVal = isNaN(val) ? 0 : val;
    return height - paddingYBottom - (Math.min(105, safeVal) / 100) * chartHeight;
  };

  const getInterpolatedValue = (date: Date, key: 'planned' | 'executed' | 'financial') => {
    const start = chartData[0].date;
    const end = chartData[chartData.length - 1].date;

    if (isBefore(date, start)) return 0;

    // Si es PROGRAMADO, usamos el cálculo exacto ítem por ítem para ser 100% consistentes con el resumen
    if (key === 'planned') {
      const aiu = project.aiu || { administracion: 0, imprevistos: 0, utilidad: 0 };
      const aiuFactor = 1 + (((aiu.administracion || 0) + (aiu.imprevistos || 0) + (aiu.utilidad || 0)) / 100);

      const activeVersion = project.budgetVersions?.find(v => v.id === project.activeBudgetVersionId);
      const items = activeVersion?.items || project.budgetItems || [];

      let total = 0;
      const normalizedDate = new Date(date);
      normalizedDate.setHours(12, 0, 0, 0);

      items.forEach(item => {
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
      return ((total * aiuFactor) / totalContractValue) * 100;
    }


    if (key === 'executed' || key === 'financial') {
      const validPoints = chartData.filter(d => d[key] !== null);
      if (validPoints.length === 0) return 0;
      const lastValid = validPoints[validPoints.length - 1];
      if (!isBefore(date, lastValid.date)) return lastValid[key] as number;
    }

    if (isAfter(date, end)) return chartData[chartData.length - 1][key] || 0;

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

  const currentPlanned = getInterpolatedValue(statusDate ? parseISO(statusDate) : new Date(), 'planned');
  const currentExecuted = getInterpolatedValue(statusDate ? parseISO(statusDate) : new Date(), 'executed');
  const currentEV = (currentExecuted / 100) * totalContractValue;
  const spi = currentPlanned > 0 ? currentExecuted / currentPlanned : 0;

  const createPath = (key: 'planned' | 'executed' | 'financial') => {
    const validPoints = chartData.filter(d => d[key] !== null);
    if (validPoints.length === 0) return "";
    return validPoints.map((d, i) => {
      return `${i === 0 ? 'M' : 'L'} ${getXFromDate(d.date)} ${getY(d[key] as number)}`;
    }).join(' ');
  };

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(val);

  // --- Lógica de Arrastre ---
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

      // Actualización "optimista" local para suavidad
      // Nota: Aquí actualizamos el proyecto en el contexto. 
      // Si se siente lento, podríamos usar un estado temporal local.
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

  return (
    <div style={{
      display: 'grid',
      gridTemplateRows: 'auto 1fr auto',
      height: 'calc(100% + 48px)',
      margin: '-24px',
      padding: '24px 24px 12px',
      gap: '32px',
      overflow: 'hidden',
      background: 'transparent'
    }}>
      {/* 1. Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '0 12px' }}>
        <div>
          <h2 style={{ fontSize: '1.1rem', fontWeight: '900', letterSpacing: '-0.02em', margin: 0 }}>
            CURVA S <span style={{ color: 'hsl(var(--primary-neon))' }}>CONTROL GERENCIAL</span>
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
            <span style={{ fontSize: '0.6rem', color: 'hsl(var(--text-muted))', fontWeight: 'bold', textTransform: 'uppercase' }}>{project.name}</span>
            <div style={{ width: '4px', height: '4px', borderRadius: '50%', background: 'hsl(var(--border-color))' }}></div>
            <button
              onClick={() => setGranularity(granularity === 'weeks' ? 'months' : 'weeks')}
              style={{
                background: 'hsla(var(--primary-neon-hsl), 0.1)',
                border: '1px solid hsl(var(--primary-neon))',
                color: 'hsl(var(--primary-neon))',
                fontSize: '0.55rem', padding: '1px 6px', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: '4px'
              }}
            >
              <Clock size={10} /> VISTA: {granularity === 'weeks' ? 'SEMANAL' : 'MENSUAL'}
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '12px' }}>
              <span style={{ fontSize: '0.6rem', color: 'hsl(var(--text-muted))', fontWeight: 'bold' }}>FECHA DE ESTADO:</span>
              <input
                type="date"
                value={statusDate}
                onChange={(e) => setStatusDate(e.target.value)}
                style={{
                  background: 'hsla(var(--bg-tertiary), 0.5)',
                  border: '1px solid hsl(var(--border-color))',
                  color: 'hsl(var(--text-primary))',
                  fontSize: '0.65rem',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  outline: 'none',
                  fontFamily: 'monospace'
                }}
              />
            </div>
            <button
              onClick={toggleStatusLine}
              style={{
                background: 'hsla(var(--bg-tertiary), 0.5)',
                border: '1px solid hsl(var(--border-color))',
                color: showStatusLine ? 'hsl(var(--primary-neon))' : 'hsl(var(--text-muted))',
                fontSize: '0.6rem', padding: '2px 8px', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: '4px', marginLeft: '4px'
              }}
              title={showStatusLine ? "Ocultar Línea de Estado" : "Mostrar Línea de Estado"}
            >
              {showStatusLine ? <Eye size={10} /> : <EyeOff size={10} />}
              {showStatusLine ? 'OCULTAR' : 'MOSTRAR'}
            </button>
            <button
              onClick={() => {
                const data = chartData.map(d => ({
                  'Fecha': format(d.date, 'yyyy-MM-dd'),
                  'Prog. (%)': d.planned.toFixed(2),
                  'Ejec. (%)': d.executed !== null ? d.executed.toFixed(2) : '',
                  'Finan. (%)': d.financial !== null ? d.financial.toFixed(2) : '',
                  'Valor Ejec. (EV)': d.evValue
                }));
                exportToExcel(data, `Curva_S_${project.name.replace(/\s+/g, '_')}`, 'Curva S');
              }}
              style={{
                background: 'hsla(var(--bg-tertiary), 0.5)',
                border: '1px solid hsl(var(--border-color))',
                color: 'hsl(var(--text-primary))',
                fontSize: '0.6rem', padding: '2px 8px', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: '4px', marginLeft: '8px'
              }}
            >
              <Download size={10} /> EXPORTAR
            </button>
            <button
              onClick={() => setShowCustomizer(!showCustomizer)}
              style={{
                background: showCustomizer ? 'hsla(var(--primary-neon-hsl), 0.2)' : 'hsla(var(--bg-tertiary), 0.5)',
                border: showCustomizer ? '1px solid hsl(var(--primary-neon))' : '1px solid hsl(var(--border-color))',
                color: showCustomizer ? 'hsl(var(--primary-neon))' : 'hsl(var(--text-primary))',
                fontSize: '0.6rem', padding: '2px 8px', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: '4px', marginLeft: '8px'
              }}
            >
              <Settings size={10} /> PERSONALIZAR
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '16px' }}>
          <MetricSmall label="COBERTURA PROG." value={`${schedulingCoverage.toFixed(1)}%`} color={schedulingCoverage < 100 ? 'hsl(var(--warning))' : 'hsl(var(--success))'} />
          <MetricSmall label="VALOR TOTAL (AIU)" value={formatCurrency(totalContractValue)} />
          <MetricSmall label="EJECUCIÓN FÍSICA" value={`${currentExecuted.toFixed(2)}%`} accent />
          <MetricSmall label="DESEMPEÑO (SPI)" value={spi.toFixed(3)} color={spi >= 1 ? 'hsl(var(--success))' : 'hsl(var(--danger))'} />
        </div>
      </div>

      {/* 2. Main Chart Area */}
      <div className="glass-panel" style={{
        flex: 1,
        minHeight: 0,
        padding: '16px 20px',
        display: 'flex',
        flexDirection: 'row',
        position: 'relative',
        overflow: 'hidden',
        gap: '20px'
      }}>
        {/* Left Side: Chart Content Column */}
        <div style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          position: 'relative'
        }}>
          <div style={{ display: 'flex', gap: '16px', marginBottom: '12px', justifyContent: 'flex-end' }}>
            <LegendItem
              color={chartConfig.plannedColor} label="PROGRAMACIÓN (PV)" dashed={chartConfig.plannedDashArray !== 'none'}
              visible={visibleCurves.planned}
              onClick={() => toggleCurve('planned')}
            />
            <LegendItem
              color={chartConfig.executedColor.startsWith('hsl') ? 'hsl(var(--primary-neon))' : chartConfig.executedColor} label="EJECUCIÓN REAL (EV)"
              visible={visibleCurves.executed}
              onClick={() => toggleCurve('executed')}
            />
            <LegendItem
              color={chartConfig.financialColor} label="FINANCIERO" dashed={chartConfig.financialDashArray !== 'none'}
              visible={visibleCurves.financial}
              onClick={() => toggleCurve('financial')}
            />
          </div>

          <div style={{ flex: 1, width: '100%', position: 'relative', minHeight: 0 }}>
          <svg
            ref={svgRef}
            width="100%" height="100%" viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="xMidYMid meet" style={{ overflow: 'visible' }}
          >
            <defs>
              <filter id="glow-ev" filterUnits="userSpaceOnUse" x="0" y="0" width="1000" height="500">
                <feGaussianBlur stdDeviation={chartConfig.executedGlowRadius} result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
              <filter id="glow-pv" filterUnits="userSpaceOnUse" x="0" y="0" width="1000" height="500">
                <feGaussianBlur stdDeviation={chartConfig.plannedGlowRadius} result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
              <filter id="glow-fi" filterUnits="userSpaceOnUse" x="0" y="0" width="1000" height="500">
                <feGaussianBlur stdDeviation={chartConfig.financialGlowRadius} result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
              <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={chartConfig.executedColor.startsWith('hsl') ? '#c5ff00' : chartConfig.executedColor} stopOpacity={chartConfig.executedFillOpacity} />
                <stop offset="100%" stopColor={chartConfig.executedColor.startsWith('hsl') ? '#c5ff00' : chartConfig.executedColor} stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* 1. Grid Lines (Eje Y - Porcentajes) */}
            {[0, 20, 40, 60, 80, 100].map(val => (
              <g key={`gy-${val}`}>
                {chartConfig.gridVisible && (
                  <line
                    x1={paddingX} y1={getY(val)}
                    x2={width - paddingX} y2={getY(val)}
                    stroke={chartConfig.gridColor} strokeWidth="0.5"
                  />
                )}
                <text x={paddingX - 12} y={getY(val) + 4} textAnchor="end" style={{ fontSize: `${chartConfig.axisFontSize}px`, fill: chartConfig.axisColor, fontWeight: '900', fontFamily: 'monospace' }}>{val}%</text>
              </g>
            ))}

            {/* 2. Grid Lines (Eje X - Intervalos con etiquetas) */}
            {chartConfig.gridVisible && chartData.filter((_, i) => i % Math.max(1, Math.ceil(chartData.length / 8)) === 0 || i === chartData.length - 1).map((d, i) => (
              <line
                key={`gx-${i}`}
                x1={getXFromDate(d.date)} y1={paddingYTop}
                x2={getXFromDate(d.date)} y2={height - paddingYBottom}
                stroke={chartConfig.gridColor}
                strokeWidth="0.5"
              />
            ))}

            {visibleCurves.executed && (() => {
              const lastReportIdx = chartData.findLastIndex(d => d.executed !== null);
              if (lastReportIdx === -1) return null;
              const lastDate = chartData[lastReportIdx].date;
              return <path d={`${createPath('executed')} L ${getXFromDate(lastDate)} ${getY(0)} L ${getXFromDate(globalStart)} ${getY(0)} Z`} fill="url(#areaGradient)" />;
            })()}

            {visibleCurves.planned && (
              <path 
                d={createPath('planned')} 
                fill="none" 
                stroke={chartConfig.plannedColor} 
                strokeWidth={chartConfig.plannedWidth} 
                strokeDasharray={chartConfig.plannedDashArray === 'none' ? undefined : chartConfig.plannedDashArray} 
                filter={chartConfig.plannedGlow ? 'url(#glow-pv)' : undefined}
                opacity="0.8" 
              />
            )}
            {visibleCurves.executed && (
              <path 
                d={createPath('executed')} 
                fill="none" 
                stroke={chartConfig.executedColor.startsWith('hsl') ? 'hsl(var(--primary-neon))' : chartConfig.executedColor} 
                strokeWidth={chartConfig.executedWidth} 
                filter={chartConfig.executedGlow ? 'url(#glow-ev)' : undefined} 
              />
            )}
            {visibleCurves.financial && (
              <path 
                d={createPath('financial')} 
                fill="none" 
                stroke={chartConfig.financialColor} 
                strokeWidth={chartConfig.financialWidth} 
                strokeDasharray={chartConfig.financialDashArray === 'none' ? undefined : chartConfig.financialDashArray} 
                filter={chartConfig.financialGlow ? 'url(#glow-fi)' : undefined}
              />
            )}

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
                      <circle cx={baseX} cy={baseY} r={chartConfig.pointSize > 0 ? chartConfig.pointSize + 0.5 : 3.5} fill={chartConfig.plannedColor} stroke="#fff" strokeWidth="1" filter={chartConfig.plannedGlow ? 'url(#glow-pv)' : undefined} />
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
                        fontWeight: isStatusPoint ? '900' : 'bold',
                        fontFamily: 'monospace',
                        opacity: isStatusPoint ? 1 : 0.8, cursor: 'move', userSelect: 'none'
                      }}
                    >
                      {d.planned.toFixed(2)}%
                    </text>
                  </g>
                );
              });
            })()}

            {visibleCurves.executed && chartData.map((d, i) => {
              if (d.executed === null) return null;
              const lastIdx = chartData.findLastIndex(item => item.executed !== null);
              const prev = i > 0 ? chartData[i - 1] : null;
              const isSignificant = !prev || prev.executed === null || Math.abs(d.executed - prev.executed) > 0.1 || i === lastIdx;
              return (
                <g key={i}>
                  <circle cx={getXFromDate(d.date)} cy={getY(d.executed)} r={i === lastIdx ? (chartConfig.pointSize > 0 ? chartConfig.pointSize + 1 : 4) : (chartConfig.pointSize > 0 ? chartConfig.pointSize : 2)} fill={chartConfig.executedColor.startsWith('hsl') ? 'hsl(var(--primary-neon))' : chartConfig.executedColor} filter={chartConfig.executedGlow ? 'url(#glow-ev)' : undefined} />
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
                            stroke={chartConfig.executedColor.startsWith('hsl') ? 'hsl(var(--primary-neon))' : chartConfig.executedColor} strokeWidth="0.5" strokeDasharray="2 1" opacity="0.6"
                          />
                        )}
                        <text
                          x={baseX + offset.x}
                          y={baseY + 15 + offset.y}
                          textAnchor="middle"
                          onMouseDown={(e) => handleMouseDown(e, `executed-${i}`)}
                          style={{
                            fontSize: `${chartConfig.labelFontSize}px`, fill: chartConfig.executedColor.startsWith('hsl') ? 'hsl(var(--primary-neon))' : chartConfig.executedColor, fontWeight: '900',
                            fontFamily: 'monospace', cursor: 'move', userSelect: 'none'
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

            {visibleCurves.financial && chartData.map((d, i) => {
              if (d.financial === null) return null;
              const prev = i > 0 ? chartData[i - 1] : null;
              const isSignificant = !prev || prev.financial === null || Math.abs(d.financial - prev.financial) > 5 || i === chartData.length - 1;
              if (!isSignificant) return null;
              const offset = getLabelOffset(`financial-${i}`);
              const baseX = getXFromDate(d.date);
              const baseY = getY(d.financial);
              const hasOffset = offset.x !== 0 || offset.y !== 0;

              return (
                <g key={`f-group-${i}`}>
                  {hasOffset && (
                    <line
                      x1={baseX} y1={baseY}
                      x2={baseX + offset.x} y2={baseY + 15 + offset.y}
                      stroke={chartConfig.financialColor} strokeWidth="0.5" strokeDasharray="2 1" opacity="0.6"
                    />
                  )}
                  <text
                    x={baseX + offset.x}
                    y={baseY + 15 + offset.y}
                    textAnchor="middle"
                    onMouseDown={(e) => handleMouseDown(e, `financial-${i}`)}
                    style={{
                      fontSize: `${chartConfig.labelFontSize}px`, fill: chartConfig.financialColor, fontWeight: 'bold', fontFamily: 'monospace',
                      opacity: 0.8, cursor: 'move', userSelect: 'none'
                    }}
                  >
                    {d.financial.toFixed(2)}%
                  </text>
                </g>
              );
            })}

            {statusDate && showStatusLine && isValid(parseISO(statusDate)) && (() => {
              const dateObj = parseISO(statusDate);
              if (isBefore(dateObj, globalStart) || isAfter(dateObj, globalEnd)) return null;
              const xPos = getXFromDate(dateObj);
              const pVal = getInterpolatedValue(dateObj, 'planned');
              const eVal = getInterpolatedValue(dateObj, 'executed');
              const fVal = getInterpolatedValue(dateObj, 'financial');

              // Posiciones base Y
              let pvBaseY = getY(pVal);
              let evBaseY = getY(eVal);
              let fvBaseY = getY(fVal);

              // Lógica de anticolisión automática (solo si no hay offsets manuales)
              const pvOff = getLabelOffset('status-pv');
              const evOff = getLabelOffset('status-ev');
              const fvOff = getLabelOffset('status-fv');

              let pvFinalY = pvBaseY;
              let evFinalY = evBaseY;
              let fvFinalY = fvBaseY;

              if (pvOff.x === 0 && pvOff.y === 0 && evOff.x === 0 && evOff.y === 0 && fvOff.x === 0 && fvOff.y === 0) {
                // Separación simple de 3 puntos
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
                  <g>
                    <rect x={xPos - 45} y={paddingYTop - 45} width="90" height="20" rx="4" fill="hsla(var(--bg-secondary), 0.95)" stroke="hsla(var(--border-color), 0.5)" strokeWidth="0.5" />
                    <text x={xPos - 4} y={paddingYTop - 31} textAnchor="middle" style={{ fontSize: '10px', fill: '#fff', fontWeight: '900', fontFamily: 'monospace' }}>
                      {format(dateObj, 'dd MMM yyyy', { locale: es }).toUpperCase()}
                    </text>

                    {/* Botón X para cerrar/ocultar */}
                    <g
                      onClick={(e) => { e.stopPropagation(); setShowStatusLine(false); }}
                      style={{ cursor: 'pointer' }}
                    >
                      <rect x={xPos + 30} y={paddingYTop - 45} width="15" height="20" rx="0" fill="transparent" />
                      <g transform={`translate(${xPos + 32}, ${paddingYTop - 40})`}>
                        <X size={10} color="hsl(var(--danger))" strokeWidth={3} />
                      </g>
                    </g>
                  </g>

                  <line x1={xPos} y1={paddingYTop - 25} x2={xPos} y2={height - paddingYBottom} stroke="hsl(var(--danger))" strokeWidth="1.5" strokeDasharray="4 2" />
                  <g>
                    {visibleCurves.planned && (
                      <g>
                        <circle cx={xPos} cy={getY(pVal)} r={chartConfig.pointSize > 0 ? chartConfig.pointSize + 2 : 5} fill={chartConfig.plannedColor} stroke="#fff" strokeWidth="1.5" filter={chartConfig.plannedGlow ? 'url(#glow-pv)' : undefined} />

                        {/* Leader Line for PV */}
                        {(pvOff.x !== 0 || pvOff.y !== 0 || pvFinalY !== pvBaseY) && (
                          <line
                            x1={xPos} y1={pvBaseY}
                            x2={xPos + 8 + pvOff.x} y2={pvFinalY + pvOff.y}
                            stroke={chartConfig.plannedColor} strokeWidth="0.5" opacity="0.6"
                          />
                        )}

                        <text
                          x={xPos + 8 + pvOff.x}
                          y={pvFinalY + 4 + pvOff.y}
                          onMouseDown={(e) => handleMouseDown(e, 'status-pv')}
                          style={{
                            fontSize: `${chartConfig.labelFontSize + 2}px`, fill: chartConfig.plannedColor, fontWeight: '900', fontFamily: 'monospace',
                            cursor: 'move', userSelect: 'none'
                          }}
                        >
                          PV: {pVal.toFixed(2)}%
                        </text>
                      </g>
                    )}

                    {visibleCurves.executed && eVal !== null && (
                      <>
                        <circle cx={xPos} cy={getY(eVal)} r={chartConfig.pointSize > 0 ? chartConfig.pointSize + 2 : 5} fill={chartConfig.executedColor.startsWith('hsl') ? 'hsl(var(--primary-neon))' : chartConfig.executedColor} stroke="#fff" strokeWidth="1.5" filter={chartConfig.executedGlow ? 'url(#glow-ev)' : undefined} />

                        {/* Leader Line for EV */}
                        {(evOff.x !== 0 || evOff.y !== 0 || evFinalY !== evBaseY) && (
                          <line
                            x1={xPos} y1={evBaseY}
                            x2={xPos + 8 + evOff.x} y2={evFinalY + evOff.y}
                            stroke={chartConfig.executedColor.startsWith('hsl') ? 'hsl(var(--primary-neon))' : chartConfig.executedColor} strokeWidth="0.5" opacity="0.6"
                          />
                        )}

                        <text
                          x={xPos + 8 + evOff.x}
                          y={evFinalY + 4 + evOff.y}
                          onMouseDown={(e) => handleMouseDown(e, 'status-ev')}
                          style={{
                            fontSize: `${chartConfig.labelFontSize + 2}px`, fill: chartConfig.executedColor.startsWith('hsl') ? 'hsl(var(--primary-neon))' : chartConfig.executedColor, fontWeight: '900', fontFamily: 'monospace',
                            paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.5)', strokeWidth: '2px',
                            cursor: 'move', userSelect: 'none'
                          }}
                        >
                          EV: {eVal.toFixed(2)}%
                        </text>
                      </>
                    )}

                    {visibleCurves.financial && fVal !== null && (
                      <>
                        <circle cx={xPos} cy={fvBaseY} r={chartConfig.pointSize > 0 ? chartConfig.pointSize + 2 : 5} fill={chartConfig.financialColor} stroke="#fff" strokeWidth="1.5" filter={chartConfig.financialGlow ? 'url(#glow-fi)' : undefined} />

                        {/* Leader Line for Financial */}
                        {(fvOff.x !== 0 || fvOff.y !== 0 || fvFinalY !== fvBaseY) && (
                          <line
                            x1={xPos} y1={fvBaseY}
                            x2={xPos + 8 + fvOff.x} y2={fvFinalY + fvOff.y}
                            stroke={chartConfig.financialColor} strokeWidth="0.5" opacity="0.6"
                          />
                        )}

                        <text
                          x={xPos + 8 + fvOff.x}
                          y={fvFinalY + 4 + fvOff.y}
                          onMouseDown={(e) => handleMouseDown(e, 'status-fv')}
                          style={{
                            fontSize: `${chartConfig.labelFontSize + 2}px`, fill: chartConfig.financialColor, fontWeight: '900', fontFamily: 'monospace',
                            paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.5)', strokeWidth: '2px',
                            cursor: 'move', userSelect: 'none'
                          }}
                        >
                          FI: {fVal.toFixed(2)}%
                        </text>
                      </>
                    )}
                  </g>
                </g>
              );
            })()}

            <line x1={paddingX} y1={height - paddingYBottom} x2={width - paddingX} y2={height - paddingYBottom} stroke="hsl(var(--border-color))" strokeWidth="1.5" />

            {(() => {
              const labeledData = chartData.filter((_, i) => i % Math.max(1, Math.ceil(chartData.length / 8)) === 0 || i === chartData.length - 1);

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
                    style={{ fontSize: `${chartConfig.axisFontSize + 1}px`, fill: chartConfig.axisColor, fontWeight: 'bold', fontFamily: 'monospace' }}
                  >
                    {d.label}
                  </text>
                );
              });
            })()}
          </svg>
        </div>
      </div> {/* Closes Left Side: Chart Content Column */}

      {/* Right Side: Excel-style Sidebar Customizer */}
      {showCustomizer && (
        <div className="glass-panel" style={{
          width: '300px',
          minWidth: '300px',
          maxWidth: '300px',
          padding: '14px 18px',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
          borderRadius: 'var(--radius-sm)',
          background: 'hsla(var(--bg-secondary), 0.3)',
          borderLeft: '1px solid hsl(var(--border-color))',
          overflowY: 'auto',
          height: '100%',
          maxHeight: '100%',
          animation: 'fadeInLeft 0.2s ease-out',
          zIndex: 5
        }}>
          {/* Header of Personalizer */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid hsla(var(--border-color), 0.5)', paddingBottom: '6px' }}>
            <h3 style={{ fontSize: '0.7rem', color: 'hsl(var(--primary-neon))', fontWeight: 'bold', letterSpacing: '1px', textTransform: 'uppercase', margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Settings size={11} /> FORMATO DE GRÁFICO
            </h3>
            <button 
              onClick={() => setShowCustomizer(false)}
              style={{ background: 'none', border: 'none', color: 'hsl(var(--text-muted))', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2px' }}
            >
              <X size={12} strokeWidth={2.5} />
            </button>
          </div>

          {/* Scrollable controls */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1, overflowY: 'auto', paddingRight: '4px' }}>
            {/* Section 1: General & Textos */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <h4 style={{ fontSize: '0.6rem', color: 'hsl(var(--text-muted))', fontWeight: '900', letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: '2px' }}>TEXTOS Y CUADRÍCULA</h4>
              
              <div className="input-group" style={{ margin: 0 }}>
                <label className="input-label" style={{ fontSize: '0.55rem', display: 'flex', justifyContent: 'space-between', color: 'hsl(var(--text-secondary))', marginBottom: '2px' }}>
                  <span>Tamaño Texto Ejes</span>
                  <span style={{ fontFamily: 'monospace', color: 'hsl(var(--primary-neon))' }}>{chartConfig.axisFontSize}px</span>
                </label>
                <input 
                  type="range" min="8" max="16" step="0.5"
                  value={chartConfig.axisFontSize}
                  onChange={e => updateChartConfig({ axisFontSize: parseFloat(e.target.value) })}
                  style={{ width: '100%', accentColor: 'hsl(var(--primary-neon))', height: '3px', borderRadius: '1.5px', outline: 'none', cursor: 'pointer' }}
                />
              </div>

              <div className="input-group" style={{ margin: 0 }}>
                <label className="input-label" style={{ fontSize: '0.55rem', display: 'flex', justifyContent: 'space-between', color: 'hsl(var(--text-secondary))', marginBottom: '2px' }}>
                  <span>Tamaño Letra Hitos</span>
                  <span style={{ fontFamily: 'monospace', color: 'hsl(var(--primary-neon))' }}>{chartConfig.labelFontSize}px</span>
                </label>
                <input 
                  type="range" min="8" max="18" step="0.5"
                  value={chartConfig.labelFontSize}
                  onChange={e => updateChartConfig({ labelFontSize: parseFloat(e.target.value) })}
                  style={{ width: '100%', accentColor: 'hsl(var(--primary-neon))', height: '3px', borderRadius: '1.5px', outline: 'none', cursor: 'pointer' }}
                />
              </div>

              <div className="input-group" style={{ margin: 0 }}>
                <label className="input-label" style={{ fontSize: '0.55rem', display: 'flex', justifyContent: 'space-between', color: 'hsl(var(--text-secondary))', marginBottom: '2px' }}>
                  <span>Tamaño de Puntos</span>
                  <span style={{ fontFamily: 'monospace', color: 'hsl(var(--primary-neon))' }}>{chartConfig.pointSize}px</span>
                </label>
                <input 
                  type="range" min="0" max="8" step="0.5"
                  value={chartConfig.pointSize}
                  onChange={e => updateChartConfig({ pointSize: parseFloat(e.target.value) })}
                  style={{ width: '100%', accentColor: 'hsl(var(--primary-neon))', height: '3px', borderRadius: '1.5px', outline: 'none', cursor: 'pointer' }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '2px' }}>
                <span style={{ fontSize: '0.55rem', color: 'hsl(var(--text-secondary))', fontWeight: '500' }}>Mostrar Cuadrícula</span>
                <input 
                  type="checkbox"
                  checked={chartConfig.gridVisible}
                  onChange={e => updateChartConfig({ gridVisible: e.target.checked })}
                  style={{ accentColor: 'hsl(var(--primary-neon))', cursor: 'pointer' }}
                />
              </div>
            </div>

            {/* Section 2: Programada (PV) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', borderTop: '1px solid hsla(var(--border-color), 0.3)', paddingTop: '8px' }}>
              <h4 style={{ fontSize: '0.6rem', color: '#00E5FF', fontWeight: '900', letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: '2px' }}>PROGRAMACIÓN (PV)</h4>
              
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.55rem', color: 'hsl(var(--text-secondary))' }}>Color de Curva</span>
                <input 
                  type="color"
                  value={chartConfig.plannedColor}
                  onChange={e => updateChartConfig({ plannedColor: e.target.value })}
                  style={{ width: '24px', height: '16px', border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}
                />
              </div>

              <div className="input-group" style={{ margin: 0 }}>
                <label className="input-label" style={{ fontSize: '0.55rem', display: 'flex', justifyContent: 'space-between', color: 'hsl(var(--text-secondary))', marginBottom: '2px' }}>
                  <span>Grosor de Línea</span>
                  <span style={{ fontFamily: 'monospace', color: '#00E5FF' }}>{chartConfig.plannedWidth}px</span>
                </label>
                <input 
                  type="range" min="0.5" max="6" step="0.1"
                  value={chartConfig.plannedWidth}
                  onChange={e => updateChartConfig({ plannedWidth: parseFloat(e.target.value) })}
                  style={{ width: '100%', accentColor: '#00E5FF', height: '3px', borderRadius: '1.5px', outline: 'none', cursor: 'pointer' }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.55rem', color: 'hsl(var(--text-secondary))' }}>Estilo de Línea</span>
                <select
                  value={chartConfig.plannedDashArray}
                  onChange={e => updateChartConfig({ plannedDashArray: e.target.value })}
                  style={{
                    background: 'hsla(var(--bg-tertiary), 0.8)',
                    border: '1px solid hsl(var(--border-color))',
                    color: 'hsl(var(--text-primary))',
                    fontSize: '0.55rem',
                    padding: '2px 4px',
                    borderRadius: '4px',
                    outline: 'none',
                    cursor: 'pointer'
                  }}
                >
                  <option value="none">Sólido</option>
                  <option value="4 2">Discontinuo</option>
                  <option value="2 2">Puntos</option>
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.55rem', color: 'hsl(var(--text-secondary))', fontWeight: '500' }}>Brillo (Glow)</span>
                <input 
                  type="checkbox"
                  checked={chartConfig.plannedGlow}
                  onChange={e => updateChartConfig({ plannedGlow: e.target.checked })}
                  style={{ accentColor: '#00E5FF', cursor: 'pointer' }}
                />
              </div>
              
              {chartConfig.plannedGlow && (
                <div className="input-group" style={{ margin: 0 }}>
                  <label className="input-label" style={{ fontSize: '0.5rem', display: 'flex', justifyContent: 'space-between', color: 'hsl(var(--text-secondary))', marginBottom: '2px' }}>
                    <span>Radio de Brillo</span>
                    <span style={{ fontFamily: 'monospace', color: '#00E5FF' }}>{chartConfig.plannedGlowRadius}px</span>
                  </label>
                  <input 
                    type="range" min="1" max="10" step="0.5"
                    value={chartConfig.plannedGlowRadius}
                    onChange={e => updateChartConfig({ plannedGlowRadius: parseFloat(e.target.value) })}
                    style={{ width: '100%', accentColor: '#00E5FF', height: '3px', borderRadius: '1.5px', outline: 'none', cursor: 'pointer' }}
                  />
                </div>
              )}
            </div>

            {/* Section 3: Ejecutada Real (EV) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', borderTop: '1px solid hsla(var(--border-color), 0.3)', paddingTop: '8px' }}>
              <h4 style={{ fontSize: '0.6rem', color: 'hsl(var(--primary-neon))', fontWeight: '900', letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: '2px' }}>EJECUCIÓN REAL (EV)</h4>
              
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.55rem', color: 'hsl(var(--text-secondary))' }}>Color de Curva</span>
                <input 
                  type="color"
                  value={chartConfig.executedColor.startsWith('hsl') ? '#c5ff00' : chartConfig.executedColor}
                  onChange={e => updateChartConfig({ executedColor: e.target.value })}
                  style={{ width: '24px', height: '16px', border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}
                />
              </div>

              <div className="input-group" style={{ margin: 0 }}>
                <label className="input-label" style={{ fontSize: '0.55rem', display: 'flex', justifyContent: 'space-between', color: 'hsl(var(--text-secondary))', marginBottom: '2px' }}>
                  <span>Grosor de Línea</span>
                  <span style={{ fontFamily: 'monospace', color: 'hsl(var(--primary-neon))' }}>{chartConfig.executedWidth}px</span>
                </label>
                <input 
                  type="range" min="1" max="8" step="0.2"
                  value={chartConfig.executedWidth}
                  onChange={e => updateChartConfig({ executedWidth: parseFloat(e.target.value) })}
                  style={{ width: '100%', accentColor: 'hsl(var(--primary-neon))', height: '3px', borderRadius: '1.5px', outline: 'none', cursor: 'pointer' }}
                />
              </div>

              <div className="input-group" style={{ margin: 0 }}>
                <label className="input-label" style={{ fontSize: '0.55rem', display: 'flex', justifyContent: 'space-between', color: 'hsl(var(--text-secondary))', marginBottom: '2px' }}>
                  <span>Opacidad de Relleno</span>
                  <span style={{ fontFamily: 'monospace', color: 'hsl(var(--primary-neon))' }}>{Math.round(chartConfig.executedFillOpacity * 100)}%</span>
                </label>
                <input 
                  type="range" min="0" max="0.3" step="0.01"
                  value={chartConfig.executedFillOpacity}
                  onChange={e => updateChartConfig({ executedFillOpacity: parseFloat(e.target.value) })}
                  style={{ width: '100%', accentColor: 'hsl(var(--primary-neon))', height: '3px', borderRadius: '1.5px', outline: 'none', cursor: 'pointer' }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.55rem', color: 'hsl(var(--text-secondary))', fontWeight: '500' }}>Brillo (Glow)</span>
                <input 
                  type="checkbox"
                  checked={chartConfig.executedGlow}
                  onChange={e => updateChartConfig({ executedGlow: e.target.checked })}
                  style={{ accentColor: 'hsl(var(--primary-neon))', cursor: 'pointer' }}
                />
              </div>

              {chartConfig.executedGlow && (
                <div className="input-group" style={{ margin: 0 }}>
                  <label className="input-label" style={{ fontSize: '0.5rem', display: 'flex', justifyContent: 'space-between', color: 'hsl(var(--text-secondary))', marginBottom: '2px' }}>
                    <span>Radio de Brillo</span>
                    <span style={{ fontFamily: 'monospace', color: 'hsl(var(--primary-neon))' }}>{chartConfig.executedGlowRadius}px</span>
                  </label>
                  <input 
                    type="range" min="1" max="10" step="0.5"
                    value={chartConfig.executedGlowRadius}
                    onChange={e => updateChartConfig({ executedGlowRadius: parseFloat(e.target.value) })}
                    style={{ width: '100%', accentColor: 'hsl(var(--primary-neon))', height: '3px', borderRadius: '1.5px', outline: 'none', cursor: 'pointer' }}
                  />
                </div>
              )}
            </div>

            {/* Section 4: Financiera (FI) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', borderTop: '1px solid hsla(var(--border-color), 0.3)', paddingTop: '8px' }}>
              <h4 style={{ fontSize: '0.6rem', color: '#FFAB00', fontWeight: '900', letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: '2px' }}>FINANCIERA (FI)</h4>
              
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.55rem', color: 'hsl(var(--text-secondary))' }}>Color de Curva</span>
                <input 
                  type="color"
                  value={chartConfig.financialColor}
                  onChange={e => updateChartConfig({ financialColor: e.target.value })}
                  style={{ width: '24px', height: '16px', border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}
                />
              </div>

              <div className="input-group" style={{ margin: 0 }}>
                <label className="input-label" style={{ fontSize: '0.55rem', display: 'flex', justifyContent: 'space-between', color: 'hsl(var(--text-secondary))', marginBottom: '2px' }}>
                  <span>Grosor de Línea</span>
                  <span style={{ fontFamily: 'monospace', color: '#FFAB00' }}>{chartConfig.financialWidth}px</span>
                </label>
                <input 
                  type="range" min="0.5" max="5" step="0.1"
                  value={chartConfig.financialWidth}
                  onChange={e => updateChartConfig({ financialWidth: parseFloat(e.target.value) })}
                  style={{ width: '100%', accentColor: '#FFAB00', height: '3px', borderRadius: '1.5px', outline: 'none', cursor: 'pointer' }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.55rem', color: 'hsl(var(--text-secondary))' }}>Estilo de Línea</span>
                <select
                  value={chartConfig.financialDashArray}
                  onChange={e => updateChartConfig({ financialDashArray: e.target.value })}
                  style={{
                    background: 'hsla(var(--bg-tertiary), 0.8)',
                    border: '1px solid hsl(var(--border-color))',
                    color: 'hsl(var(--text-primary))',
                    fontSize: '0.55rem',
                    padding: '2px 4px',
                    borderRadius: '4px',
                    outline: 'none',
                    cursor: 'pointer'
                  }}
                >
                  <option value="none">Sólido</option>
                  <option value="4 2">Discontinuo</option>
                  <option value="3 3">Puntos</option>
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.55rem', color: 'hsl(var(--text-secondary))', fontWeight: '500' }}>Brillo (Glow)</span>
                <input 
                  type="checkbox"
                  checked={chartConfig.financialGlow}
                  onChange={e => updateChartConfig({ financialGlow: e.target.checked })}
                  style={{ accentColor: '#FFAB00', cursor: 'pointer' }}
                />
              </div>

              {chartConfig.financialGlow && (
                <div className="input-group" style={{ margin: 0 }}>
                  <label className="input-label" style={{ fontSize: '0.5rem', display: 'flex', justifyContent: 'space-between', color: 'hsl(var(--text-secondary))', marginBottom: '2px' }}>
                    <span>Radio de Brillo</span>
                    <span style={{ fontFamily: 'monospace', color: '#FFAB00' }}>{chartConfig.financialGlowRadius}px</span>
                  </label>
                  <input 
                    type="range" min="1" max="10" step="0.5"
                    value={chartConfig.financialGlowRadius}
                    onChange={e => updateChartConfig({ financialGlowRadius: parseFloat(e.target.value) })}
                    style={{ width: '100%', accentColor: '#FFAB00', height: '3px', borderRadius: '1.5px', outline: 'none', cursor: 'pointer' }}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Reset Button */}
          <button
            onClick={resetChartConfig}
            style={{
              marginTop: '6px',
              background: 'hsla(0, 80%, 50%, 0.15)',
              border: '1px solid hsl(0, 80%, 50%)',
              color: 'hsl(0, 80%, 65%)',
              fontSize: '0.55rem',
              padding: '5px 10px',
              borderRadius: '4px',
              fontWeight: 'bold',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              cursor: 'pointer',
              transition: 'all 0.2s',
              width: '100%',
              textAlign: 'center'
            }}
          >
            Restablecer Valores
          </button>
        </div>
      )}
    </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', padding: '0 8px 8px', zIndex: 10 }}>
        <AnalysisCard
          icon={<Activity size={16} />} title="DESEMPEÑO FÍSICO"
          value={currentExecuted >= currentPlanned ? 'ADELANTADO' : 'ATRASADO'}
          color={currentExecuted >= currentPlanned ? 'hsl(var(--success))' : 'hsl(var(--danger))'}
          desc={`Variación: ${(currentExecuted - currentPlanned).toFixed(2)}%`}
        />
        <AnalysisCard
          icon={<DollarSign size={16} />} title="VALOR EJECUTADO (AIU)"
          value={formatCurrency(currentEV)} color="hsl(var(--text-primary))" desc="Costo total con AIU."
        />
        <AnalysisCard
          icon={<Zap size={16} />} title="ÍNDICE SPI"
          value={spi.toFixed(3)} color={spi < 0.85 ? 'hsl(var(--danger))' : 'hsl(var(--success))'}
          desc={spi < 0.85 ? 'Retraso Crítico' : 'Dentro de rangos'}
          semaphore={spi < 0.85 ? 'red' : (spi < 0.95 ? 'yellow' : 'green')}
        />
      </div>
    </div>
  );
}

function MetricSmall({ label, value, color, accent }: { label: string, value: string, color?: string, accent?: boolean }) {
  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{ fontSize: '0.6rem', color: 'hsl(var(--text-muted))', letterSpacing: '0.08em', fontWeight: 'bold' }}>{label}</div>
      <div style={{ fontSize: '1.1rem', fontWeight: '900', color: accent ? 'hsl(var(--primary-neon))' : (color || 'hsl(var(--text-primary))'), fontFamily: 'monospace' }}>{value}</div>
    </div>
  );
}

function LegendItem({ color, label, dashed, visible, onClick }: { color: string, label: string, dashed?: boolean, visible: boolean, onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer',
        transition: 'all 0.2s ease'
      }}
    >
      {visible ? (
        <>
          <div style={{ width: '20px', height: '2.5px', background: color, borderBottom: dashed ? `1px dashed ${color}` : 'none' }}></div>
          <span style={{ fontSize: '0.6rem', fontWeight: '900', color: 'hsl(var(--text-secondary))', letterSpacing: '0.05em' }}>{label}</span>
        </>
      ) : (
        <div style={{
          width: '8px', height: '8px', borderRadius: '50%', background: color,
          boxShadow: `0 0 10px ${color}`, opacity: 0.8
        }}></div>
      )}
    </div>
  );
}

function AnalysisCard({ icon, title, value, color, desc, semaphore }: { icon: any, title: string, value: string, color: string, desc: string, semaphore?: 'red' | 'yellow' | 'green' }) {
  return (
    <div className="glass-panel" style={{ 
      padding: '12px 16px', 
      display: 'flex', 
      gap: '12px', 
      alignItems: 'center', 
      borderRadius: 'var(--radius-sm)' 
    }}>
      <div style={{ color: 'hsl(var(--primary-neon))', opacity: 0.8 }}>{icon}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: '0.55rem', color: 'hsl(var(--text-muted))', fontWeight: 'bold', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{title}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
          <div style={{ fontSize: '0.9rem', fontWeight: '800', color: color, fontFamily: 'monospace' }}>{value}</div>
          <div style={{ fontSize: '0.6rem', color: 'hsl(var(--text-muted))', fontWeight: '500' }}>{desc}</div>
          {semaphore && (
            <div style={{
              width: '8px', height: '8px', borderRadius: '50%',
              background: semaphore === 'red' ? 'hsl(var(--danger))' : (semaphore === 'yellow' ? 'hsl(var(--warning))' : 'hsl(var(--success))'),
              boxShadow: `0 0 8px ${semaphore === 'red' ? 'hsl(var(--danger))' : (semaphore === 'yellow' ? 'hsl(var(--warning))' : 'hsl(var(--success))')}`,
              marginLeft: 'auto'
            }}></div>
          )}
        </div>
      </div>
    </div>
  );
}
