"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Sidebar } from "@/components/Sidebar";
import { PanelsGrid } from "@/components/PanelsGrid";
import { SettingsPanel } from "@/components/SettingsPanel";
import { ProjectsPanel } from "@/components/ProjectsPanel";
import { OrchestratorModal } from "@/components/OrchestratorModal";
import { OrchestrationBanner } from "@/components/OrchestrationBanner";
import { useAgent } from "@/store/agent";

export default function Home() {
  const setToken = useAgent((s) => s.setToken);
  const applySettings = useAgent((s) => s.applySettings);
  const initWorkspace = useAgent((s) => s.initWorkspace);
  const addPanel = useAgent((s) => s.addPanel);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [projectsFor, setProjectsFor] = useState<string | null>(null);
  const [orchestrateOpen, setOrchestrateOpen] = useState(false);

  useEffect(() => {
    void (async () => {
      const [tok, settings] = await Promise.all([
        fetch("/api/session-token").then((r) => r.json()).catch(() => ({})),
        fetch("/api/settings").then((r) => r.json()).catch(() => null),
      ]);
      if (tok?.token) setToken(tok.token);
      if (settings) applySettings(settings);
      await initWorkspace();
    })();
  }, [setToken, applySettings, initWorkspace]);

  const onAddPanel = () => {
    const st = useAgent.getState();
    addPanel(st.sessions[st.activePanel]?.cwd || "");
  };

  return (
    <>
      <AppShell onOpenSettings={() => setSettingsOpen(true)}>
        <OrchestrationBanner />
        <div className="layout">
          <Sidebar
            onAddPanel={onAddPanel}
            onOrchestrate={() => setOrchestrateOpen(true)}
            onProjects={() => setProjectsFor(useAgent.getState().activePanel)}
          />
          <PanelsGrid onChangeFolder={setProjectsFor} />
        </div>
      </AppShell>
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
      {projectsFor && <ProjectsPanel panelId={projectsFor} onClose={() => setProjectsFor(null)} />}
      {orchestrateOpen && <OrchestratorModal onClose={() => setOrchestrateOpen(false)} />}
    </>
  );
}
