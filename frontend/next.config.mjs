/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    const apiOrigin = process.env.CLEARPAGE_API_URL || "http://127.0.0.1:8000";
    return [
      { source: "/api/:path*", destination: `${apiOrigin}/:path*` },
      { source: "/v1/:path*", destination: `${apiOrigin}/v1/:path*` },
    ];
  },
};
export default nextConfig;
