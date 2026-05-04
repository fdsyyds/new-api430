import type { SizeOption, QualityOption } from './types'

export const SIZE_OPTIONS: SizeOption[] = [
  { label: '1024x1024', value: '1024x1024' },
  { label: '1536x1024', value: '1536x1024' },
  { label: '1024x1536', value: '1024x1536' },
  { label: '2048x2048', value: '2048x2048' },
  { label: '2880x2880', value: '2880x2880' },
  { label: '3840x2160', value: '3840x2160' },
  { label: '2160x3840', value: '2160x3840' },
]

export const QUALITY_OPTIONS: QualityOption[] = [
  { label: 'high', value: 'high' },
  { label: 'medium', value: 'medium' },
  { label: 'low', value: 'low' },
  { label: 'auto', value: 'auto' },
]

export const DEFAULT_DRAW_CONFIG = {
  model: 'gpt-image-1',
  size: '1024x1024',
  quality: 'auto',
  n: 1,
}
