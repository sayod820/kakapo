/** @type {import('next').NextConfig} */
const DEFAULT_BACKEND = 'https://kakapo-api.onrender.com'

function resolveBackendUrl() {
  for (const key of ['KAKAPO_BACKEND_URL', 'NEXT_PUBLIC_API_URL']) {
    const raw = (process.env[key] || '').trim()
    if (!raw || raw === 'true' || raw === 'false') continue
    if (/^https?:\/\//i.test(raw)) return raw.replace(/\/$/, '')
  }
  return process.env.NODE_ENV === 'production' ? DEFAULT_BACKEND : 'http://localhost:8000'
}

const backendUrl = resolveBackendUrl()

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
