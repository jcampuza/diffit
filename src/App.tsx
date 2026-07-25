import { AnnotationsPanel } from "./components/annotations/AnnotationsPanel";
import { CommandPalette } from "./components/CommandPalette";
import { DiffPanel } from "./components/DiffPanel";
import { Sidebar } from "./components/Sidebar";
import { AppMessages, TopBar } from "./components/TopBar";
import { useAppLifecycle } from "./hooks/useAppLifecycle";
import { useAppSelector } from "./store";

function App() {
  useAppLifecycle();
  const sidebarCollapsed = useAppSelector((state) => state.sidebarCollapsed);

  return (
    <div className="app-shell">
      <TopBar />
      <AppMessages />
      <main className="workspace">
        {sidebarCollapsed ? null : <Sidebar />}
        <DiffPanel />
        <AnnotationsPanel />
      </main>
      <CommandPalette />
    </div>
  );
}

export default App;
