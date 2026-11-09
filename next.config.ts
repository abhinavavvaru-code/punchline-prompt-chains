import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // The generate route reads bundled preset photos from disk to send real pixels
  // to the vision step; include them in that serverless function's trace.
  outputFileTracingIncludes: { '/api/chains/[id]/generate': ['./public/photos/**/*'] },
  poweredByHeader: false,
}

export default nextConfig
