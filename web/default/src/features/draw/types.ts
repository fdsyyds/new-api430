export interface ImageGenerationRequest {
  model: string
  prompt: string
  n: number
  size: string
  quality: string
  response_format: 'b64_json'
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
