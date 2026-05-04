import { useEffect, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { ImagePlus, Loader2, WandSparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { getUserModels } from '@/features/playground/api'
import {
  DRAW_IMAGE_ACCEPT,
  DEFAULT_DRAW_CONFIG,
  QUALITY_OPTIONS,
  SIZE_OPTIONS,
} from '../constants'
import type { DrawMode, DrawSubmitConfig, PromptPolishConfig } from '../types'

interface DrawFormProps {
  onSubmit: (config: DrawSubmitConfig) => void
  onPolishPrompt: (config: PromptPolishConfig) => Promise<string>
  isGenerating: boolean
  isPolishing: boolean
}

function isLikelyImageModel(model: string) {
  return /(^|[-_])(image|dall|mj|midjourney|sdxl|stable)([-_]|$)/i.test(model)
}

export function DrawForm({
  onSubmit,
  onPolishPrompt,
  isGenerating,
  isPolishing,
}: DrawFormProps) {
  const { t } = useTranslation()
  const imageInputId = useId()
  const [mode, setMode] = useState<DrawMode>('generate')
  const [model, setModel] = useState(DEFAULT_DRAW_CONFIG.model)
  const [polishModel, setPolishModel] = useState('')
  const [prompt, setPrompt] = useState('')
  const [size, setSize] = useState(DEFAULT_DRAW_CONFIG.size)
  const [quality, setQuality] = useState(DEFAULT_DRAW_CONFIG.quality)
  const [n, setN] = useState(DEFAULT_DRAW_CONFIG.n)
  const [images, setImages] = useState<File[]>([])

  const { data: models, isLoading: isLoadingModels } = useQuery({
    queryKey: ['draw-models'],
    queryFn: getUserModels,
  })

  const preferredPolishModel = useMemo(() => {
    if (!models || models.length === 0) return ''
    return models.find((m) => !isLikelyImageModel(m.value))?.value ?? models[0].value
  }, [models])

  useEffect(() => {
    if (!models || models.length === 0) return
    const hasCurrentModel = models.some((m) => m.value === model)
    if (!hasCurrentModel) {
      setModel(models[0].value)
    }
  }, [models, model])

  useEffect(() => {
    if (!models || models.length === 0) return
    const hasCurrentModel = models.some((m) => m.value === polishModel)
    if (!hasCurrentModel) {
      setPolishModel(preferredPolishModel)
    }
  }, [models, polishModel, preferredPolishModel])

  const canSubmit =
    Boolean(prompt.trim() && model) && (mode === 'generate' || images.length > 0)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    onSubmit({
      mode,
      model,
      prompt: prompt.trim(),
      size,
      quality,
      n,
      images,
    })
  }

  const handlePolishPrompt = async () => {
    if (!prompt.trim() || !polishModel) return
    const polished = await onPolishPrompt({
      model: polishModel,
      prompt: prompt.trim(),
    })
    if (polished) {
      setPrompt(polished)
    }
  }

  const handleImagesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? [])
    setImages(selected)
    e.target.value = ''
  }

  const removeImage = (index: number) => {
    setImages((current) => current.filter((_, i) => i !== index))
  }

  return (
    <form onSubmit={handleSubmit} className='flex flex-col gap-4'>
      <Tabs value={mode} onValueChange={(value) => setMode(value as DrawMode)}>
        <TabsList className='grid w-full grid-cols-2'>
          <TabsTrigger value='generate'>{t('Text to Image')}</TabsTrigger>
          <TabsTrigger value='edit'>{t('Image to Image')}</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className='space-y-2'>
        <Label>{t('Model')}</Label>
        {isLoadingModels ? (
          <div className='flex h-9 items-center text-sm text-muted-foreground'>
            <Loader2 className='mr-2 size-4 animate-spin' />
            {t('Loading...')}
          </div>
        ) : (
          <Select value={model} onValueChange={setModel}>
            <SelectTrigger>
              <SelectValue placeholder={t('Select Model')} />
            </SelectTrigger>
            <SelectContent>
              {models?.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className='space-y-2'>
        <Label>{t('Prompt Model')}</Label>
        {isLoadingModels ? (
          <div className='flex h-9 items-center text-sm text-muted-foreground'>
            <Loader2 className='mr-2 size-4 animate-spin' />
            {t('Loading...')}
          </div>
        ) : (
          <Select value={polishModel} onValueChange={setPolishModel}>
            <SelectTrigger>
              <SelectValue placeholder={t('Select Model')} />
            </SelectTrigger>
            <SelectContent>
              {models?.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className='space-y-2'>
        <div className='flex items-center justify-between gap-2'>
          <Label>{t('Prompt')}</Label>
          <Button
            type='button'
            size='sm'
            variant='ghost'
            onClick={handlePolishPrompt}
            disabled={isPolishing || !prompt.trim() || !polishModel}
          >
            {isPolishing ? (
              <Loader2 className='size-4 animate-spin' />
            ) : (
              <WandSparkles className='size-4' />
            )}
            {isPolishing ? t('Polishing...') : t('Polish Prompt')}
          </Button>
        </div>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t('Describe the image you want to generate...')}
          className='min-h-[160px] resize-y'
          maxLength={4000}
        />
      </div>

      {mode === 'edit' && (
        <div className='space-y-2'>
          <Label>{t('Reference Images')}</Label>
          <input
            id={imageInputId}
            type='file'
            accept={DRAW_IMAGE_ACCEPT}
            multiple
            className='hidden'
            onChange={handleImagesChange}
          />
          <Button type='button' variant='outline' className='w-full' asChild>
            <label htmlFor={imageInputId}>
              <ImagePlus className='size-4' />
              {t('Upload reference images')}
            </label>
          </Button>

          {images.length > 0 && (
            <div className='space-y-2'>
              <p className='text-xs text-muted-foreground'>
                {t('Selected reference images')}
              </p>
              <div className='space-y-1'>
                {images.map((image, index) => (
                  <div
                    key={`${image.name}-${index}`}
                    className='flex h-8 items-center gap-2 rounded-md border px-2 text-xs'
                  >
                    <span className='min-w-0 flex-1 truncate'>{image.name}</span>
                    <Button
                      type='button'
                      size='icon-sm'
                      variant='ghost'
                      aria-label={t('Remove reference image')}
                      onClick={() => removeImage(index)}
                    >
                      <X className='size-4' />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className='grid grid-cols-2 gap-3'>
        <div className='space-y-2'>
          <Label>{t('Size')}</Label>
          <Select value={size} onValueChange={setSize}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SIZE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className='space-y-2'>
          <Label>{t('Quality')}</Label>
          <Select value={quality} onValueChange={setQuality}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {QUALITY_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className='space-y-2'>
        <Label>{t('Count')}</Label>
        <Input
          type='number'
          min={1}
          max={4}
          value={n}
          onChange={(e) =>
            setN(Math.min(4, Math.max(1, Number(e.target.value) || 1)))
          }
        />
      </div>

      <Button type='submit' disabled={isGenerating || !canSubmit}>
        {isGenerating ? (
          <>
            <Loader2 className='mr-2 size-4 animate-spin' />
            {t('Generating...')}
          </>
        ) : mode === 'edit' ? (
          t('Generate from Image')
        ) : (
          t('Generate Image')
        )}
      </Button>
    </form>
  )
}
