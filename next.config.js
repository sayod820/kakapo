/** @type {import('next').NextConfig} */
const backendUrl = process.env.KAKAPO_BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

const nextConfig = {
  reactStrictMode: true,
  images: { unoptimized: true },
  async rewrites() {
    return [
      {
        source: '/api/kakapo/:path*',
        destination: `${backendUrl}/:path*`,
      },
    ]
  },
  // Пропускаем проверки типов при сборке (код конвертирован из JSX)
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
}
module.exports = nextConfig
