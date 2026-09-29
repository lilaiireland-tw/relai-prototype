import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { ArrowLeft, Sparkles } from 'lucide-react'
import { useDemoSession } from '../components/DemoSession'
export default function Login() {
 const [username, setUsername] = useState('')
 const [password, setPassword] = useState('')
 const [error, setError] = useState('')
 const { login } = useDemoSession()
 function submit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault()
  try { login(username, password); setPassword('') }
  catch { setError('請輸入使用者名稱與密碼。') }
 }
 return <div className="flex flex-1 flex-col bg-white px-8 pb-10 pt-10">
  <div className="flex items-center justify-between">
   <Link to="/" aria-label="返回首頁" className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-card-gray"><ArrowLeft size={20} /></Link>
   <div className="flex items-center gap-1"><h1 className="text-lg font-bold">ReLai</h1><Sparkles size={16} className="text-irish-green" /></div>
   <div className="h-10 w-10" />
  </div>
  <div className="mt-8 text-center">
   <p className="text-sm text-text-secondary">哩來語感特訓</p>
   <h2 className="mt-3 text-2xl font-semibold">登入你的帳號</h2>
   <p className="mt-2 text-sm leading-relaxed text-text-secondary">示範模式：輸入任意使用者名稱與密碼即可體驗模擬資料。此處不驗證正式帳號，請勿輸入真實密碼。</p>
  </div>
  <form onSubmit={submit} className="mt-8 flex flex-col gap-4">
   <label className="flex flex-col gap-2 text-sm">使用者名稱
    <input name="username" autoComplete="off" value={username} onChange={e => setUsername(e.target.value)} required className="h-12 rounded-xl border border-gray-200 px-4 outline-none focus:border-irish-green" />
   </label>
   <label className="flex flex-col gap-2 text-sm">密碼
    <input name="password" type="password" autoComplete="off" value={password} onChange={e => setPassword(e.target.value)} required className="h-12 rounded-xl border border-gray-200 px-4 outline-none focus:border-irish-green" />
   </label>
   {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
   <button type="submit" className="mt-2 h-12 rounded-xl bg-irish-green text-base font-semibold text-white hover:bg-irish-green-dark">登入並開始</button>
  </form>
 </div>
}
