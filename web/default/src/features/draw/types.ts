export type DrawMode = 'generate' | 'edit'

export interface ImageGenerationRequest {
  model: string
  prompt: string
  n: number
  size: string
  quality: string
  response_format: 'b64_json'
}

export interface ImageEditRequest extends ImageGenerationRequest {
  images: File[]
}

export interface ImageItem {
  b64_json?: string
  url?: string
  revised_prompt?: string
}

export interface ImageGenerationResponse {
  created: number
  data: ImageItem[]
  error?: { message?: string } | string
}

export interface SizeOption {
  label: string
  value: string
}

export interface QualityOption {
  label: string
  value: string
}

export interface DrawSubmitConfig {
  mode: DrawMode
  model: string
  prompt: string
  size: string
  quality: string
  n: number
  images: File[]
}

export interface PromptPolishConfig {
  model: string
  prompt: string
}

export interface DrawHistoryRecord {
  id: string
  userId?: number
  createdAt: number
  mode: DrawMode
  model: string
  prompt: string
  size: string
  quality: string
  n: number
  images: ImageItem[]
  sourceImageNames?: string[]
}
