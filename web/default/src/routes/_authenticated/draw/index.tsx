import { createFileRoute } from '@tanstack/react-router'
import { AppHeader, Main } from '@/components/layout'
import { Draw } from '@/features/draw'

export const Route = createFileRoute('/_authenticated/draw/')({
  component: DrawPage,
})

function DrawPage() {
  return (
    <>
      <AppHeader />
      <Main className='p-0'>
        <Draw />
      </Main>
    </>
  )
}
