import { useState } from "react";
import { MotionConfig } from "motion/react";
import { CalendarView } from "./components/CalendarView";
import { Planner } from "./components/Planner";
import { SettingsPanel } from "./components/SettingsPanel";
import { useTheme } from "./hooks/useTheme";
import { ScheduleProvider } from "./stores/scheduleStore";

function Shell() {
  const theme = useTheme();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [plannerOpen, setPlannerOpen] = useState(true);

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center border-b border-border bg-surface px-4">
        <button
          type="button"
          onClick={() => setPlannerOpen((v) => !v)}
          aria-label={
            plannerOpen
              ? "Ocultar planificador de turnos"
              : "Mostrar planificador de turnos"
          }
          aria-pressed={plannerOpen}
          className="mr-2 rounded p-2 text-muted hover:bg-bg hover:text-fg"
        >
          <svg
            viewBox="0 0 24 24"
            className="size-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <line x1="9" y1="4" x2="9" y2="20" />
          </svg>
        </button>
        <h1 className="flex-1 text-lg font-semibold text-fg">RotaPro</h1>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          aria-label="Abrir ajustes de apariencia"
          className="rounded p-2 text-muted hover:bg-bg hover:text-fg"
        >
          <svg
            viewBox="0 0 24 24"
            className="size-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </header>
      <main className="flex min-h-0 flex-1 flex-row bg-bg">
        {plannerOpen && <Planner />}
        <CalendarView />
      </main>
      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        theme={theme.theme}
        accent={theme.accent}
        density={theme.density}
        setTheme={theme.setTheme}
        setAccent={theme.setAccent}
        setDensity={theme.setDensity}
      />
    </div>
  );
}

export default function App() {
  return (
    <ScheduleProvider>
      <MotionConfig reducedMotion="user">
        <Shell />
      </MotionConfig>
    </ScheduleProvider>
  );
}
