import { useState, useMemo, useRef, useCallback } from 'react';
import { useProjects, globalBlobUrlCache } from '../context/ProjectsContext';
import { photoDB } from '../services/PhotoDatabase';
import {
  X, Settings, FileText, Printer, Plus, Trash2, Save,
  ChevronRight, ChevronLeft, CalendarDays, Users, Building2,
  Eye, Download, CheckCircle2
} from 'lucide-react';
import type { ReportConfig, ReportStaff, BudgetItem, ProgressReport } from '../types/projectTypes';
import { format, parseISO, differenceInDays, isBefore, isAfter, eachMonthOfInterval, startOfMonth, endOfMonth, isWithinInterval } from 'date-fns';
import { es } from 'date-fns/locale';

// ─── Helpers ────────────────────────────────────────────────────

const fmt = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v);

const fmtNum = (v: number) =>
  new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(v);

const MONTHS_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

// ─── Component ──────────────────────────────────────────────────

export default function ReportsView() {
  const { getActiveProject, updateProject, closeProject } = useProjects();
  const project = getActiveProject();

  // Tab state
  const [activeTab, setActiveTab] = useState<'config' | 'generator' | 'preview'>('config');

  // Config form state (local mirror, saved on "Guardar")
  const [config, setConfig] = useState<ReportConfig>(() => project?.reportConfig || {});

  // Generator state
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [signDate, setSignDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [includeSections, setIncludeSections] = useState({
    identification: true,
    personnel: true,
    committees: true,
    correspondence: true,
    progress: true,
    curveS: true,
    activities: true,
    photos: true,
  });

  // Photo cache for preview
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [isLoadingPhotos, setIsLoadingPhotos] = useState(false);

  // Print ref
  const printRef = useRef<HTMLDivElement>(null);

  if (!project) return null;

  // ─── Derived Data ────────────────────────────────────────────

  const activeVersion = project.budgetVersions?.find(v => v.id === project.activeBudgetVersionId);
  const budgetItems = activeVersion?.items || project.budgetItems || [];
  const aiu = project.aiu || { administracion: 0, imprevistos: 0, utilidad: 0 };
  const aiuFactor = 1 + ((aiu.administracion + aiu.imprevistos + aiu.utilidad) / 100);
  const baseValue = budgetItems.reduce((acc, it) => it.type === 'item' ? acc + (it.vlrTotal || 0) : acc, 0);
  const totalContract = baseValue * aiuFactor;

  // Parse selected month
  const [selYear, selMon] = selectedMonth.split('-').map(Number);
  const monthStart = startOfMonth(new Date(selYear, selMon - 1));
  const monthEnd = endOfMonth(new Date(selYear, selMon - 1));
  const monthLabel = `${MONTHS_ES[selMon - 1]} ${selYear}`;

  // Available months from project timeline
  const availableMonths = useMemo(() => {
    if (!project.startDate) return [];
    const start = parseISO(project.startDate);
    const endDate = project.endDate ? parseISO(project.endDate) : new Date();
    const now = new Date();
    const effectiveEnd = isAfter(now, endDate) ? now : endDate;
    try {
      return eachMonthOfInterval({ start, end: effectiveEnd }).map(d => ({
        value: format(d, 'yyyy-MM'),
        label: format(d, 'MMMM yyyy', { locale: es }).toUpperCase()
      }));
    } catch { return []; }
  }, [project.startDate, project.endDate]);

  // ─── Progress Computation ────────────────────────────────────

  const progressData = useMemo(() => {
    const reports = project.progressReports || [];
    // Find the latest report AT or BEFORE month end
    const reportsBeforeEnd = reports
      .filter(r => !isAfter(parseISO(r.date), monthEnd))
      .sort((a, b) => parseISO(b.date).getTime() - parseISO(a.date).getTime());
    const currentReport = reportsBeforeEnd[0] || null;

    // Find the latest report BEFORE month start (previous month accumulated)
    const reportsBeforeStart = reports
      .filter(r => isBefore(parseISO(r.date), monthStart))
      .sort((a, b) => parseISO(b.date).getTime() - parseISO(a.date).getTime());
    const prevReport = reportsBeforeStart[0] || null;

    // Build table rows
    const rows = budgetItems.map((item, idx) => {
      if (item.type !== 'item') {
        return { item, idx, type: item.type as string, isItem: false, cantPres: 0, vlrUnit: 0, vlrTotal: 0, cantAcumAnt: 0, cantAcumAct: 0, cantMes: 0, vlrMes: 0, vlrAcum: 0, pctMes: 0, pctAcum: 0 };
      }

      const cantPres = item.cantidad || 0;
      const vlrUnit = item.vlrUnitario || 0;
      const vlrTotal = item.vlrTotal || 0;

      // Previous accumulated
      const prevEntry = prevReport?.entries.find(e => e.itemCode === item.item);
      const cantAcumAnt = prevEntry?.accumulatedQuantity || 0;

      // Current accumulated
      const curEntry = currentReport?.entries.find(e => e.itemCode === item.item);
      const cantAcumAct = curEntry?.accumulatedQuantity || 0;

      // Month delta
      const cantMes = Math.max(0, cantAcumAct - cantAcumAnt);
      const vlrMes = cantMes * vlrUnit;
      const vlrAcum = cantAcumAct * vlrUnit;

      const pctMes = cantPres > 0 ? (cantMes / cantPres) * 100 : 0;
      const pctAcum = cantPres > 0 ? (cantAcumAct / cantPres) * 100 : 0;

      return { item, idx, type: 'item', isItem: true, cantPres, vlrUnit, vlrTotal, cantAcumAnt, cantAcumAct, cantMes, vlrMes, vlrAcum, pctMes, pctAcum };
    });

    // Totals
    const totalVlrMes = rows.reduce((s, r) => s + r.vlrMes, 0);
    const totalVlrAcum = rows.reduce((s, r) => s + r.vlrAcum, 0);
    const pctEjecutadoMes = baseValue > 0 ? (totalVlrMes / baseValue) * 100 : 0;
    const pctEjecutadoAcum = baseValue > 0 ? (totalVlrAcum / baseValue) * 100 : 0;

    return { rows, totalVlrMes, totalVlrAcum, pctEjecutadoMes, pctEjecutadoAcum, currentReport, prevReport };
  }, [budgetItems, project.progressReports, monthStart, monthEnd, baseValue]);

  // ─── Activities This Month ───────────────────────────────────

  const activitiesThisMonth = useMemo(() => {
    return progressData.rows.filter(r => r.isItem && r.cantMes > 0).map(r => ({
      code: r.item.item,
      description: r.item.descripcion,
      quantity: r.cantMes,
      unit: r.item.unidad,
      percentage: r.pctMes
    }));
  }, [progressData]);

  // ─── Correspondence This Month ──────────────────────────────

  const correspondenceThisMonth = useMemo(() => {
    const files = project.correspondenceFiles || [];
    return files.filter(f => {
      const dateStr = f.metadata?.date || f.uploadDate;
      if (!dateStr) return false;
      try {
        const d = parseISO(dateStr);
        return isWithinInterval(d, { start: monthStart, end: monthEnd });
      } catch { return false; }
    });
  }, [project.correspondenceFiles, monthStart, monthEnd]);

  // ─── Committee Meetings (Actas) ─────────────────────────────

  const committeeMeetings = useMemo(() => {
    const folders = project.correspondenceFolders || [];
    const actaFolderIds = folders
      .filter(f => /acta|comit[eé]/i.test(f.name))
      .map(f => f.id);

    const files = project.correspondenceFiles || [];
    return files.filter(f => {
      if (!actaFolderIds.includes(f.folderId)) return false;
      const dateStr = f.metadata?.date || f.uploadDate;
      if (!dateStr) return false;
      try {
        const d = parseISO(dateStr);
        return isWithinInterval(d, { start: monthStart, end: monthEnd });
      } catch { return false; }
    });
  }, [project.correspondenceFolders, project.correspondenceFiles, monthStart, monthEnd]);

  // ─── Photos This Month ──────────────────────────────────────

  const photosThisMonth = useMemo(() => {
    const entries = project.logiEntries || [];
    return entries.filter(e => {
      if (!e.date) return false;
      try {
        const d = parseISO(e.date);
        return isWithinInterval(d, { start: monthStart, end: monthEnd });
      } catch { return false; }
    });
  }, [project.logiEntries, monthStart, monthEnd]);

  // Load photo blobs for preview
  const loadPhotos = useCallback(async () => {
    setIsLoadingPhotos(true);
    const urls: Record<string, string> = {};
    for (const entry of photosThisMonth) {
      if (globalBlobUrlCache.has(entry.id)) {
        urls[entry.id] = globalBlobUrlCache.get(entry.id)!;
      } else if (entry.isLocal) {
        try {
          const b64 = await photoDB.getPhoto(entry.id);
          if (b64) {
            const blob = await fetch(`data:image/jpeg;base64,${b64}`).then(r => r.blob());
            const url = URL.createObjectURL(blob);
            globalBlobUrlCache.set(entry.id, url);
            urls[entry.id] = url;
          }
        } catch { /* skip */ }
      } else if (entry.imageUrl) {
        urls[entry.id] = entry.imageUrl;
      }
    }
    setPhotoUrls(urls);
    setIsLoadingPhotos(false);
  }, [photosThisMonth]);

  // ─── S-Curve SVG Generator (for print) ──────────────────────

  const curveSSvg = useMemo(() => {
    if (!project.startDate || !project.durationMonths) return null;

    const globalStart = parseISO(project.startDate);
    const totalDaysDuration = Math.round(project.durationMonths * 30.4375);
    const globalEnd = new Date(globalStart);
    globalEnd.setDate(globalEnd.getDate() + totalDaysDuration);

    const reports = project.progressReports || [];

    try {
      const intervals = eachMonthOfInterval({ start: globalStart, end: globalEnd });
      if (intervals.length < 2) return null;

      const W = 700, H = 350;
      const px = 60, pt = 30, pb = 40;
      const cw = W - px * 2, ch = H - pt - pb;

      const totalDays = Math.max(1, differenceInDays(globalEnd, globalStart));
      const getX = (d: Date) => px + (Math.min(1, Math.max(0, differenceInDays(d, globalStart) / totalDays))) * cw;
      const getY = (pct: number) => H - pb - (Math.min(100, pct) / 100) * ch;

      // Calculate planned for each interval
      const getPlanned = (targetDate: Date) => {
        let total = 0;
        budgetItems.forEach(item => {
          if (item.type !== 'item' || item.vlrTotal <= 0 || !item.startDate || !item.endDate) return;
          const s = new Date(item.startDate + 'T12:00:00');
          const e = new Date(item.endDate + 'T12:00:00');
          const now = new Date(targetDate); now.setHours(12, 0, 0, 0);
          if (now >= e) total += item.vlrTotal;
          else if (now >= s) {
            const td = Math.max(1, differenceInDays(e, s) + 1);
            const ed = Math.max(0, differenceInDays(now, s) + 1);
            total += item.vlrTotal * Math.min(1, ed / td);
          }
        });
        return totalContract > 0 ? (total * aiuFactor / totalContract) * 100 : 0;
      };

      // Calculate executed for each interval
      const getExecuted = (targetDate: Date) => {
        const reportsBefore = reports
          .filter(r => !isAfter(parseISO(r.date), targetDate))
          .sort((a, b) => parseISO(b.date).getTime() - parseISO(a.date).getTime());
        if (reportsBefore.length === 0) return 0;
        const latest = reportsBefore[0];
        let val = 0;
        latest.entries.forEach(entry => {
          const item = budgetItems.find(i => i.item === entry.itemCode);
          if (item) val += (entry.accumulatedQuantity || 0) * (item.vlrUnitario || 0);
        });
        return totalContract > 0 ? (val * aiuFactor / totalContract) * 100 : 0;
      };

      const data = intervals.map(d => ({
        date: d,
        planned: getPlanned(d),
        executed: getExecuted(d),
        label: format(d, 'MMM yy', { locale: es }).toUpperCase()
      }));

      // Build paths
      const plannedPath = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${getX(d.date).toFixed(1)} ${getY(d.planned).toFixed(1)}`).join(' ');
      const executedPath = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${getX(d.date).toFixed(1)} ${getY(d.executed).toFixed(1)}`).join(' ');

      // Status line at monthEnd
      const statusX = getX(monthEnd);

      // Grid lines
      const gridY = [0, 20, 40, 60, 80, 100];
      const labelStep = Math.max(1, Math.ceil(data.length / 10));

      return (
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxHeight: '300px' }}>
          {/* Grid */}
          {gridY.map(v => (
            <g key={v}>
              <line x1={px} y1={getY(v)} x2={W - px} y2={getY(v)} stroke="#ccc" strokeWidth="0.5" />
              <text x={px - 8} y={getY(v) + 4} textAnchor="end" style={{ fontSize: '8px', fill: '#666' }}>{v}%</text>
            </g>
          ))}
          {/* X labels */}
          {data.filter((_, i) => i % labelStep === 0 || i === data.length - 1).map((d, i) => (
            <text key={i} x={getX(d.date)} y={H - pb + 14} textAnchor="middle" style={{ fontSize: '7px', fill: '#666' }}>{d.label}</text>
          ))}
          {/* Planned */}
          <path d={plannedPath} fill="none" stroke="#0077B6" strokeWidth="1.5" strokeDasharray="4 2" />
          {/* Executed */}
          <path d={executedPath} fill="none" stroke="#2D6A4F" strokeWidth="2.5" />
          {/* Status line */}
          <line x1={statusX} y1={pt} x2={statusX} y2={H - pb} stroke="#E63946" strokeWidth="1" strokeDasharray="3 2" />
          <text x={statusX} y={pt - 5} textAnchor="middle" style={{ fontSize: '7px', fill: '#E63946', fontWeight: 'bold' }}>CORTE</text>
          {/* Legend */}
          <line x1={px + 10} y1={15} x2={px + 30} y2={15} stroke="#0077B6" strokeWidth="1.5" strokeDasharray="4 2" />
          <text x={px + 34} y={18} style={{ fontSize: '8px', fill: '#333' }}>Programado</text>
          <line x1={px + 110} y1={15} x2={px + 130} y2={15} stroke="#2D6A4F" strokeWidth="2.5" />
          <text x={px + 134} y={18} style={{ fontSize: '8px', fill: '#333' }}>Ejecutado</text>
        </svg>
      );
    } catch { return null; }
  }, [project, budgetItems, aiuFactor, totalContract, monthEnd]);

  // ─── Save Config ─────────────────────────────────────────────

  const saveConfig = () => {
    updateProject(project.id, { reportConfig: config });
  };

  // ─── Staff Management ────────────────────────────────────────

  const addStaff = (key: 'personalObra' | 'personalInterventoria') => {
    const current = config[key] || [];
    setConfig({ ...config, [key]: [...current, { name: '', idCard: '', role: '' }] });
  };

  const removeStaff = (key: 'personalObra' | 'personalInterventoria', idx: number) => {
    const current = [...(config[key] || [])];
    current.splice(idx, 1);
    setConfig({ ...config, [key]: current });
  };

  const updateStaff = (key: 'personalObra' | 'personalInterventoria', idx: number, field: keyof ReportStaff, value: string) => {
    const current = [...(config[key] || [])];
    current[idx] = { ...current[idx], [field]: value };
    setConfig({ ...config, [key]: current });
  };

  // ─── Switch to Preview & Load Photos ─────────────────────────

  const goToPreview = async () => {
    setActiveTab('preview');
    await loadPhotos();
  };

  // ─── Print ───────────────────────────────────────────────────

  const handlePrint = () => {
    window.print();
  };

  // ─── Styles ──────────────────────────────────────────────────

  const tabStyle = (isActive: boolean): React.CSSProperties => ({
    padding: '10px 20px',
    fontSize: '0.75rem',
    fontWeight: isActive ? 800 : 500,
    fontFamily: 'var(--font-technical)',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    cursor: 'pointer',
    background: isActive ? 'hsla(var(--primary-neon-hsl), 0.12)' : 'transparent',
    border: 'none',
    borderBottom: isActive ? '2px solid hsl(var(--primary-neon))' : '2px solid transparent',
    color: isActive ? 'hsl(var(--primary-neon))' : 'hsl(var(--text-secondary))',
    transition: 'all 0.25s ease',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  });

  const labelStyle: React.CSSProperties = {
    fontSize: '0.65rem',
    fontWeight: 700,
    color: 'hsl(var(--text-muted))',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    marginBottom: '4px',
  };

  const inputStyle: React.CSSProperties = {
    background: 'hsl(var(--bg-primary))',
    border: '1px solid hsl(var(--border-color))',
    color: 'hsl(var(--text-primary))',
    padding: '8px 12px',
    borderRadius: 'var(--radius-sm)',
    fontSize: '0.8rem',
    width: '100%',
    outline: 'none',
    transition: 'border-color 0.2s',
    fontFamily: 'var(--font-body)',
  };

  const sectionCardStyle: React.CSSProperties = {
    background: 'var(--surface-glass)',
    backdropFilter: 'var(--glass-blur)',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-md)',
    padding: '20px',
    marginBottom: '16px',
  };

  // ═══════════════════════════════════════════════════════════════
  //  RENDER
  // ═══════════════════════════════════════════════════════════════

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* ─── Header ─────────────────────────────────────────── */}
      <div className="page-header" style={{ flexShrink: 0 }}>
        <div>
          <h2 className="page-title" style={{ fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <FileText size={22} style={{ color: 'hsl(var(--primary-neon))' }} />
            INFORME MENSUAL DE INTERVENTORÍA
          </h2>
          <span style={{ fontSize: '0.65rem', color: 'hsl(var(--text-muted))', fontWeight: 600, letterSpacing: '0.05em' }}>
            Generador Automatizado · {project.name}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {activeTab === 'preview' && (
            <button className="btn btn-primary" onClick={handlePrint} style={{ fontSize: '0.7rem', padding: '6px 16px' }}>
              <Printer size={14} /> IMPRIMIR PDF
            </button>
          )}
          <div style={{ width: '1px', height: '24px', background: 'var(--border-color)', margin: '0 8px', opacity: 0.3 }} />
          <button
            className="btn btn-ghost"
            onClick={closeProject}
            title="Cerrar Proyecto"
            style={{ color: 'hsl(var(--text-muted))', padding: '8px', borderRadius: '50%' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'hsl(var(--text-primary))'; e.currentTarget.style.background = 'hsla(var(--text-primary), 0.1)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'hsl(var(--text-muted))'; e.currentTarget.style.background = 'none'; }}
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* ─── Tabs ───────────────────────────────────────────── */}
      <div style={{
        display: 'flex',
        gap: '0',
        borderBottom: '1px solid var(--border-color)',
        marginBottom: '16px',
        flexShrink: 0,
      }}>
        <button style={tabStyle(activeTab === 'config')} onClick={() => setActiveTab('config')}>
          <Settings size={14} /> Configuración
        </button>
        <button style={tabStyle(activeTab === 'generator')} onClick={() => setActiveTab('generator')}>
          <CalendarDays size={14} /> Generador
        </button>
        <button style={tabStyle(activeTab === 'preview')} onClick={goToPreview}>
          <Eye size={14} /> Vista Previa
        </button>
      </div>

      {/* ─── Tab Content ────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: 'auto', paddingBottom: '20px' }}>

        {/* ═══════════ TAB 1: CONFIGURACIÓN ═══════════ */}
        {activeTab === 'config' && (
          <div style={{ maxWidth: '900px' }}>

            {/* Datos del Contrato de Obra */}
            <div style={sectionCardStyle}>
              <h3 style={{ fontSize: '0.8rem', fontWeight: 800, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px', color: 'hsl(var(--text-primary))' }}>
                <Building2 size={16} style={{ color: 'hsl(var(--primary-neon))' }} />
                DATOS DEL CONTRATO DE OBRA
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <div style={labelStyle}>Objeto del Contrato</div>
                  <textarea
                    value={config.objetoObra || ''}
                    onChange={e => setConfig({ ...config, objetoObra: e.target.value })}
                    style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }}
                    placeholder="Descripción del objeto contractual..."
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div>
                    <div style={labelStyle}>Contratista de Obra</div>
                    <input style={inputStyle} value={config.contratistaObra || ''} onChange={e => setConfig({ ...config, contratistaObra: e.target.value })} placeholder="Nombre o razón social" />
                  </div>
                  <div>
                    <div style={labelStyle}>NIT Contratista Obra</div>
                    <input style={inputStyle} value={config.nitObra || ''} onChange={e => setConfig({ ...config, nitObra: e.target.value })} placeholder="NIT" />
                  </div>
                </div>
                <div>
                  <div style={labelStyle}>Representante Legal (Obra)</div>
                  <input style={inputStyle} value={config.repLegalObra || ''} onChange={e => setConfig({ ...config, repLegalObra: e.target.value })} placeholder="Nombre completo" />
                </div>
                <div>
                  <div style={labelStyle}>Supervisor FFIE / Entidad</div>
                  <input style={inputStyle} value={config.supervisorFfie || ''} onChange={e => setConfig({ ...config, supervisorFfie: e.target.value })} placeholder="Nombre del supervisor" />
                </div>
              </div>
            </div>

            {/* Datos de Interventoría */}
            <div style={sectionCardStyle}>
              <h3 style={{ fontSize: '0.8rem', fontWeight: 800, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px', color: 'hsl(var(--text-primary))' }}>
                <Building2 size={16} style={{ color: 'hsl(142, 80%, 50%)' }} />
                DATOS DE INTERVENTORÍA
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <div style={labelStyle}>Contratista de Interventoría</div>
                  <input style={inputStyle} value={config.contratistaInterventoria || ''} onChange={e => setConfig({ ...config, contratistaInterventoria: e.target.value })} placeholder="Nombre o razón social" />
                </div>
                <div>
                  <div style={labelStyle}>NIT Interventoría</div>
                  <input style={inputStyle} value={config.nitInterventoria || ''} onChange={e => setConfig({ ...config, nitInterventoria: e.target.value })} placeholder="NIT" />
                </div>
                <div>
                  <div style={labelStyle}>Representante Legal (Interventoría)</div>
                  <input style={inputStyle} value={config.repLegalInterventoria || ''} onChange={e => setConfig({ ...config, repLegalInterventoria: e.target.value })} placeholder="Nombre completo" />
                </div>
                <div>
                  <div style={labelStyle}>Fiduciaria</div>
                  <input style={inputStyle} value={config.fiduciaria || ''} onChange={e => setConfig({ ...config, fiduciaria: e.target.value })} placeholder="Nombre de la fiduciaria" />
                </div>
                <div>
                  <div style={labelStyle}>Jornadas de Trabajo</div>
                  <input style={inputStyle} value={config.jornadasTrabajo || ''} onChange={e => setConfig({ ...config, jornadasTrabajo: e.target.value })} placeholder="Ej: Lunes a Sábado, 7:00 AM - 5:00 PM" />
                </div>
              </div>
            </div>

            {/* Personal de Obra */}
            <div style={sectionCardStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h3 style={{ fontSize: '0.8rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '8px', color: 'hsl(var(--text-primary))' }}>
                  <Users size={16} style={{ color: 'hsl(40, 100%, 60%)' }} />
                  PERSONAL DE OBRA
                </h3>
                <button
                  onClick={() => addStaff('personalObra')}
                  style={{
                    background: 'hsla(var(--primary-neon-hsl), 0.1)',
                    border: '1px solid hsl(var(--primary-neon))',
                    color: 'hsl(var(--primary-neon))',
                    fontSize: '0.65rem', padding: '4px 10px', borderRadius: '6px', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 700,
                  }}
                >
                  <Plus size={12} /> Agregar
                </button>
              </div>
              {(config.personalObra || []).length === 0 && (
                <p style={{ color: 'hsl(var(--text-muted))', fontSize: '0.75rem', textAlign: 'center', padding: '12px 0' }}>
                  No hay personal registrado. Haga clic en "Agregar" para comenzar.
                </p>
              )}
              {(config.personalObra || []).map((p, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: '8px', marginBottom: '8px', alignItems: 'end' }}>
                  <div>
                    {i === 0 && <div style={labelStyle}>Nombre</div>}
                    <input style={inputStyle} value={p.name} onChange={e => updateStaff('personalObra', i, 'name', e.target.value)} placeholder="Nombre completo" />
                  </div>
                  <div>
                    {i === 0 && <div style={labelStyle}>Cédula</div>}
                    <input style={inputStyle} value={p.idCard} onChange={e => updateStaff('personalObra', i, 'idCard', e.target.value)} placeholder="No. de cédula" />
                  </div>
                  <div>
                    {i === 0 && <div style={labelStyle}>Cargo</div>}
                    <input style={inputStyle} value={p.role} onChange={e => updateStaff('personalObra', i, 'role', e.target.value)} placeholder="Director, Residente, etc." />
                  </div>
                  <button
                    onClick={() => removeStaff('personalObra', i)}
                    style={{ background: 'none', border: 'none', color: 'hsl(var(--danger))', cursor: 'pointer', padding: '8px' }}
                    title="Eliminar"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>

            {/* Personal de Interventoría */}
            <div style={sectionCardStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h3 style={{ fontSize: '0.8rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '8px', color: 'hsl(var(--text-primary))' }}>
                  <Users size={16} style={{ color: 'hsl(320, 100%, 60%)' }} />
                  PERSONAL DE INTERVENTORÍA
                </h3>
                <button
                  onClick={() => addStaff('personalInterventoria')}
                  style={{
                    background: 'hsla(var(--primary-neon-hsl), 0.1)',
                    border: '1px solid hsl(var(--primary-neon))',
                    color: 'hsl(var(--primary-neon))',
                    fontSize: '0.65rem', padding: '4px 10px', borderRadius: '6px', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 700,
                  }}
                >
                  <Plus size={12} /> Agregar
                </button>
              </div>
              {(config.personalInterventoria || []).length === 0 && (
                <p style={{ color: 'hsl(var(--text-muted))', fontSize: '0.75rem', textAlign: 'center', padding: '12px 0' }}>
                  No hay personal registrado.
                </p>
              )}
              {(config.personalInterventoria || []).map((p, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: '8px', marginBottom: '8px', alignItems: 'end' }}>
                  <div>
                    {i === 0 && <div style={labelStyle}>Nombre</div>}
                    <input style={inputStyle} value={p.name} onChange={e => updateStaff('personalInterventoria', i, 'name', e.target.value)} placeholder="Nombre completo" />
                  </div>
                  <div>
                    {i === 0 && <div style={labelStyle}>Cédula</div>}
                    <input style={inputStyle} value={p.idCard} onChange={e => updateStaff('personalInterventoria', i, 'idCard', e.target.value)} placeholder="No. de cédula" />
                  </div>
                  <div>
                    {i === 0 && <div style={labelStyle}>Cargo</div>}
                    <input style={inputStyle} value={p.role} onChange={e => updateStaff('personalInterventoria', i, 'role', e.target.value)} placeholder="Director, Residente, etc." />
                  </div>
                  <button
                    onClick={() => removeStaff('personalInterventoria', i)}
                    style={{ background: 'none', border: 'none', color: 'hsl(var(--danger))', cursor: 'pointer', padding: '8px' }}
                    title="Eliminar"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>

            {/* Save Button */}
            <button
              onClick={saveConfig}
              className="btn btn-primary"
              style={{ fontSize: '0.75rem', padding: '10px 24px', display: 'flex', alignItems: 'center', gap: '8px' }}
            >
              <Save size={16} /> GUARDAR CONFIGURACIÓN
            </button>
          </div>
        )}

        {/* ═══════════ TAB 2: GENERADOR ═══════════ */}
        {activeTab === 'generator' && (
          <div style={{ maxWidth: '700px' }}>
            <div style={sectionCardStyle}>
              <h3 style={{ fontSize: '0.8rem', fontWeight: 800, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px', color: 'hsl(var(--text-primary))' }}>
                <CalendarDays size={16} style={{ color: 'hsl(var(--primary-neon))' }} />
                PARÁMETROS DEL INFORME
              </h3>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
                <div>
                  <div style={labelStyle}>Mes de Corte</div>
                  <select
                    value={selectedMonth}
                    onChange={e => setSelectedMonth(e.target.value)}
                    style={{ ...inputStyle, cursor: 'pointer' }}
                  >
                    {availableMonths.map(m => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <div style={labelStyle}>Fecha de Firma</div>
                  <input
                    type="date"
                    value={signDate}
                    onChange={e => setSignDate(e.target.value)}
                    style={inputStyle}
                  />
                </div>
              </div>

              <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
                <div style={labelStyle}>Secciones a Incluir</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '8px' }}>
                  {Object.entries(includeSections).map(([key, val]) => {
                    const labels: Record<string, string> = {
                      identification: '1. Identificación y Metadatos',
                      personnel: '2. Equipo de Trabajo',
                      committees: '3. Mesas Técnicas y Comités',
                      correspondence: '4. Correspondencia',
                      progress: '5. Control de Avance',
                      curveS: '6. Gráfica Curva S',
                      activities: '7. Actividades del Mes',
                      photos: '8. Registro Fotográfico',
                    };
                    return (
                      <label key={key} style={{
                        display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer',
                        padding: '6px 10px', borderRadius: '6px',
                        background: val ? 'hsla(var(--primary-neon-hsl), 0.06)' : 'transparent',
                        border: `1px solid ${val ? 'hsla(var(--primary-neon-hsl), 0.2)' : 'transparent'}`,
                        transition: 'all 0.2s',
                      }}>
                        <input
                          type="checkbox"
                          checked={val}
                          onChange={() => setIncludeSections(prev => ({ ...prev, [key]: !prev[key as keyof typeof prev] }))}
                          style={{ accentColor: 'hsl(var(--primary-neon))' }}
                        />
                        <span style={{ fontSize: '0.75rem', color: val ? 'hsl(var(--text-primary))' : 'hsl(var(--text-muted))', fontWeight: val ? 600 : 400 }}>
                          {labels[key]}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Summary cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '20px' }}>
              <SummaryCard label="Actividades del Mes" value={String(activitiesThisMonth.length)} accent />
              <SummaryCard label="Correspondencia" value={String(correspondenceThisMonth.length)} />
              <SummaryCard label="Actas / Comités" value={String(committeeMeetings.length)} />
              <SummaryCard label="Fotos del Mes" value={String(photosThisMonth.length)} />
            </div>

            <button
              onClick={goToPreview}
              className="btn btn-primary"
              style={{ fontSize: '0.75rem', padding: '12px 24px', display: 'flex', alignItems: 'center', gap: '8px' }}
            >
              <Eye size={16} /> GENERAR Y PREVISUALIZAR
            </button>
          </div>
        )}

        {/* ═══════════ TAB 3: VISTA PREVIA DE IMPRESIÓN ═══════════ */}
        {activeTab === 'preview' && (
          <div>
            {/* Controls bar */}
            <div className="no-print" style={{
              display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px',
              padding: '10px 16px', background: 'var(--surface-glass)', borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-color)',
            }}>
              <button onClick={() => setActiveTab('generator')} style={{
                background: 'none', border: 'none', color: 'hsl(var(--text-secondary))', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.7rem', fontWeight: 600,
              }}>
                <ChevronLeft size={14} /> Volver al Generador
              </button>
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: '0.7rem', color: 'hsl(var(--text-muted))', fontWeight: 600 }}>
                {monthLabel} · {progressData.rows.filter(r => r.isItem).length} ítems
              </span>
              <button className="btn btn-primary" onClick={handlePrint} style={{ fontSize: '0.7rem', padding: '6px 16px' }}>
                <Printer size={14} /> IMPRIMIR
              </button>
            </div>

            {/* Print Content */}
            <div ref={printRef} className="report-wizard-overlay" style={{ background: 'transparent' }}>

              {/* ── PAGE 1: Portada + Identificación ── */}
              {includeSections.identification && (
                <div className="report-page" style={printPageStyle}>
                  <div style={{ textAlign: 'center', marginBottom: '24px', borderBottom: '2px solid #333', paddingBottom: '16px' }}>
                    <h1 style={{ fontSize: '16px', fontWeight: 900, color: '#111', marginBottom: '4px' }}>INFORME MENSUAL DE INTERVENTORÍA</h1>
                    <h2 style={{ fontSize: '13px', fontWeight: 700, color: '#333', marginBottom: '2px' }}>{monthLabel.toUpperCase()}</h2>
                    <p style={{ fontSize: '10px', color: '#666' }}>{project.name} · {project.code}</p>
                  </div>

                  <table style={printTableStyle}>
                    <tbody>
                      <PrintRow label="Objeto del Contrato" value={config.objetoObra || project.name} />
                      <PrintRow label="Contratista de Obra" value={config.contratistaObra || '—'} />
                      <PrintRow label="NIT Contratista" value={config.nitObra || '—'} />
                      <PrintRow label="Rep. Legal (Obra)" value={config.repLegalObra || '—'} />
                      <PrintRow label="Contratista Interventoría" value={config.contratistaInterventoria || '—'} />
                      <PrintRow label="NIT Interventoría" value={config.nitInterventoria || '—'} />
                      <PrintRow label="Rep. Legal (Interventoría)" value={config.repLegalInterventoria || '—'} />
                      <PrintRow label="Supervisor / Entidad" value={config.supervisorFfie || '—'} />
                      <PrintRow label="Fiduciaria" value={config.fiduciaria || '—'} />
                      <PrintRow label="Ubicación" value={project.location} />
                      <PrintRow label="Fecha Inicio" value={project.startDate ? format(parseISO(project.startDate), 'dd/MM/yyyy') : '—'} />
                      <PrintRow label="Plazo (Meses)" value={String(project.durationMonths)} />
                      <PrintRow label="Valor Costo Directo" value={fmt(baseValue)} />
                      <PrintRow label="AIU" value={`A: ${aiu.administracion}% · I: ${aiu.imprevistos}% · U: ${aiu.utilidad}%`} />
                      <PrintRow label="Valor Total (con AIU)" value={fmt(totalContract)} />
                      <PrintRow label="Jornadas de Trabajo" value={config.jornadasTrabajo || '—'} />
                      <PrintRow label="Periodo del Informe" value={monthLabel} />
                      <PrintRow label="Fecha de Firma" value={signDate ? format(parseISO(signDate), 'dd/MM/yyyy') : '—'} />
                    </tbody>
                  </table>
                </div>
              )}

              {/* ── PAGE 2: Personal ── */}
              {includeSections.personnel && (
                <div className="report-page" style={printPageStyle}>
                  <PrintSectionTitle num={2} title="EQUIPO DE TRABAJO" />

                  <h4 style={printSubtitleStyle}>Personal de Obra</h4>
                  {(config.personalObra || []).length > 0 ? (
                    <table style={printTableStyle}>
                      <thead>
                        <tr>
                          <th style={printThStyle}>No.</th>
                          <th style={printThStyle}>Nombre</th>
                          <th style={printThStyle}>Cédula</th>
                          <th style={printThStyle}>Cargo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(config.personalObra || []).map((p, i) => (
                          <tr key={i}>
                            <td style={printTdStyle}>{i + 1}</td>
                            <td style={printTdStyle}>{p.name}</td>
                            <td style={printTdStyle}>{p.idCard}</td>
                            <td style={printTdStyle}>{p.role}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p style={{ fontSize: '9px', color: '#888', marginBottom: '12px' }}>No se ha registrado personal de obra.</p>
                  )}

                  <h4 style={{ ...printSubtitleStyle, marginTop: '20px' }}>Personal de Interventoría</h4>
                  {(config.personalInterventoria || []).length > 0 ? (
                    <table style={printTableStyle}>
                      <thead>
                        <tr>
                          <th style={printThStyle}>No.</th>
                          <th style={printThStyle}>Nombre</th>
                          <th style={printThStyle}>Cédula</th>
                          <th style={printThStyle}>Cargo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(config.personalInterventoria || []).map((p, i) => (
                          <tr key={i}>
                            <td style={printTdStyle}>{i + 1}</td>
                            <td style={printTdStyle}>{p.name}</td>
                            <td style={printTdStyle}>{p.idCard}</td>
                            <td style={printTdStyle}>{p.role}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p style={{ fontSize: '9px', color: '#888' }}>No se ha registrado personal de interventoría.</p>
                  )}
                </div>
              )}

              {/* ── PAGE 3: Comités + Correspondencia ── */}
              {(includeSections.committees || includeSections.correspondence) && (
                <div className="report-page" style={printPageStyle}>
                  {includeSections.committees && (
                    <>
                      <PrintSectionTitle num={3} title="MESAS TÉCNICAS Y COMITÉS" />
                      {committeeMeetings.length > 0 ? (
                        <table style={printTableStyle}>
                          <thead>
                            <tr>
                              <th style={printThStyle}>No.</th>
                              <th style={printThStyle}>Documento</th>
                              <th style={printThStyle}>Fecha</th>
                              <th style={printThStyle}>Asunto</th>
                            </tr>
                          </thead>
                          <tbody>
                            {committeeMeetings.map((m, i) => (
                              <tr key={i}>
                                <td style={printTdStyle}>{i + 1}</td>
                                <td style={printTdStyle}>{m.name}</td>
                                <td style={printTdStyle}>{m.metadata?.date ? format(parseISO(m.metadata.date), 'dd/MM/yyyy') : format(parseISO(m.uploadDate), 'dd/MM/yyyy')}</td>
                                <td style={printTdStyle}>{m.metadata?.subject || '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <p style={{ fontSize: '9px', color: '#888', marginBottom: '16px' }}>No se registraron actas de comité en este periodo.</p>
                      )}
                    </>
                  )}

                  {includeSections.correspondence && (
                    <>
                      <PrintSectionTitle num={4} title="CORRESPONDENCIA DEL PERIODO" />
                      {correspondenceThisMonth.length > 0 ? (
                        <table style={printTableStyle}>
                          <thead>
                            <tr>
                              <th style={printThStyle}>No.</th>
                              <th style={printThStyle}>Documento</th>
                              <th style={printThStyle}>Fecha</th>
                              <th style={printThStyle}>Remitente</th>
                              <th style={printThStyle}>Destinatario</th>
                              <th style={printThStyle}>Asunto</th>
                              <th style={printThStyle}>Estado</th>
                            </tr>
                          </thead>
                          <tbody>
                            {correspondenceThisMonth.map((c, i) => (
                              <tr key={i}>
                                <td style={printTdStyle}>{i + 1}</td>
                                <td style={printTdStyle}>{c.name}</td>
                                <td style={printTdStyle}>{c.metadata?.date ? format(parseISO(c.metadata.date), 'dd/MM/yyyy') : '—'}</td>
                                <td style={printTdStyle}>{c.metadata?.sender || '—'}</td>
                                <td style={printTdStyle}>{c.metadata?.receiver || '—'}</td>
                                <td style={printTdStyle}>{c.metadata?.subject || '—'}</td>
                                <td style={printTdStyle}>{c.metadata?.status === 'answered' ? 'Contestada' : c.metadata?.status === 'no_action_needed' ? 'Sin acción' : 'Pendiente'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <p style={{ fontSize: '9px', color: '#888' }}>No se registró correspondencia en este periodo.</p>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* ── PAGE 4: Control de Avance ── */}
              {includeSections.progress && (
                <div className="report-page" style={{ ...printPageStyle, padding: '10mm' }}>
                  <PrintSectionTitle num={5} title="CONTROL DE PROGRAMACIÓN – CUADRO DE AVANCE" />

                  <div style={{ overflow: 'hidden' }}>
                    <table style={{ ...printTableStyle, fontSize: '7px' }}>
                      <thead>
                        <tr>
                          <th style={{ ...printThStyle, fontSize: '6.5px', padding: '3px 4px' }}>ÍTEM</th>
                          <th style={{ ...printThStyle, fontSize: '6.5px', padding: '3px 4px', minWidth: '120px' }}>DESCRIPCIÓN</th>
                          <th style={{ ...printThStyle, fontSize: '6.5px', padding: '3px 4px' }}>UND</th>
                          <th style={{ ...printThStyle, fontSize: '6.5px', padding: '3px 4px' }}>CANT. PRES.</th>
                          <th style={{ ...printThStyle, fontSize: '6.5px', padding: '3px 4px' }}>VR. UNIT.</th>
                          <th style={{ ...printThStyle, fontSize: '6.5px', padding: '3px 4px' }}>VR. TOTAL</th>
                          <th style={{ ...printThStyle, fontSize: '6.5px', padding: '3px 4px' }}>CANT. ACUM. ANT.</th>
                          <th style={{ ...printThStyle, fontSize: '6.5px', padding: '3px 4px' }}>CANT. MES</th>
                          <th style={{ ...printThStyle, fontSize: '6.5px', padding: '3px 4px' }}>CANT. ACUM. ACT.</th>
                          <th style={{ ...printThStyle, fontSize: '6.5px', padding: '3px 4px' }}>VR. MES</th>
                          <th style={{ ...printThStyle, fontSize: '6.5px', padding: '3px 4px' }}>VR. ACUM.</th>
                          <th style={{ ...printThStyle, fontSize: '6.5px', padding: '3px 4px' }}>% MES</th>
                          <th style={{ ...printThStyle, fontSize: '6.5px', padding: '3px 4px' }}>% ACUM.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {progressData.rows.map((r, i) => {
                          if (!r.isItem) {
                            return (
                              <tr key={i}>
                                <td colSpan={13} style={{
                                  ...printTdStyle,
                                  fontWeight: r.type === 'title' ? 900 : 700,
                                  fontSize: r.type === 'title' ? '7.5px' : '7px',
                                  background: r.type === 'title' ? '#e8e8e8' : '#f3f3f3',
                                  padding: '3px 4px',
                                }}>
                                  {r.item.item} {r.item.descripcion}
                                </td>
                              </tr>
                            );
                          }
                          return (
                            <tr key={i}>
                              <td style={{ ...printTdStyle, fontSize: '6.5px', padding: '2px 4px' }}>{r.item.item}</td>
                              <td style={{ ...printTdStyle, fontSize: '6.5px', padding: '2px 4px' }}>{r.item.descripcion}</td>
                              <td style={{ ...printTdStyle, fontSize: '6.5px', padding: '2px 4px', textAlign: 'center' }}>{r.item.unidad}</td>
                              <td style={{ ...printTdStyle, fontSize: '6.5px', padding: '2px 4px', textAlign: 'right' }}>{fmtNum(r.cantPres)}</td>
                              <td style={{ ...printTdStyle, fontSize: '6.5px', padding: '2px 4px', textAlign: 'right' }}>{fmt(r.vlrUnit)}</td>
                              <td style={{ ...printTdStyle, fontSize: '6.5px', padding: '2px 4px', textAlign: 'right' }}>{fmt(r.vlrTotal)}</td>
                              <td style={{ ...printTdStyle, fontSize: '6.5px', padding: '2px 4px', textAlign: 'right' }}>{fmtNum(r.cantAcumAnt)}</td>
                              <td style={{ ...printTdStyle, fontSize: '6.5px', padding: '2px 4px', textAlign: 'right', fontWeight: r.cantMes > 0 ? 700 : 400, color: r.cantMes > 0 ? '#1a5' : '#333' }}>{fmtNum(r.cantMes)}</td>
                              <td style={{ ...printTdStyle, fontSize: '6.5px', padding: '2px 4px', textAlign: 'right' }}>{fmtNum(r.cantAcumAct)}</td>
                              <td style={{ ...printTdStyle, fontSize: '6.5px', padding: '2px 4px', textAlign: 'right' }}>{fmt(r.vlrMes)}</td>
                              <td style={{ ...printTdStyle, fontSize: '6.5px', padding: '2px 4px', textAlign: 'right' }}>{fmt(r.vlrAcum)}</td>
                              <td style={{ ...printTdStyle, fontSize: '6.5px', padding: '2px 4px', textAlign: 'right' }}>{r.pctMes.toFixed(1)}%</td>
                              <td style={{ ...printTdStyle, fontSize: '6.5px', padding: '2px 4px', textAlign: 'right' }}>{r.pctAcum.toFixed(1)}%</td>
                            </tr>
                          );
                        })}
                        {/* Totals */}
                        <tr style={{ fontWeight: 900, background: '#ddd' }}>
                          <td colSpan={5} style={{ ...printTdStyle, fontSize: '7px', padding: '3px 4px' }}>TOTAL COSTO DIRECTO</td>
                          <td style={{ ...printTdStyle, fontSize: '7px', padding: '3px 4px', textAlign: 'right' }}>{fmt(baseValue)}</td>
                          <td colSpan={3} style={printTdStyle} />
                          <td style={{ ...printTdStyle, fontSize: '7px', padding: '3px 4px', textAlign: 'right' }}>{fmt(progressData.totalVlrMes)}</td>
                          <td style={{ ...printTdStyle, fontSize: '7px', padding: '3px 4px', textAlign: 'right' }}>{fmt(progressData.totalVlrAcum)}</td>
                          <td style={{ ...printTdStyle, fontSize: '7px', padding: '3px 4px', textAlign: 'right' }}>{progressData.pctEjecutadoMes.toFixed(2)}%</td>
                          <td style={{ ...printTdStyle, fontSize: '7px', padding: '3px 4px', textAlign: 'right' }}>{progressData.pctEjecutadoAcum.toFixed(2)}%</td>
                        </tr>
                        <tr style={{ fontWeight: 900, background: '#ccc' }}>
                          <td colSpan={5} style={{ ...printTdStyle, fontSize: '7px', padding: '3px 4px' }}>TOTAL CON AIU ({(aiuFactor - 1) * 100}%)</td>
                          <td style={{ ...printTdStyle, fontSize: '7px', padding: '3px 4px', textAlign: 'right' }}>{fmt(totalContract)}</td>
                          <td colSpan={3} style={printTdStyle} />
                          <td style={{ ...printTdStyle, fontSize: '7px', padding: '3px 4px', textAlign: 'right' }}>{fmt(progressData.totalVlrMes * aiuFactor)}</td>
                          <td style={{ ...printTdStyle, fontSize: '7px', padding: '3px 4px', textAlign: 'right' }}>{fmt(progressData.totalVlrAcum * aiuFactor)}</td>
                          <td style={{ ...printTdStyle, fontSize: '7px', padding: '3px 4px', textAlign: 'right' }}>{progressData.pctEjecutadoMes.toFixed(2)}%</td>
                          <td style={{ ...printTdStyle, fontSize: '7px', padding: '3px 4px', textAlign: 'right' }}>{progressData.pctEjecutadoAcum.toFixed(2)}%</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* ── PAGE 5: Curva S ── */}
              {includeSections.curveS && curveSSvg && (
                <div className="report-page" style={printPageStyle}>
                  <PrintSectionTitle num={6} title="GRÁFICA DE AVANCE – CURVA S" />
                  <div style={{ border: '1px solid #ccc', padding: '12px', borderRadius: '4px', marginBottom: '16px' }}>
                    {curveSSvg}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                    <PrintInfoBox label="Ejecución Acum. (%)" value={`${progressData.pctEjecutadoAcum.toFixed(2)}%`} />
                    <PrintInfoBox label="Valor Ejecutado Acum." value={fmt(progressData.totalVlrAcum * aiuFactor)} />
                    <PrintInfoBox label="Valor Total Contrato" value={fmt(totalContract)} />
                  </div>
                </div>
              )}

              {/* ── PAGE 6: Actividades Realizadas ── */}
              {includeSections.activities && (
                <div className="report-page" style={printPageStyle}>
                  <PrintSectionTitle num={7} title="ACTIVIDADES REALIZADAS EN EL MES" />
                  {activitiesThisMonth.length > 0 ? (
                    <table style={printTableStyle}>
                      <thead>
                        <tr>
                          <th style={printThStyle}>No.</th>
                          <th style={printThStyle}>Ítem</th>
                          <th style={printThStyle}>Descripción</th>
                          <th style={printThStyle}>Unidad</th>
                          <th style={printThStyle}>Cant. Mes</th>
                          <th style={printThStyle}>% del Ítem</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activitiesThisMonth.map((a, i) => (
                          <tr key={i}>
                            <td style={printTdStyle}>{i + 1}</td>
                            <td style={printTdStyle}>{a.code}</td>
                            <td style={printTdStyle}>{a.description}</td>
                            <td style={{ ...printTdStyle, textAlign: 'center' }}>{a.unit}</td>
                            <td style={{ ...printTdStyle, textAlign: 'right' }}>{fmtNum(a.quantity)}</td>
                            <td style={{ ...printTdStyle, textAlign: 'right' }}>{a.percentage.toFixed(1)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p style={{ fontSize: '9px', color: '#888' }}>No se registraron actividades con avance en este periodo.</p>
                  )}
                </div>
              )}

              {/* ── PAGE 7+: Registro Fotográfico ── */}
              {includeSections.photos && photosThisMonth.length > 0 && (
                <div className="report-page" style={printPageStyle}>
                  <PrintSectionTitle num={8} title="REGISTRO FOTOGRÁFICO" />
                  {isLoadingPhotos ? (
                    <p style={{ fontSize: '9px', color: '#888', textAlign: 'center' }}>Cargando fotografías...</p>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      {photosThisMonth.slice(0, 8).map((entry) => (
                        <div key={entry.id} style={{ border: '1px solid #ccc', borderRadius: '4px', overflow: 'hidden' }}>
                          {photoUrls[entry.id] ? (
                            <img
                              src={photoUrls[entry.id]}
                              alt={entry.description}
                              style={{ width: '100%', height: '120px', objectFit: 'cover', display: 'block', borderRadius: 0, filter: 'none' }}
                            />
                          ) : (
                            <div style={{ width: '100%', height: '120px', background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '8px', color: '#999' }}>Sin imagen</div>
                          )}
                          <div style={{ padding: '4px 6px', fontSize: '7.5px', color: '#333' }}>
                            <strong>{entry.itemCode}</strong> — {entry.description || 'Sin descripción'}
                            <br />
                            <span style={{ color: '#888' }}>{entry.date}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {photosThisMonth.length > 8 && (
                    <p style={{ fontSize: '8px', color: '#888', textAlign: 'center', marginTop: '8px' }}>
                      Se muestran 8 de {photosThisMonth.length} fotografías. El resto puede consultarse en el sistema CONTROL.
                    </p>
                  )}
                </div>
              )}

              {/* ── LAST PAGE: Firmas ── */}
              <div className="report-page" style={printPageStyle}>
                <div style={{ flex: 1 }} />
                <div style={{ borderTop: '2px solid #333', paddingTop: '16px' }}>
                  <p style={{ fontSize: '9px', color: '#555', textAlign: 'center', marginBottom: '40px' }}>
                    En constancia se firma en {project.location} a los {signDate ? format(parseISO(signDate), "dd 'días del mes de' MMMM 'de' yyyy", { locale: es }) : '______'}.
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '40px', marginTop: '20px' }}>
                    <SignatureBlock
                      title="CONTRATISTA DE OBRA"
                      name={config.repLegalObra || ''}
                      company={config.contratistaObra || ''}
                    />
                    <SignatureBlock
                      title="INTERVENTORÍA"
                      name={config.repLegalInterventoria || ''}
                      company={config.contratistaInterventoria || ''}
                    />
                  </div>
                  {config.supervisorFfie && (
                    <div style={{ display: 'flex', justifyContent: 'center', marginTop: '40px' }}>
                      <SignatureBlock
                        title="SUPERVISOR / ENTIDAD"
                        name={config.supervisorFfie}
                        company=""
                      />
                    </div>
                  )}
                </div>
              </div>

            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Print Sub-Components ────────────────────────────────────────

const printPageStyle: React.CSSProperties = {
  background: 'white',
  color: '#111',
  padding: '15mm',
  minHeight: '279mm',
  width: '210mm',
  margin: '0 auto 20px',
  boxShadow: '0 2px 20px rgba(0,0,0,0.15)',
  fontFamily: "'Inter', 'Segoe UI', sans-serif",
  fontSize: '9px',
  lineHeight: 1.5,
  display: 'flex',
  flexDirection: 'column',
  pageBreakAfter: 'always',
  position: 'relative',
};

const printTableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  marginBottom: '12px',
  fontSize: '8.5px',
};

const printThStyle: React.CSSProperties = {
  background: '#2D3748',
  color: '#fff',
  padding: '5px 8px',
  textAlign: 'left',
  fontSize: '7.5px',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
  borderBottom: '2px solid #1A202C',
};

const printTdStyle: React.CSSProperties = {
  padding: '4px 8px',
  borderBottom: '1px solid #E2E8F0',
  color: '#333',
  fontSize: '8.5px',
};

const printSubtitleStyle: React.CSSProperties = {
  fontSize: '10px',
  fontWeight: 800,
  color: '#2D3748',
  marginBottom: '8px',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

function PrintRow({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td style={{ ...printTdStyle, fontWeight: 700, width: '35%', background: '#F7FAFC' }}>{label}</td>
      <td style={printTdStyle}>{value}</td>
    </tr>
  );
}

function PrintSectionTitle({ num, title }: { num: number; title: string }) {
  return (
    <h3 style={{
      fontSize: '12px',
      fontWeight: 900,
      color: '#1A202C',
      marginBottom: '12px',
      paddingBottom: '6px',
      borderBottom: '2px solid #2D3748',
      textTransform: 'uppercase',
      letterSpacing: '0.04em',
    }}>
      {num}. {title}
    </h3>
  );
}

function PrintInfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: '1px solid #ccc', borderRadius: '4px', padding: '8px', textAlign: 'center' }}>
      <div style={{ fontSize: '7px', color: '#888', textTransform: 'uppercase', fontWeight: 700, marginBottom: '2px' }}>{label}</div>
      <div style={{ fontSize: '11px', fontWeight: 900, color: '#1A202C' }}>{value}</div>
    </div>
  );
}

function SignatureBlock({ title, name, company }: { title: string; name: string; company: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ borderBottom: '1px solid #333', marginBottom: '6px', height: '40px' }} />
      <div style={{ fontSize: '9px', fontWeight: 800, color: '#111' }}>{name || '________________________'}</div>
      {company && <div style={{ fontSize: '8px', color: '#555' }}>{company}</div>}
      <div style={{ fontSize: '7px', color: '#888', textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: '2px' }}>{title}</div>
    </div>
  );
}

function SummaryCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{
      background: accent ? 'hsla(var(--primary-neon-hsl), 0.08)' : 'var(--surface-glass)',
      border: `1px solid ${accent ? 'hsla(var(--primary-neon-hsl), 0.25)' : 'var(--border-color)'}`,
      borderRadius: 'var(--radius-md)',
      padding: '12px',
      textAlign: 'center',
      backdropFilter: 'var(--glass-blur)',
    }}>
      <div style={{ fontSize: '1.4rem', fontWeight: 900, color: accent ? 'hsl(var(--primary-neon))' : 'hsl(var(--text-primary))', fontFamily: 'var(--font-technical)' }}>
        {value}
      </div>
      <div style={{ fontSize: '0.6rem', fontWeight: 700, color: 'hsl(var(--text-muted))', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: '2px' }}>
        {label}
      </div>
    </div>
  );
}
