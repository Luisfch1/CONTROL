# CONTROL

App web (PWA) para control de obra: **presupuesto**, **reportes de avance (acumulados)**, **financiero (bruto)** y **comparativos con programado**.

## Cómo ejecutar

Opción 1 (recomendado): servidor local

```bash
# con Python
python -m http.server 8000
# abre http://localhost:8000
```

Opción 2: Live Server (VS Code)

## Notas de diseño (MVP)

- Valor contrato vigente: suma de `cantidad * valor unitario` (aplicando redondeo configurado).
- Cantidades: se editan/visualizan con decimales configurados (por defecto 2).  
  Si el presupuesto trae más decimales de lo permitido, se **resalta** y se avisa.
- Reportes: ingreso por **acumulado** (CONTROL calcula el periodo por diferencia).

## Estructura

- `index.html` UI
- `app.js` lógica
- `styles.css` estilos
- `xlsx.full.min.js` SheetJS (local, para modo offline)
- `sw.js` service worker para cache offline
- `manifest.webmanifest` manifiesto PWA


## Instalar como app (icono)
- **Android (Chrome) / Windows / Mac (Chrome/Edge):** abre la URL en HTTPS y usa el botón **Instalar** (o el ícono de instalación en la barra de direcciones).
- **iPhone/iPad (Safari):** botón **Compartir** → **Añadir a pantalla de inicio**.

> Nota: para que aparezca instalar, debe estar servido por **HTTPS** (GitHub Pages sirve perfecto).
