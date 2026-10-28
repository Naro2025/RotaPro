# RotaPro 📅

RotaPro es una aplicación de escritorio de alto rendimiento diseñada para profesionales con horarios no tradicionales (turnos rotativos, guardias, fines de semana). Construida con un enfoque moderno y optimizado para Windows, macOS y Linux.

## ✨ Características
- **Planificador visual:** Arrastrar y soltar turnos (drag & drop) en vista mensual y semanal.
- **Gestión de turnos:** Soporte para Full-time, Part-time, Guardias y turnos nocturnos (overnight).
- **Personalización total:** Modo claro/oscuro, densidad de la interfaz, colores HEX personalizados y emojis.
- **Exportación:** Sincronización de turnos con Google Calendar, Apple Calendar u Outlook mediante archivos `.ics` (iCalendar).
- **Alto rendimiento:** Motor de solapamiento propio en TS puro. Consumo de memoria < 80MB.

## 🛠️ Stack Tecnológico
- **Frontend:** React + TypeScript + Tailwind CSS + Framer Motion
- **Backend:** Rust + Tauri v2
- **Base de Datos:** SQLite

## 🚀 Instalación (Desarrollo)
1. Clona el repositorio: `git clone https://github.com/TU_USUARIO/RotaPro.git`
2. Instala dependencias: `npm install`
3. Corre en modo desarrollo: `npm run tauri dev`

## 📦 Generar Instaladores
Para compilar la versión de producción:
`npm run tauri build`

*(Aquí puedes añadir las capturas de pantalla que me mostraste, subiéndolas al repositorio y enlazándolas con `![Vista Mensual](ruta/a/tu/imagen.png)`)*
