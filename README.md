# RotaPro

Gestión de turnos laborales de escritorio: calendario híbrido (mes + vista semanal TimeGrid), planner drag & drop, turnos solapados side-by-side, overnight partido, emoji en plantillas, selector de color ilimitado con armonías cromáticas, 4 formatos laborales y personalización de tema (claro/oscuro/sistema), acento y densidad, con animaciones que respetan `prefers-reduced-motion`.

## Stack

- **Tauri v2** — shell de escritorio (Rust + WebView nativo)
- **React + TypeScript + Vite** — frontend
- **Tailwind CSS v4** — estilos (variables CSS)
- **SQLite** vía **rusqlite** — persistencia local

## Requisitos

- Node.js ≥ 20
- Rust (stable)
- Linux — dependencias del sistema:

```bash
# Fedora / dnf
sudo dnf install pkgconf-pkg-config dbus-devel gtk3-devel webkit2gtk4.1-devel librsvg2-devel libsoup3-devel openssl-devel
```

```bash
# Debian / Ubuntu / apt
sudo apt install pkg-config libdbus-1-dev libgtk-3-dev libwebkit2gtk-4.1-dev librsvg2-dev libsoup-3.0-dev libssl-dev
```

## Desarrollo

```bash
npm install
npm run tauri dev
```

## Pruebas

```bash
npm test
cargo test --manifest-path src-tauri/Cargo.toml
```

## Build de release

```bash
npm run tauri build
```

## Estructura

La arquitectura y el esquema de datos están documentados en [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Guía rápida de uso

- **Planner**: arrastra una plantilla de turno (Mañana, Tarde, Noche, Guardia 24h) a un día del calendario para asignarla.
- **Cambio mes/semana**: alterna entre el calendario mensual y la vista semanal TimeGrid (turnos posicionados por hora, solapamientos side-by-side, overnight partido en dos segmentos).
- **Crear turno con emoji y color**: en el form "+ Turno" elige un emoji y un color (picker con swatches + armonías cromáticas) antes de guardar la plantilla.
- **Borrar**: pasa el cursor sobre una asignación y pulsa el botón **×** para eliminarla.
- **Ajustes**: abre el panel de configuración con el engranaje para cambiar tema (claro/oscuro/sistema), acento y densidad.
