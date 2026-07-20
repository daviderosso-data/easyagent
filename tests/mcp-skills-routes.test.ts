import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { GET as mcpGet, POST as mcpPost } from "@/app/api/mcp/route";
import { GET as skillsGet } from "@/app/api/skills/route";
import { POST as togglePost } from "@/app/api/skills/toggle/route";
import { SESSION_TOKEN } from "@/server/security";
import { PROJECTS_ROOT } from "@/server/projects";

const auth = { "x-ccw-token": SESSION_TOKEN, "content-type": "application/json" };
const WS = join(PROJECTS_ROOT, "routes-p4-test");

describe("mcp/skills routes auth", () => {
  it("rejects requests without the session token", async () => {
    expect((await mcpGet(new Request("http://x/api/mcp"))).status).toBe(403);
    expect((await mcpPost(new Request("http://x/api/mcp", { method: "POST", body: "{}" }))).status).toBe(403);
    expect((await skillsGet(new Request(`http://x/api/skills?cwd=${WS}`))).status).toBe(403);
    expect(
      (await togglePost(new Request("http://x/api/skills/toggle", { method: "POST", body: "{}" }))).status
    ).toBe(403);
  });

  it("rejects malformed MCP bodies without writing anything", async () => {
    const bad = await mcpPost(
      new Request("http://x/api/mcp", { method: "POST", headers: auth, body: JSON.stringify({ entry: { name: "NOT VALID", kind: "stdio" } }) })
    );
    expect(bad.status).toBe(400);
    const badPreset = await mcpPost(
      new Request("http://x/api/mcp", { method: "POST", headers: auth, body: JSON.stringify({ preset: "github" }) })
    );
    expect(badPreset.status).toBe(400); // github without token
  });

  it("rejects bad cwd and bad skill names", async () => {
    expect((await skillsGet(new Request("http://x/api/skills?cwd=/etc", { headers: auth }))).status).toBe(400);
    const r = await togglePost(
      new Request("http://x/api/skills/toggle", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ cwd: WS, name: "../up", enabled: true }),
      })
    );
    expect(r.status).toBe(400);
  });
});
