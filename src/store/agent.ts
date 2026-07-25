"use client";

import { create } from "zustand";
import type { AgentEvent } from "@/lib/agent-events";
import type { AppSettings, Lang, Theme, SecurityConfig } from "@/lib/settings";
import type { Effort } from "@/lib/models";
import type { ProviderInfo } from "@/lib/providers-client";
import { autoColor } from "@/lib/panel-colors";
import { DEFAULT_SETTINGS, PROFILES, detectProfile } from "@/lib/settings";
import { streamAgent } from "@/lib/sse-client";
import { clearCommandsCache } from "@/lib/commands-client";
import { deliverNotification, notifyPermission, shouldNotify, type NotifyKind } from "@/lib/notify";
import { messages, type MsgKey } from "@/i18n/messages";

export type Item =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string }
  | { kind: "thinking"; id: string; text: string }
  | {
      kind: "tool";
      id: string;
      name: string;
      input: Record<string, unknown>;
      result?: string;
      isError?: boolean;
      status: "running" | "done";
    }
  | { kind: "done"; id: string; costUsd: number; numTurns: number; durationMs: number; isError: boolean }
  | { kind: "error"; id: string; message: string };

export interface PendingApproval {
  approvalId: string;
  turnId: string;
  toolName: string;
  input: Record<string, unknown>;
  title: string;
  risk: "normal" | "red";
  severity: string;
}

export interface Session {
  id: string;
  cwd: string;
  /** Root path of the pinned project this session belongs to (cwd may be a
   *  subfolder, e.g. orchestrator role panels). */
  project?: string;
  items: Item[];
  running: boolean;
  turnId: string | null;
  sessionId: string | null;
  model: string | null;
  apiKeySource: string | null;
  /** Approval requests waiting for the user, oldest first. The SDK can issue
   *  parallel tool calls, so this must be a queue — a single slot would lose
   *  requests and park the turn forever. */
  pending: PendingApproval[];
  abortController: AbortController | null;
  /** Orchestrator role label (shown in the panel header). */
  roleLabel?: string;
  /** Role persona appended to the system prompt for this session's turns. */
  systemAppend?: string;
  /** Server-minted grant for orchestration turns (autonomous-but-safe config). */
  orchestrationGrant?: string;
  /** Engine running this chat (undefined = default, Claude). */
  provider?: string;
  /** Accent color id (lib/panel-colors) so parallel sessions are telling apart. */
  color?: string;
  /** Per-chat model override (null/undefined = default). */
  selModel?: string | null;
  /** Per-chat reasoning effort (undefined = default). */
  effort?: Effort;
  /** Live preview of this session's project. */
  previewState?: PreviewState;
  previewUrl?: string | null;
  previewError?: string;
  previewLog?: string[];
  /** External connections seen by the last turn, with startup status. */
  mcpStatus?: { name: string; status: string }[];
  /** Skill names loaded for the last turn. */
  skills?: string[];
  /** Last turn died on a usage limit — offer switching engine (P6.9.6). */
  rateLimited?: boolean;
  /** Twin panel of an A/B comparison — prompts sent here go to both (P6.9.4). */
  abPeer?: string;
}

export type PreviewState = "idle" | "installing" | "starting" | "running" | "error";

export interface PreviewInfo {
  state: PreviewState;
  url?: string;
  kind?: "static" | "node" | "none";
  error?: string;
  logTail?: string[];
}

export type OrchPhase = "idle" | "planning" | "working" | "reviewing" | "done" | "error" | "cancelled";

export interface OrchState {
  active: boolean;
  phase: OrchPhase;
  orchestratorPanel: string;
  rolePanels: string[];
  round: number;
  projectName: string;
  projectRoot: string;
  runInstructions: string;
  error: string;
  /** Set by stopOrchestration; the round loop checks it and bails out. */
  cancelRequested: boolean;
}

const IDLE_ORCH: OrchState = {
  active: false,
  phase: "idle",
  orchestratorPanel: "",
  rolePanels: [],
  round: 0,
  projectName: "",
  projectRoot: "",
  runInstructions: "",
  error: "",
  cancelRequested: false,
};

export interface RoleSpec {
  role: string;
  folder: string;
  task: string;
}

/** A reviewed plan the user confirmed in the orchestrator modal. */
export interface OrchPlanInput {
  projectName: string;
  brief: string;
  roles: { role: string; folder: string; task: string; provider?: string; model?: string | null }[];
  /** Staged reference uploads, moved into <project>/reference/ on launch. */
  stagingId?: string;
  /** Marketplace skills the user kept selected in the plan review. */
  installSkills?: { source: string; skillId: string }[];
}

export const MAX_PANELS = 10;

export type ViewMode = "split" | "tabs";

/** Non-blocking notice shown in the corner stack (auto-dismissed). */
export interface Toast {
  id: number;
  message: string;
}

interface AppState {
  sessions: Record<string, Session>;
  panels: string[];
  activePanel: string;
  /** Pinned project roots, in sidebar order. */
  openProjects: string[];
  /** The pinned project whose sessions and files are on screen. */
  activeProject: string;
  /** Sessions layout: split grid or full-screen tabs. */
  viewMode: ViewMode;
  token: string | null;
  lang: Lang;
  settings: AppSettings;
  orch: OrchState;
  /** Engines catalogue from /api/providers (empty until loaded). */
  providers: ProviderInfo[];
  /** Bumped when files change outside the editor (e.g. save-point restore) so
   *  the tree and open tabs reload from disk. */
  fsRefresh: number;
  /** Panel temporarily expanded to fill the split grid ("" = none). Ephemeral. */
  focusPanel: string;
  /** Failures the user should know about but that must not block them. */
  toasts: Toast[];
  /** Set by the global Cmd/Ctrl+K shortcut; the active panel's composer reacts. */
  paletteRequest: { panelId: string; nonce: number } | null;

