import { ApiError } from '../lib/api'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { ArrowLeft, Sparkles } from 'lucide-react'
import { useAuthSession } from '../components/AuthSession'
export default function Login() {
 const [username, setUsername] = useState('')
 const [password, setPassword] = useState('')
 const [error, setError] = useState('')
 const { login, notice, state } = useAuthSession()
 const [submitting, setSubmitting] = useState(false)
 async function submit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault()
  if (submitting) return
  setSubmitting(true)
  setError('')
  try { await login(username, password) }
  catch (failure) { setError(failure instanceof ApiError && failure.status === 401 ? '登入資訊不正確。' : '登入服務暫時無法使用，請稍後再試。') }
  finally { setPassword(''); setSubmitting(false) }
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
   <p className="mt-2 text-sm leading-relaxed text-text-secondary">請使用 ReLai 提供的測試帳號與密碼登入。學習內容目前使用模擬資料。</p>
  </div>
  <form onSubmit={submit} className="mt-8 flex flex-col gap-4">
   <label className="flex flex-col gap-2 text-sm">使用者名稱
    <input name="username" autoComplete="off" value={username} onChange={e => setUsername(e.target.value)} required className="h-12 rounded-xl border border-gray-200 px-4 outline-none focus:border-irish-green" />
   </label>
   <label className="flex flex-col gap-2 text-sm">密碼
    <input name="password" type="password" autoComplete="off" value={password} onChange={e => setPassword(e.target.value)} required className="h-12 rounded-xl border border-gray-200 px-4 outline-none focus:border-irish-green" />
   </label>
   {notice && <p role="alert">{notice}</p>}
   {state.status === 'error' && <p role="alert">無法確認登入狀態，請登入或稍後重試。</p>}
   {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
   <button type="submit" disabled={submitting} className="mt-2 h-12 rounded-xl bg-irish-green text-base font-semibold text-white hover:bg-irish-green-dark">{submitting ? '登入中…' : '登入並開始'}</button>
  </form>
 </div>
}
