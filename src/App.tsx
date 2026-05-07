import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect } from "react";
import Sidebar from "./components/layout/Sidebar";
import TopBar from "./components/layout/TopBar";
import StatusBar from "./components/layout/StatusBar";
import Dashboard from "./pages/Dashboard";
import Wallet from "./pages/Wallet";
import Settlement from "./pages/Settlement";
import Marketplace from "./pages/Marketplace";
import Agreements from "./pages/Agreements";
import Reputation from "./pages/Reputation";
import Miner from "./pages/Miner";
import Settings from "./pages/Settings";
import { useNodePoller } from "./hooks/useNodePoller";
import { useStore } from "./lib/store";

function AppLayout() {
  useNodePoller();
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed);

  return (
    <div className="flex h-screen bg-surface-base overflow-hidden">
      {/* Sidebar */}
      <Sidebar />

      {/* Main content area */}
      <div
        className="flex flex-col flex-1 min-w-0 transition-all duration-300"
        style={{ marginLeft: sidebarCollapsed ? "64px" : "240px" }}
      >
        <TopBar />

        <main className="flex-1 overflow-y-auto px-6 py-5">
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/wallet" element={<Wallet />} />
            <Route path="/settlement" element={<Settlement />} />
            <Route path="/marketplace" element={<Marketplace />} />
            <Route path="/agreements" element={<Agreements />} />
            <Route path="/agreements/:id" element={<Agreements />} />
            <Route path="/reputation" element={<Reputation />} />
            <Route path="/miner" element={<Miner />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>

        <StatusBar />
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/*" element={<AppLayout />} />
      </Routes>
    </BrowserRouter>
  );
}
