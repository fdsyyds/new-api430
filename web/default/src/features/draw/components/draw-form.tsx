import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getUserModels } from '@/features/playground/api'
import { SIZE_OPTIONS, QUALITY_OPTIONS, DEFAULT_DRAW_CONFIG } from '../constants'

interface DrawFormProps {
  onSubmit: (config: {
    model: string
    prompt: string
    size: string
    quality: string
    n: number
  }) => void
  isGenerating: boolean
}

export function DrawForm({ onSubmit, isGenerating }: DrawFormProps) {
  const { t } = useTranslation()
  const [model, setModel] = useState(DEFAULT_DRAW_CONFIG.model)
  const [prompt, setPrompt] = useState('')
  const [size, setSize] = useState(DEFAULT_DRAW_CONFIG.size)
  const [quality, setQuality] = useState(DEFAULT_DRAW_CONFIG.quality)
  const [n, setN] = useState(DEFAULT_DRAW_CONFIG.n)

  const { data: models, isLoading: isLoadingModels } = useQuery({
    queryKey: ['draw-models'],
    queryFn: getUserModels,
  })

  useEffect(() => {
    if (!models || models.length === 0) return
    const hasCurrentModel = models.some((m) => m.value === model)
    if (!hasCurrentModel) {
      setModel(models[0].value)
    }
  }, [models, model])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!prompt.trim() || !model) return
    onSubmit({ model, prompt: prompt.trim(), size, quality, n })
  }

  return (
    <form onSubmit={handleSubmit} className='flex flex-col gap-4'>
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
        <Label>{t('Prompt')}</Label>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t('Describe the image you want to generate...')}
          className='min-h-[160px] resize-y'
          maxLength={4000}
        />
      </div>

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
          onChange={(e) => setN(Math.min(4, Math.max(1, Number(e.target.value) || 1)))}
        />
      </div>

      <Button type='submit' disabled={isGenerating || !prompt.trim()}>
        {isGenerating ? (
          <>
            <Loader2 className='mr-2 size-4 animate-spin' />
            {t('Generating...')}
          </>
        ) : (
          t('Generate Image')
        )}
      </Button>
    </form>
  )
}
