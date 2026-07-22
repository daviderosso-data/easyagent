"use client";

import { useRef, useState } from "react";
import { useAgent } from "@/store/agent";
import { useT } from "@/i18n";
import { apiUpload } from "@/lib/fs-client";
import { addUploadFiles, readExcerpts, UPLOAD_ACCEPT, type UploadReject } from "@/lib/uploads";
import { Icon } from "@/components/icons";

interface PlanRole {
  role: string;
  folder: string;
  task: string;
  provider: string;
  model: string | null;
}
interface Plan {
  projectName: string;
  brief: string;
  questions: string[];
  roles: PlanRole[];
}
interface EngineOpt {
  id: string;
  label: string;
  models: (string | null)[];
}
interface SuggestedSkill {
  id: string;
  skillId: string;
  name: string;
  installs: number;
  source: string;
}
interface SuggestedMcp {
  name: string;
  reason: string;
  requiresToken: boolean;
}

const REJECT_TOAST = { type: "toastFileType", big: "toastFileTooBig", many: "toastTooManyFiles" } as const;

// Plan-first flow: the orchestrator drafts brief + agents + engine/model
// assignments and asks structure questions; nothing runs until the user
// reviews (and optionally refines) the plan and explicitly launches it.
export function OrchestratorModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const token = useAgent((s) => s.token);
  const runOrchestration = useAgent((s) => s.runOrchestration);
  const pushToast = useAgent((s) => s.pushToast);
  const [goal, setGoal] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [engines, setEngines] = useState<EngineOpt[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);
  const [extra, setExtra] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refFiles, setRefFiles] = useState<File[]>([]);
  const [skills, setSkills] = useState<SuggestedSkill[]>([]);
  const [selSkills, setSelSkills] = useState<Set<string>>(new Set());
  const [mcps, setMcps] = useState<SuggestedMcp[]>([]);
  const [mcpState, setMcpState] = useState<Record<string, "adding" | "added" | "error">>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const headers = (): Record<string, string> => ({
    "content-type": "application/json",
    ...(token ? { "x-ccw-token": token } : {}),
  });

  const addFiles = (incoming: Iterable<File>) =>
    setRefFiles((cur) => addUploadFiles(cur, incoming, (why: UploadReject) => pushToast(REJECT_TOAST[why])));

  const fetchPlan = async (ans?: string) => {
    setBusy(true);
    setError("");
    try {
      const references = refFiles.length ? await readExcerpts(refFiles) : undefined;
      const r = await fetch("/api/orchestrate/plan", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ goal: goal.trim(), ...(ans ? { answers: ans } : {}), ...(references ? { references } : {}) }),
      });
      const d = await r.json();
      if (d?.ok && d.plan) {
        setPlan(d.plan);
        setEngines(Array.isArray(d.engines) ? d.engines : []);
        setAnswers(new Array((d.plan.questions ?? []).length).fill(""));
        const sk: SuggestedSkill[] = Array.isArray(d.suggestedSkills) ? d.suggestedSkills : [];
        setSkills(sk);
        setSelSkills(new Set(sk.map((s) => s.id)));
        setMcps(Array.isArray(d.connectors) ? d.connectors : []);
      } else {
        setError(d?.error || t("orchPlanFailed"));
      }
    } catch {
      setError(t("serverUnreachable"));
    }
    setBusy(false);
  };

  const addMcpPreset = async (name: string) => {
    setMcpState((m) => ({ ...m, [name]: "adding" }));
    try {
      const r = await fetch("/api/mcp", { method: "POST", headers: headers(), body: JSON.stringify({ preset: name }) });
      const d = await r.json();
      setMcpState((m) => ({ ...m, [name]: d?.ok ? "added" : "error" }));
    } catch {
      setMcpState((m) => ({ ...m, [name]: "error" }));
    }
  };

  const refine = () => {
    if (!plan) return;
    const parts = plan.questions
      .map((q, i) => (answers[i]?.trim() ? `Q: ${q}\nA: ${answers[i].trim()}` : null))
      .filter(Boolean) as string[];
    if (extra.trim()) parts.push(`Additional instructions from the user:\n${extra.trim()}`);
    setExtra("");
    void fetchPlan(parts.join("\n\n") || undefined);
  };

  const updateRole = (i: number, patch: Partial<PlanRole>) => {
    setPlan((p) => (p ? { ...p, roles: p.roles.map((r, j) => (j === i ? { ...r, ...patch } : r)) } : p));
  };

  const launch = async () => {
    if (!plan) return;
    // Stage the reference files first: the project folder does not exist yet,
    // /api/orchestrate moves them into <project>/reference/ on creation.
    let stagingId: string | undefined;
    if (refFiles.length) {
      setBusy(true);
      const up = await apiUpload(refFiles, token, { staging: true });
      setBusy(false);
      if (!up.ok || !up.stagingId) {
        pushToast("toastUpload");
        return;
      }
      stagingId = up.stagingId;
    }
    const installSkills = skills
      .filter((s) => selSkills.has(s.id))
      .map((s) => ({ source: s.source, skillId: s.skillId }));
    onClose();
    void runOrchestration(goal.trim(), {
      projectName: plan.projectName,
      brief: plan.brief,
      roles: plan.roles,
      ...(stagingId ? { stagingId } : {}),
      ...(installSkills.length ? { installSkills } : {}),
    });
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="settings-modal">
        <div className="settings-head">
          <h2>
            <Icon name="network" size={16} /> {t("orchestrateTitle")} <span className="orch-badge-exp">{t("experimental")}</span>
          </h2>
          <button className="icon-btn" onClick={onClose} aria-label={t("close")}>
            <Icon name="x" size={14} />
          </button>
        </div>
        <div className="settings-body">
          {!plan ? (
            <>
              <p className="settings-sub">{t("orchestrateHint")}</p>
              <p className="orch-exp-note">⚠️ {t("orchExperimentalNote")}</p>
              <textarea
                className="composer-input orch-goal"
                rows={4}
                autoFocus
                placeholder={t("orchestrateGoal")}
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
              />
              <div className="orch-attach-row">
                <input
                  ref={fileInputRef}
                  type="file"
                  hidden
                  multiple
                  accept={UPLOAD_ACCEPT}
                  onChange={(e) => {
                    if (e.target.files) addFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
                <button className="icon-btn icon-btn-sm" title={t("attachTip")} aria-label={t("attachTip")} onClick={() => fileInputRef.current?.click()}>
                  <Icon name="paperclip" size={13} /> {t("orchRefTitle")}
                </button>
                <span className="orch-ref-hint">{t("orchRefHint")}</span>
              </div>
              {refFiles.length > 0 && (
                <div className="attach-chips">
                  {refFiles.map((f) => (
                    <span className="attach-chip" key={f.name + f.size}>
                      <Icon name="file" size={11} />
                      <span className="attach-chip-name">{f.name}</span>
                      <button className="attach-chip-x" aria-label={t("close")} onClick={() => setRefFiles((cur) => cur.filter((x) => x !== f))}>
                        <Icon name="x" size={10} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {error && <p className="orch-exp-note">⚠️ {error}</p>}
              <div className="modal-actions">
                <button className="btn btn-ghost" onClick={onClose}>
                  {t("close")}
                </button>
                <button className="btn btn-primary" disabled={!goal.trim() || busy} onClick={() => void fetchPlan()}>
                  {busy ? t("orchPlanning") : <><Icon name="note" size={13} /> {t("orchPlanBtn")}</>}
                </button>
              </div>
            </>
          ) : (
            <>
              <label className="select-row">
                <span>{t("orchProjectName")}</span>
                <input
                  className="field-input"
                  value={plan.projectName}
                  onChange={(e) => setPlan({ ...plan, projectName: e.target.value })}
                />
              </label>

              <h3>{t("orchBriefTitle")}</h3>
              <p className="settings-sub orch-brief">{plan.brief}</p>

              {plan.questions.length > 0 && (
                <>
                  <h3><Icon name="question" size={14} /> {t("orchQuestionsTitle")}</h3>
                  {plan.questions.map((q, i) => (
                    <label className="orch-question" key={i}>
                      <span>{q}</span>
                      <input
                        className="field-input"
                        placeholder={t("orchAnswerPh")}
                        value={answers[i] ?? ""}
                        onChange={(e) => setAnswers((a) => a.map((v, j) => (j === i ? e.target.value : v)))}
                      />
                    </label>
                  ))}
                </>
              )}

              <h3><Icon name="plus" size={14} /> {t("orchExtraTitle")}</h3>
              <textarea
                className="field-input"
                rows={2}
                value={extra}
                placeholder={t("orchExtraPh")}
                onChange={(e) => setExtra(e.target.value)}
              />

              <h3><Icon name="robot" size={14} /> {t("orchRolesTitle")}</h3>
              {plan.roles.map((r, i) => {
                const engine = engines.find((e) => e.id === r.provider) ?? engines[0];
                return (
                  <div className="orch-role" key={i}>
                    <div className="orch-role-head">
                      <input
                        className="field-input orch-role-name"
                        value={r.role}
                        placeholder={t("orchRolePh")}
                        onChange={(e) => updateRole(i, { role: e.target.value })}
                      />
                      <input
                        className="field-input orch-role-folder"
                        value={r.folder}
                        spellCheck={false}
                        placeholder={t("orchFolderPh")}
                        onChange={(e) => updateRole(i, { folder: e.target.value })}
                      />
                      <span className="panel-head-spacer" />
                      <select
                        className="hdr-select"
                        title={t("engineTip")}
                        value={r.provider}
                        onChange={(e) => updateRole(i, { provider: e.target.value, model: null })}
                      >
                        {engines.map((en) => (
                          <option key={en.id} value={en.id}>
                            {en.label}
                          </option>
                        ))}
                      </select>
                      <select
                        className="hdr-select"
                        title={t("modelTip")}
                        value={r.model ?? ""}
                        onChange={(e) => updateRole(i, { model: e.target.value || null })}
                      >
                        {(engine?.models ?? [null]).map((m) => (
                          <option key={m ?? "default"} value={m ?? ""}>
                            {m ?? t("optDefault")}
                          </option>
                        ))}
                      </select>
                      <button
                        className="icon-btn icon-btn-sm"
                        aria-label={t("close")}
                        disabled={plan.roles.length <= 1}
                        onClick={() => setPlan({ ...plan, roles: plan.roles.filter((_, j) => j !== i) })}
                      >
                        <Icon name="x" size={12} />
                      </button>
                    </div>
                    <textarea
                      className="field-input orch-role-task"
                      rows={2}
                      value={r.task}
                      placeholder={t("orchTaskPh")}
                      onChange={(e) => updateRole(i, { task: e.target.value })}
                    />
                  </div>
                );
              })}
              {plan.roles.length < 6 && (
                <button
                  className="link-btn"
                  onClick={() =>
                    setPlan({
                      ...plan,
                      roles: [
                        ...plan.roles,
                        { role: "", folder: `agent-${plan.roles.length + 1}`, task: "", provider: engines[0]?.id ?? "claude", model: null },
                      ],
                    })
                  }
                >
                  <Icon name="plus" size={12} /> {t("orchAddAgent")}
                </button>
              )}

              {refFiles.length > 0 && (
                <>
                  <h3><Icon name="paperclip" size={13} /> {t("orchRefTitle")}</h3>
                  <div className="attach-chips">
                    {refFiles.map((f) => (
                      <span className="attach-chip" key={f.name + f.size}>
                        <Icon name="file" size={11} />
                        <span className="attach-chip-name">{f.name}</span>
                      </span>
                    ))}
                  </div>
                  <p className="settings-sub">{t("orchRefHint")}</p>
                </>
              )}

              {(skills.length > 0 || mcps.length > 0) && (
                <>
                  <h3><Icon name="sparkles" size={14} /> {t("orchSuggestTitle")}</h3>
                  {skills.map((s) => (
                    <label className="orch-suggest" key={s.id}>
                      <input
                        type="checkbox"
                        checked={selSkills.has(s.id)}
                        onChange={(e) =>
                          setSelSkills((cur) => {
                            const next = new Set(cur);
                            if (e.target.checked) next.add(s.id);
                            else next.delete(s.id);
                            return next;
                          })
                        }
                      />
                      <span className="orch-suggest-name">{s.name}</span>
                      <span className="orch-suggest-meta">
                        {s.installs > 0 ? `${s.installs} ${t("installsLbl")} · ` : ""}
                        {t("orchSkillInstall")}
                      </span>
                    </label>
                  ))}
                  {mcps.map((m) => (
                    <div className="orch-suggest" key={m.name}>
                      <Icon name="plug" size={13} />
                      <span className="orch-suggest-name">{m.name}</span>
                      <span className="orch-suggest-meta">{m.reason}</span>
                      <span className="panel-head-spacer" />
                      {m.requiresToken ? (
                        <span className="orch-suggest-meta">{t("orchMcpOpenConn")}</span>
                      ) : mcpState[m.name] === "added" ? (
                        <span className="orch-suggest-meta"><Icon name="check" size={12} /> {t("orchMcpAdded")}</span>
                      ) : (
                        <button
                          className="btn btn-soft btn-sm"
                          disabled={mcpState[m.name] === "adding"}
                          onClick={() => void addMcpPreset(m.name)}
                        >
                          {mcpState[m.name] === "error" ? t("orchMcpRetry") : t("orchMcpAdd")}
                        </button>
                      )}
                    </div>
                  ))}
                </>
              )}

              {error && <p className="orch-exp-note">⚠️ {error}</p>}
              <div className="modal-actions">
                <button className="btn btn-ghost" onClick={() => setPlan(null)} disabled={busy}>
                  ← {t("orchBack")}
                </button>
                <button className="btn btn-soft" onClick={refine} disabled={busy}>
                  {busy ? t("orchPlanning") : <><Icon name="refresh" size={13} /> {t("orchUpdatePlan")}</>}
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => void launch()}
                  disabled={busy || plan.roles.some((r) => !r.role.trim() || !r.folder.trim() || !r.task.trim())}
                >
                  ▸ {t("startOrchestration")}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
