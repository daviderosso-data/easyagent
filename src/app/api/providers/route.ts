import { listProviders } from "@/server/providers";
import { tokenValid } from "@/server/security";

export const runtime = "nodejs";
export const maxDuration = 60;

// Engines catalogue for the UI: capabilities, model options and live
// availability, probed in parallel (each provider's status() is fast and
// never throws).
export async function GET(req: Request) {
  if (!tokenValid(req)) return Response.json({ providers: [] }, { status: 403 });
  const providers = await Promise.all(
    listProviders().map(async (p) => {
      const [status, models] = await Promise.all([p.status(), p.models()]);
      return {
        id: p.id,
        label: p.label,
        capabilities: p.capabilities,
        models,
        status,
        hasAccount: !!p.account,
      };
    }),
  );
  return Response.json({ providers });
}
