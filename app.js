// CONTROL - MVP
// Data: IndexedDB (projects) + localStorage (settings)

const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

/* ---------------- Settings ---------------- */
const SETTINGS_KEY = "CONTROL_SETTINGS_v1";
const defaultSettings = {
  moneyDecimals: 0,          // 0 by default; -3 rounds to thousands
  qtyDecimals: 2,            // quantities should be 2 by default
  highlightExtraQty: true,
  shiftPlannedBySuspensions: true
};

function loadSettings(){
  try{
    const raw = localStorage.getItem(SETTINGS_KEY);
    if(!raw) return {...defaultSettings};
    const obj = JSON.parse(raw);
    return {...defaultSettings, ...obj};
  }catch{
    return {...defaultSettings};
  }
}
function saveSettings(s){
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

/* ---------------- Formatting helpers ---------------- */
function parseNumber(v){
  if(v === null || v === undefined) return null;
  if(typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if(!s) return null;
  // handle Colombian formats "1.234,56" or "1234,56"
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  let norm = s;
  if(hasComma && hasDot){
    // assume dot is thousand sep, comma is decimal
    norm = s.replaceAll(".", "").replace(",", ".");
  }else if(hasComma && !hasDot){
    norm = s.replace(",", ".");
  }
  const n = Number(norm);
  return Number.isFinite(n) ? n : null;
}

function roundByDecimals(value, decimals){
  if(value === null || value === undefined) return null;
  const x = Number(value);
  if(!Number.isFinite(x)) return null;

  if(decimals === -3){
    return Math.round(x / 1000) * 1000;
  }
  const p = Math.pow(10, decimals);
  return Math.round(x * p) / p;
}

function formatMoney(x, settings, currency="COP"){
  if(x === null || x === undefined) return "—";
  const r = roundByDecimals(x, settings.moneyDecimals);
  try{
    return new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency,
      maximumFractionDigits: settings.moneyDecimals >= 0 ? settings.moneyDecimals : 0,
      minimumFractionDigits: settings.moneyDecimals >= 0 ? settings.moneyDecimals : 0
    }).format(r);
  }catch{
    // fallback
    return String(r);
  }
}

function formatNumber(x, decimals=2){
  if(x === null || x === undefined) return "—";
  const r = roundByDecimals(x, decimals);
  return new Intl.NumberFormat("es-CO", {maximumFractionDigits: decimals, minimumFractionDigits: decimals}).format(r);
}

function decimalsCount(n){
  if(n === null || n === undefined) return 0;
  const s = String(n);
  if(!s.includes(".")) return 0;
  return s.split(".")[1].length;
}

function normalizeCode(code){
  if(code === null || code === undefined) return "";
  const s = String(code).trim();
  // convert "1." to "1"
  return s.endsWith(".") ? s.slice(0, -1) : s;
}

function codeLevel(codeNorm){
  // e.g. "1" => 1; "1.2.3" => 3; "NP 1" => 99 (treat as item-level)
  if(!codeNorm) return 0;
  if(/^\d+(\.\d+)*$/.test(codeNorm)){
    return codeNorm.split(".").length;
  }
  return 99;
}

function classifyRow(code, desc, qty, unit, vu, vt){
  const cRaw = (code ?? "").toString().trim();
  const dRaw = (desc ?? "").toString().trim();
  const cLow = cRaw.toLowerCase();
  const dLow = dRaw.toLowerCase();

  if(!cRaw && !dRaw) return "OTHER";

  // Subtotales (a veces vienen en ÍTEM/código, a veces en descripción)
  if(cLow.startsWith("subtotal") || dLow.startsWith("subtotal")) return "SUBTOTAL";

  // AIU (normalmente sin código al final)
  if(
    dLow.startsWith("administr") || dLow.startsWith("imprev") || dLow.startsWith("utilidad") ||
    dLow.includes("a.i.u") || dLow === "aiu" ||
    cLow.startsWith("administr") || cLow.startsWith("imprev") || cLow.startsWith("utilidad") ||
    cLow.includes("a.i.u") || cLow === "aiu"
  ) return "AIU";

  // Totales
  if(
    dLow.includes("valor total") || cLow.includes("valor total") ||
    dLow.includes("incluye a.i.u") || dLow.includes("incluye aiu") ||
    cLow.includes("incluye a.i.u") || cLow.includes("incluye aiu")
  ) return "TOTAL";

  // Filas sin código pero con valor total (lump sum) o encabezado de texto
  const hasVT = (typeof vt === "number") && Number.isFinite(vt);
  if(!cRaw && dRaw){
    return hasVT ? "LUMP" : "TEXT";
  }

  // Códigos numéricos jerárquicos: CAP/SUB/ITEM según el nivel
  const cn = normalizeCode(cRaw);
  if(/^[0-9]+(\.[0-9]+)*$/.test(cn)){
    const lvl = codeLevel(cn);
    if(lvl === 1) return "CAP";
    if(lvl === 2) return "SUB";
    return "ITEM";
  }

  // Alfanuméricos tipo "NP 1"
  if(cn) return "ITEM";

  return "OTHER";
}

function toast(msg){
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(()=>t.classList.add("hidden"), 2800);
}

/* ---------------- IndexedDB ---------------- */
const DB_NAME = "CONTROL_DB_v1";
const DB_VERSION = 1;
const STORE_PROJECTS = "projects";

