import { z } from "zod";
import {
  listMcpServers,
  addMcpServer,
  updateMcpServer,
  deleteMcpServer,
  entryFromPreset,
  getMcpStatus,
  MCP_PRESETS,
} from "@/server/mcp-store";
import { loadSettings } from "@/server/settings-store";
import { tokenValid } from "@/server/security";

export const runtime = "nodejs";

const KV = z.record(z.string(), z.string()).optional();
const EntryInput = z.object({
  name: z.string().max(64),
  kind: z.enum(["stdio", "http", "sse"]),
  command: z.string().max(500).optional(),
  args: z.array(z.string().max(500)).max(24).optional(),
  env: KV,
  url: z.string().max(2048).optional(),
  headers: KV,
  enabled: z.boolean().optional(),
});

export function GET(req: Request) {
  if (!tokenValid(req)) return Response.json({ ok: false }, { status: 403 });
  const status = getMcpStatus();
  const servers = listMcpServers().map((e) => ({
    ...e,
    status: status[e.name]?.status,
    statusError: status[e.name]?.error,
  }));
  return Response.json({
    ok: true,
    servers,
    presets: MCP_PRESETS.map((p) => ({ id: p.id, name: p.name, requiresToken: !!p.requiresToken })),
    locked: loadSettings().security.profile === "locked",
  });
}

const PostBody = z.union([
  z.object({ preset: z.string().max(64), token: z.string().max(4096).optional() }),
  z.object({ entry: EntryInput }),
]);

export async function POST(req: Request) {
  if (!tokenValid(req)) return Response.json({ ok: false }, { status: 403 });
  let body: z.infer<typeof PostBody>;
  try {
    body = PostBody.parse(await req.json());
  } catch {
    return Response.json({ ok: false, error: "bad-fields" }, { status: 400 });
  }
  if ("preset" in body) {
    const entry = entryFromPreset(body.preset, body.token);
    if (!entry) return Response.json({ ok: false, error: "bad-fields" }, { status: 400 });
    const res = addMcpServer(entry);
    return Response.json(res, { status: res.ok ? 200 : 400 });
  }
  const res = addMcpServer(body.entry);
  return Response.json(res, { status: res.ok ? 200 : 400 });
}

const PutBody = z.object({ id: z.string().max(64), patch: EntryInput.partial() });

export async function PUT(req: Request) {
  if (!tokenValid(req)) return Response.json({ ok: false }, { status: 403 });
  let body: z.infer<typeof PutBody>;
  try {
    body = PutBody.parse(await req.json());
  } catch {
    return Response.json({ ok: false, error: "bad-fields" }, { status: 400 });
  }
  const res = updateMcpServer(body.id, body.patch);
  return Response.json(res, { status: res.ok ? 200 : 400 });
}

export function DELETE(req: Request) {
  if (!tokenValid(req)) return Response.json({ ok: false }, { status: 403 });
  const id = new URL(req.url).searchParams.get("id") ?? "";
  return Response.json({ ok: deleteMcpServer(id) });
}
