"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Sidebar } from "@/components/Sidebar";
import { PanelsGrid } from "@/components/PanelsGrid";
import { SettingsPanel } from "@/components/SettingsPanel";
import { AnalyticsPanel } from "@/components/AnalyticsPanel";
import { SkillsPanel } from "@/components/SkillsPanel";
import { ProjectsPanel, PIN_PICKER } from "@/components/ProjectsPanel";
import { OrchestratorModal } from "@/components/OrchestratorModal";
import { OrchestrationBanner } from "@/components/OrchestrationBanner";
import { Toasts } from "@/components/Toasts";
import { ShortcutsHelp, useGlobalShortcuts } from "@/components/ShortcutsHelp";
import { useAgent } from "@/store/agent";

export default function Home() {
  const setToken = useAgent((s) => s.setToken);
  const applySettings = useAgent((s) => s.applySettings);
  const initWorkspace = useAgent((s) => s.initWorkspace);
  const addPanel = useAgent((s) => s.addPanel);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [projectsFor, setProjectsFor] = useState<string | null>(null);
  const [skillsFor, setSkillsFor] = useState<string | null>(null);
  const [orchestrateOpen, setOrchestrateOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  useGlobalShortcuts(helpOpen, setHelpOpen);

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
    addPanel(st.activeProject || st.sessions[st.activePanel]?.cwd || "");
  };

  return (
    <>
      <AppShell onOpenSettings={() => setSettingsOpen(true)} onOpenHelp={() => setHelpOpen(true)}>
        <OrchestrationBanner />
        <div className="layout">
          <Sidebar
            onAddPanel={onAddPanel}
            onOrchestrate={() => setOrchestrateOpen(true)}
            onProjects={() => setProjectsFor(PIN_PICKER)}
            onAnalytics={() => setAnalyticsOpen(true)}
            onSkills={() => setSkillsFor(useAgent.getState().activePanel)}
          />
          <PanelsGrid onChangeFolder={setProjectsFor} />
        </div>
      </AppShell>
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
      {analyticsOpen && <AnalyticsPanel onClose={() => setAnalyticsOpen(false)} />}
      {projectsFor && <ProjectsPanel panelId={projectsFor} onClose={() => setProjectsFor(null)} />}
      {skillsFor && <SkillsPanel panelId={skillsFor} onClose={() => setSkillsFor(null)} />}
      {orchestrateOpen && <OrchestratorModal onClose={() => setOrchestrateOpen(false)} />}
      {helpOpen && <ShortcutsHelp onClose={() => setHelpOpen(false)} />}
      <Toasts />
    </>
  );
}
