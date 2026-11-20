/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  // Never show a kept copy of a console page when moving between tabs.
  experimental: { staleTimes: { dynamic: 0, static: 30 } },
};

export default nextConfig;
