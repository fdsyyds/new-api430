import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { DrawForm } from './components/draw-form'
import { DrawResult } from './components/draw-result'
import { generateImage } from './api'
import type { ImageItem } from './types'

export function Draw() {
  const { t } = useTranslation()
  const [images, setImages] = useState<ImageItem[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = useCallback(
    async (config: {
      model: string
      prompt: string
      size: string
      quality: string
      n: number
    }) => {
      setIsGenerating(true)
      setError(null)
      setImages([])

      try {
        const res = await generateImage({
          model: config.model,
          prompt: config.prompt,
          n: config.n,
          size: config.size,
          quality: config.quality,
          response_format: 'b64_json',
        })

        if (res.error) {
          const errObj = res.error
          const msg =
            typeof errObj === 'object' && errObj?.message
              ? errObj.message
              : String(errObj || t('Generation failed'))
          setError(msg)
          return
        }

        if (!res.data || res.data.length === 0) {
          setError(t('No images returned'))
          return
        }

        setImages(res.data)
        toast.success(t('Image generated successfully'))
      } catch (err: unknown) {
        const axiosErr = err as { response?: { data?: { error?: { message?: string } } }; message?: string }
        const msg =
          axiosErr?.response?.data?.error?.message ||
          axiosErr?.message ||
          t('Generation failed')
        setError(msg)
      } finally {
        setIsGenerating(false)
      }
    },
    [t]
  )

  return (
    <div className='flex size-full gap-4 overflow-hidden p-4'>
      <div className='w-80 shrink-0 overflow-y-auto rounded-lg border bg-card p-4'>
        <h2 className='mb-4 text-lg font-semibold'>{t('Draw')}</h2>
        <DrawForm onSubmit={handleSubmit} isGenerating={isGenerating} />
      </div>
      <div className='flex min-w-0 flex-1 flex-col rounded-lg border bg-card p-4'>
        <DrawResult
          images={images}
          isGenerating={isGenerating}
          error={error}
        />
      </div>
    </div>
  )
}
