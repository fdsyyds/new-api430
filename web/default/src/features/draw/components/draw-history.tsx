import { useTranslation } from 'react-i18next'
import { Clock, ImageIcon, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { DrawHistoryRecord } from '../types'

interface DrawHistoryProps {
  records: DrawHistoryRecord[]
  onRestore: (record: DrawHistoryRecord) => void
  onDelete: (id: string) => void
  onClear: () => void
}

function getImageSource(record: DrawHistoryRecord) {
  const image = record.images[0]
  if (!image) return ''
  return image.b64_json ? `data:image/png;base64,${image.b64_json}` : image.url || ''
}

export function DrawHistory({
  records,
  onRestore,
  onDelete,
  onClear,
}: DrawHistoryProps) {
  const { t } = useTranslation()

  return (
    <div className='flex min-h-0 flex-col gap-3 border-t pt-4'>
      <div className='flex items-center justify-between gap-2'>
        <h3 className='text-sm font-medium'>{t('History')}</h3>
        <Button
          type='button'
          size='sm'
          variant='ghost'
          onClick={onClear}
          disabled={records.length === 0}
        >
          <Trash2 className='size-4' />
          {t('Clear History')}
        </Button>
      </div>

      {records.length === 0 ? (
        <div className='flex h-24 flex-col items-center justify-center gap-2 rounded-md border border-dashed text-muted-foreground'>
          <Clock className='size-5' />
          <p className='text-xs'>{t('No saved images yet')}</p>
        </div>
      ) : (
        <ScrollArea className='h-72'>
          <div className='space-y-2 pe-2'>
            {records.map((record) => {
              const src = getImageSource(record)
              const createdAt = new Date(record.createdAt).toLocaleString()

              return (
                <div
                  key={record.id}
                  className='rounded-md border bg-background p-2'
                >
                  <div className='flex gap-2'>
                    <button
                      type='button'
                      className='flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted'
                      aria-label={t('Restore result')}
                      onClick={() => onRestore(record)}
                    >
                      {src ? (
                        <img
                          src={src}
                          alt=''
                          className='size-full object-cover'
                        />
                      ) : (
                        <ImageIcon className='size-5 text-muted-foreground' />
                      )}
                    </button>
                    <div className='min-w-0 flex-1 space-y-1'>
                      <div className='flex items-center gap-2'>
                        <Badge variant='secondary'>
                          {record.mode === 'edit'
                            ? t('Image to Image')
                            : t('Text to Image')}
                        </Badge>
                        <span className='truncate text-xs text-muted-foreground'>
                          {createdAt}
                        </span>
                      </div>
                      <button
                        type='button'
                        className='line-clamp-2 text-left text-xs leading-5'
                        onClick={() => onRestore(record)}
                      >
                        {record.prompt}
                      </button>
                    </div>
                    <Button
                      type='button'
                      size='icon-sm'
                      variant='ghost'
                      aria-label={t('Delete history item')}
                      onClick={() => onDelete(record.id)}
                    >
                      <Trash2 className='size-4' />
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}
