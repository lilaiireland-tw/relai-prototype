import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router'
import { AuthSessionProvider, RequireAuth, RequirePasswordChanged } from './components/AuthSession'
import ChangePassword from './pages/ChangePassword'
import Splash from './pages/Splash'
import Login from './pages/Login'
import Home from './pages/Home'
import Flashcards from './pages/Flashcards'
import ErrorLog from './pages/ErrorLog'
import Stats from './pages/Stats'
import Settings from './pages/Settings'
import Onboarding from './pages/Onboarding'
import { ProductSessionProvider, RequireLevel } from './components/ProductSession'
export function AppRouter() {
 return <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}><App /></BrowserRouter>
}
function Pending({ title }: { title: string }) {
 return <section className="p-8"><h1 className="text-xl font-bold">{title}</h1><Link to="/home" className="text-irish-green">返回首頁</Link></section>
}
export function App() {
 return <AuthSessionProvider>
  <div className="mx-auto flex min-h-screen w-full max-w-app flex-col bg-white sm:my-6 sm:min-h-[calc(100vh-3rem)] sm:rounded-[2.5rem] sm:shadow-xl sm:ring-1 sm:ring-black/5">
   <Routes>
    <Route index element={<Splash />} />
    <Route path="login" element={<Login />} />
    <Route path="auth" element={<Navigate to="/login" replace />} />
    <Route element={<RequireAuth />}>
    <Route path="change-password" element={<ChangePassword />} />
    <Route element={<RequirePasswordChanged />}>
    <Route element={<ProductSessionProvider />}>
    <Route path="onboarding" element={<Onboarding />} />
    <Route element={<RequireLevel />}>
    <Route path="home" element={<Home />} />
    <Route path="cards" element={<Flashcards />} />
    <Route path="flashcards" element={<Navigate to="/cards" replace />} />
    <Route path="error-log" element={<ErrorLog />} />
    <Route path="stats" element={<Stats />} />
    <Route path="settings" element={<Settings />} />
    </Route>
    </Route>
    </Route>
    </Route>
    <Route path="*" element={<Pending title="找不到頁面" />} />
   </Routes>
  </div>
 </AuthSessionProvider>
}
