import * as z from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { SettingsSection } from '../components/settings-section'
import { useResetForm } from '../hooks/use-reset-form'
import { useSystemOptions } from '../hooks/use-system-options'
import { useUpdateOption } from '../hooks/use-update-option'

const behaviorSchema = z.object({
  RetryTimes: z.coerce.number().min(0).max(10),
  DefaultCollapseSidebar: z.boolean(),
  DemoSiteEnabled: z.boolean(),
  SelfUseModeEnabled: z.boolean(),
  DefaultTokenGroup: z.string(),
})

type BehaviorFormValues = z.infer<typeof behaviorSchema>

type SystemBehaviorSectionProps = {
  defaultValues: BehaviorFormValues
}

export function SystemBehaviorSection({
  defaultValues,
}: SystemBehaviorSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const { data: optionsData } = useSystemOptions()

  const userUsableGroups: Record<string, string> = (() => {
    const raw = optionsData?.data?.find(
      (o) => o.key === 'UserUsableGroups'
    )?.value
    if (!raw) return {}
    try {
      return JSON.parse(raw)
    } catch {
      return {}
    }
  })()

  const form = useForm({
    resolver: zodResolver(behaviorSchema),
    defaultValues: {
      ...defaultValues,
      DefaultTokenGroup: defaultValues.DefaultTokenGroup || '__none__',
    },
  })

  useResetForm(form, {
    ...defaultValues,
    DefaultTokenGroup: defaultValues.DefaultTokenGroup || '__none__',
  })

  const onSubmit = async (data: BehaviorFormValues) => {
    const updates = Object.entries(data).filter(
      ([key, value]) => value !== defaultValues[key as keyof BehaviorFormValues]
    )

    for (const [key, value] of updates) {
      const submitValue = key === 'DefaultTokenGroup' && value === '__none__' ? '' : value
      await updateOption.mutateAsync({ key, value: submitValue })
    }
  }

  return (
    <SettingsSection
      title={t('System Behavior')}
      description={t('Configure system-wide behavior and defaults')}
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-6'>
          <FormField
            control={form.control}
            name='RetryTimes'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Retry Times')}</FormLabel>
                <FormControl>
                  <Input
                    type='number'
                    min='0'
                    max='10'
                    value={field.value as number}
                    onChange={(e) => field.onChange(e.target.valueAsNumber)}
                    name={field.name}
                    onBlur={field.onBlur}
                    ref={field.ref}
                  />
                </FormControl>
                <FormDescription>
                  {t('Number of times to retry failed requests (0-10)')}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='DefaultCollapseSidebar'
            render={({ field }) => (
              <FormItem className='flex flex-row items-center justify-between rounded-lg border p-4'>
                <div className='space-y-0.5'>
                  <FormLabel className='text-base'>
                    {t('Default Collapse Sidebar')}
                  </FormLabel>
                  <FormDescription>
                    {t('Sidebar collapsed by default for new users')}
                  </FormDescription>
                </div>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='DemoSiteEnabled'
            render={({ field }) => (
              <FormItem className='flex flex-row items-center justify-between rounded-lg border p-4'>
                <div className='space-y-0.5'>
                  <FormLabel className='text-base'>
                    {t('Demo Site Mode')}
                  </FormLabel>
                  <FormDescription>
                    {t('Enable demo mode with limited functionality')}
                  </FormDescription>
                </div>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='SelfUseModeEnabled'
            render={({ field }) => (
              <FormItem className='flex flex-row items-center justify-between rounded-lg border p-4'>
                <div className='space-y-0.5'>
                  <FormLabel className='text-base'>
                    {t('Self-Use Mode')}
                  </FormLabel>
                  <FormDescription>
                    {t('Optimize system for self-hosted single-user usage')}
                  </FormDescription>
                </div>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='DefaultTokenGroup'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Default Token Group')}</FormLabel>
                <FormControl>
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                  >
                    <SelectTrigger className='w-full'>
                      <SelectValue placeholder={t('Use user group (default)')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='__none__'>
                        {t('Use user group (default)')}
                      </SelectItem>
                      {Object.entries(userUsableGroups).map(([key, desc]) => (
                        <SelectItem key={key} value={key}>
                          {key}{desc ? ` - ${desc}` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormControl>
                <FormDescription>
                  {t('Default group used when token has no group assigned. Falls back to user group if not set.')}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <Button type='submit' disabled={updateOption.isPending}>
            {updateOption.isPending ? t('Saving...') : t('Save Changes')}
          </Button>
        </form>
      </Form>
    </SettingsSection>
  )
}
