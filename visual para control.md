# Identidad Visual: Logi Kinetic (Acid Neon System)
Este documento detalla el ADN estético de **Logi Kinetic** para su transposición al ecosistema **CONTROL**. El diseño se basa en el sistema *Stitch Design* con una variante "Acid Neon" de alto rendimiento.

---

## 🎨 Paleta de Colores (Tokens de Diseño)

La paleta está diseñada para maximizar el contraste en entornos de obra (sol directo) y elegancia técnica en oficina.

### Modo Oscuro (Principal)
- **Primary (Acid Neon):** `#CAFD00` (El corazón de la interfaz).
- **Background Main:** `#000000` (Negro absoluto para profundidad).
- **Surface Glass:** `rgba(10, 10, 11, 0.8)` (Efecto cristal translúcido).
- **Surface Card:** `#121214` (Gris técnico profundo).
- **Text Primary:** `#F6F2FA` (Blanco con tinte violeta mínimo para reducir fatiga).
- **On Surface Variant:** `#ACAAB1` (Gris para metadatos y etiquetas secundarias).

### Modo Claro (Fuerza Nuclear)
- **Background Main:** `#F5F7FA` (Gris azulado muy suave).
- **Surface Glass:** `rgba(255, 255, 255, 0.95)` (Cristal blanco de alta opacidad).
- **Text Primary:** `#0F172A` (Azul marino casi negro para legibilidad crítica).

---

## ✨ Sistema de Cristalismo (Glassmorphism)

El look "Premium" se logra mediante capas de vidrio técnico.

- **Desenfoque (Blur):** `25px` mínimo (`backdrop-filter: blur(25px)`).
- **Saturación:** `180%` a `250%` en modo claro para realzar colores subyacentes.
- **Bordes:** `1px solid rgba(202, 253, 0, 0.2)` (Borde neón sutil).
- **Sombra:** `0 8px 32px 0 rgba(0, 0, 0, 0.6)`.

---

## 🖋️ Tipografía

- **Headlines (Títulos Técnicos):** `Space Grotesk` (Geométrica, moderna, técnica).
- **Body & Data:** `Inter` (Optimizado para legibilidad en listas densas).
- **Estilo de Texto:** `letter-spacing: 0.4em` en encabezados de sección para un look "Aerospace".

---

## 🕯️ Efectos Neón y Sombras

Para destacar elementos de acción (Botón Captura, Sync):
- **Neon Glow:** `text-shadow: 0 0 10px rgba(202, 253, 0, 0.4)`.
- **Neon Shadow:** `box-shadow: 0 0 15px rgba(202, 253, 0, 0.4)`.
- **Animación Pulse:** Una pulsación suave (`3s infinite`) que oscila el `drop-shadow`.

---

## 📏 Arquitectura de Componentes (Estilo Zapatas)

- **Espaciados:** Compactos (`padding: 0.75rem` en tarjetas).
- **Radios de Curvatura:**
  - Botones y Tarjetas: `1.25rem` (20px).
  - Halos de selección: `1rem`.
- **Densidad de Información:** Alta pero jerarquizada. Los metadatos (fechas, IDs) siempre en `On Surface Variant` con fuentes pequeñas (`0.75rem`).
- **Interacción:** Sin bordes rígidos en modo claro; uso de sombras suaves para separar planos.

---

## 🛠️ Reglas de Implementación en CONTROL

1. **Inmutabilidad:** Las vistas deben ser módulos independientes (Regla de Oro).
2. **Icons:** Uso exclusivo de `Material Symbols Outlined`.
3. **Scroll:** Scrollbars ocultas (`width: 0px`) para sensación de app nativa.
4. **Imágenes:** Filtro de contraste `1.08` y saturación `1.15` para evitar el "efecto lavado" en las fotos de obra.

---
*Documento generado para la sincronización estética Logi <-> Control.*