  setToken: (t: string) => void;
  setFocusPanel: (id: string) => void;
  clearRateLimit: (id: string) => void;
  pushToast: (key: MsgKey) => void;
  dismissToast: (id: number) => void;
  requestPalette: () => void;
  setLang: (l: Lang) => void;
  setTheme: (t: Theme) => void;
  setNotifications: (on: boolean) => void;
  applySettings: (s: AppSettings) => void;
  applyProfile: (p: SecurityConfig["profile"]) => void;
  updateSecurity: (patch: Partial<SecurityConfig>) => void;

  ensureFirstPanel: (cwd: string) => void;
  addPanel: (cwd: string) => void;
  removePanel: (id: string) => void;
  setActivePanel: (id: string) => void;
  pinProject: (path: string) => void;
  unpinProject: (path: string) => void;
  activateProject: (path: string) => void;
  setViewMode: (m: ViewMode) => void;
  runOrchestration: (goal: string, plan: OrchPlanInput) => Promise<void>;
  stopOrchestration: () => void;
  dismissOrchestration: () => void;

  startAB: (id: string, provider: string) => Promise<void>;
  endAB: (id: string) => void;
  setCwd: (id: string, cwd: string) => void;
  setPanelColor: (id: string, color: string | undefined) => void;
  setProvider: (id: string, provider: string) => void;
  setModel: (id: string, model: string | null) => void;
  setEffort: (id: string, effort: Effort | undefined) => void;
  loadProviders: () => Promise<void>;
  openProjectNewChat: (id: string, projectPath: string) => void;
  resumeSession: (id: string, projectPath: string, sessionId: string) => Promise<void>;
  initWorkspace: () => Promise<void>;
  send: (id: string, prompt: string) => Promise<void>;
  stop: (id: string) => Promise<void>;
  respondApproval: (id: string, decision: "allow" | "deny", alwaysAllow?: boolean) => Promise<void>;
  resetSession: (id: string) => void;

  bumpFsRefresh: () => void;
  refreshPreview: (id: string) => Promise<void>;
  startPreview: (id: string) => Promise<void>;
  stopPreview: (id: string) => Promise<void>;
}

let counter = 0;
const nid = () => `i${Date.now()}_${counter++}`;
let toastCounter = 0;
let panelCounter = 0;
const pid = () => `p${Date.now()}_${panelCounter++}`;

function newSession(cwd: string, project?: string): Session {
  return {
    id: pid(),
    cwd,
    project: project ?? (cwd || undefined),
    items: [],
    running: false,
    turnId: null,
    sessionId: null,
    model: null,
    apiKeySource: null,
    pending: [],
    abortController: null,
  };
}

function authHeaders(token: string | null): Record<string, string> {
  return { "content-type": "application/json", ...(token ? { "x-ccw-token": token } : {}) };
}

async function persist(settings: AppSettings, token: string | null) {
  try {
    const r = await fetch("/api/settings", { method: "PUT", headers: authHeaders(token), body: JSON.stringify(settings) });
    if (!r.ok) useAgent.getState().pushToast("toastSettingsSave");
  } catch {
    useAgent.getState().pushToast("toastSettingsSave");
  }
}

