import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AppShell } from '@/components/AppShell'
import { TooltipProvider } from '@/components/ui/tooltip'
import { StateView } from '@/components/ui/misc'
import { useAuth } from '@/lib/auth'
import Landing from '@/pages/Landing'
import Login from '@/pages/Login'
import NotFound from '@/pages/NotFound'

const Live = lazy(() => import('@/pages/Live'))
const History = lazy(() => import('@/pages/History'))
const Sessions = lazy(() => import('@/pages/Sessions'))
const Events = lazy(() => import('@/pages/Events'))
const Devices = lazy(() => import('@/pages/Devices'))
const DeviceDetail = lazy(() => import('@/pages/Devices').then((m) => ({ default: m.DeviceDetail })))
const Demo = lazy(() => import('@/pages/Demo'))
const Settings = lazy(() => import('@/pages/Settings'))

function RequireAuth({ children }: { children: ReactNode }) {
  const token = useAuth((s) => s.token)
  const loc = useLocation()
  if (!token) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />
  return <>{children}</>
}

const page = (el: ReactNode) => <Suspense fallback={<StateView kind="loading" title="Loading…" />}>{el}</Suspense>

export default function App() {
  return (
    <TooltipProvider>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/app" element={<RequireAuth><AppShell /></RequireAuth>}>
            <Route index element={<Navigate to="live" replace />} />
            <Route path="live" element={page(<Live />)} />
            <Route path="history" element={page(<History />)} />
            <Route path="history/:sessionId" element={page(<History />)} />
            <Route path="sessions" element={page(<Sessions />)} />
            <Route path="events" element={page(<Events />)} />
            <Route path="devices" element={page(<Devices />)} />
            <Route path="devices/:id" element={page(<DeviceDetail />)} />
            <Route path="demo" element={page(<Demo />)} />
            <Route path="settings" element={page(<Settings />)} />
            <Route path="*" element={<NotFound />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  )
}
