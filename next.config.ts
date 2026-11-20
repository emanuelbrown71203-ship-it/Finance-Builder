import type { NextConfig } from "next";

/**
 * A name for this exact build. The app compares the one it is running with
 * the one the server has, so pulling down to refresh can load a newer version.
 */
// Off Vercel there is no commit id, so every local build shares one name and never asks to reload.
const buildId = process.env.VERCEL_GIT_COMMIT_SHA ?? "local";

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_BUILD_ID: buildId },
  cacheComponents: true,
  partialPrefetching: true,
  // PGlite ships a WebAssembly build of Postgres; load it from node_modules rather than bundling it.
  serverExternalPackages: ["@electric-sql/pglite"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
