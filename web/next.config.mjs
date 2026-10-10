/** @type {import('next').NextConfig} */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

const nextConfig = {
  // Pure static site: `npm run build` writes everything to ./out, which any
  // static host (nginx, GitHub Pages, S3...) can serve. No Node server needed.
  output: "export",
  basePath: basePath || undefined,
  images: { unoptimized: true },
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