export const useAgent = create<AppState>((set, get) => ({
  sessions: {},
  panels: [],
  activePanel: "",
  token: null,
  lang: "en",
  settings: DEFAULT_SETTINGS,
  orch: IDLE_ORCH,
  providers: [],
  openProjects: [],
  activeProject: "",
  viewMode: "split",
  fsRefresh: 0,
  focusPanel: "",
  toasts: [],
  paletteRequest: null,

  setToken: (token) => set({ token }),

  setFocusPanel: (id) => set({ focusPanel: id }),

  clearRateLimit: (id) => updateSession(id, (s) => ({ ...s, rateLimited: false })),

  pushToast: (key) => {
    const message = messages[get().lang][key] ?? messages.en[key];
    // One notice per problem: an identical toast already on screen is enough.
    if (get().toasts.some((t) => t.message === message)) return;
    const id = ++toastCounter;
    set((s) => ({ toasts: [...s.toasts, { id, message }] }));
    setTimeout(() => get().dismissToast(id), 6000);
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  requestPalette: () =>
    set((s) => ({ paletteRequest: { panelId: s.activePanel, nonce: (s.paletteRequest?.nonce ?? 0) + 1 } })),

  loadProviders: async () => {
    try {
      const r = await fetch("/api/providers", { headers: authHeaders(get().token) });
      if (!r.ok) {
        get().pushToast("toastProviders");
        return;
      }
      const d = await r.json();
      if (Array.isArray(d.providers) && d.providers.length) set({ providers: d.providers });
    } catch {
      // Engines dropdown falls back to Claude-only — say so instead of hiding it.
      get().pushToast("toastProviders");
    }
  },

  bumpFsRefresh: () => set((s) => ({ fsRefresh: s.fsRefresh + 1 })),

  refreshPreview: async (id) => {
    const s = get().sessions[id];
    if (!s?.cwd) return;
    try {
      const r = await fetch(`/api/preview?cwd=${encodeURIComponent(s.cwd)}`, { headers: authHeaders(get().token) });
      if (!r.ok) return;
      applyPreview(id, (await r.json()) as PreviewInfo);
    } catch {
      /* ignore */
    }
  },

  startPreview: async (id) => {
    const s = get().sessions[id];
    if (!s?.cwd) return;
    try {
      const r = await fetch("/api/preview/start", {
        method: "POST",
        headers: authHeaders(get().token),
        body: JSON.stringify({ cwd: s.cwd }),
      });
      if (!r.ok) {
        get().pushToast("toastPreview");
        return;
      }
      const info = (await r.json()) as PreviewInfo;
      // Nothing to preview (no index.html, no dev script) → friendly error state.
      if (info.kind === "none") applyPreview(id, { state: "error", error: "none" });
      else applyPreview(id, info);
    } catch {
      get().pushToast("toastPreview");
    }
  },

  stopPreview: async (id) => {
    const s = get().sessions[id];
    if (!s?.cwd) return;
    try {
      await fetch("/api/preview/stop", {
        method: "POST",
        headers: authHeaders(get().token),
        body: JSON.stringify({ cwd: s.cwd }),
      });
    } catch {
      /* ignore */
    }
    updateSession(id, (s2) => ({ ...s2, previewState: "idle", previewUrl: null, previewError: undefined }));
  },

  setLang: (lang) => {
    set({ lang });
    const { settings, token } = get();
    void persist({ ...settings, lang }, token);
  },

  setTheme: (theme) => {
    const { settings, token } = get();
    const next = { ...settings, theme };
    set({ settings: next });
    void persist(next, token);
  },

  setNotifications: (notifications) => {
    const { settings, token } = get();
    const next = { ...settings, notifications };
    set({ settings: next });
    void persist(next, token);
  },

  applySettings: (s) => set({ settings: s, lang: s.lang }),

  applyProfile: (p) => {
    const { settings, token } = get();
    const next = { ...settings, security: { ...PROFILES[p] } };
    set({ settings: next });
    void persist(next, token);
  },

  updateSecurity: (patch) => {
    const { settings, token } = get();
    const security = { ...settings.security, ...patch };
    const detected = detectProfile(security);
    if (detected !== "custom") security.profile = detected;
    const next = { ...settings, security };
    set({ settings: next });
    void persist(next, token);
  },

  ensureFirstPanel: (cwd) => {
    if (get().panels.length > 0) return;
    const s = newSession(cwd);
    set({
      sessions: { [s.id]: s },
      panels: [s.id],
      activePanel: s.id,
      openProjects: cwd ? [cwd] : [],
      activeProject: cwd,
    });
  },

  addPanel: (cwd) => {
    const { panels, sessions, activeProject } = get();
    const project = activeProject || cwd;
    if (panels.filter((p) => sessions[p]?.project === project).length >= MAX_PANELS) return;
    const s = newSession(cwd, project);
    set({ sessions: { ...sessions, [s.id]: s }, panels: [...panels, s.id], activePanel: s.id });
    scheduleSaveWorkspace();
  },

  removePanel: (id) => {
    const { panels, sessions, activePanel } = get();
    const project = sessions[id]?.project;
    const siblings = panels.filter((p) => sessions[p]?.project === project);
    if (siblings.length <= 1) return; // a pinned project always keeps one session
    sessions[id]?.abortController?.abort();
    const rest = panels.filter((p) => p !== id);
    const nextSessions = { ...sessions };
    delete nextSessions[id];
    // Closing one half of an A/B pair ends the comparison on the survivor.
    for (const [sid, s] of Object.entries(nextSessions)) {
      if (s.abPeer === id) nextSessions[sid] = { ...s, abPeer: undefined };
    }
    set({
      sessions: nextSessions,
      panels: rest,
      activePanel: activePanel === id ? siblings.filter((p) => p !== id)[0] : activePanel,
      ...(get().focusPanel === id ? { focusPanel: "" } : {}),
    });
    scheduleSaveWorkspace();
  },

  setActivePanel: (id) => set({ activePanel: id }),

  // P6.9.4 — spawn a linked twin panel on another engine; prompts sent to
  // either go to both until the pair is unlinked (or one panel closes).
  // Variant B works on a COPY of the project (ab-<engine>/) so both sides can
  // write the same filenames without clobbering each other's output.
  startAB: async (id, provider) => {
    const { sessions, panels, token } = get();
    const src = sessions[id];
    if (!src?.cwd || src.abPeer) return;
    const siblings = panels.filter((p) => sessions[p]?.project === src.project);
    if (siblings.length >= MAX_PANELS) return;
    let twinCwd = src.cwd;
    try {
      const r = await fetch("/api/ab/copy", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ cwd: src.project ?? src.cwd, provider }),
      });
      const d = await r.json();
      if (d.ok && d.path) twinCwd = d.path;
      else get().pushToast("toastAbCopy");
    } catch {
      get().pushToast("toastAbCopy");
    }
    // Guard again: the user may have clicked twice while the copy was made.
    if (get().sessions[id]?.abPeer) return;
    const twin = newSession(twinCwd, src.project);
    twin.provider = provider === "claude" ? undefined : provider;
    twin.color = autoColor(panels.length);
    twin.abPeer = id;
    set((s) => ({
      sessions: { ...s.sessions, [twin.id]: twin, [id]: { ...s.sessions[id], abPeer: twin.id } },
      panels: [...s.panels, twin.id],
    }));
    get().bumpFsRefresh(); // the new ab-* folder should appear in the tree
    scheduleSaveWorkspace();
  },

  endAB: (id) => {
    const peer = get().sessions[id]?.abPeer;
    updateSession(id, (s) => ({ ...s, abPeer: undefined }));
    if (peer) updateSession(peer, (s) => ({ ...s, abPeer: undefined }));
  },

  activateProject: (path) => {
    const { sessions, panels, activePanel } = get();
    const mine = panels.filter((p) => sessions[p]?.project === path);
    if (!mine.length) {
      // A pinned project always has at least one session to land on.
      const s = newSession(path);
      set({
        sessions: { ...sessions, [s.id]: s },
        panels: [...panels, s.id],
        activeProject: path,
        activePanel: s.id,
      });
    } else {
      const keep = mine.includes(activePanel) ? activePanel : mine[0];
      set({ activeProject: path, activePanel: keep });
    }
    if (get().focusPanel) set({ focusPanel: "" });
    scheduleSaveWorkspace();
  },

  pinProject: (path) => {
    const { openProjects } = get();
    if (!openProjects.includes(path)) set({ openProjects: [...openProjects, path] });
    get().activateProject(path);
    touchProjectApi(path, get().token);
  },

  unpinProject: (path) => {
    const st = get();
    // Stop whatever the project is still running, then drop its sessions.
    for (const pid2 of st.panels) {
      const s = st.sessions[pid2];
      if (s?.project === path && s.running) void st.stop(pid2);
    }
    const rest = st.panels.filter((p) => st.sessions[p]?.project !== path);
    const nextSessions: Record<string, Session> = {};
    for (const p of rest) nextSessions[p] = st.sessions[p];
    const openProjects = st.openProjects.filter((p) => p !== path);
    const activeProject = st.activeProject === path ? (openProjects[0] ?? "") : st.activeProject;
    set({ sessions: nextSessions, panels: rest, openProjects, activeProject, focusPanel: "" });
    if (activeProject) {
      get().activateProject(activeProject);
    } else {
      // Nothing pinned: keep one empty panel so the first-run guidance shows.
      const s = newSession("");
      set({ sessions: { [s.id]: s }, panels: [s.id], activePanel: s.id });
    }
    scheduleSaveWorkspace();
  },

  setViewMode: (m) => {
    set({ viewMode: m, focusPanel: "" });
    scheduleSaveWorkspace();
  },

  dismissOrchestration: () => set({ orch: IDLE_ORCH }),

  stopOrchestration: () => {
    const { orch } = get();
    if (!orch.active) return;
    // Stop every panel this orchestration owns (aborts the server turns too),
    // then flag the round loop to bail out on its next checkpoint.
    for (const id of [orch.orchestratorPanel, ...orch.rolePanels].filter(Boolean)) {
      void get().stop(id);
    }
    set((s) => ({ orch: { ...s.orch, active: false, cancelRequested: true, phase: "cancelled" } }));
  },

  async runOrchestration(goal, plan) {
    const st0 = get();
    if (st0.orch.active) return;
    // Other pinned projects keep their sessions (and running turns) — the
    // orchestration lives in its own brand-new pinned project.
    set({ orch: { ...IDLE_ORCH, active: true, phase: "planning" } });

    // 1) Launch the reviewed plan — server creates the project + role
    //    subfolders + plan files (the model call already happened in /plan).
    let res: any;
    try {
      res = await fetch("/api/orchestrate", {
        method: "POST",
        headers: authHeaders(st0.token),
        body: JSON.stringify({ goal, plan }),
      }).then((r) => r.json());
    } catch {
      res = { ok: false, error: "network error" };
    }
    if (!res?.ok) {
      set((s) => ({ orch: { ...s.orch, active: false, phase: "error", error: res?.error || "Planning failed" } }));
      maybeNotify(get().orch.orchestratorPanel, "orchError");
      return;
    }
    const { projectRoot, projectName, brief } = res;
    const grant: string | undefined = typeof res.grant === "string" ? res.grant : undefined;
    const roleData: { role: string; folder: string; task: string; provider?: string; model?: string | null }[] = res.roles;

    // 2) Build panels: orchestrator + one per role, each with its own accent
    //    color and the engine/model the reviewed plan assigned.
    const orch = newSession(projectRoot, projectRoot);
    orch.roleLabel = "Orchestrator";
    orch.color = autoColor(0);
    orch.orchestrationGrant = grant;
    orch.systemAppend =
      `You are the ORCHESTRATOR of the project "${projectName}". Specialist agents each work in a ` +
      `sub-folder. Shared brief:\n\n${brief}\n\nYou work at the project root and integrate/test the whole project.`;
    const sessions: Record<string, Session> = { [orch.id]: orch };
    const panels: string[] = [orch.id];
    const rolePanels: string[] = [];
    const folderToPanel: Record<string, string> = {};
    roleData.forEach((r, i) => {
      const s = newSession(r.folder, projectRoot);
      s.roleLabel = r.role;
      s.color = autoColor(i + 1);
      s.provider = r.provider;
      s.selModel = r.model ?? null;
      s.orchestrationGrant = grant;
      s.systemAppend =
        `You are the "${r.role}" specialist on the project "${projectName}", coordinated by an ` +
        `orchestrator. Work ONLY inside your assigned folder. Shared brief:\n\n${brief}`;
      sessions[s.id] = s;
      panels.push(s.id);
      rolePanels.push(s.id);
      folderToPanel[r.folder.split("/").pop() || r.folder] = s.id;
    });
    {
      const cur = get();
      set({
        sessions: { ...cur.sessions, ...sessions },
        panels: [...cur.panels, ...panels],
        activePanel: orch.id,
        openProjects: [...cur.openProjects.filter((p) => p !== projectRoot), projectRoot],
        activeProject: projectRoot,
        orch: { ...IDLE_ORCH, active: true, phase: "working", orchestratorPanel: orch.id, rolePanels, round: 1, projectName, projectRoot },
      });
    }
    {
      const skillsOk = Array.isArray(res.installedSkills)
        ? (res.installedSkills as { skillId: string; ok: boolean }[]).filter((s) => s.ok).map((s) => s.skillId)
        : [];
      const extras = skillsOk.length ? `\n\nSkills installed: ${skillsOk.join(", ")}.` : "";
      pushAssistant(orch.id, `Project "${projectName}" created.\n\n${brief}${extras}\n\nDispatching ${roleData.length} agents…`);
    }

    // 3) Round loop: roles work → orchestrator reviews → done or dispatch fixes.
    const cancelled = () => get().orch.cancelRequested;
    let dispatch = roleData.map((r, i) => ({ panelId: rolePanels[i], prompt: rolePrompt(r.role, r.task) }));
    const MAX_ROUNDS = 3;
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      set((s) => ({ orch: { ...s.orch, phase: "working", round } }));
      await Promise.all(dispatch.map((d) => get().send(d.panelId, d.prompt)));
      if (cancelled()) return; // stopOrchestration already set phase "cancelled"

      set((s) => ({ orch: { ...s.orch, phase: "reviewing" } }));
      await get().send(orch.id, reviewPrompt(round));
      if (cancelled()) return;

      // A failed review turn must NOT be read as success: bail out honestly
      // instead of concluding "done" on empty/stale text.
      if (sessionErrored(orch.id)) {
        set((s) => ({ orch: { ...s.orch, phase: "error", active: false, error: orchError(get().lang) } }));
        maybeNotify(orch.id, "orchError");
        return;
      }
      const decision = parseDecision(lastAssistantText(orch.id));

      if (decision.status === "done" || round === MAX_ROUNDS) {
        set((s) => ({ orch: { ...s.orch, phase: "done", active: false, runInstructions: decision.run || "" } }));
        maybeNotify(orch.id, "orchDone");
        return;
      }
      const fixes = (decision.fixes || [])
        .map((f) => ({ panelId: folderToPanel[f.folder], prompt: `${f.instruction}\n\nApply the fix in your folder, then stop.` }))
        .filter((d) => d.panelId);
      if (!fixes.length) {
        set((s) => ({ orch: { ...s.orch, phase: "done", active: false, runInstructions: decision.run || "" } }));
        maybeNotify(orch.id, "orchDone");
        return;
      }
      dispatch = fixes;
    }
  },

  setCwd: (id, cwd) => {
    updateSession(id, (s) => ({ ...s, cwd, project: cwd }));
    const { settings, token, openProjects } = get();
    if (cwd && !openProjects.includes(cwd)) set({ openProjects: [...openProjects, cwd] });
    if (cwd) set({ activeProject: cwd });
    void persist({ ...settings, cwd }, token);
    scheduleSaveWorkspace();
  },

  setPanelColor: (id, color) => {
    updateSession(id, (s) => ({ ...s, color }));
    scheduleSaveWorkspace();
  },

  setProvider: (id, provider) => {
    updateSession(id, (s) =>
      s.provider === provider || (!s.provider && provider === "claude")
        ? s
        : // A session id belongs to its engine — switching engines starts a
          // fresh conversation (the visible transcript stays).
          { ...s, provider, selModel: null, effort: undefined, sessionId: null, rateLimited: false },
    );
    scheduleSaveWorkspace();
  },

  setModel: (id, model) => {
    updateSession(id, (s) => ({ ...s, selModel: model }));
    scheduleSaveWorkspace();
  },
  setEffort: (id, effort) => {
    updateSession(id, (s) => ({ ...s, effort }));
    scheduleSaveWorkspace();
  },

  openProjectNewChat: (id, projectPath) => {
    updateSession(id, (s) => ({
      ...s,
      cwd: projectPath,
      project: projectPath,
      items: [],
      sessionId: null,
      turnId: null,
      pending: [],
      roleLabel: undefined,
      orchestrationGrant: undefined,
    }));
    const { openProjects } = get();
    if (!openProjects.includes(projectPath)) set({ openProjects: [...openProjects, projectPath] });
    set({ activeProject: projectPath, activePanel: id });
    touchProjectApi(projectPath, get().token);
    scheduleSaveWorkspace();
  },

  resumeSession: async (id, projectPath, sessionId) => {
    updateSession(id, (s) => ({
      ...s,
      cwd: projectPath,
      project: projectPath,
      items: [],
      sessionId,
      turnId: null,
      pending: [],
      roleLabel: undefined,
      orchestrationGrant: undefined,
    }));
    const { openProjects } = get();
    if (!openProjects.includes(projectPath)) set({ openProjects: [...openProjects, projectPath] });
    set({ activeProject: projectPath, activePanel: id });
    touchProjectApi(projectPath, get().token);
    scheduleSaveWorkspace();
    const token = get().token;
    try {
      const d = await fetch(`/api/projects/messages?sessionId=${encodeURIComponent(sessionId)}`, {
        headers: token ? { "x-ccw-token": token } : {},
      }).then((r) => r.json());
      if (Array.isArray(d.items)) updateSession(id, (s) => ({ ...s, items: d.items }));
    } catch {
      get().pushToast("toastHistory");
    }
  },

  initWorkspace: async () => {
    const token = get().token;
    void get().loadProviders();
    const [w, pj] = await Promise.all([
      fetch("/api/workspace").then((r) => r.json()).catch(() => ({ panels: [] })),
      fetch("/api/projects").then((r) => r.json()).catch(() => ({ projects: [] })),
    ]);
    const roots: string[] = (pj.projects ?? []).map((p: { path: string }) => p.path);
    const existing = new Set<string>(roots);
    // A panel belongs to a registered project root (its cwd may be a subfolder).
    const projectOf = (p: { projectPath: string; project?: string }): string =>
      p.project && existing.has(p.project)
        ? p.project
        : existing.has(p.projectPath)
          ? p.projectPath
          : (roots.find((r) => p.projectPath.startsWith(r + "/")) ?? "");
    const wpanels = (w.panels ?? []).filter((p: { projectPath: string; project?: string }) => projectOf(p));
    if (wpanels.length) {
      const sessions: Record<string, Session> = {};
      const panels: string[] = [];
      const derived: string[] = [];
      for (const p of wpanels) {
        const proj = projectOf(p);
        const s = newSession(p.projectPath, proj);
        s.provider = p.provider;
        s.color = p.color;
        s.selModel = p.selModel ?? null;
        s.effort = p.effort;
        s.roleLabel = p.roleLabel;
        s.sessionId = p.sessionId ?? null;
        sessions[s.id] = s;
        panels.push(s.id);
        if (!derived.includes(proj)) derived.push(proj);
      }
      const savedOpen: string[] = Array.isArray(w.openProjects) ? w.openProjects.filter((p: string) => existing.has(p)) : [];
      const openProjects = [...savedOpen, ...derived.filter((p) => !savedOpen.includes(p))];
      const activeProject =
        typeof w.activeProject === "string" && openProjects.includes(w.activeProject) ? w.activeProject : openProjects[0];
      const mine = panels.filter((p) => sessions[p].project === activeProject);
      const ai = Math.min(Math.max(0, w.activeIndex ?? 0), panels.length - 1);
      const activePanel = mine.includes(panels[ai]) ? panels[ai] : mine[0];
      set({
        sessions,
        panels,
        activePanel,
        openProjects,
        activeProject,
        viewMode: w.viewMode === "tabs" ? "tabs" : "split",
      });
      wpanels.forEach((p: { sessionId?: string | null }, i: number) => {
        if (p.sessionId) loadItemsInto(panels[i], p.sessionId, token);
      });
    } else if (roots.length && !Array.isArray(w.openProjects)) {
      // True first run (no saved workspace shape): open the first project as a
      // starter. A deliberately emptied workspace (openProjects: []) stays empty.
      const s = newSession(roots[0]);
      set({ sessions: { [s.id]: s }, panels: [s.id], activePanel: s.id, openProjects: [roots[0]], activeProject: roots[0] });
      touchProjectApi(roots[0], token);
    } else {
      const s = newSession("");
      set({ sessions: { [s.id]: s }, panels: [s.id], activePanel: s.id });
    }
  },

  resetSession: (id) => updateSession(id, (s) => ({ ...s, items: [], sessionId: null, turnId: null, pending: [] })),

  async send(id, prompt) {
    const st = get();
    const session = st.sessions[id];
    if (!session || session.running || !prompt.trim() || !session.cwd) return;
    // A/B pair: forward the prompt to the twin exactly once (no ping-pong).
    const forwarded = abForwarded.delete(id);
    if (!forwarded && session.abPeer && st.sessions[session.abPeer] && !st.sessions[session.abPeer].running) {
      abForwarded.add(session.abPeer);
      void get().send(session.abPeer, prompt);
    }
    const abortController = new AbortController();
    updateSession(id, (s) => ({
      ...s,
      items: [...s.items, { kind: "user", id: nid(), text: prompt }],
      rateLimited: false,
      running: true,
      pending: [],
      abortController,
    }));
    const onEvent = (e: AgentEvent) => reduce(id, e);
    await streamAgent(
      {
        prompt,
        cwd: session.cwd,
        lang: st.lang,
        sessionId: session.sessionId ?? undefined,
        provider: session.provider,
        model: session.selModel ?? undefined,
        effort: session.effort,
        systemAppend: session.systemAppend,
        orchestrationGrant: session.orchestrationGrant,
      },
      onEvent,
      abortController.signal,
      st.token,
      // Arrives with the response headers, before any SSE event: makes Stop
      // able to reach the server turn even during SDK startup.
      (turnId) => updateSession(id, (s) => ({ ...s, turnId })),
    );
    updateSession(id, (s) => ({ ...s, running: false, abortController: null }));
  },

  async stop(id) {
    const { sessions, token } = get();
    const session = sessions[id];
    if (session?.turnId) {
      try {
        await fetch("/api/chat/stop", { method: "POST", headers: authHeaders(token), body: JSON.stringify({ turnId: session.turnId }) });
      } catch {
        /* ignore */
      }
    }
    session?.abortController?.abort();
    // The dying turn auto-denies its parked approvals server-side; drop the
    // local queue so no stale modal outlives the turn.
    updateSession(id, (s) => ({ ...s, running: false, pending: [] }));
  },

  async respondApproval(id, decision, alwaysAllow) {
    const { sessions, token } = get();
    const pending = sessions[id]?.pending[0];
    if (!pending || approvalsInFlight.has(pending.approvalId)) return;
    approvalsInFlight.add(pending.approvalId);
    let settled = false;
    try {
      const res = await fetch("/api/chat/approve", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ turnId: pending.turnId, approvalId: pending.approvalId, decision, alwaysAllow }),
      });
      // Delivered (200) or stale (404: turn/approval already gone) → done with
      // this entry. Anything else keeps the modal so the user can retry —
      // clearing it optimistically would park the turn with no way to answer.
      settled = res.ok || res.status === 404;
    } catch {
      settled = false;
    } finally {
      approvalsInFlight.delete(pending.approvalId);
    }
    if (settled) {
      updateSession(id, (s) => ({ ...s, pending: s.pending.filter((p) => p.approvalId !== pending.approvalId) }));
    } else {
      // The modal stays so the user can retry — tell them why nothing happened.
      get().pushToast("toastApprove");
    }
  },
}));

