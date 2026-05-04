import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { DrawForm } from './components/draw-form'
import { DrawHistory } from './components/draw-history'
import { DrawResult } from './components/draw-result'
import { editImage, generateImage, polishPrompt } from './api'
import {
  clearDrawHistory,
  deleteDrawHistoryRecord,
  getDrawHistory,
  saveDrawHistoryRecord,
} from './lib/storage'
import type { DrawHistoryRecord, DrawSubmitConfig, ImageItem } from './types'

function createHistoryId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function getErrorMessage(err: unknown, fallback: string) {
  const axiosErr = err as {
    response?: { data?: { error?: { message?: string } | string } }
    message?: string
  }
  const responseError = axiosErr?.response?.data?.error
  if (typeof responseError === 'string') return responseError
  if (responseError?.message) return responseError.message
  return axiosErr?.message || fallback
}

export function Draw() {
  const { t } = useTranslation()
  const userId = useAuthStore((state) => state.auth.user?.id)
  const [images, setImages] = useState<ImageItem[]>([])
  const [history, setHistory] = useState<DrawHistoryRecord[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [isPolishing, setIsPolishing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (userId === undefined) {
      setHistory([])
      setImages([])
      return
    }

    let mounted = true

    getDrawHistory(userId)
      .then((records) => {
        if (!mounted) return
        setHistory(records)
        if (records[0]?.images?.length) {
          setImages(records[0].images)
        } else {
          setImages([])
        }
      })
      .catch(() => {
        if (mounted) {
          setHistory([])
        }
      })

    return () => {
      mounted = false
    }
  }, [userId])

  const saveHistory = useCallback(
    async (config: DrawSubmitConfig, nextImages: ImageItem[]) => {
      const record: DrawHistoryRecord = {
        id: createHistoryId(),
        userId,
        createdAt: Date.now(),
        mode: config.mode,
        model: config.model,
        prompt: config.prompt,
        size: config.size,
        quality: config.quality,
        n: config.n,
        images: nextImages,
        sourceImageNames:
          config.mode === 'edit' ? config.images.map((image) => image.name) : [],
      }

      try {
        const records = await saveDrawHistoryRecord(record)
        setHistory(records)
        toast.success(t('Image saved to history'))
      } catch {
        toast.error(t('Could not save image history'))
      }
    },
    [t, userId]
  )

  const handleSubmit = useCallback(
    async (config: DrawSubmitConfig) => {
      if (config.mode === 'edit' && config.images.length === 0) {
        setError(t('Select at least one reference image'))
        return
      }

      setIsGenerating(true)
      setError(null)
      setImages([])

      try {
        const res =
          config.mode === 'edit'
            ? await editImage({
                model: config.model,
                prompt: config.prompt,
                n: config.n,
                size: config.size,
                quality: config.quality,
                images: config.images,
                response_format: 'b64_json',
              })
            : await generateImage({
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
        await saveHistory(config, res.data)
        toast.success(t('Image generated successfully'))
      } catch (err: unknown) {
        setError(getErrorMessage(err, t('Generation failed')))
      } finally {
        setIsGenerating(false)
      }
    },
    [saveHistory, t]
  )

  const handlePolishPrompt = useCallback(
    async (config: { model: string; prompt: string }) => {
      setIsPolishing(true)

      try {
        const polished = await polishPrompt(config)
        toast.success(t('Prompt polished'))
        return polished
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, t('Prompt polishing failed')))
        return ''
      } finally {
        setIsPolishing(false)
      }
    },
    [t]
  )

  const handleRestoreHistory = useCallback((record: DrawHistoryRecord) => {
    setError(null)
    setImages(record.images)
  }, [])

  const handleDeleteHistory = useCallback(async (id: string) => {
    const records = await deleteDrawHistoryRecord(id, userId)
    setHistory(records)
  }, [userId])

  const handleClearHistory = useCallback(async () => {
    if (!window.confirm(t('Clear all image history?'))) return
    await clearDrawHistory(userId)
    setHistory([])
  }, [t, userId])

  return (
    <div className='grid size-full grid-cols-1 gap-4 overflow-hidden p-4 lg:grid-cols-[22rem_minmax(0,1fr)]'>
      <div className='flex min-h-0 flex-col gap-4 overflow-y-auto rounded-lg border bg-card p-4'>
        <h2 className='text-lg font-semibold'>{t('Draw')}</h2>
        <DrawForm
          onSubmit={handleSubmit}
          onPolishPrompt={handlePolishPrompt}
          isGenerating={isGenerating}
          isPolishing={isPolishing}
        />
        <DrawHistory
          records={history}
          onRestore={handleRestoreHistory}
          onDelete={handleDeleteHistory}
          onClear={handleClearHistory}
        />
      </div>
      <div className='flex min-h-0 min-w-0 flex-1 flex-col rounded-lg border bg-card p-4'>
        <DrawResult
          images={images}
          isGenerating={isGenerating}
          error={error}
        />
      </div>
    </div>
  )
}
