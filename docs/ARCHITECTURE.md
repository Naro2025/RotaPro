# RotaPro — Arquitectura

App de escritorio de gestión de turnos. Greenfield, local-first, single-user.
Stack fijo: **Tauri v2** (Rust + WebView nativo) · **React + TypeScript + Vite** · **Tailwind CSS** (variables CSS) · **SQLite en backend Rust**. Windows / Linux / macOS.

## 1. Decisiones clave

- **SQLite vía `rusqlite` (feature `bundled`) + comandos custom, NO `tauri-plugin-sql`.**
  Verificado (oct 2026): `tauri-plugin-sql` v2.6.0 usa `sqlx` (runtime async/tokio, sqlite/mysql/postgres). `rusqlite` v0.41.0 es FFI directo con SQLite vendored. Para CRUD + escaneos por rango no hace falta runtime async ni pooling; evita `tokio`+`sqlx` → binario y RAM menores (objetivo <80MB) y arranque <1s.
- **UUID v7** (time-ordered) como `TEXT` en todas las PK: índice natural, estable para sync.
- **`uid` estable en `assignments`** = UID del VEVENT iCal, independiente de la PK para que el sync futuro adopte el UID remoto sin tocar FKs.
- **Fechas/horas en hora local** (`YYYY-MM-DD`, `HH:MM`) como `TEXT`: single-user local-first, sin tz. Riesgo asumido (§7).
- **Sin recurrencia** (RRULE) por ahora: drag&drop = una fila por día; se añade por `ALTER TABLE` con el sync.
- **Rango de días = N assignments individuales** (uid v7 por día), idempotente por (fecha, plantilla): estirar un turno inserta solo los días que faltan.
- **Settings clave-valor** (`key`/`value`): cubre tema/acento/densidad y es extensible sin migraciones.
- **Seguridad deny-by-default**: `capabilities/default.json` lista solo los comandos IPC expuestos; sin `fs`/`shell`/red.
- **Taxonomía fija**: 4 formatos (`work_formats`) y 4 plantillas base (`shift_templates`) seeded en la primera migración.
- **Librerías UI congeladas**: solo **Inter Variable** (tipografía) y **motion** (animaciones) autorizadas (Fase 3.5). `@dnd-kit` descartado (no usa HTML5 DnD nativo → riesgo sobre `useDayDrop`) y las librerías de calendario (`schedule-x` / `react-big-calendar` / `FullCalendar`) descartadas porque reemplazan las vistas custom.
- **Plugin de diálogo autorizado (Fase 4, explícito del usuario)**: **tauri-plugin-dialog** (cargo) + **@tauri-apps/plugin-dialog** (npm) para el diálogo nativo de guardado del `.ics`; permiso `dialog:allow-save` en `capabilities/default.json`. Sigue deny-by-default: sin `fs`/`shell`/red.
- **Overnight derivado**: `end_time <= start_time`; `is_overnight` en las respuestas Rust es enriquecimiento computado (no columna), siempre consistente ante ediciones.