/** approvalIds with an /api/chat/approve POST in flight (double-click guard). */
const approvalsInFlight = new Set<string>();

/** Panel ids about to receive an A/B-forwarded prompt (recursion guard). */
const abForwarded = new Set<string>();

function updateSession(id: string, updater: (s: Session) => Session) {
  useAgent.setState((st) => {
    const cur = st.sessions[id];
    if (!cur) return {};
    return { sessions: { ...st.sessions, [id]: updater(cur) } };
  });
}

function applyPreview(id: string, info: PreviewInfo) {
  updateSession(id, (s) => ({
    ...s,
    previewState: info.state,
    previewUrl: info.url ?? null,
    previewError: info.error,
    previewLog: info.logTail,
  }));
}

/* ---- Project / workspace helpers ---- */

function folderOf(p: string): string {
  return p.split("/").filter(Boolean).pop() || "";
}

function touchProjectApi(projectPath: string, token: string | null) {
  const folder = folderOf(projectPath);
  if (!folder) return;
  void fetch("/api/projects", {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify({ folder }),
  }).catch(() => {});
}

function loadItemsInto(panelId: string, sessionId: string, token: string | null) {
  fetch(`/api/projects/messages?sessionId=${encodeURIComponent(sessionId)}`, {
    headers: token ? { "x-ccw-token": token } : {},
  })
    .then((r) => r.json())
    .then((d) => {
      if (Array.isArray(d.items) && d.items.length) updateSession(panelId, (s) => ({ ...s, items: d.items }));
    })
    .catch(() => useAgent.getState().pushToast("toastHistory"));
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSaveWorkspace() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const st = useAgent.getState();
    const panels = st.panels
      .map((id) => {
        const s = st.sessions[id];
        return {
          projectPath: s?.cwd || "",
          project: s?.project,
          provider: s?.provider,
          color: s?.color,
          selModel: s?.selModel ?? null,
          effort: s?.effort,
          sessionId: s?.sessionId ?? null,
          roleLabel: s?.roleLabel,
        };
      })
      .filter((p) => p.projectPath);
    const activeIndex = Math.max(0, st.panels.indexOf(st.activePanel));
    void fetch("/api/workspace", {
      method: "PUT",
      headers: authHeaders(st.token),
      body: JSON.stringify({
        panels,
        activeIndex,
        openProjects: st.openProjects,
        activeProject: st.activeProject,
        viewMode: st.viewMode,
      }),
    }).catch(() => useAgent.getState().pushToast("toastWorkspaceSave"));
  }, 800);
}

