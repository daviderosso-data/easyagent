import { z } from "zod";
import { loadSettings, saveSettings } from "@/server/settings-store";
import { tokenValid } from "@/server/security";
import type { AppSettings } from "@/lib/settings";

export const runtime = "nodejs";

export function GET() {
  return Response.json(loadSettings());
}

const SecuritySchema = z.object({
  profile: z.enum(["locked", "standard", "open"]),
  sandbox: z.boolean(),
  blockCatastrophic: z.boolean(),
  blockSecrets: z.boolean(),
  confineToFolder: z.boolean(),
  installNetwork: z.enum(["block", "red", "normal", "off"]),
  behavior: z.enum(["ask", "auto", "open"]),
});

const SettingsSchema = z.object({
  lang: z.enum(["en", "it"]),
  theme: z.enum(["system", "light", "dark"]).default("system"),
  model: z.string().nullable(),
  security: SecuritySchema,
  cwd: z.string().nullable(),
  notifications: z.boolean().default(false),
});

export async function PUT(req: Request) {
  if (!tokenValid(req)) return Response.json({ error: "Unauthorized" }, { status: 403 });
  let body: AppSettings;
  try {
    body = SettingsSchema.parse(await req.json());
  } catch {
    return Response.json({ error: "Invalid settings" }, { status: 400 });
  }
  saveSettings(body);
  return Response.json({ ok: true });
}
