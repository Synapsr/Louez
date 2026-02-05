import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { env } from '@/env'

export const s3Client = new S3Client({
  region: env.S3_REGION,
  endpoint: env.S3_ENDPOINT,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
})

const BUCKET = env.S3_BUCKET
const PUBLIC_URL = env.S3_PUBLIC_URL

interface UploadOptions {
  key: string
  body: Buffer | Uint8Array | Blob
  contentType: string
}

export async function uploadFile({ key, body, contentType }: UploadOptions) {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      ACL: 'public-read',
    })
  )

  return `${PUBLIC_URL}/${key}`
}

export async function deleteFile(key: string) {
  await s3Client.send(
    new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: key,
    })
  )
}

export async function getPresignedUploadUrl(
  key: string,
  contentType: string,
  expiresIn = 3600
) {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
  })

  return getSignedUrl(s3Client, command, { expiresIn })
}

export async function getPresignedDownloadUrl(key: string, expiresIn = 3600) {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
  })

  return getSignedUrl(s3Client, command, { expiresIn })
}

export function getPublicUrl(key: string) {
  return `${PUBLIC_URL}/${key}`
}

export function getStorageKey(
  storeId: string,
  type: 'logo' | 'products' | 'documents' | 'inspections',
  ...parts: string[]
) {
  const base = `${storeId}/${type}`
  if (parts.length === 0) return base
  return `${base}/${parts.join('/')}`
}
