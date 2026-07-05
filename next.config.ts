import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root to this project (a stray lockfile in $HOME otherwise
  // makes Next infer the wrong root).
  turbopack: { root: import.meta.dirname },
  // The Agent SDK spawns a bundled Claude Code binary — keep it external so
  // Next/webpack doesn't try to bundle it (and its native assets).
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk"],
};

export default nextConfig;