function reduce(id: string, e: AgentEvent) {
  switch (e.type) {
    case "ready":
      updateSession(id, (s) => ({
        ...s,
        turnId: e.turnId,
        sessionId: e.sessionId,
        model: e.model,
        apiKeySource: e.apiKeySource,
        ...(e.mcpServers ? { mcpStatus: e.mcpServers } : {}),
        ...(e.skills ? { skills: e.skills } : {}),
      }));
      scheduleSaveWorkspace();
      break;
    case "text":
      updateSession(id, (s) => {
        const last = s.items[s.items.length - 1];
        if (last && last.kind === "assistant" && last.id === e.id) {
          const items = s.items.slice();
          items[items.length - 1] = { ...last, text: last.text + e.text };
          return { ...s, items };
        }
        return { ...s, items: [...s.items, { kind: "assistant", id: e.id, text: e.text }] };
      });
      break;
    case "thinking":
      updateSession(id, (s) => {
        const last = s.items[s.items.length - 1];
        if (last && last.kind === "thinking" && last.id === e.id) {
          const items = s.items.slice();
          items[items.length - 1] = { ...last, text: last.text + e.text };
          return { ...s, items };
        }
        return { ...s, items: [...s.items, { kind: "thinking", id: e.id, text: e.text }] };
      });
      break;
    case "tool_use":
      updateSession(id, (s) => ({ ...s, items: [...s.items, { kind: "tool", id: e.id, name: e.name, input: e.input, status: "running" }] }));
      break;
    case "tool_result":
      updateSession(id, (s) => {
        const items = s.items.slice();
        for (let i = items.length - 1; i >= 0; i--) {
          const it = items[i];
          if (it.kind === "tool" && it.id === e.toolUseId) {
            items[i] = { ...it, result: e.content, isError: e.isError, status: "done" };
            break;
          }
        }
        return { ...s, items };
      });
      break;
    case "approval_request":
      // Notify on the first waiting approval only — one nudge per queue.
      if ((useAgent.getState().sessions[id]?.pending.length ?? 0) === 0) maybeNotify(id, "approval");
      updateSession(id, (s) => ({
        ...s,
        pending: [
          ...s.pending,
          { approvalId: e.approvalId, turnId: e.turnId, toolName: e.toolName, input: e.input, title: e.title, risk: e.risk, severity: e.severity },
        ],
      }));
      break;
    case "done":
      updateSession(id, (s) => ({
        ...s,
        items: [...s.items, { kind: "done", id: nid(), costUsd: e.totalCostUsd, numTurns: e.numTurns, durationMs: e.durationMs, isError: e.isError }],
        sessionId: e.sessionId || s.sessionId,
      }));
      maybeNotify(id, e.isError ? "turnError" : "turnDone", e.durationMs);
      // The turn may have created/edited skills — let the palette refetch.
      {
        const cwd = useAgent.getState().sessions[id]?.cwd;
        if (cwd) clearCommandsCache(cwd);
      }
      break;
    case "error":
      updateSession(id, (s) => ({
        ...s,
        items: [...s.items, { kind: "error", id: nid(), message: e.message }],
        ...(e.code === "rate-limit" ? { rateLimited: true } : {}),
      }));
      maybeNotify(id, "turnError");
      break;
  }
}

