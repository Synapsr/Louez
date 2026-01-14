import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

const nextConfig: NextConfig = {
  // Enable standalone output for Docker deployment
  output: 'standalone',
  // Increase body size limit for server actions (image uploads)
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
  images: {
    remotePatterns: [
      // Google (OAuth profile pictures)
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
      },
      // YouTube thumbnails
      {
        protocol: 'https',
        hostname: 'img.youtube.com',
      },
      // AWS S3
      {
        protocol: 'https',
        hostname: '*.s3.amazonaws.com',
      },
      {
        protocol: 'https',
        hostname: '*.s3.*.amazonaws.com',
      },
      {
        protocol: 'https',
        hostname: 's3.*.amazonaws.com',
      },
      // Scaleway Object Storage
      {
        protocol: 'https',
        hostname: '*.scw.cloud',
      },
      // OVH Object Storage
      {
        protocol: 'https',
        hostname: '*.cloud.ovh.net',
      },
      {
        protocol: 'https',
        hostname: '*.s3.*.cloud.ovh.net',
      },
      // DigitalOcean Spaces
      {
        protocol: 'https',
        hostname: '*.digitaloceanspaces.com',
      },
      // Cloudflare R2
      {
        protocol: 'https',
        hostname: '*.r2.cloudflarestorage.com',
      },
      // Backblaze B2
      {
        protocol: 'https',
        hostname: '*.backblazeb2.com',
      },
      // Wasabi
      {
        protocol: 'https',
        hostname: '*.wasabisys.com',
      },
      // Linode Object Storage
      {
        protocol: 'https',
        hostname: '*.linodeobjects.com',
      },
      // MinIO (self-hosted) - Allow any hostname for flexibility
      // Users can add their own custom domains if needed
    ],
  },
}

export default withNextIntl(nextConfig)