function openDB(){
  return new Promise((resolve, reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if(!db.objectStoreNames.contains(STORE_PROJECTS)){
        db.createObjectStore(STORE_PROJECTS, {keyPath:"id"});
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGetAllProjects(){
  const db = await openDB();
  return new Promise((resolve, reject)=>{
    const tx = db.transaction(STORE_PROJECTS, "readonly");
    const st = tx.objectStore(STORE_PROJECTS);
    const req = st.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function dbPutProject(project){
  const db = await openDB();
  return new Promise((resolve, reject)=>{
    const tx = db.transaction(STORE_PROJECTS, "readwrite");
    tx.objectStore(STORE_PROJECTS).put(project);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function dbDeleteProject(id){
  const db = await openDB();
  return new Promise((resolve, reject)=>{
    const tx = db.transaction(STORE_PROJECTS, "readwrite");
    tx.objectStore(STORE_PROJECTS).delete(id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

/* ---------------- Data model helpers ---------------- */
function newProject(){
  const id = "proj_" + Math.random().toString(16).slice(2) + "_" + Date.now();
  const today = new Date();
  const iso = (d)=> d.toISOString().slice(0,10);
  return {
    id,
    name: "Proyecto sin nombre",
    parties: {
      owner: {name:"", nit:"", rep:""},
      contractor: {name:"", nit:"", rep:""},
      interventoria: {name:"", nit:"", rep:""}
    },
    contract: {
      startDate: iso(today),
      initialEndDate: iso(new Date(today.getTime() + 1000*60*60*24*180)),
      currency: "COP",
      aiu: {a:0, i:0, u:0},
      notes: ""
    },
    suspensions: [],
    budget: { items: [], revisions: [] },
    reports: [],
    finance: { events: [] },
    planned: { curve: [] } // [{date:"YYYY-MM-DD", plannedCostAccum: number}]
  };
}

function budgetEffectiveItem(item, project, asOfDate=null){
  // For MVP: apply revisions in insertion order; asOfDate reserved for later.
  let qty = item.qtyContract ?? 0;
  let vu = item.vuContract ?? 0;

  for(const rev of (project.budget.revisions || [])){
    const ch = (rev.changes || []).find(c => c.itemCodeNorm === item.codeNorm);
    if(ch){
      if(typeof ch.qtyNew === "number") qty = ch.qtyNew;
      if(typeof ch.vuNew === "number") vu = ch.vuNew;
    }
  }
  return {qty, vu, vt: qty*vu};
}

function contractValue(project, settings){
  const cur = project.contract.currency || "COP";

  // 1) Si existe una fila explícita de "VALOR TOTAL", úsala como fuente de verdad.
  const totalRow = (project.budget.items || []).find(it =>
    (it.type === "TOTAL") &&
    ((it.desc || "").toString().toLowerCase().includes("valor total")) &&
    (typeof it.vtContract === "number") && Number.isFinite(it.vtContract)
  );
  if(totalRow){
    return {value: roundByDecimals(totalRow.vtContract, settings.moneyDecimals), currency: cur};
  }

  // 2) Si no, sumamos:
  //    - ITEM: qty*vu (aplica revisiones)
  //    - AIU/LUMP: vtContract (son sumas directas)
  //    Excluimos SUBTOTAL para no duplicar.
  let sum = 0;
  for(const it of (project.budget.items || [])){
    if(it.type === "ITEM"){
      const eff = budgetEffectiveItem(it, project);
      sum += eff.qty * eff.vu;
      continue;
    }
    if(it.type === "AIU" || it.type === "LUMP"){
      const vt = (typeof it.vtContract === "number" && Number.isFinite(it.vtContract)) ? it.vtContract : 0;
      sum += vt;
      continue;
    }
  }
  return {value: roundByDecimals(sum, settings.moneyDecimals), currency: cur};
}

/* ---------------- UI state ---------------- */
let settings = loadSettings();
let projects = [];
let activeProjectId = null;
let activeBudgetWorkbook = null;
let activePlannedWorkbook = null;

/* ---------------- Tabs ---------------- */
function initTabs(){
  $$(".nav-item").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      $$(".nav-item").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      const tabId = btn.dataset.tab;
      $$(".tab").forEach(t=>t.classList.remove("active"));
      $("#"+tabId).classList.add("active");
      renderAll();
    });
  });
}

/* ---------------- Project picker ---------------- */
function projectLabel(p){
  const n = p.name?.trim() || "Proyecto";
  return `${n} (${p.id.slice(0,8)})`;
}

function setActiveProject(id){
  activeProjectId = id;
  localStorage.setItem("CONTROL_ACTIVE_PROJECT", id);
  renderAll();
}

function getActiveProject(){
  return projects.find(p=>p.id === activeProjectId) || null;
}

/* ---------------- Render: KPI sidebar ---------------- */
function renderKPIs(){
  const p = getActiveProject();
  if(!p){
    $("#kpiContractValue").textContent = "—";
    $("#kpiLastReport").textContent = "—";
    $("#kpiExecuted").textContent = "—";
    $("#kpiFinance").textContent = "—";
    $("#activeProjectHint").textContent = "Crea un proyecto para empezar.";
    return;
  }
  $("#activeProjectHint").textContent = p.contract?.notes ? p.contract.notes : "Proyecto activo.";
  const cv = contractValue(p, settings);
  $("#kpiContractValue").textContent = formatMoney(cv.value, settings, cv.currency);

  const last = [...(p.reports||[])].sort((a,b)=> (a.cutoffDate||"").localeCompare(b.cutoffDate||"")).at(-1);
  $("#kpiLastReport").textContent = last ? `${last.label || "Reporte"} · ${last.cutoffDate}` : "—";

  const execPct = last ? computeExecutedPct(p, last) : null;
  $("#kpiExecuted").textContent = execPct === null ? "—" : `${(execPct*100).toFixed(1)}%`;

  const finPct = last ? computeFinancePct(p, last.cutoffDate) : null;
  $("#kpiFinance").textContent = finPct === null ? "—" : `${(finPct*100).toFixed(1)}%`;
}

/* ---------------- Render: project form ---------------- */
function renderProjectForm(){
  const p = getActiveProject();
  if(!p) return;

  $("#p_name").value = p.name || "";
  $("#p_currency").value = p.contract.currency || "COP";
  $("#p_start").value = p.contract.startDate || "";
  $("#p_end").value = p.contract.initialEndDate || "";

  $("#p_owner_name").value = p.parties.owner.name || "";
  $("#p_owner_nit").value = p.parties.owner.nit || "";
  $("#p_owner_rep").value = p.parties.owner.rep || "";

  $("#p_contractor_name").value = p.parties.contractor.name || "";
  $("#p_contractor_nit").value = p.parties.contractor.nit || "";
  $("#p_contractor_rep").value = p.parties.contractor.rep || "";

  $("#p_inter_name").value = p.parties.interventoria.name || "";
  $("#p_inter_nit").value = p.parties.interventoria.nit || "";
  $("#p_inter_rep").value = p.parties.interventoria.rep || "";

  renderSuspensions();
}

function renderSuspensions(){
  const p = getActiveProject();
  if(!p) return;
  const wrap = $("#suspensionsTable");
  const rows = p.suspensions || [];
  const html = `
    <table>
      <thead><tr>
        <th>Inicio</th><th>Fin</th><th>Motivo</th><th></th>
      </tr></thead>
      <tbody>
        ${rows.map((s, i)=>`
          <tr>
            <td><input type="date" data-sus="${i}" data-k="from" value="${s.from||""}"></td>
            <td><input type="date" data-sus="${i}" data-k="to" value="${s.to||""}"></td>
            <td><input type="text" data-sus="${i}" data-k="reason" value="${escapeHtml(s.reason||"")}" placeholder="—"></td>
            <td class="center"><button class="btn small danger" data-susdel="${i}">X</button></td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
  wrap.innerHTML = html;

  $$("input[data-sus]").forEach(inp=>{
    inp.addEventListener("change", async ()=>{
      const idx = Number(inp.dataset.sus);
      const k = inp.dataset.k;
      p.suspensions[idx][k] = inp.value;
      await dbPutProject(p);
      toast("Suspensión actualizada");
      renderAll();
    });
  });
  $$("button[data-susdel]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const idx = Number(btn.dataset.susdel);
      p.suspensions.splice(idx,1);
      await dbPutProject(p);
      toast("Suspensión eliminada");
      renderAll();
    });
  });
}

/* ---------------- Budget import ---------------- */
function enableBudgetUI(enabled){
  $("#budgetSheetSelect").disabled = !enabled;
  $("#btnParseBudget").disabled = !enabled;
}

function sheetNames(wb){
  return wb.SheetNames || [];
}

function rowsFromSheet(wb, sheetName){
  const ws = wb.Sheets[sheetName];
  if(!ws) return [];
  const data = XLSX.utils.sheet_to_json(ws, {header:1, raw:true, defval:null});
  return data || [];
}

function findHeaderRow(rows){
  // Heuristic: look for row with at least 3 header-like keywords
  const keywords = ["item","ítem","codigo","código","descripcion","descripción","unidad","und","cantidad","cant","valor","unit","total","vt","vu"];
  let best = {idx:-1, score:0};
  for(let i=0;i<Math.min(rows.length, 80);i++){
    const r = rows[i] || [];
    const text = r.map(c=> String(c??"").toLowerCase().trim()).filter(Boolean);
    const hits = text.reduce((acc, t)=>{
      const k = keywords.some(kw=> t.includes(kw));
      return acc + (k?1:0);
    },0);
    const nonEmpty = text.length;
    const score = hits*3 + Math.min(nonEmpty, 12);
    if(score > best.score){
      best = {idx:i, score};
    }
  }
  return best.idx;
}

function mapColumns(headerRow){
  const header = headerRow.map(h => String(h ?? "").toLowerCase().trim());
  const find = (preds) => {
    for(let i=0;i<header.length;i++){
      const h = header[i];
      if(!h) continue;
      if(preds.some(p => h.includes(p))) return i;
    }
    return -1;
  };

  const col = {
    code: find(["item","ítem","codigo","código"]),
    desc: find(["descripcion","descripción","desc"]),
    unit: find(["unidad","und"]),
    qty: find(["cantidad","cant"]),
    vu: find(["valor unit","vr unit","v/u","vu"]),
    vt: find(["valor total","vr total","total","vt"])
  };
  return col;
}

function parseBudgetFromSheet(rows){
  const headerIdx = findHeaderRow(rows);
  if(headerIdx < 0) return {items:[], warnings:["No se encontró fila de encabezados."]};

  const headerRow = rows[headerIdx];
  const cols = mapColumns(headerRow);

  const missing = Object.entries(cols).filter(([k,v]) => ["code","desc","unit","qty","vu"].includes(k) && v<0).map(([k])=>k);
  const warnings = [];
  if(missing.length){
    warnings.push("Faltan columnas mínimas detectables: " + missing.join(", ") + ". Puedes renombrarlas en Excel o ajustar manualmente (próxima versión).");
  }

  const items = [];
  for(let r = headerIdx+1; r<rows.length; r++){
    const row = rows[r];
    if(!row || row.every(c => c === null || c === "")) continue;

    const code = cols.code>=0 ? row[cols.code] : null;
    const desc = cols.desc>=0 ? row[cols.desc] : null;
    const unit = cols.unit>=0 ? row[cols.unit] : null;
    const qty = cols.qty>=0 ? parseNumber(row[cols.qty]) : null;
    const vu = cols.vu>=0 ? parseNumber(row[cols.vu]) : null;
    const vt = cols.vt>=0 ? parseNumber(row[cols.vt]) : null;

    const typ = classifyRow(code, desc, qty, unit, vu, vt);
    if(typ === "OTHER") continue;

    let codeStr = (code ?? "").toString().trim();
    let descStr = (desc ?? "").toString().trim();

    // En algunos presupuestos, las filas de SUBTOTAL vienen en la columna ÍTEM (código).
    // Para que se vean bien en pantalla, pasamos el texto a la descripción.
    if(typ === "SUBTOTAL" && !descStr && codeStr.toLowerCase().startsWith("subtotal")){
      descStr = codeStr;
      codeStr = "";
    }

    const codeNorm = normalizeCode(codeStr);
    const lvl = codeLevel(codeNorm);
    const parent = (lvl >= 2 && /^\d+(\.\d+)*$/.test(codeNorm)) ? codeNorm.split(".").slice(0,-1).join(".") : "";

    items.push({
      id: "itm_" + Math.random().toString(16).slice(2) + "_" + r,
      code: codeStr,
      codeNorm,
      desc: descStr,
      unit: (unit ?? "").toString().trim(),
      qtyContract: qty ?? 0,
      vuContract: vu ?? 0,
      vtContract: (vt ?? ((qty??0)*(vu??0))),
      parentCodeNorm: parent,
      type: typ
    });
  }


  // warnings for qty decimals
  const extra = items.filter(it => decimalsCount(it.qtyContract) > settings.qtyDecimals);
  if(extra.length){
    warnings.push(`Hay ${extra.length} cantidad(es) con más de ${settings.qtyDecimals} decimales en el presupuesto. Se resaltarán.`);
  }

  return {items, warnings};
}

function renderBudget(){
  const p = getActiveProject();
  if(!p){
    $("#budgetWarnings").innerHTML = "";
    $("#budgetTable").innerHTML = "";
    $("#btnAddRevision").disabled = true;
    $("#btnNormalizeQty").disabled = true;
    return;
  }

  $("#btnAddRevision").disabled = p.budget.items.length === 0;
  $("#btnNormalizeQty").disabled = p.budget.items.length === 0;

  // revision toggles
  const togglesWrap = $("#revisionToggles");
  togglesWrap.innerHTML = (p.budget.revisions||[]).map((rev)=>`
    <label class="toggle">
      <input type="checkbox" data-revshow="${rev.id}" ${rev._show === false ? "" : "checked"} />
      <span>${escapeHtml(rev.name || "MOD")}</span>
    </label>
  `).join("");

  $$("input[data-revshow]").forEach(chk=>{
    chk.addEventListener("change", async ()=>{
      const rev = p.budget.revisions.find(r=>r.id === chk.dataset.revshow);
      if(rev){
        rev._show = chk.checked;
        await dbPutProject(p);
        renderBudget();
      }
    });
  });

  const showBase = $("#toggleShowBase").checked;

  // compute warnings
  const w = [];
  const extra = (p.budget.items||[]).filter(it => it.type==="ITEM" && decimalsCount(it.qtyContract) > settings.qtyDecimals);
  if(extra.length && settings.highlightExtraQty){
    w.push(`⚠️ Presupuesto: ${extra.length} ítem(s) tienen más de ${settings.qtyDecimals} decimales en cantidad.`);
  }
  $("#budgetWarnings").innerHTML = w.map(x=>`<div class="warning">${x}</div>`).join("");

  const cur = p.contract.currency || "COP";
  const rows = (p.budget.items||[]);

  const revs = (p.budget.revisions||[]).filter(r => r._show !== false);

  // build table
  let th = `
    <th>Tipo</th>
    <th>Código</th>
    <th>Descripción</th>
    <th class="center">Und</th>
  `;
  if(showBase){
    th += `
      <th class="num">Cant. base</th>
      <th class="num">VU base</th>
      <th class="num">VT base</th>
    `;
  }
  for(const rev of revs){
    th += `
      <th class="num">Cant. ${escapeHtml(rev.name||"MOD")}</th>
      <th class="num">VU ${escapeHtml(rev.name||"MOD")}</th>
      <th class="num">VT ${escapeHtml(rev.name||"MOD")}</th>
    `;
  }
  th += `
    <th class="num">Cant. vigente</th>
    <th class="num">VU vigente</th>
    <th class="num">VT vigente</th>
  `;

  const body = rows.map(it=>{
    const isItem = it.type === "ITEM";
    const isCapSub = (it.type === "CAP" || it.type === "SUB");
    const isText = (it.type === "TEXT");
    const isSubtotal = (it.type === "SUBTOTAL");
    const isAIU = (it.type === "AIU");
    const isTotal = (it.type === "TOTAL");
    const isLump = (it.type === "LUMP");
    const isSummary = isSubtotal || isAIU || isTotal || isLump;

    const badge = isItem ? "item" : (isCapSub ? "cap" : "sub");

    const extraDec = isItem && settings.highlightExtraQty && (decimalsCount(it.qtyContract) > settings.qtyDecimals);
    const qtyClass = extraDec ? "qty-warn" : "";
    const hint = extraDec ? `<div class="small hint">>${settings.qtyDecimals} dec</div>` : "";

    const vtContract = (typeof it.vtContract === "number" && Number.isFinite(it.vtContract)) ? it.vtContract : 0;

    // Base cells
    let baseCells = "";
    if(showBase){
      if(isItem){
        baseCells = `
          <td class="num ${qtyClass}">${formatNumber(it.qtyContract, settings.qtyDecimals)} ${hint}</td>
          <td class="num">${formatMoney(it.vuContract, settings, cur)}</td>
          <td class="num">${formatMoney(it.qtyContract*it.vuContract, settings, cur)}</td>
        `;
      }else if(isSummary){
        const vuShow = isAIU ? `${(Number(it.vuContract||0)*100).toFixed(2)}%` : "";
        baseCells = `
          <td class="num"></td>
          <td class="num">${vuShow}</td>
          <td class="num">${formatMoney(vtContract, settings, cur)}</td>
        `;
      }else{
        // CAP / SUB / TEXT
        baseCells = `
          <td class="num"></td>
          <td class="num"></td>
          <td class="num"></td>
        `;
      }
    }

    // Revision cells: solo aplica para ITEM
    let revCells = "";
    if(isItem){
      revCells = revs.map(rev=>{
        const ch = (rev.changes||[]).find(c=>c.itemCodeNorm === it.codeNorm);
        const qty = (ch && typeof ch.qtyNew === "number") ? ch.qtyNew : null;
        const vu = (ch && typeof ch.vuNew === "number") ? ch.vuNew : null;
        const eff = budgetEffectiveItem(it, {budget:{revisions:[rev]}});
        // show blanks if not changed
        const qShow = qty === null ? "" : formatNumber(qty, settings.qtyDecimals);
        const vuShow = vu === null ? "" : formatMoney(vu, settings, cur);
        const vtShow = (qty === null && vu === null) ? "" : formatMoney(eff.vt, settings, cur);
        return `
          <td class="num">${qShow}</td>
          <td class="num">${vuShow}</td>
          <td class="num">${vtShow}</td>
        `;
      }).join("");
    }else{
      revCells = revs.map(()=>`
        <td class="num"></td>
        <td class="num"></td>
        <td class="num"></td>
      `).join("");
    }

    // Vigente
    let qtyVig = "";
    let vuVig = "";
    let vtVig = "";

    if(isItem){
      const effAll = budgetEffectiveItem(it, p);
      qtyVig = formatNumber(effAll.qty, settings.qtyDecimals);
      vuVig = formatMoney(effAll.vu, settings, cur);
      vtVig = formatMoney(effAll.vt, settings, cur);
    }else if(isSummary){
      qtyVig = "";
      vuVig = isAIU ? `${(Number(it.vuContract||0)*100).toFixed(2)}%` : "";
      vtVig = formatMoney(vtContract, settings, cur);
    }else{
      qtyVig = "";
      vuVig = "";
      vtVig = "";
    }

    const typeLabel = isSubtotal ? "SUBTOTAL" : it.type;

    return `
      <tr>
        <td><span class="badge ${badge}">${escapeHtml(typeLabel)}</span></td>
        <td>${escapeHtml(it.code || "")}</td>
        <td>${escapeHtml(it.desc || "")}</td>
        <td class="center">${escapeHtml(it.unit || "")}</td>
        ${baseCells}
        ${revCells}
        <td class="num">${qtyVig}</td>
        <td class="num">${vuVig}</td>
        <td class="num">${vtVig}</td>
      </tr>
    `;
  }).join("");

    const effAll = budgetEffectiveItem(it, p);
    return `
      <tr>
        <td><span class="badge ${badge}">${it.type}</span></td>
        <td>${escapeHtml(it.code)}</td>
        <td>${escapeHtml(it.desc)}</td>
        <td class="center">${escapeHtml(it.unit)}</td>
        ${baseCells}
        ${revCells}
        <td class="num">${formatNumber(effAll.qty, settings.qtyDecimals)}</td>
        <td class="num">${formatMoney(effAll.vu, settings, cur)}</td>
        <td class="num">${formatMoney(effAll.vt, settings, cur)}</td>
      </tr>
    `;
  }).join("");

  $("#budgetTable").innerHTML = `
    <table>
      <thead><tr>${th}</tr></thead>
      <tbody>${body}</tbody>
    </table>
  `;

  // update KPI contract value
  renderKPIs();
}

/* ---------------- Revisions UI ---------------- */
async function addRevisionFlow(){
  const p = getActiveProject();
  if(!p) return;
  const name = prompt("Nombre de la modificación (ej: MOD 1, OTROSI 2):", `MOD ${ (p.budget.revisions?.length||0) + 1 }`);
  if(!name) return;

  // simple: ask user to input changes via prompt? We'll create an empty revision and allow editing in future versions.
  // MVP: revision exists; you can later import changes by JSON import or we extend.
  const rev = {id: "rev_"+Math.random().toString(16).slice(2)+"_"+Date.now(), name, effectiveDate: null, changes: [], _show:true};
  p.budget.revisions.push(rev);
  await dbPutProject(p);
  toast("Modificación creada. (MVP: carga cambios vía Importar JSON o edítalo en futuras versiones)");
  renderBudget();
}

/* ---------------- Normalize quantities ---------------- */
async function normalizeBudgetQuantities(){
  const p = getActiveProject();
  if(!p) return;
  const dec = settings.qtyDecimals;
  for(const it of (p.budget.items||[])){
    if(it.type !== "ITEM") continue;
    it.qtyContract = roundByDecimals(it.qtyContract, dec);
  }
  await dbPutProject(p);
  toast(`Cantidades normalizadas a ${dec} decimales`);
  renderBudget();
}

/* ---------------- Reports ---------------- */
function ensureReportId(date){
  return "rep_" + date.replaceAll("-","") + "_" + Math.random().toString(16).slice(2);
}

function renderReportSelect(){
  const p = getActiveProject();
  const sel = $("#reportSelect");
  sel.innerHTML = "";
  if(!p){
    sel.innerHTML = `<option value="">—</option>`;
    return;
  }
  const reps = [...(p.reports||[])].sort((a,b)=> (a.cutoffDate||"").localeCompare(b.cutoffDate||""));
  if(reps.length === 0){
    sel.innerHTML = `<option value="">(sin reportes)</option>`;
  }else{
    for(const r of reps){
      const opt = document.createElement("option");
      opt.value = r.id;
      opt.textContent = `${r.label || "Reporte"} · ${r.cutoffDate}`;
      sel.appendChild(opt);
    }
  }
}

function getSelectedReport(project){
  const id = $("#reportSelect").value;
  return (project.reports||[]).find(r=>r.id === id) || null;
}

async function createNewReport(){
  const p = getActiveProject();
  if(!p) return;
  if((p.budget.items||[]).filter(i=>i.type==="ITEM").length === 0){
    toast("Primero carga el presupuesto.");
    return;
  }
  const cutoff = prompt("Fecha de corte (YYYY-MM-DD):", new Date().toISOString().slice(0,10));
  if(!cutoff) return;

  const label = prompt("Etiqueta (ej: Mes 12):", "");
  const start = prompt("Inicio del periodo (opcional, YYYY-MM-DD):", "");
  const end = cutoff;

  const rep = {
    id: ensureReportId(cutoff),
    cutoffDate: cutoff,
    label: label || cutoff,
    periodStart: start || "",
    periodEnd: end,
    notes: "",
    qtyAccumByItem: {}
  };

  // initialize accumulated with previous report if exists
  const prev = [...(p.reports||[])].filter(r=> (r.cutoffDate||"") < cutoff).sort((a,b)=> (a.cutoffDate||"").localeCompare(b.cutoffDate||"")).at(-1);
  const base = prev?.qtyAccumByItem || {};
  for(const it of (p.budget.items||[])){
    if(it.type !== "ITEM") continue;
    rep.qtyAccumByItem[it.codeNorm] = typeof base[it.codeNorm] === "number" ? base[it.codeNorm] : 0;
  }

  p.reports.push(rep);
  await dbPutProject(p);
  renderAll();
  // select new report
  $("#reportSelect").value = rep.id;
  renderReports();
  toast("Reporte creado");
}

async function deleteSelectedReport(){
  const p = getActiveProject();
  if(!p) return;
  const rep = getSelectedReport(p);
  if(!rep){
    toast("No hay reporte seleccionado.");
    return;
  }
  if(!confirm(`¿Borrar el reporte ${rep.label} (${rep.cutoffDate})?`)) return;
  p.reports = (p.reports||[]).filter(r=>r.id !== rep.id);
  await dbPutProject(p);
  renderAll();
  toast("Reporte borrado");
}

function previousReport(project, report){
  const cutoff = report.cutoffDate || "";
  return [...(project.reports||[])]
    .filter(r => (r.cutoffDate||"") < cutoff)
    .sort((a,b)=> (a.cutoffDate||"").localeCompare(b.cutoffDate||""))
    .at(-1) || null;
}

function computeExecutedValues(project, report){
  const prev = previousReport(project, report);
  const prevMap = prev?.qtyAccumByItem || {};
  const map = report.qtyAccumByItem || {};
  const cur = project.contract.currency || "COP";

  let accumVal = 0;
  let periodVal = 0;

  for(const it of (project.budget.items||[])){
    if(it.type !== "ITEM") continue;
    const eff = budgetEffectiveItem(it, project, report.cutoffDate);
    const qa = typeof map[it.codeNorm] === "number" ? map[it.codeNorm] : 0;
    const qp0 = typeof prevMap[it.codeNorm] === "number" ? prevMap[it.codeNorm] : 0;
    const qPeriod = qa - qp0;

    accumVal += qa * eff.vu;
    periodVal += qPeriod * eff.vu;
  }
  return {
    accumVal: roundByDecimals(accumVal, settings.moneyDecimals),
    periodVal: roundByDecimals(periodVal, settings.moneyDecimals),
    currency: cur
  };
}

function computeExecutedPct(project, report){
  const cv = contractValue(project, settings).value || 0;
  if(cv <= 0) return null;
  const v = computeExecutedValues(project, report);
  return v.accumVal / cv;
}

function renderReports(){
  const p = getActiveProject();
  if(!p){
    $("#reportMeta").innerHTML = "";
    $("#reportTable").innerHTML = "";
    $("#repExecAccum").textContent = "—";
    $("#repExecPeriod").textContent = "—";
    $("#repExecPct").textContent = "—";
    $("#chartExec").innerHTML = "—";
    return;
  }

  renderReportSelect();

  // keep selection
  if(!$("#reportSelect").value){
    const reps = [...(p.reports||[])].sort((a,b)=> (a.cutoffDate||"").localeCompare(b.cutoffDate||""));
    if(reps.length) $("#reportSelect").value = reps.at(-1).id;
  }

  const rep = getSelectedReport(p);
  if(!rep){
    $("#reportMeta").innerHTML = `<div class="card"><div class="muted">Crea un reporte para empezar.</div></div>`;
    $("#reportTable").innerHTML = "";
    return;
  }

  const prev = previousReport(p, rep);
  const prevMap = prev?.qtyAccumByItem || {};

  $("#reportMeta").innerHTML = `
    <div class="card soft">
      <div class="card-title">Corte</div>
      <div class="kv"><div class="k">Etiqueta</div><div class="v">${escapeHtml(rep.label||"")}</div></div>
      <div class="kv"><div class="k">Fecha corte</div><div class="v">${escapeHtml(rep.cutoffDate||"")}</div></div>
      <div class="kv"><div class="k">Periodo</div><div class="v">${escapeHtml(rep.periodStart||"")} → ${escapeHtml(rep.periodEnd||"")}</div></div>
    </div>
    <div class="card soft">
      <div class="card-title">Referencia</div>
      <div class="kv"><div class="k">Reporte anterior</div><div class="v">${prev ? `${escapeHtml(prev.label||"")} · ${escapeHtml(prev.cutoffDate||"")}` : "—"}</div></div>
      <div class="kv"><div class="k">Nota</div><div class="v">${escapeHtml(rep.notes||"")}</div></div>
    </div>
  `;

  const cur = p.contract.currency || "COP";
  const items = (p.budget.items||[]).filter(i=>i.type==="ITEM");
  // table
  const th = `
    <th>Código</th>
    <th>Descripción</th>
    <th class="center">Und</th>
    <th class="num">Cant. contrato (vig.)</th>
    <th class="num">Acum. anterior</th>
    <th class="num">Acum. actual (editable)</th>
    <th class="num">Periodo</th>
    <th class="num">VU vig.</th>
    <th class="num">Valor acum.</th>
    <th class="num">Valor periodo</th>
  `;
  const body = items.map(it=>{
    const eff = budgetEffectiveItem(it, p, rep.cutoffDate);
    const qaPrev = typeof prevMap[it.codeNorm] === "number" ? prevMap[it.codeNorm] : 0;
    const qa = typeof rep.qtyAccumByItem[it.codeNorm] === "number" ? rep.qtyAccumByItem[it.codeNorm] : 0;
    const qPeriod = qa - qaPrev;

    const warnExtra = settings.highlightExtraQty && decimalsCount(qa) > settings.qtyDecimals;
    const qtyClass = warnExtra ? "qty-warn" : "";

    return `
      <tr>
        <td>${escapeHtml(it.code)}</td>
        <td>${escapeHtml(it.desc)}</td>
        <td class="center">${escapeHtml(it.unit)}</td>
        <td class="num">${formatNumber(eff.qty, settings.qtyDecimals)}</td>
        <td class="num">${formatNumber(qaPrev, settings.qtyDecimals)}</td>
        <td class="num ${qtyClass}">
          <input class="inpQty" type="number" step="0.01" data-item="${escapeHtml(it.codeNorm)}" value="${qa}" />
        </td>
        <td class="num">${formatNumber(qPeriod, settings.qtyDecimals)}</td>
        <td class="num">${formatMoney(eff.vu, settings, cur)}</td>
        <td class="num">${formatMoney(qa*eff.vu, settings, cur)}</td>
        <td class="num">${formatMoney(qPeriod*eff.vu, settings, cur)}</td>
      </tr>
    `;
  }).join("");

  $("#reportTable").innerHTML = `
    <table>
      <thead><tr>${th}</tr></thead>
      <tbody>${body}</tbody>
    </table>
  `;

  // input handlers
  $$(".inpQty").forEach(inp=>{
    inp.addEventListener("input", ()=>{
      const codeNorm = inp.dataset.item;
      const n = parseNumber(inp.value);
      if(n === null) return;
      rep.qtyAccumByItem[codeNorm] = n;
      // highlight if too many decimals
      const extra = settings.highlightExtraQty && decimalsCount(n) > settings.qtyDecimals;
      inp.parentElement.classList.toggle("qty-warn", extra);
      // update totals live (lightweight)
      renderReportTotals(p, rep);
      renderKPIs();
      renderCharts();
    });
    inp.addEventListener("blur", ()=>{
      // enforce rounding to qtyDecimals for safer input
      const n = parseNumber(inp.value);
      if(n === null) return;
      const rounded = roundByDecimals(n, settings.qtyDecimals);
      if(rounded !== n){
        inp.value = rounded;
        rep.qtyAccumByItem[inp.dataset.item] = rounded;
        toast(`Cantidad redondeada a ${settings.qtyDecimals} decimales`);
      }
    });
  });

  renderReportTotals(p, rep);
  renderCharts();
}

function renderReportTotals(project, report){
  const v = computeExecutedValues(project, report);
  $("#repExecAccum").textContent = formatMoney(v.accumVal, settings, v.currency);
  $("#repExecPeriod").textContent = formatMoney(v.periodVal, settings, v.currency);

  const pct = computeExecutedPct(project, report);
  $("#repExecPct").textContent = pct === null ? "—" : `${(pct*100).toFixed(2)}%`;
}

async function saveCurrentReport(){
  const p = getActiveProject();
  if(!p) return;
  const rep = getSelectedReport(p);
  if(!rep) return;
  await dbPutProject(p);
  toast("Reporte guardado");
  renderAll();
}

/* ---------------- Finance ---------------- */
function renderFinance(){
  const p = getActiveProject();
  if(!p){
    $("#financeTable").innerHTML = "";
    $("#chartFinance").innerHTML = "—";
    $("#finPct").textContent = "—";
    $("#finAccum").textContent = "—";
    return;
  }
  const events = (p.finance.events||[]).slice().sort((a,b)=> (a.date||"").localeCompare(b.date||""));

  const html = `
    <table>
      <thead><tr>
        <th>Fecha</th><th>Tipo</th><th class="num">Valor</th><th>Nota</th><th></th>
      </tr></thead>
      <tbody>
        ${events.map((e, i)=>`
          <tr>
            <td><input type="date" data-fev="${i}" data-k="date" value="${e.date||""}"></td>
            <td>
              <select data-fev="${i}" data-k="type">
                <option value="ADVANCE" ${e.type==="ADVANCE"?"selected":""}>Anticipo</option>
                <option value="PAYMENT" ${e.type==="PAYMENT"?"selected":""}>Pago parcial</option>
              </select>
            </td>
            <td class="num"><input type="number" step="1" data-fev="${i}" data-k="amount" value="${e.amount??0}"></td>
            <td><input type="text" data-fev="${i}" data-k="note" value="${escapeHtml(e.note||"")}"></td>
            <td class="center"><button class="btn small danger" data-fevdel="${i}">X</button></td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
  $("#financeTable").innerHTML = html;

  // write back sorted events into project order
  p.finance.events = events;

  $$("[data-fev]").forEach(inp=>{
    inp.addEventListener("change", async ()=>{
      const idx = Number(inp.dataset.fev);
      const k = inp.dataset.k;
      const ev = p.finance.events[idx];
      if(!ev) return;
      if(k === "amount"){
        ev[k] = parseNumber(inp.value) ?? 0;
      }else{
        ev[k] = inp.value;
      }
      await dbPutProject(p);
      renderAll();
    });
  });
  $$("button[data-fevdel]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const idx = Number(btn.dataset.fevdel);
      p.finance.events.splice(idx,1);
      await dbPutProject(p);
      toast("Evento eliminado");
      renderAll();
    });
  });

  renderCharts();
}

async function addFinanceEvent(){
  const p = getActiveProject();
  if(!p) return;
  p.finance.events.push({date: new Date().toISOString().slice(0,10), type:"PAYMENT", amount:0, note:""});
  await dbPutProject(p);
  toast("Evento creado");
  renderFinance();
}

async function deleteLastFinanceEvent(){
  const p = getActiveProject();
  if(!p) return;
  if((p.finance.events||[]).length === 0){
    toast("No hay eventos.");
    return;
  }
  p.finance.events.pop();
  await dbPutProject(p);
  toast("Último evento borrado");
  renderFinance();
}

function financeAccumUpTo(project, cutoffDate){
  const date = cutoffDate || "9999-12-31";
  const sum = (project.finance.events||[])
    .filter(e => (e.date||"") <= date)
    .reduce((acc, e)=> acc + (Number(e.amount)||0), 0);
  return roundByDecimals(sum, settings.moneyDecimals);
}
function computeFinancePct(project, cutoffDate){
  const cv = contractValue(project, settings).value || 0;
  if(cv <= 0) return null;
  const acc = financeAccumUpTo(project, cutoffDate);
  return acc / cv;
}

/* ---------------- Planned import ---------------- */
function enablePlannedUI(enabled){
  $("#plannedSheetSelect").disabled = !enabled;
  $("#btnParsePlanned").disabled = !enabled;
}

function parsePlanned(rows){
  const warnings = [];
  if(!rows.length) return {curve:[], warnings:["Hoja vacía."]};

  const headerIdx = findHeaderRow(rows);
  const header = (rows[headerIdx] || []).map(h=> String(h??"").trim());
  const lower = header.map(h=>h.toLowerCase());

  // case A: columns with "fecha" and "costo"
  let iFecha = lower.findIndex(h=>h.includes("fecha"));
  let iCosto = lower.findIndex(h=>h.includes("costo") || h.includes("cost"));

  const points = [];

  if(iFecha >= 0 && iCosto >= 0){
    for(let r=headerIdx+1; r<rows.length; r++){
      const row = rows[r];
      if(!row) continue;
      const dRaw = row[iFecha];
      const cRaw = row[iCosto];
      const cost = parseNumber(cRaw);
      if(cost === null) continue;
      const date = toISODate(dRaw);
      if(!date) continue;
      points.push({date, cost});
    }
  }else{
    // case B: date columns (Project export: many date columns)
    const dateCols = [];
    for(let i=0;i<header.length;i++){
      const iso = toISODate(header[i]);
      if(iso) dateCols.push({i, date: iso});
    }
    if(dateCols.length < 3){
      warnings.push("No pude detectar columnas de fecha/costo. Intenta una hoja con columnas 'Fecha' y 'Costo', o una exportación con fechas como encabezados.");
      return {curve:[], warnings};
    }
    // sum costs per date across all rows
    const sumByDate = new Map(dateCols.map(c => [c.date, 0]));
    for(let r=headerIdx+1; r<rows.length; r++){
      const row = rows[r];
      if(!row) continue;
      for(const c of dateCols){
        const v = parseNumber(row[c.i]);
        if(v === null) continue;
        sumByDate.set(c.date, (sumByDate.get(c.date)||0) + v);
      }
    }
    for(const [date, cost] of sumByDate.entries()){
      points.push({date, cost});
    }
  }

  // normalize and accumulate
  const byDate = new Map();
  for(const p of points){
    byDate.set(p.date, (byDate.get(p.date)||0) + p.cost);
  }
  const sorted = [...byDate.entries()].sort((a,b)=>a[0].localeCompare(b[0]));
  let accum = 0;
  const curve = sorted.map(([date, cost])=>{
    accum += cost;
    return {date, plannedCostAccum: accum};
  });

  if(curve.length) warnings.push(`Programado: ${curve.length} punto(s) de curva cargados.`);
  return {curve, warnings};
}

function toISODate(v){
  if(v === null || v === undefined) return null;
  if(v instanceof Date) return v.toISOString().slice(0,10);
  if(typeof v === "number"){
    // Excel date serial (SheetJS can output numbers if raw)
    try{
      const d = XLSX.SSF.parse_date_code(v);
      if(d && d.y && d.m && d.d){
        const mm = String(d.m).padStart(2,"0");
        const dd = String(d.d).padStart(2,"0");
        return `${d.y}-${mm}-${dd}`;
      }
    }catch{}
  }
  const s = String(v).trim();
  // Try YYYY-MM-DD
  if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // Try DD/MM/YYYY or DD-MM-YYYY
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if(m){
    const dd = String(Number(m[1])).padStart(2,"0");
    const mm = String(Number(m[2])).padStart(2,"0");
    const yy = m[3];
    return `${yy}-${mm}-${dd}`;
  }
  // Month name etc: ignore in MVP
  return null;
}

function renderPlanned(){
  const p = getActiveProject();
  if(!p){
    $("#plannedWarnings").innerHTML = "";
    $("#plannedTable").innerHTML = "";
    return;
  }

  const curve = (p.planned.curve||[]).slice().sort((a,b)=>a.date.localeCompare(b.date));
  if(curve.length === 0){
    $("#plannedTable").innerHTML = `<div class="muted small">Aún no hay curva programada. Importa desde Excel.</div>`;
    return;
  }

  const cur = p.contract.currency || "COP";
  const rows = curve.slice(-120); // show last 120 points max
  $("#plannedTable").innerHTML = `
    <table>
      <thead><tr><th>Fecha</th><th class="num">Costo programado acumulado</th></tr></thead>
      <tbody>
        ${rows.map(r=>`
          <tr><td>${r.date}</td><td class="num">${formatMoney(r.plannedCostAccum, settings, cur)}</td></tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

/* ---------------- Charts ---------------- */
function renderCharts(){
  const p = getActiveProject();
  if(!p) return;

  const rep = getSelectedReport(p);
  // chart 1: planned vs executed (economic executed vs planned cost)
  if(rep){
    const series = buildPlannedVsExecutedSeries(p);
    $("#chartExec").innerHTML = series ? svgLineChart(series, {title:"Programado vs Ejecutado"}) : `<div class="muted small">Carga el programado para ver la curva.</div>`;
  }else{
    $("#chartExec").innerHTML = `<div class="muted small">Crea un reporte para ver el gráfico.</div>`;
  }

  // chart 2: finance vs executed (up to last report)
  const series2 = buildFinanceVsExecutedSeries(p);
  $("#chartFinance").innerHTML = series2 ? svgLineChart(series2, {title:"Financiero vs Ejecutado"}) : `<div class="muted small">Crea reportes y eventos financieros para ver el gráfico.</div>`;

  // finance KPIs based on selected report cutoff
  if(rep){
    const acc = financeAccumUpTo(p, rep.cutoffDate);
    const pct = computeFinancePct(p, rep.cutoffDate);
    $("#finAccum").textContent = formatMoney(acc, settings, p.contract.currency||"COP");
    $("#finPct").textContent = pct === null ? "—" : `${(pct*100).toFixed(2)}%`;
  }else{
    $("#finAccum").textContent = "—";
    $("#finPct").textContent = "—";
  }
}

function buildPlannedVsExecutedSeries(project){
  const curve = (project.planned.curve||[]).slice().sort((a,b)=>a.date.localeCompare(b.date));
  const reps = (project.reports||[]).slice().sort((a,b)=>(a.cutoffDate||"").localeCompare(b.cutoffDate||""));
  if(curve.length === 0 || reps.length === 0) return null;

  // planned pct by contract value
  const cv = contractValue(project, settings).value || 0;
  if(cv <= 0) return null;

  // shift planned by suspensions if enabled
  const plannedPct = curve.map(p=>{
    const date = settings.shiftPlannedBySuspensions ? shiftDateBySuspensions(p.date, project) : p.date;
    return {x: date, y: p.plannedCostAccum / cv};
  });

  const executedPct = reps.map(r=>{
    const y = computeExecutedPct(project, r);
    return {x: r.cutoffDate, y: y ?? 0};
  });

  return [
    {name:"Programado", points: plannedPct, color:"accent"},
    {name:"Ejecutado", points: executedPct, color:"ok"}
  ];
}

function shiftDateBySuspensions(dateISO, project){
  // MVP: Instead of shifting planned points, we "delay" planned date by total suspended days up to that date.
  // This approximates "congelar" el plan durante suspensión.
  const d = new Date(dateISO + "T00:00:00");
  if(Number.isNaN(d.getTime())) return dateISO;
  let extraDays = 0;
  for(const s of (project.suspensions||[])){
    if(!s.from || !s.to) continue;
    const a = new Date(s.from + "T00:00:00");
    const b = new Date(s.to + "T00:00:00");
    if(Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) continue;
    // if suspension is entirely before date
    if(b <= d){
      extraDays += Math.round((b - a) / (1000*60*60*24)) + 1;
    }
  }
  const shifted = new Date(d.getTime() + extraDays*24*60*60*1000);
  return shifted.toISOString().slice(0,10);
}

function buildFinanceVsExecutedSeries(project){
  const reps = (project.reports||[]).slice().sort((a,b)=>(a.cutoffDate||"").localeCompare(b.cutoffDate||""));
  if(reps.length === 0) return null;
  const cv = contractValue(project, settings).value || 0;
  if(cv <= 0) return null;

  const fin = reps.map(r=>{
    const acc = financeAccumUpTo(project, r.cutoffDate);
    return {x: r.cutoffDate, y: acc / cv};
  });
  const exec = reps.map(r=>{
    const y = computeExecutedPct(project, r);
    return {x: r.cutoffDate, y: y ?? 0};
  });
  return [
    {name:"Financiero (bruto)", points: fin, color:"warn"},
    {name:"Ejecutado", points: exec, color:"ok"}
  ];
}

// Pure-SVG line chart (no external libs)
function svgLineChart(series, opts={}){
  const width = 780;
  const height = 240;
  const pad = {l:48, r:18, t:18, b:30};

  // collect x-values and y-range
  const allPts = series.flatMap(s => s.points || []);
  if(allPts.length === 0) return `<div class="muted small">Sin datos.</div>`;

  const xs = [...new Set(allPts.map(p=>p.x))].sort();
  const xIndex = new Map(xs.map((x,i)=>[x,i]));
  const xMax = Math.max(1, xs.length-1);

  let yMin = 0;
  let yMax = Math.max(...allPts.map(p=>p.y));
  yMax = Math.max(0.05, yMax);
  yMax = Math.min(1.0, Math.ceil(yMax*10)/10);

  const xScale = (x)=> pad.l + (xIndex.get(x) ?? 0) / xMax * (width - pad.l - pad.r);
  const yScale = (y)=> pad.t + (1 - (y - yMin)/(yMax - yMin)) * (height - pad.t - pad.b);

  const gridY = [];
  for(let i=0;i<=5;i++){
    const yy = yMin + (yMax-yMin)*(i/5);
    gridY.push(yy);
  }

  const pathFor = (pts)=>{
    const valid = pts.filter(p=>xIndex.has(p.x));
    if(valid.length === 0) return "";
    const d = valid.map((p, i)=>{
      const X = xScale(p.x);
      const Y = yScale(p.y);
      return (i===0?`M ${X} ${Y}`:`L ${X} ${Y}`);
    }).join(" ");
    return d;
  };

  const xTicks = xs.length <= 6 ? xs : [xs[0], xs[Math.floor(xs.length/3)], xs[Math.floor(xs.length*2/3)], xs.at(-1)].filter(Boolean);

  return `
  <svg viewBox="0 0 ${width} ${height}" width="100%" height="100%" role="img" aria-label="${escapeHtml(opts.title||"Gráfico")}">
    <!-- grid -->
    ${gridY.map(v=>{
      const y = yScale(v);
      return `<line x1="${pad.l}" y1="${y}" x2="${width-pad.r}" y2="${y}" stroke="rgba(148,163,184,.18)" />`;
    }).join("")}

    <!-- y labels -->
    ${gridY.map(v=>{
      const y = yScale(v);
      return `<text x="${pad.l-8}" y="${y+4}" fill="rgba(156,163,175,.85)" font-size="11" text-anchor="end">${(v*100).toFixed(0)}%</text>`;
    }).join("")}

    <!-- x axis -->
    <line x1="${pad.l}" y1="${height-pad.b}" x2="${width-pad.r}" y2="${height-pad.b}" stroke="rgba(148,163,184,.28)" />

    <!-- x labels -->
    ${xTicks.map(x=>{
      const X = xScale(x);
      return `<text x="${X}" y="${height-10}" fill="rgba(156,163,175,.85)" font-size="11" text-anchor="middle">${escapeHtml(x.slice(5))}</text>`;
    }).join("")}

    <!-- series paths -->
    ${series.map((s, si)=>{
      const d = pathFor(s.points||[]);
      const stroke = si===0 ? "rgba(96,165,250,.95)" : (si===1 ? "rgba(52,211,153,.95)" : "rgba(251,191,36,.95)");
      return `
        <path d="${d}" fill="none" stroke="${stroke}" stroke-width="2.4" />
        ${(s.points||[]).slice(-1).map(p=>{
          const X = xScale(p.x);
          const Y = yScale(p.y);
          return `<circle cx="${X}" cy="${Y}" r="3.5" fill="${stroke}" />`;
        }).join("")}
      `;
    }).join("")}

    <!-- legend -->
    ${series.map((s, i)=>{
      const y = 14 + i*14;
      const stroke = i===0 ? "rgba(96,165,250,.95)" : (i===1 ? "rgba(52,211,153,.95)" : "rgba(251,191,36,.95)");
      return `
        <rect x="${pad.l}" y="${y-8}" width="10" height="3" fill="${stroke}" />
        <text x="${pad.l+14}" y="${y-5}" fill="rgba(229,231,235,.95)" font-size="12">${escapeHtml(s.name)}</text>
      `;
    }).join("")}
  </svg>`;
}

/* ---------------- Utilities ---------------- */
function escapeHtml(s){
  return String(s ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
}

/* ---------------- Export/Import ---------------- */
async function exportJSON(){
  // Read from DB to make sure the export is always consistent
  const freshProjects = await dbGetAllProjects();
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    settings,
    projects: freshProjects
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `CONTROL_export_${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ---------------- PWA update (backup then refresh) ---------------- */
let swReg = null;

function showUpdateButton(show){
  const b = $("#btnUpdate");
  if(!b) return;
  b.hidden = !show;
}

function markUpdateAvailable(){
  showUpdateButton(true);
  toast("Nueva versión lista. Pulsa 'Actualizar' (haré backup antes).");
}

async function registerServiceWorker(){
  if(!('serviceWorker' in navigator)) return;
  try{
    swReg = await navigator.serviceWorker.register('./sw.js');

    // If there's already an update waiting (edge cases)
    if(swReg.waiting && navigator.serviceWorker.controller){
      markUpdateAvailable();
    }

    swReg.addEventListener('updatefound', ()=>{
      const nw = swReg.installing;
      if(!nw) return;
      nw.addEventListener('statechange', ()=>{
        // 'installed' + controller means: update ready, old version was controlling
        if(nw.state === 'installed' && navigator.serviceWorker.controller){
          markUpdateAvailable();
        }
      });
    });

    // Optional: check for updates occasionally
    setInterval(()=> swReg?.update?.().catch(()=>{}), 60*60*1000);
  }catch{
    // ignore
  }
}

async function updateWithBackup(){
  // Backup
  try{ await exportJSON(); }catch{}

  // Trigger SW activation if there's a waiting worker
  const waiting = swReg?.waiting;
  if(waiting){
    toast("Actualizando…");
    waiting.postMessage({type:"SKIP_WAITING"});
    // When the new SW takes control, reload to pick up fresh assets
    await new Promise((resolve)=>{
      let done = false;
      const onChange = ()=>{
        if(done) return;
        done = true;
        navigator.serviceWorker.removeEventListener('controllerchange', onChange);
        resolve(true);
      };
      navigator.serviceWorker.addEventListener('controllerchange', onChange);
      setTimeout(()=>{
        if(done) return;
        navigator.serviceWorker.removeEventListener('controllerchange', onChange);
        resolve(false);
      }, 4000);
    });
    window.location.reload();
    return;
  }

  // No waiting worker: do a normal reload (will fetch latest from network)
  try{ await swReg?.update?.(); }catch{}
  window.location.reload();
}

async function importJSON(file){
  const txt = await file.text();
  const payload = JSON.parse(txt);
  if(!payload || !Array.isArray(payload.projects)){
    toast("JSON inválido.");
    return;
  }
  // settings
  if(payload.settings){
    settings = {...settings, ...payload.settings};
    saveSettings(settings);
    applySettingsToUI();
  }

  // write projects to DB
  for(const p of payload.projects){
    await dbPutProject(p);
  }
  projects = await dbGetAllProjects();
  if(projects.length) setActiveProject(projects[0].id);
  toast("Importación completada");
  renderAll();
}

/* ---------------- Wire up events ---------------- */
function wireEvents(){
  // Project actions
  $("#btnNewProject").addEventListener("click", async ()=>{
    const p = newProject();
    await dbPutProject(p);
    projects = await dbGetAllProjects();
    setActiveProject(p.id);
    toast("Proyecto creado");
    renderAll();
  });

  $("#btnDeleteProject").addEventListener("click", async ()=>{
    const p = getActiveProject();
    if(!p) return;
    if(!confirm(`¿Borrar el proyecto "${p.name}"?`)) return;
    await dbDeleteProject(p.id);
    projects = await dbGetAllProjects();
    activeProjectId = projects[0]?.id || null;
    localStorage.setItem("CONTROL_ACTIVE_PROJECT", activeProjectId || "");
    toast("Proyecto borrado");
    renderAll();
  });

  $("#projectSelect").addEventListener("change", ()=>{
    setActiveProject($("#projectSelect").value);
  });

  $("#btnSaveProject").addEventListener("click", async ()=>{
    const p = getActiveProject();
    if(!p) return;
    p.name = $("#p_name").value.trim() || p.name;
    p.contract.currency = $("#p_currency").value;
    p.contract.startDate = $("#p_start").value;
    p.contract.initialEndDate = $("#p_end").value;

    p.parties.owner.name = $("#p_owner_name").value;
    p.parties.owner.nit = $("#p_owner_nit").value;
    p.parties.owner.rep = $("#p_owner_rep").value;

    p.parties.contractor.name = $("#p_contractor_name").value;
    p.parties.contractor.nit = $("#p_contractor_nit").value;
    p.parties.contractor.rep = $("#p_contractor_rep").value;

    p.parties.interventoria.name = $("#p_inter_name").value;
    p.parties.interventoria.nit = $("#p_inter_nit").value;
    p.parties.interventoria.rep = $("#p_inter_rep").value;

    await dbPutProject(p);
    toast("Proyecto guardado");
    renderAll();
  });

  $("#btnAddSuspension").addEventListener("click", async ()=>{
    const p = getActiveProject();
    if(!p) return;
    p.suspensions.push({from:"", to:"", reason:""});
    await dbPutProject(p);
    toast("Suspensión agregada");
    renderSuspensions();
  });

  
  // PWA install (Android/Chrome/Edge)
  let deferredInstallPrompt = null;
  const installBtn = $("#btnInstall");
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandaloneIOS = (window.navigator.standalone === true);

  window.addEventListener("beforeinstallprompt", (e) => {
    // Chrome/Edge: we can show our own install button
    e.preventDefault();
    deferredInstallPrompt = e;
    if (installBtn) installBtn.hidden = false;
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    if (installBtn) installBtn.hidden = true;
    toast("CONTROL instalado ✅");
  });

  if (installBtn) {
    installBtn.addEventListener("click", async () => {
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        try { await deferredInstallPrompt.userChoice; } catch {}
        deferredInstallPrompt = null;
        installBtn.hidden = true;
        return;
      }
      // iOS (Safari) doesn't fire beforeinstallprompt
      if (isIOS && !isStandaloneIOS) {
        toast("En iPhone/iPad: Compartir → 'Añadir a pantalla de inicio'");
      } else {
        toast("Instalación no disponible aquí. Usa Chrome/Edge o agrega a pantalla de inicio.");
      }
    });
  }

// Settings
  $("#btnSettings").addEventListener("click", ()=>{
    $("#settingsDialog").showModal();
  });
  $("#btnSaveSettings").addEventListener("click", async ()=>{
    settings.moneyDecimals = Number($("#setMoneyDecimals").value);
    settings.qtyDecimals = Number($("#setQtyDecimals").value);
    settings.highlightExtraQty = $("#setHighlightExtraQty").checked;
    settings.shiftPlannedBySuspensions = $("#setShiftPlannedBySuspensions").checked;
    saveSettings(settings);
    toast("Ajustes guardados");
    renderAll();
  });

  // Export / import
  $("#btnExport").addEventListener("click", exportJSON);
  $("#btnUpdate")?.addEventListener("click", updateWithBackup);
  $("#jsonImport").addEventListener("change", async (e)=>{
    const file = e.target.files?.[0];
    if(!file) return;
    await importJSON(file);
    e.target.value = "";
  });

  // Budget import
  $("#budgetFile").addEventListener("change", async (e)=>{
    const file = e.target.files?.[0];
    if(!file) return;
    const data = await file.arrayBuffer();
    activeBudgetWorkbook = XLSX.read(data, {type:"array"});
    const names = sheetNames(activeBudgetWorkbook);
    const sel = $("#budgetSheetSelect");
    sel.innerHTML = names.map(n=>`<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("");
    enableBudgetUI(true);
    toast("Excel cargado. Selecciona la hoja y presiona 'Leer hoja'.");
  });

  $("#btnParseBudget").addEventListener("click", async ()=>{
    const p = getActiveProject();
    if(!p){
      toast("Crea/selecciona un proyecto primero.");
      return;
    }
    const sheet = $("#budgetSheetSelect").value;
    const rows = rowsFromSheet(activeBudgetWorkbook, sheet);
    const parsed = parseBudgetFromSheet(rows);

    p.budget.items = parsed.items;
    // clear revisions? keep existing
    await dbPutProject(p);

    $("#budgetWarnings").innerHTML = (parsed.warnings||[]).map(w=>`<div class="warning">${escapeHtml(w)}</div>`).join("");
    toast("Presupuesto cargado");
    renderBudget();
  });

  $("#btnAddRevision").addEventListener("click", addRevisionFlow);
  $("#btnNormalizeQty").addEventListener("click", normalizeBudgetQuantities);

  $("#toggleShowBase").addEventListener("change", ()=>{
    renderBudget();
  });

  // Reports
  $("#reportSelect").addEventListener("change", ()=> renderReports());
  $("#btnNewReport").addEventListener("click", createNewReport);
  $("#btnDeleteReport").addEventListener("click", deleteSelectedReport);
  $("#btnSaveReport").addEventListener("click", saveCurrentReport);

  // Finance
  $("#btnAddFinanceEvent").addEventListener("click", addFinanceEvent);
  $("#btnDeleteFinanceEvent").addEventListener("click", deleteLastFinanceEvent);

  // Planned import
  $("#plannedFile").addEventListener("change", async (e)=>{
    const file = e.target.files?.[0];
    if(!file) return;
    const data = await file.arrayBuffer();
    activePlannedWorkbook = XLSX.read(data, {type:"array"});
    const names = sheetNames(activePlannedWorkbook);
    const sel = $("#plannedSheetSelect");
    sel.innerHTML = names.map(n=>`<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("");
    enablePlannedUI(true);
    toast("Excel de programado cargado. Selecciona la hoja y 'Leer hoja'.");
  });

  $("#btnParsePlanned").addEventListener("click", async ()=>{
    const p = getActiveProject();
    if(!p){
      toast("Crea/selecciona un proyecto primero.");
      return;
    }
    const sheet = $("#plannedSheetSelect").value;
    const rows = rowsFromSheet(activePlannedWorkbook, sheet);
    const parsed = parsePlanned(rows);
    p.planned.curve = parsed.curve;
    await dbPutProject(p);
    $("#plannedWarnings").innerHTML = (parsed.warnings||[]).map(w=>`<div class="warning">${escapeHtml(w)}</div>`).join("");
    toast("Programado cargado");
    renderAll();
  });
}

function applySettingsToUI(){
  $("#setMoneyDecimals").value = String(settings.moneyDecimals);
  $("#setQtyDecimals").value = String(settings.qtyDecimals);
  $("#setHighlightExtraQty").checked = !!settings.highlightExtraQty;
  $("#setShiftPlannedBySuspensions").checked = !!settings.shiftPlannedBySuspensions;
}

/* ---------------- Main render ---------------- */
function renderProjectSelect(){
  const sel = $("#projectSelect");
  sel.innerHTML = "";
  if(projects.length === 0){
    sel.innerHTML = `<option value="">(sin proyectos)</option>`;
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  for(const p of projects){
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = projectLabel(p);
    sel.appendChild(opt);
  }
  sel.value = activeProjectId || projects[0].id;
}

function renderAll(){
  renderProjectSelect();
  renderKPIs();
  const p = getActiveProject();
  if(p){
    renderProjectForm();
    renderBudget();
    renderReports();
    renderFinance();
    renderPlanned();
  }else{
    $("#budgetTable").innerHTML = "";
    $("#reportTable").innerHTML = "";
    $("#financeTable").innerHTML = "";
    $("#plannedTable").innerHTML = "";
  }
}

async function init(){
  initTabs();
  applySettingsToUI();
  wireEvents();
  await registerServiceWorker();

  projects = await dbGetAllProjects();
  const stored = localStorage.getItem("CONTROL_ACTIVE_PROJECT");
  activeProjectId = stored && projects.some(p=>p.id===stored) ? stored : (projects[0]?.id || null);

  renderAll();
}

init();
