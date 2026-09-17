import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useBootstrap } from './state/auth'
import { AppShell } from './layout/AppShell'
import { LoginPage } from './pages/LoginPage'
import { SetupPage } from './pages/SetupPage'
import { FilesPage } from './pages/FilesPage'
import { SimpleListPage } from './pages/SimpleListPage'
import { TrashPage } from './pages/TrashPage'
import { SharesPage } from './pages/SharesPage'
import { SettingsPage } from './pages/SettingsPage'
import { ShareViewPage } from './pages/ShareViewPage'
import { Splash } from './components/ui'

function SplashRedirect({ children }: { children: React.ReactNode }) {
  const { data, isLoading } = useBootstrap()
  const location = useLocation()
  if (isLoading) return <Splash />
  if (!data?.initialized) return <Navigate to="/setup" replace />
  if (!data.me) return <Navigate to="/login" state={{ from: location.pathname }} replace />
  return <>{children}</>
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/setup" element={<SetupPage />} />
      <Route path="/s/:token" element={<ShareViewPage />} />
      <Route
        element={
          <SplashRedirect>
            <AppShell />
          </SplashRedirect>
        }
      >
        <Route path="/" element={<Navigate to="/files" replace />} />
        <Route path="/files" element={<FilesPage />} />
        <Route path="/files/:folderId" element={<FilesPage />} />
        <Route path="/starred" element={<SimpleListPage mode="starred" />} />
        <Route path="/recent" element={<SimpleListPage mode="recent" />} />
        <Route path="/shares" element={<SharesPage />} />
        <Route path="/trash" element={<TrashPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/files" replace />} />
    </Routes>
  )
}
