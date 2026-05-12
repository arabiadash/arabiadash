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
};

export default nextConfig;
