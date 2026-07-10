"use client";

import { create } from "zustand";
import type { AgentEvent } from "@/lib/agent-events";
import type { AppSettings, Lang, Theme, SecurityConfig } from "@/lib/settings";
import type { Effort } from "@/lib/models";
import { DEFAULT_SETTINGS, PROFILES, detectProfile } from "@/lib/settings";
import { streamAgent } from "@/lib/sse-client";

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
  /** Per-chat model override (null/undefined = default). */
  selModel?: string | null;
  /** Per-chat reasoning effort (undefined = default). */
  effort?: Effort;
}

export type OrchPhase = "idle" | "planning" | "working" | "reviewing" | "done" | "error";

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
};

export interface RoleSpec {
  role: string;
  folder: string;
  task: string;
}

export const MAX_PANELS = 4;

interface AppState {
  sessions: Record<string, Session>;
  panels: string[];
  activePanel: string;
  token: string | null;
  lang: Lang;
  settings: AppSettings;
  orch: OrchState;

  setToken: (t: string) => void;
  setLang: (l: Lang) => void;
  setTheme: (t: Theme) => void;
  applySettings: (s: AppSettings) => void;
  applyProfile: (p: SecurityConfig["profile"]) => void;
  updateSecurity: (patch: Partial<SecurityConfig>) => void;

  ensureFirstPanel: (cwd: string) => void;
  addPanel: (cwd: string) => void;
  removePanel: (id: string) => void;
  setActivePanel: (id: string) => void;
  runOrchestration: (goal: string) => Promise<void>;
  dismissOrchestration: () => void;

  setCwd: (id: string, cwd: string) => void;
  setModel: (id: string, model: string | null) => void;
  setEffort: (id: string, effort: Effort | undefined) => void;
  openProjectNewChat: (id: string, projectPath: string) => void;
  resumeSession: (id: string, projectPath: string, sessionId: string) => Promise<void>;
  initWorkspace: () => Promise<void>;
  send: (id: string, prompt: string) => Promise<void>;
  stop: (id: string) => Promise<void>;
  respondApproval: (id: string, decision: "allow" | "deny", alwaysAllow?: boolean) => Promise<void>;
  resetSession: (id: string) => void;
}

let counter = 0;
const nid = () => `i${Date.now()}_${counter++}`;
let panelCounter = 0;
const pid = () => `p${Date.now()}_${panelCounter++}`;