const NOTIF_TITLE: Record<NotifyKind, MsgKey> = {
  turnDone: "notifDone",
  turnError: "notifError",
  approval: "notifApproval",
  orchDone: "notifOrchDone",
  orchError: "notifOrchError",
};

/** Desktop notification for a background event (P6.9.2). Role panels stay
 *  silent during orchestration — the orchestration outcome notifies instead. */
function maybeNotify(id: string, kind: NotifyKind, durationMs?: number) {
  const st = useAgent.getState();
  const s = st.sessions[id];
  if (s?.orchestrationGrant && (kind === "turnDone" || kind === "turnError")) return;
  const focused = typeof document !== "undefined" && document.hasFocus();
  if (!shouldNotify({ enabled: !!st.settings.notifications, permission: notifyPermission(), focused, kind, durationMs })) return;
  const msg = messages[st.lang] ?? messages.en;
  const folder = s?.cwd?.split("/").filter(Boolean).pop() ?? "";
  const body = kind === "orchDone" || kind === "orchError" ? st.orch.projectName : s?.roleLabel ? `${s.roleLabel} — ${folder}` : folder;
  deliverNotification(msg[NOTIF_TITLE[kind]], body, `easyagent-${kind}-${id}`, () => {
    const cur = useAgent.getState();
    const proj = cur.sessions[id]?.project;
    if (proj && cur.activeProject !== proj) cur.activateProject(proj);
    cur.setActivePanel(id);
  });
}

