import { z } from "zod";
import { tokenValid } from "@/server/security";
import {
  listProjects,
  listGroups,
  createProjectMeta,
  renameProject,
  setProjectGroup,
  touchProject,
  deleteProject,
} from "@/server/project-registry";

export const runtime = "nodejs";

export function GET() {
  return Response.json({ projects: listProjects(), groups: listGroups() });
}

export async function POST(req: Request) {
  if (!tokenValid(req)) return Response.json({ ok: false }, { status: 403 });
  let body: { name: string; template?: string };
  try {
    body = z.object({ name: z.string().min(1).max(80), template: z.string().optional() }).parse(await req.json());
  } catch {
    return Response.json({ ok: false, error: "Invalid name" }, { status: 400 });
  }
  return Response.json(createProjectMeta(body.name, body.template));
}

export async function PATCH(req: Request) {
  if (!tokenValid(req)) return Response.json({ ok: false }, { status: 403 });
  let body: { folder: string; name?: string; group?: string | null };
  try {
    body = z
      .object({ folder: z.string(), name: z.string().max(80).optional(), group: z.string().max(40).nullable().optional() })
      .parse(await req.json());
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
  if (body.name && body.name.trim()) renameProject(body.folder, body.name);
  if (body.group !== undefined) setProjectGroup(body.folder, body.group);
  else touchProject(body.folder);
  return Response.json({ ok: true, projects: listProjects(), groups: listGroups() });
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
