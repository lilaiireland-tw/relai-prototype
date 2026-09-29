import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router'
import { AuthSessionProvider, RequireAuth } from './components/AuthSession'
import Splash from './pages/Splash'
import Login from './pages/Login'
import Home from './pages/Home'
import Flashcards from './pages/Flashcards'
import ErrorLog from './pages/ErrorLog'
export function AppRouter() {
 return <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}><App /></BrowserRouter>
}
function Pending({ title, mock = false }: { title: string; mock?: boolean }) {
 return <section className="p-8"><h1 className="text-xl font-bold">{title}</h1>{mock && <p data-source="mock">模擬資料 · 尚未連接產品 API</p>}<p className="mt-3 text-text-secondary">此功能尚未開放。</p><Link to="/home" className="text-irish-green">返回首頁</Link></section>
}
export function App() {
 return <AuthSessionProvider>
  <div className="mx-auto flex min-h-screen w-full max-w-app flex-col bg-white sm:my-6 sm:min-h-[calc(100vh-3rem)] sm:rounded-[2.5rem] sm:shadow-xl sm:ring-1 sm:ring-black/5">
   <Routes>
    <Route index element={<Splash />} />
    <Route path="login" element={<Login />} />
    <Route path="auth" element={<Navigate to="/login" replace />} />
    <Route element={<RequireAuth />}>
    <Route path="home" element={<Home />} />
    <Route path="cards" element={<Flashcards />} />
    <Route path="flashcards" element={<Navigate to="/cards" replace />} />
    <Route path="error-log" element={<ErrorLog />} />
    <Route path="stats" element={<Pending title="學習統計" mock />} />
    <Route path="settings" element={<Pending title="設定" mock />} />
    </Route>
    <Route path="*" element={<Pending title="找不到頁面" />} />
   </Routes>
  </div>
 </AuthSessionProvider>
}
