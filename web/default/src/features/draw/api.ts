import { api } from '@/lib/api'
import type {
  ImageEditRequest,
  ImageGenerationRequest,
  ImageGenerationResponse,
  PromptPolishConfig,
} from './types'

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

export async function editImage(
  payload: ImageEditRequest
): Promise<ImageGenerationResponse> {
  const formData = new FormData()
  formData.append('model', payload.model)
  formData.append('prompt', payload.prompt)
  formData.append('n', String(payload.n))
  formData.append('size', payload.size)
  formData.append('quality', payload.quality)
  formData.append('response_format', payload.response_format)

  const imageField = payload.images.length > 1 ? 'image[]' : 'image'
  payload.images.forEach((image) => {
    formData.append(imageField, image)
  })

  const res = await api.post('/pg/images/edits', formData, {
    skipBusinessError: true,
    skipErrorHandler: true,
    timeout: 300000,
  } as Record<string, unknown>)
  return res.data
}

export async function polishPrompt({
  model,
  prompt,
}: PromptPolishConfig): Promise<string> {
  const res = await api.post(
    '/pg/chat/completions',
    {
      model,
      messages: [
        {
          role: 'system',
          content:
            'You polish prompts for image generation. Preserve the user intent, remove ambiguity, add useful visual detail, and return only the polished prompt.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      stream: false,
      temperature: 0.4,
    },
    {
      skipBusinessError: true,
      skipErrorHandler: true,
      timeout: 60000,
    } as Record<string, unknown>
  )

  if (res.data?.error) {
    const err = res.data.error
    throw new Error(
      typeof err === 'object' && err?.message
        ? err.message
        : String(err || 'Prompt polishing failed')
    )
  }

  const content = res.data?.choices?.[0]?.message?.content
  if (!content || typeof content !== 'string') {
    throw new Error('Prompt polishing failed')
  }

  return content.trim()
}
