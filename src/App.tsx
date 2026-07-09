import { AnnotationsPanel } from "./components/annotations/AnnotationsPanel";
import { CommandPalette } from "./components/CommandPalette";
import { DiffPanel } from "./components/DiffPanel";
import { Sidebar } from "./components/Sidebar";
import { AppMessages, TopBar } from "./components/TopBar";
import { useAppLifecycle } from "./hooks/useAppLifecycle";

function App() {
  useAppLifecycle();

  return (
    <div className="app-shell">
      <TopBar />
      <AppMessages />
      <main className="workspace">
        <Sidebar />
        <DiffPanel />
        <AnnotationsPanel />
      </main>
      <CommandPalette />
    </div>
  );
}

export default App;
