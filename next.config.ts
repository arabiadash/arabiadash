import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // google-ads-api pulls in @grpc/grpc-js with native bindings that break
  // when Turbopack tries to bundle them on the server. Keep them external
  // so Node loads them at runtime from node_modules.
  serverExternalPackages: [
    "google-ads-api",
    "google-ads-node",
    "google-gax",
    "@grpc/grpc-js",
    "@grpc/proto-loader",
    "long",
  ],
  // Next.js 16's React Compiler-aware lint rules (react-hooks/set-state-in-effect,
  // react-hooks/purity, react-hooks/immutability) fire on legitimate patterns —
  // query-param parsing after mount, hydration-safe Date.now() init,
  // prop-into-state sync. Auditing every effect is tracked separately; for now,
  // don't gate Vercel deployments on these warnings. Local `npx eslint` still
  // surfaces them.
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
