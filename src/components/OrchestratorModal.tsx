"use client";

import { useState } from "react";
import { useAgent } from "@/store/agent";
import { useT } from "@/i18n";
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

// Plan-first flow: the orchestrator drafts brief + agents + engine/model
// assignments and asks structure questions; nothing runs until the user
// reviews (and optionally refines) the plan and explicitly launches it.
export function OrchestratorModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const token = useAgent((s) => s.token);
  const runOrchestration = useAgent((s) => s.runOrchestration);
  const [goal, setGoal] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [engines, setEngines] = useState<EngineOpt[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);
  const [extra, setExtra] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const headers = (): Record<string, string> => ({
    "content-type": "application/json",
    ...(token ? { "x-ccw-token": token } : {}),
  });

  const fetchPlan = async (ans?: string) => {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/orchestrate/plan", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ goal: goal.trim(), ...(ans ? { answers: ans } : {}) }),
      });
      const d = await r.json();
      if (d?.ok && d.plan) {
        setPlan(d.plan);
        setEngines(Array.isArray(d.engines) ? d.engines : []);
        setAnswers(new Array((d.plan.questions ?? []).length).fill(""));
      } else {
        setError(d?.error || t("orchPlanFailed"));
      }
    } catch {
      setError(t("serverUnreachable"));
    }
    setBusy(false);
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

  const launch = () => {
    if (!plan) return;
    onClose();
    void runOrchestration(goal.trim(), { projectName: plan.projectName, brief: plan.brief, roles: plan.roles });
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
                      <b>{r.role}</b>
                      <code>{r.folder}/</code>
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
                    </div>
                    <p className="settings-sub">{r.task}</p>
                  </div>
                );
              })}

              {error && <p className="orch-exp-note">⚠️ {error}</p>}
              <div className="modal-actions">
                <button className="btn btn-ghost" onClick={() => setPlan(null)} disabled={busy}>
                  ← {t("orchBack")}
                </button>
                <button className="btn btn-soft" onClick={refine} disabled={busy}>
                  {busy ? t("orchPlanning") : <><Icon name="refresh" size={13} /> {t("orchUpdatePlan")}</>}
                </button>
                <button className="btn btn-primary" onClick={launch} disabled={busy}>
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
