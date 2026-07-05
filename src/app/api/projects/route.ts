import { z } from "zod";
import { tokenValid } from "@/server/security";
import { listProjects, createProjectMeta, renameProject, touchProject, deleteProject } from "@/server/project-registry";

export const runtime = "nodejs";

export function GET() {
  return Response.json({ projects: listProjects() });
}

export async function POST(req: Request) {
  if (!tokenValid(req)) return Response.json({ ok: false }, { status: 403 });
  let name: string;
  try {
    name = z.object({ name: z.string().min(1).max(80) }).parse(await req.json()).name;
  } catch {
    return Response.json({ ok: false, error: "Invalid name" }, { status: 400 });
  }
  return Response.json(createProjectMeta(name));
}

export async function PATCH(req: Request) {
  if (!tokenValid(req)) return Response.json({ ok: false }, { status: 403 });
  let body: { folder: string; name?: string };
  try {
    body = z.object({ folder: z.string(), name: z.string().max(80).optional() }).parse(await req.json());
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
  if (body.name && body.name.trim()) renameProject(body.folder, body.name);
  touchProject(body.folder);
  return Response.json({ ok: true, projects: listProjects() });
}

export async function DELETE(req: Request) {
  if (!tokenValid(req)) return Response.json({ ok: false }, { status: 403 });
  let folder: string;
  try {
    folder = z.object({ folder: z.string() }).parse(await req.json()).folder;
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
  const ok = deleteProject(folder);
  return Response.json({ ok, projects: listProjects() });
}
