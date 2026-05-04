import { api } from '@/lib/api'
import type { ImageGenerationRequest, ImageGenerationResponse } from './types'

export async function generateImage(
  payload: ImageGenerationRequest
): Promise<ImageGenerationResponse> {
  const res = await api.post('/pg/images/generations', payload, {
    skipBusinessError: true,
    skipErrorHandler: true,
    timeout: 300000,
  } as Record<string, unknown>)
  return res.data
}