## 2. Esquema SQLite

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Formatos laborales (taxonomía fija, seeded)
CREATE TABLE work_formats (
  id         TEXT PRIMARY KEY,               -- UUID v7
  code       TEXT NOT NULL UNIQUE,           -- 'full_time'|'part_time'|'shift_work'|'on_call'
  name       TEXT NOT NULL,                  -- 'Full-time'|'Part-time'|'Por Turnos'|'Guardias/Disponibilidad'
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- Plantillas de turno (Mañana, Tarde, Noche, Guardia 24h)
CREATE TABLE shift_templates (
  id             TEXT PRIMARY KEY,           -- UUID v7
  work_format_id TEXT NOT NULL REFERENCES work_formats(id) ON DELETE RESTRICT,
  code           TEXT NOT NULL UNIQUE,       -- 'morning'|'afternoon'|'night'|'guard_24h'
  name           TEXT NOT NULL,
  start_time     TEXT NOT NULL,              -- 'HH:MM' hora local
  end_time       TEXT NOT NULL,              -- 'HH:MM'
  color          TEXT NOT NULL,              -- '#RRGGBB'
  emoji          TEXT NOT NULL DEFAULT '',   -- emoji identificador opcional (migración aditiva, Fase 3.5)
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Asignaciones plantilla → día (un VEVENT por fila)
CREATE TABLE assignments (
  id               TEXT PRIMARY KEY,         -- UUID v7 (interno)
  uid              TEXT NOT NULL UNIQUE,     -- UID estable sync iCal (default = id al crear)
  shift_template_id TEXT NOT NULL REFERENCES shift_templates(id) ON DELETE CASCADE,
  date             TEXT NOT NULL,            -- 'YYYY-MM-DD' hora local
  start_time       TEXT,                     -- override opcional 'HH:MM'
  end_time         TEXT,                     -- override opcional 'HH:MM'
  notes            TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Índices para queries por rango de fechas (vista mes/semana)
CREATE INDEX idx_assignments_date     ON assignments(date);
CREATE INDEX idx_assignments_template ON assignments(shift_template_id);
CREATE INDEX idx_shift_templates_fmt  ON shift_templates(work_format_id);

-- Settings clave-valor (tema / acento / densidad + futuros)
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,                    -- 'theme'|'accent'|'density'|...
  value TEXT NOT NULL
);
```

`work_formats.code` clasifica cada plantilla → 4 formatos laborales. `shift_templates` = 4 plantillas con hora inicio/fin y color. `assignments` mapea plantilla→día con `uid` estable. Rango de fechas: `WHERE date BETWEEN ?1 AND ?2` (usa `idx_assignments_date`); el `UNIQUE(uid)` ya crea índice implícito.

**Migración `emoji` (Fase 3.5)**: `ALTER TABLE shift_templates ADD COLUMN emoji TEXT NOT NULL DEFAULT ''` se aplica solo si la columna aún no existe, vía `column_exists` (`PRAGMA table_info`) en `db.rs`. Aditiva e idempotente, **sin** `PRAGMA user_version`; las BDs existentes sobreviven sin pérdida.

## 3. Estructura de carpetas (máx 2 niveles)

```
rotapro/
├── docs/ARCHITECTURE.md
├── src-tauri/
│   ├── Cargo.toml · tauri.conf.json · build.rs
│   ├── capabilities/default.json
│   ├── icons/
│   └── src/
│       ├── main.rs          # entrypoint → lib::run()
│       ├── lib.rs           # Builder: .manage(AppState), .invoke_handler, migraciones
│       ├── db.rs            # rusqlite (bundled) + DDL + migración emoji idempotente + seeds
│       ├── models.rs        # structs serde (ShiftTemplate, Assignment, ...)
│       ├── commands.rs      # todos los #[tauri::command] (+ *_impl testeables)
│       └── ics.rs           # exportación iCalendar (RFC 5545) puro, testeable
├── src/
│   ├── main.tsx · App.tsx
│   ├── index.css            # @tailwind v4 (config vía CSS, sin tailwind.config.ts)
│   ├── theme.css            # variables claro/oscuro/acento/densidad + --hour-h
│   ├── types.ts             # tipos TS espejo de models.rs
│   ├── api.ts               # wrappers invoke()
│   ├── vite-env.d.ts
│   ├── components/
│   │   ├── CalendarView.tsx # contenedor mes/semana (transición motion)
│   │   ├── MonthView.tsx · WeekView.tsx · DayCell.tsx (+ DayCell.test.ts)
│   │   ├── Planner.tsx      # drag&drop plantillas + form "+ Turno"
│   │   ├── SettingsPanel.tsx # tema/densidad/acento/export .ics (usa ColorPicker)
│   │   ├── ColorPicker.tsx  # picker compartido (turnos + acento)
│   │   └── RangeDialog.tsx  # asignación a rango de días
│   ├── hooks/
│   │   ├── useDayDrop.ts    # drop HTML5 DnD nativo + TEMPLATE_MIME
│   │   └── useTheme.ts      # tema claro/oscuro/sistema
│   ├── utils/
│   │   ├── overlap.ts       # packOverlaps / buildDayShifts (+ overlap.test.ts)
│   │   ├── timegrid.ts      # daySegments / visibleSegments (+ timegrid.test.ts)
│   │   ├── color.ts         # contrastText / colorHarmonies (+ color.test.ts)
│   │   └── date.ts          # helpers de fecha (+ date.test.ts)
│   └── stores/
│       └── scheduleStore.ts # estado + cache de vistas (+ scheduleStore.test.ts)
├── index.html · package.json · vite.config.ts · tsconfig.json
```

## 4. Comandos IPC (mínimos)

Rust snake_case ↔ TS camelCase (conversión automática Tauri v2). Todas retornan `Result<_, String>`.

| Comando | Firma Rust | Payload TS |
|---|---|---|
| list_work_formats | `() -> Vec<WorkFormat>` | `invoke<WorkFormat[]>('list_work_formats')` |
| list_shift_templates | `() -> Vec<ShiftTemplate>` | `invoke<ShiftTemplate[]>('list_shift_templates')` |
| create_shift_template | `(input: ShiftTemplateInput) -> ShiftTemplate` | `invoke<ShiftTemplate>('create_shift_template', { input })` |
| update_shift_template | `(id: String, input: ShiftTemplateInput) -> ShiftTemplate` | `invoke<ShiftTemplate>('update_shift_template', { id, input })` |
| delete_shift_template | `(id: String) -> ()` | `invoke<void>('delete_shift_template', { id })` |
| list_assignments | `(range: CalendarRange) -> Vec<Assignment>` | `invoke<Assignment[]>('list_assignments', { range })` |
| create_assignment | `(input: AssignmentInput) -> Assignment` | `invoke<Assignment>('create_assignment', { input })` |
| create_assignments_range | `(input: RangeAssignmentInput) -> Vec<Assignment>` | `invoke<Assignment[]>('create_assignments_range', { input })` |
| update_assignment | `(id: String, input: AssignmentInput) -> Assignment` | `invoke<Assignment>('update_assignment', { id, input })` |
| delete_assignment | `(id: String) -> ()` | `invoke<void>('delete_assignment', { id })` |
| get_settings | `() -> Vec<Setting>` | `invoke<Setting[]>('get_settings')` |
| set_setting | `(key: String, value: String) -> ()` | `invoke<void>('set_setting', { key, value })` |
| get_calendar_month | `(year: i32, month: u32) -> CalendarData` | `invoke<CalendarData>('get_calendar_month', { year, month })` |
| get_calendar_week | `(year: i32, week: u32) -> CalendarData` | `invoke<CalendarData>('get_calendar_week', { year, week })` |
| export_calendar_ics | `(state, path: String) -> ()` | `invoke<void>('export_calendar_ics', { path })` |

`get_calendar_week` retorna el rango **lunes−1 … domingo** (un día antes del lunes de la semana ISO): el lunes visible debe poder albergar la continuación 00:00→fin de un overnight iniciado el domingo anterior; el FE descarta lo que no cae en la semana visible.

`export_calendar_ics` escribe todos los assignments a un `.ics` (RFC 5545): **DTSTART/DTEND flotantes en hora local** (sin `TZID` ni `Z`, coherente con la decisión tz-free de §1); overnight (`end <= start`) → `DTEND` al día siguiente; hora efectiva = override del assignment o la de la plantilla; `SUMMARY` escapado y plegado (≤75 octetos, sin partir emoji). El **diálogo nativo de guardado** se abre desde JS con `save()` de `@tauri-apps/plugin-dialog` (permiso `dialog:allow-save`); el backend añade `.ics` si el path no lo lleva.

Notas sobre `create_shift_template` / `update_shift_template`:
- **`code` opcional/autogenerado**: si `ShiftTemplateInput.code` se omite o llega en blanco, `create_shift_template` genera `custom-<uuid>` (evita colisiones UNIQUE y marca el turno como personalizado, borrable desde el Planner).
- **Validación de horas** (ambos comandos): `name` trim no vacío y ≤ 40 chars; `start_time`/`end_time` deben matchear `^([01]\d|2[0-3]):[0-5]\d$` (24h "HH:MM") y `start_time != end_time`. Errores descriptivos vía `Err(String)`.

Tipos TS (espejo de models.rs):

```ts
type WorkFormat = { id; code; name; sortOrder };
type ShiftTemplate = { id; workFormatId; code; name; startTime; endTime; color; emoji?; sortOrder; isOvernight? };
type ShiftTemplateInput = Omit<ShiftTemplate, 'id' | 'code'> & { code?: string };
type Assignment = { id; uid; shiftTemplateId; date; startTime?; endTime?; notes? };
type AssignmentInput = { shiftTemplateId; date; startTime?; endTime?; notes? };
type RangeAssignmentInput = { shiftTemplateId; startDate; endDate };  // una fila por día
type CalendarRange = { start: string; end: string };   // 'YYYY-MM-DD'
type CalendarData = { assignments: Assignment[]; templates: ShiftTemplate[] };
type Setting = { key: string; value: string };
```

Notas de tipos:
- `emoji?` (opcional): aditivo; en Rust es `emoji: String` con `#[serde(default)]` ("" = sin emoji). Se valida trim + ≤16 bytes UTF-8 (cubre secuencias ZWJ).
- `isOvernight?` (opcional): enriquecimiento computado en la respuesta (`is_overnight` en `models.rs`), NO es fuente de verdad; la regla sigue derivada (`end_time <= start_time`).

## 5. UI de Fase 3 / 3.5 (motor TS puro + polish)

- **Motor de solapamientos** (`src/utils/overlap.ts`): `packOverlaps` agrupa turnos en clusters transitivos (se solapan directa o indirectamente) y `buildDayShifts` los asigna a carriles greedy por hora de inicio. `DayCell`/`WeekView` renderizan los solapes side-by-side (50/50 con 2, 33/33/33 con 3); orden determinista por hora de inicio.
- **TimeGrid semanal** (`src/utils/timegrid.ts`): `WeekView` reescrita sobre el eje 00:00–23:00 con posicionamiento absoluto en porcentajes. Overnight partido en dos segmentos (`daySegments`): cola en el día de inicio + continuación atenuada (`isContinuation`) al día siguiente. Micro pista 0–24 h con divisoria AM/PM en las celdas del mes (`DayCell`).
- **ColorPicker compartido e ilimitado** (`src/components/ColorPicker.tsx` + `src/utils/color.ts`): grid ~24 swatches + `input type="color"` + hex validado + `colorHarmonies` (complementario, análogos, triádicos, monocromático; fallback `#888888`) + preview. Se usa en el form "+ Turno" y como acento de `SettingsPanel` (reemplazó los 8 presets).
- **Emoji en plantillas**: chips/TimeBlocks renderizan `{emoji} {nombre}` (ver migración §2).
- **Tipografía y movimiento**: Inter Variable (`@fontsource-variable/inter`) con `tabular-nums` en el eje horario; paquete `motion` (import `motion/react`) con `MotionConfig reducedMotion="user"` — fade-in en `RangeDialog`/`SettingsPanel`, hover scale en chips/bloques, transición Mes↔Semana.

## 6. Rendimiento y theming

- **Inicio <1s**: una `Connection` gestionada vía `manage`, migraciones idempotentes, seeds solo si tablas vacías; lazy-load de vistas no visibles.
- **RAM <80MB**: sin runtime async; `busy_timeout` en la conexión; grilla CSS propia + Tailwind (sin librería de calendario pesada).
- **Cambio de vista instantáneo**: `get_calendar_*` devuelve payload denormalizado; `scheduleStore` cachea por rango y re-invoca solo ante mutación o cambio de mes/semana.
- **Render Mes/Semana (hardening Fase 5)**: `DayCell` memoiza el empaquetado por día (`useMemo` de `buildDayShifts`/clusters) y usa `React.memo`; `WeekView` memoiza `TimeBlock` (hoja pura) con handlers estables (`useCallback`); array vacío estable en `MonthView` para no romper `memo`. Estrés de 300 assignments/mes: pipeline completo (agrupación por día + `buildDayShifts`) en ~0.5 ms — la virtualización no está justificada (DOM acotado: 42 celdas / 7 columnas).
- **Theming**: `theme.css` define `--bg`, `--fg`, `--accent`, `--density` y `--hour-h` (altura de cada hora del TimeGrid, 3 niveles de densidad); clase `[data-theme=light|dark]` en `<html>`; `system` se resuelve con `prefers-color-scheme` y se persiste en `settings`.
- **Tipografía**: Inter Variable (`@fontsource-variable/inter`) con `tabular-nums` en el eje horario (cifras alineadas).
- **Animaciones**: paquete `motion` envuelto en `MotionConfig reducedMotion="user"` (respeta la preferencia de movimiento reducido del SO).

## 7. Riesgos / pendientes

- **Turnos que cruzan medianoche** (p.ej. Noche 22:00→06:00): **HECHO** — se deriva `overnight := end_time <= start_time` (horas "HH:MM" fijas; `start != end` ya validado). Reemplaza la idea original de flag `overnight` por migración: sin `ALTER TABLE`, siempre consistente ante ediciones. Guardia 24h se modela como 00:00–23:59 (`end_time > start_time` → no overnight).
- **Zona horaria**: hora local sin tzid; al integrar iCal añadir `tzid`/conversión. El `uid` estable ya está previsto.
- **Export iCal**: **HECHO (Fase 4)** — exportación `.ics` (RFC 5545) con DTSTART/DTEND flotantes en hora local (sin tzid/Z), overnight → DTEND al día siguiente, folding/escaping. **Sync bidireccional iCal/Google** y **tzid** siguen pendientes; RRULE se añade por migración.
- **Capabilities**: mantener `default.json` mínimo; registrar cada comando nuevo explícitamente.
- **Migraciones**: la del `emoji` (Fase 3.5) es aditiva e idempotente vía `column_exists` (sin `PRAGMA user_version`); `user_version` queda reservado para futuras migraciones (RRULE/sync).
- **Release**: el binario empaquetado aún NO incluye Fases 2–3.5 — falta `cargo tauri build` (no requiere reconstruir la BD: la migración del emoji es aditiva).

*Verificado: `tauri-plugin-sql` v2.6.0 (sqlx) vs `rusqlite` v0.41.0 (FFI directo, `bundled`).*
