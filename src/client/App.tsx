import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router'
import { DemoSessionProvider } from './components/DemoSession'
import Splash from './pages/Splash'
import Login from './pages/Login'
import Home from './pages/Home'
import Flashcards from './pages/Flashcards'
import ErrorLog from './pages/ErrorLog'
export function AppRouter() {
 return <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}><App /></BrowserRouter>
}
function Pending({ title }: { title: string }) {
 return <section className="p-8"><h1 className="text-xl font-bold">{title}</h1><p className="mt-3 text-text-secondary">此功能尚未開放。</p><Link to="/home" className="text-irish-green">返回首頁</Link></section>
}
export function App() {
 return <DemoSessionProvider>
  <div className="mx-auto flex min-h-screen w-full max-w-app flex-col bg-white sm:my-6 sm:min-h-[calc(100vh-3rem)] sm:rounded-[2.5rem] sm:shadow-xl sm:ring-1 sm:ring-black/5">
   <Routes>
    <Route index element={<Splash />} />
    <Route path="login" element={<Login />} />
    <Route path="auth" element={<Navigate to="/login" replace />} />
    <Route path="home" element={<Home />} />
    <Route path="cards" element={<Flashcards />} />
    <Route path="flashcards" element={<Navigate to="/cards" replace />} />
    <Route path="error-log" element={<ErrorLog />} />
    <Route path="stats" element={<Pending title="學習統計" />} />
    <Route path="settings" element={<Pending title="設定" />} />
    <Route path="*" element={<Pending title="找不到頁面" />} />
   </Routes>
  </div>
 </DemoSessionProvider>
}
