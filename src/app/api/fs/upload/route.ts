import { Buffer } from "node:buffer";
import { tokenValid, validateCwd } from "@/server/security";
import { MAX_UPLOAD_FILES, newStagingId, saveAttachment, saveStaged } from "@/server/fs-upload";

export const runtime = "nodejs";
export const maxDuration = 120;

// Multipart upload from the composer (cwd → <project>/attachments/) or the
// orchestrator modal (staging=1 → ~/.easyagent/uploads/<id>/, consumed by
// /api/orchestrate when the reviewed plan launches).
export async function POST(req: Request) {
  if (!tokenValid(req)) return Response.json({ ok: false }, { status: 403 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ ok: false, error: "invalid-request" }, { status: 400 });
  }
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (!files.length) return Response.json({ ok: false, error: "no-files" }, { status: 400 });
  if (files.length > MAX_UPLOAD_FILES) return Response.json({ ok: false, error: "too-many" }, { status: 400 });

  const staging = form.get("staging") === "1";
  if (staging) {
    const stagingId = newStagingId();
    const names: string[] = [];
    for (const f of files) {
      const r = saveStaged(stagingId, f.name, Buffer.from(await f.arrayBuffer()));
      if (!r.ok || !r.name) return Response.json({ ok: false, error: r.error ?? "upload-failed", file: f.name });
      names.push(r.name);
    }
    return Response.json({ ok: true, stagingId, files: names.map((name) => ({ name })) });
  }

  const check = validateCwd(form.get("cwd"));
  if (!check.ok) return Response.json({ ok: false, error: "bad-project" }, { status: 400 });
  const saved: { name: string; rel: string }[] = [];
  for (const f of files) {
    const r = saveAttachment(check.path!, f.name, Buffer.from(await f.arrayBuffer()));
    if (!r.ok || !r.rel || !r.name) return Response.json({ ok: false, error: r.error ?? "upload-failed", file: f.name });
    saved.push({ name: r.name, rel: r.rel });
  }
  return Response.json({ ok: true, files: saved });
}