function newSession(cwd: string): Session {
  return {
    id: pid(),
    cwd,
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
    await fetch("/api/settings", { method: "PUT", headers: authHeaders(token), body: JSON.stringify(settings) });
  } catch {
    /* ignore */
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

  setToken: (token) => set({ token }),

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
    set({ sessions: { [s.id]: s }, panels: [s.id], activePanel: s.id });
  },

  addPanel: (cwd) => {
    const { panels, sessions } = get();
    if (panels.length >= MAX_PANELS) return;
    const s = newSession(cwd);
    set({ sessions: { ...sessions, [s.id]: s }, panels: [...panels, s.id], activePanel: s.id });
    scheduleSaveWorkspace();
  },

  removePanel: (id) => {
    const { panels, sessions, activePanel } = get();
    if (panels.length <= 1) return;
    sessions[id]?.abortController?.abort();
    const rest = panels.filter((p) => p !== id);
    const nextSessions = { ...sessions };
    delete nextSessions[id];
    set({
      sessions: nextSessions,
      panels: rest,
      activePanel: activePanel === id ? rest[0] : activePanel,
    });
    scheduleSaveWorkspace();
  },

  setActivePanel: (id) => set({ activePanel: id }),

  dismissOrchestration: () => set({ orch: IDLE_ORCH }),

  async runOrchestration(goal) {
    const st0 = get();
    if (st0.orch.active) return;
    set({ orch: { ...IDLE_ORCH, active: true, phase: "planning" } });

    // 1) Plan — server creates a NEW project + role subfolders + plan files.
    let res: any;
    try {
      res = await fetch("/api/orchestrate", {
        method: "POST",
        headers: authHeaders(st0.token),
        body: JSON.stringify({ goal, lang: st0.lang }),
      }).then((r) => r.json());
    } catch {
      res = { ok: false, error: "network error" };
    }
    if (!res?.ok) {
      set((s) => ({ orch: { ...s.orch, active: false, phase: "error", error: res?.error || "Planning failed" } }));
      return;
    }
    const { projectRoot, projectName, brief } = res;
    const grant: string | undefined = typeof res.grant === "string" ? res.grant : undefined;
    const roleData: { role: string; folder: string; task: string }[] = res.roles;

    // 2) Build panels: orchestrator + one per role.
    const orch = newSession(projectRoot);
    orch.roleLabel = "Orchestrator";
    orch.orchestrationGrant = grant;
    orch.systemAppend =
      `You are the ORCHESTRATOR of the project "${projectName}". Specialist agents each work in a ` +
      `sub-folder. Shared brief:\n\n${brief}\n\nYou work at the project root and integrate/test the whole project.`;
    const sessions: Record<string, Session> = { [orch.id]: orch };
    const panels: string[] = [orch.id];
    const rolePanels: string[] = [];
    const folderToPanel: Record<string, string> = {};
    roleData.forEach((r) => {
      const s = newSession(r.folder);
      s.roleLabel = r.role;
      s.orchestrationGrant = grant;
      s.systemAppend =
        `You are the "${r.role}" specialist on the project "${projectName}", coordinated by an ` +
        `orchestrator. Work ONLY inside your assigned folder. Shared brief:\n\n${brief}`;
      sessions[s.id] = s;
      panels.push(s.id);
      rolePanels.push(s.id);
      folderToPanel[r.folder.split("/").pop() || r.folder] = s.id;
    });
    set({
      sessions,
      panels,
      activePanel: orch.id,
      orch: { ...IDLE_ORCH, active: true, phase: "working", orchestratorPanel: orch.id, rolePanels, round: 1, projectName, projectRoot },
    });
    pushAssistant(orch.id, `Project "${projectName}" created.\n\n${brief}\n\nDispatching ${roleData.length} agents…`);

    // 3) Round loop: roles work → orchestrator reviews → done or dispatch fixes.
    let dispatch = roleData.map((r, i) => ({ panelId: rolePanels[i], prompt: rolePrompt(r.role, r.task) }));
    const MAX_ROUNDS = 3;
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      set((s) => ({ orch: { ...s.orch, phase: "working", round } }));
      await Promise.all(dispatch.map((d) => get().send(d.panelId, d.prompt)));

      set((s) => ({ orch: { ...s.orch, phase: "reviewing" } }));
      await get().send(orch.id, reviewPrompt(round));
      const decision = parseDecision(lastAssistantText(orch.id));

      if (decision.status === "done" || round === MAX_ROUNDS) {
        set((s) => ({ orch: { ...s.orch, phase: "done", active: false, runInstructions: decision.run || "" } }));
        return;
      }
      const fixes = (decision.fixes || [])
        .map((f) => ({ panelId: folderToPanel[f.folder], prompt: `${f.instruction}\n\nApply the fix in your folder, then stop.` }))
        .filter((d) => d.panelId);
      if (!fixes.length) {
        set((s) => ({ orch: { ...s.orch, phase: "done", active: false, runInstructions: decision.run || "" } }));
        return;
      }
      dispatch = fixes;
    }
  },

  setCwd: (id, cwd) => {
    updateSession(id, (s) => ({ ...s, cwd }));
    const { settings, token } = get();
    void persist({ ...settings, cwd }, token);
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
      items: [],
      sessionId: null,
      turnId: null,
      pending: [],
      roleLabel: undefined,
      orchestrationGrant: undefined,
    }));
    touchProjectApi(projectPath, get().token);
    scheduleSaveWorkspace();
  },

  resumeSession: async (id, projectPath, sessionId) => {
    updateSession(id, (s) => ({
      ...s,
      cwd: projectPath,
      items: [],
      sessionId,
      turnId: null,
      pending: [],
      roleLabel: undefined,
      orchestrationGrant: undefined,
    }));
    touchProjectApi(projectPath, get().token);
    scheduleSaveWorkspace();
    const token = get().token;
    try {
      const d = await fetch(`/api/projects/messages?sessionId=${encodeURIComponent(sessionId)}`, {
        headers: token ? { "x-ccw-token": token } : {},
      }).then((r) => r.json());
      if (Array.isArray(d.items)) updateSession(id, (s) => ({ ...s, items: d.items }));
    } catch {
      /* ignore */
    }
  },

  initWorkspace: async () => {
    const token = get().token;
    const [w, pj] = await Promise.all([
      fetch("/api/workspace").then((r) => r.json()).catch(() => ({ panels: [] })),
      fetch("/api/projects").then((r) => r.json()).catch(() => ({ projects: [] })),
    ]);
    const existing = new Set<string>((pj.projects ?? []).map((p: { path: string }) => p.path));
    const wpanels = (w.panels ?? []).filter((p: { projectPath: string }) => existing.has(p.projectPath)).slice(0, MAX_PANELS);
    if (wpanels.length) {
      const sessions: Record<string, Session> = {};
      const panels: string[] = [];
      for (const p of wpanels) {
        const s = newSession(p.projectPath);
        s.selModel = p.selModel ?? null;
        s.effort = p.effort;
        s.roleLabel = p.roleLabel;
        s.sessionId = p.sessionId ?? null;
        sessions[s.id] = s;
        panels.push(s.id);
      }
      const ai = Math.min(Math.max(0, w.activeIndex ?? 0), panels.length - 1);
      set({ sessions, panels, activePanel: panels[ai] });
      wpanels.forEach((p: { sessionId?: string | null }, i: number) => {
        if (p.sessionId) loadItemsInto(panels[i], p.sessionId, token);
      });
    } else if ((pj.projects ?? []).length) {
      const s = newSession(pj.projects[0].path);
      set({ sessions: { [s.id]: s }, panels: [s.id], activePanel: s.id });
      touchProjectApi(pj.projects[0].path, token);
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
    const abortController = new AbortController();
    updateSession(id, (s) => ({
      ...s,
      items: [...s.items, { kind: "user", id: nid(), text: prompt }],
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
    }
  },
}));