/* ---- Orchestration helpers ---- */

function pushAssistant(id: string, text: string) {
  updateSession(id, (s) => ({ ...s, items: [...s.items, { kind: "assistant", id: nid(), text }] }));
}

function lastAssistantText(id: string): string {
  const items = useAgent.getState().sessions[id]?.items ?? [];
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].kind === "assistant") return (items[i] as Extract<Item, { kind: "assistant" }>).text;
  }
  return "";
}

/** True if the session's most recent turn ended in an error (an error item or
 *  a done item with isError) — used so a failed orchestrator review isn't
 *  mistaken for a successful "done". */
function sessionErrored(id: string): boolean {
  const items = useAgent.getState().sessions[id]?.items ?? [];
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind === "error") return true;
    if (it.kind === "done") return it.isError;
  }
  return false;
}

function orchError(lang: Lang): string {
  return messages[lang]?.orchError ?? messages.en.orchError;
}

function rolePrompt(role: string, task: string): string {
  return (
    `${task}\n\n` +
    `Rules:\n- Work ONLY inside your assigned folder.\n` +
    `- Follow the shared brief so your part fits with the other roles.\n` +
    `- When finished, append one line "DONE — <one-sentence summary>" under a "## ${role}" heading in ` +
    `../easyagent-status.md, then stop.`
  );
}

