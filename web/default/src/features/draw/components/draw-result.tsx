import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, ImageIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ImageItem } from '../types'

interface DrawResultProps {
  images: ImageItem[]
  isGenerating: boolean
  error: string | null
}

function downloadBase64Image(b64: string, filename: string) {
  const byteChars = atob(b64)
  const byteNumbers = new Array(byteChars.length)
  for (let i = 0; i < byteChars.length; i++) {
    byteNumbers[i] = byteChars.charCodeAt(i)
  }
  const blob = new Blob([new Uint8Array(byteNumbers)], { type: 'image/png' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function DrawResult({ images, isGenerating, error }: DrawResultProps) {
  const { t } = useTranslation()

  const handleDownload = useCallback((item: ImageItem, index: number) => {
    if (item.b64_json) {
      downloadBase64Image(item.b64_json, `image-${index + 1}.png`)
    } else if (item.url) {
      const a = document.createElement('a')
      a.href = item.url
      a.download = `image-${index + 1}.png`
      a.target = '_blank'
      a.click()
    }
  }, [])

  if (error) {
    return (
      <div className='flex flex-1 items-center justify-center'>
        <p className='text-sm text-destructive'>{error}</p>
      </div>
    )
  }

  if (images.length === 0) {
    return (
      <div className='flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground'>
        <ImageIcon className='size-16 opacity-30' />
        <p className='text-sm'>
          {isGenerating ? t('Generating...') : t('Generated images will appear here')}
        </p>
      </div>
    )
  }

  return (
    <div className='flex flex-1 flex-col gap-4 overflow-auto'>
      <div className='grid grid-cols-1 gap-4 lg:grid-cols-2'>
        {images.map((item, index) => {
          const src = item.b64_json
            ? `data:image/png;base64,${item.b64_json}`
            : item.url || ''

          return (
            <div
              key={index}
              className='group relative overflow-hidden rounded-lg border bg-muted/30'
            >
              <img
                src={src}
                alt={item.revised_prompt || `Generated image ${index + 1}`}
                className='w-full object-contain'
              />
              <div className='absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100'>
                <Button
                  size='sm'
                  variant='secondary'
                  onClick={() => handleDownload(item, index)}
                >
                  <Download className='mr-1 size-4' />
                  {t('Download')}
                </Button>
              </div>
              {item.revised_prompt && (
                <p className='border-t bg-background/80 p-2 text-xs text-muted-foreground'>
                  {item.revised_prompt}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
