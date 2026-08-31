/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  serverExternalPackages: ["better-sqlite3", "@modelcontextprotocol/sdk"],
  experimental: {
    // Keep server actions payloads small; we stream via SSE routes.
  },
};

export default nextConfig;
