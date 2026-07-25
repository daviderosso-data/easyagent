// P6.11.4 — project-group management: create/recolor (POST), rename (PATCH),
// delete (DELETE — projects are only ungrouped, never touched).

import { z } from "zod";
import { tokenValid } from "@/server/security";
import { deleteGroup, listGroups, renameGroup, upsertGroup } from "@/server/project-registry";

export const runtime = "nodejs";

const ok = () => Response.json({ ok: true, groups: listGroups() });
const bad = (status = 400) => Response.json({ ok: false }, { status });

export async function POST(req: Request) {
  if (!tokenValid(req)) return bad(403);
  try {
    const body = z.object({ name: z.string().min(1).max(40), color: z.string().max(20).optional() }).parse(await req.json());
    return upsertGroup(body.name, body.color) ? ok() : bad();
  } catch {
    return bad();
  }
}

export async function PATCH(req: Request) {
  if (!tokenValid(req)) return bad(403);
  try {
    const body = z.object({ from: z.string().min(1).max(40), to: z.string().min(1).max(40) }).parse(await req.json());
    return renameGroup(body.from, body.to) ? ok() : bad();
  } catch {
    return bad();
  }
}

export async function DELETE(req: Request) {
  if (!tokenValid(req)) return bad(403);
  try {
    const body = z.object({ name: z.string().min(1).max(40) }).parse(await req.json());
    return deleteGroup(body.name) ? ok() : bad();
  } catch {
    return bad();
  }
}
