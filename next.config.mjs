/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingIncludes: { "/": ["./public/data/**/*.json"], "/api/estimate": ["./public/data/**/*.json"] },
  typescript: { ignoreBuildErrors: true },
}

export default nextConfig