/** approvalIds with an /api/chat/approve POST in flight (double-click guard). */
const approvalsInFlight = new Set<string>();

function updateSession(id: string, updater: (s: Session) => Session) {
  useAgent.setState((st) => {
    const cur = st.sessions[id];
    if (!cur) return {};
    return { sessions: { ...st.sessions, [id]: updater(cur) } };
  });
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
    .catch(() => {});
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
      body: JSON.stringify({ panels, activeIndex }),
    }).catch(() => {});
  }, 800);
}

function reduce(id: string, e: AgentEvent) {
  switch (e.type) {
    case "ready":
      updateSession(id, (s) => ({ ...s, turnId: e.turnId, sessionId: e.sessionId, model: e.model, apiKeySource: e.apiKeySource }));
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
      break;
    case "error":
      updateSession(id, (s) => ({ ...s, items: [...s.items, { kind: "error", id: nid(), message: e.message }] }));
      break;
  }
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

function rolePrompt(role: string, task: string): string {
  return (
    `${task}\n\n` +
    `Rules:\n- Work ONLY inside your assigned folder.\n` +
    `- Follow the shared brief so your part fits with the other roles.\n` +
    `- When finished, append one line "DONE — <one-sentence summary>" under a "## ${role}" heading in ` +
    `../easyclaude-status.md, then stop.`
  );
}

function reviewPrompt(round: number): string {
  return (
    `The role agents have finished round ${round}. Their work is in the sub-folders ` +
    `(see easyclaude-plan.md and easyclaude-status.md).\nFrom the project root:\n` +
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