function reviewPrompt(round: number): string {
  return (
    `The role agents have finished round ${round}. Their work is in the sub-folders ` +
    `(see easyagent-plan.md and easyagent-status.md).\nFrom the project root:\n` +
    `1. Read what each role produced.\n` +
    `2. Integrate the pieces so the whole project works together (add any top-level files/config needed).\n` +
    `3. Actually run/test it — install dependencies and run the build or tests — to verify it works.\n\n` +
    `Then END your message with EXACTLY one JSON object (no code fences), as the LAST thing:\n` +
    `- If a role's work needs changes: {"status":"needs_fixes","fixes":[{"folder":"<role-folder-name>","instruction":"<precise fix>"}]}\n` +
    `- If everything works: {"status":"done","run":"<exact step-by-step commands to run the project>"}`
  );
}

interface Decision {
  status: "done" | "needs_fixes";
  run?: string;
  fixes?: { folder: string; instruction: string }[];
}

function extractLastJson(text: string): any {
  const end = text.lastIndexOf("}");
  if (end < 0) return null;
  for (let start = text.lastIndexOf("{", end); start >= 0; start = text.lastIndexOf("{", start - 1)) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      /* keep scanning */
    }
  }
  return null;
}

function parseDecision(text: string): Decision {
  const j = extractLastJson(text);
  if (j && (j.status === "done" || j.status === "needs_fixes")) {
    return {
      status: j.status,
      run: typeof j.run === "string" ? j.run : undefined,
      fixes: Array.isArray(j.fixes) ? j.fixes.filter((f: any) => f && f.folder && f.instruction) : [],
    };
  }
  // Fallback: treat the whole message as the run instructions.
  return { status: "done", run: text };
}
