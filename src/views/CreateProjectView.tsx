import { useState, useRef } from 'react';
import { FileSpreadsheet, CalendarDays, CheckCircle2, Building2, MapPin, FileCheck } from 'lucide-react';
import { useProjects } from '../context/ProjectsContext';
import type { BudgetItem } from '../types/projectTypes';
import './Dashboard.css'; // Reusing premium panel styles for consistency

interface Props {
  onProjectCreated?: () => void;
}

export default function CreateProjectView({ onProjectCreated }: Props) {
  const { addProject, setActiveProject } = useProjects();

  // Form states
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [location, setLocation] = useState('');
  const [startDate, setStartDate] = useState('');
  const [durationMonths, setDurationMonths] = useState('');
  
  const [admin, setAdmin] = useState('10');
  const [imprevistos, setImprevistos] = useState('5');
  const [utilidad, setUtilidad] = useState('5');

  // File states
  const [budgetFile, setBudgetFile] = useState<File | null>(null);
  const [budgetItems, setBudgetItems] = useState<BudgetItem[]>([]);
  const [budgetTotal, setBudgetTotal] = useState<number>(0);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processExcel = async (file: File) => {
    setBudgetFile(file);
    try {
      const { read, utils } = await import('xlsx');
      const data = await file.arrayBuffer();
      const workbook = read(data);
      
      const sheetName = workbook.SheetNames.includes('Presupuesto') ? 'Presupuesto' : workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const rows = utils.sheet_to_json<any[]>(worksheet, { header: 1 });
      
      let total = 0;
      const parsedItems: BudgetItem[] = [];
      
      // Buscar la fila de encabezados
      let headerRowIdx = -1;
      for (let i = 0; i < Math.min(20, rows.length); i++) {
        const row = rows[i];
        if (row && typeof row[0] === 'string' && row[0].toUpperCase().includes('ITEM')) {
          headerRowIdx = i;
          break;
        }
      }
      
      if (headerRowIdx !== -1) {
        for (let i = headerRowIdx + 1; i < rows.length; i++) {
          const row = rows[i];
          // Validar que exista el ítem (columna 0) y descripción (columna 1)
          if (!row || !row[0] || !row[1]) continue;
          
          const valTotal = row[5] || row[4] || 0;
          const vlrUnitario = Number(row[4]) || 0;
          if (typeof valTotal === 'number') {
            total += valTotal;
          }

          const itemCode = String(row[0]);
          let itemType: 'title' | 'subtitle' | 'item' = 'item';
          
          if (vlrUnitario === 0) {
            // Un título principal generalmente no tiene puntos o espacios extra
            // Un subtítulo suele tener la forma "1.2" o "1.2.3"
            if (!itemCode.includes('.') && !itemCode.trim().includes(' ')) {
              itemType = 'title';
            } else {
              itemType = 'subtitle';
            }
          }

          parsedItems.push({
            item: itemCode,
            descripcion: String(row[1]),
            unidad: String(row[2] || 'UN'),
            cantidad: Number(row[3]) || 0,
            vlrUnitario,
            vlrTotal: Number(row[5] || valTotal),
            type: itemType
          });
        }
      }
      
      setBudgetItems(parsedItems);
      setBudgetTotal(total);
    } catch (error) {
      console.error("Error reading Excel:", error);
      alert("Hubo un error al leer el archivo Excel. Asegúrate de que sea un formato válido.");
      setBudgetFile(null);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
        processExcel(file);
      } else {
        alert('Por favor sube un archivo Excel válido (.xlsx, .xls)');
      }
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value);
  };
  const handleCreateProject = () => {
    if (!name || budgetItems.length === 0) {
      alert("Por favor ingresa al menos el nombre del proyecto y carga un presupuesto.");
      return;
    }

    const generateId = () => Math.random().toString(36).substring(2, 9) + Date.now().toString(36);

    const newProject = {
      id: generateId(),
      name,
      code,
      location,
      startDate,
      durationMonths: Number(durationMonths) || 0,
      aiu: {
        administracion: Number(admin) || 0,
        imprevistos: Number(imprevistos) || 0,
        utilidad: Number(utilidad) || 0
      },
      budgetTotalBase: budgetTotal,
      budgetItems,
      progressReports: [],
      logiEntries: []
    };

    addProject(newProject);
    setActiveProject(newProject.id);
    
    alert("¡Proyecto creado con éxito!");

    if (onProjectCreated) {
      onProjectCreated();
    }
  };

  return (
    <div className="dashboard-container">
      <header className="page-header">
        <h2 className="page-title" style={{ color: 'hsl(var(--text-primary))' }}>NUEVO PROYECTO</h2>
        <div className="badge badge-warning">BORRADOR</div>
      </header>

      <div className="dash-grid" style={{ gridTemplateColumns: '1fr 1fr', gridTemplateRows: 'auto' }}>
        
        {/* PANEL IZQUIERDO: INFORMACIÓN GENERAL */}
        <section className="dash-panel">
          <div className="dash-panel-header">
            <h3>1. INFORMACIÓN GENERAL</h3>
          </div>
          <div className="dash-panel-content" style={{ padding: 'var(--spacing-lg)' }}>
            
            <div className="input-group">
              <label className="input-label">NOMBRE DEL PROYECTO</label>
              <div style={{ position: 'relative' }}>
                <Building2 size={16} color="hsl(var(--text-muted))" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />
                <input type="text" className="input-field" placeholder="Ej. I.E. Manuela Beltrán, Sede Menegua" style={{ width: '100%', paddingLeft: '36px' }} value={name} onChange={(e) => setName(e.target.value)} />
              </div>
            </div>

            <div className="input-group">
              <label className="input-label">CÓDIGO DE CONTRATO / ID</label>
              <input type="text" className="input-field" placeholder="Ej. CON-2026-04" style={{ width: '100%' }} value={code} onChange={(e) => setCode(e.target.value)} />
            </div>

            <div className="input-group">
              <label className="input-label">UBICACIÓN</label>
              <div style={{ position: 'relative' }}>
                <MapPin size={16} color="hsl(var(--text-muted))" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />
                <input type="text" className="input-field" placeholder="Ciudad, Departamento" style={{ width: '100%', paddingLeft: '36px' }} value={location} onChange={(e) => setLocation(e.target.value)} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
              <div className="input-group">
                <label className="input-label">FECHA DE INICIO</label>
                <div style={{ position: 'relative' }}>
                  <CalendarDays size={16} color="hsl(var(--text-muted))" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />
                  <input type="date" className="input-field" style={{ width: '100%', paddingLeft: '36px' }} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </div>
              </div>
              <div className="input-group">
                <label className="input-label">PLAZO ESTIMADO (MESES)</label>
                <input type="number" className="input-field" placeholder="Ej. 6" style={{ width: '100%' }} value={durationMonths} onChange={(e) => setDurationMonths(e.target.value)} />
              </div>
            </div>

          </div>
        </section>

        {/* PANEL DERECHO: CARGA DE INSUMOS */}
        <section className="dash-panel">
          <div className="dash-panel-header">
            <h3>2. INSUMOS (PRESUPUESTO Y PROGRAMACIÓN)</h3>
          </div>
          <div className="dash-panel-content" style={{ padding: 'var(--spacing-lg)' }}>
            
            <div className="input-group">
              <label className="input-label">IMPORTAR PRESUPUESTO (.XLSX)</label>
              <p style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))', marginBottom: '8px' }}>
                El archivo debe contener las columnas: ITEM, DESCRIPCION, UN, CANTIDAD, Vlr. UNITARIO, VLR. TOTAL
              </p>
              <input 
                type="file" 
                ref={fileInputRef} 
                style={{ display: 'none' }} 
                accept=".xlsx, .xls"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    processExcel(e.target.files[0]);
                  }
                }}
              />
              
              {!budgetFile ? (
                <div 
                  style={{ 
                    border: `2px dashed ${isDragging ? 'hsl(var(--accent-primary))' : 'hsl(var(--border-color))'}`, 
                    borderRadius: 'var(--radius-md)', 
                    padding: 'var(--spacing-xl)', 
                    textAlign: 'center',
                    backgroundColor: isDragging ? 'hsl(var(--accent-primary) / 0.1)' : 'hsl(var(--bg-tertiary))',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }} 
                  className="upload-zone"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                >
                  <FileSpreadsheet size={32} color="hsl(var(--accent-primary))" style={{ marginBottom: '8px' }} />
                  <div style={{ fontSize: '0.875rem', fontWeight: '500' }}>Arrastra el Presupuesto (Excel) aquí</div>
                  <div style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))' }}>o haz clic para buscar el archivo</div>
                </div>
              ) : (
                <div style={{ 
                  border: '1px solid hsl(var(--success))', 
                  borderRadius: 'var(--radius-md)', 
                  padding: 'var(--spacing-md)', 
                  backgroundColor: 'hsla(var(--success), 0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--spacing-md)'
                }}>
                  <div style={{ padding: 'var(--spacing-sm)', backgroundColor: 'hsl(var(--success))', borderRadius: '50%', display: 'flex' }}>
                    <FileCheck size={24} color="#fff" />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.875rem', fontWeight: '600', color: 'hsl(var(--text-primary))' }}>{budgetFile.name}</div>
                    <div style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))' }}>
                      {budgetItems.length} ítems detectados • Total Base: {formatCurrency(budgetTotal)}
                    </div>
                  </div>
                  <button 
                    className="btn btn-secondary" 
                    onClick={() => { setBudgetFile(null); setBudgetItems([]); setBudgetTotal(0); }}
                    style={{ fontSize: '0.75rem', padding: 'var(--spacing-xs) var(--spacing-sm)' }}
                  >
                    CAMBIAR
                  </button>
                </div>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--spacing-md)', marginTop: 'var(--spacing-lg)' }}>
              <div className="input-group">
                <label className="input-label">ADMINISTRACIÓN (%)</label>
                <input type="number" className="input-field" placeholder="10" style={{ width: '100%' }} value={admin} onChange={(e) => setAdmin(e.target.value)} />
              </div>
              <div className="input-group">
                <label className="input-label">IMPREVISTOS (%)</label>
                <input type="number" className="input-field" placeholder="5" style={{ width: '100%' }} value={imprevistos} onChange={(e) => setImprevistos(e.target.value)} />
              </div>
              <div className="input-group">
                <label className="input-label">UTILIDAD (%)</label>
                <input type="number" className="input-field" placeholder="5" style={{ width: '100%' }} value={utilidad} onChange={(e) => setUtilidad(e.target.value)} />
              </div>
            </div>

          </div>
        </section>

        {/* ACCIONES */}
        <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', gap: 'var(--spacing-md)', marginTop: 'var(--spacing-md)' }}>
          <button className="btn btn-secondary">CANCELAR</button>
          <button className="btn btn-primary" onClick={handleCreateProject}>
            <CheckCircle2 size={16} />
            CREAR PROYECTO
          </button>
        </div>

      </div>
    </div>
  );
}
