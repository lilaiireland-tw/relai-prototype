import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { ApiError } from '../lib/api'
import { useAuthSession } from '../components/AuthSession'

export default function ChangePassword() {
 const { state, changePassword, logout, retry } = useAuthSession()
 const [currentPassword, setCurrentPassword] = useState('')
 const [newPassword, setNewPassword] = useState('')
 const [confirmation, setConfirmation] = useState('')
 const [error, setError] = useState('')
 const [submitting, setSubmitting] = useState(false)
 const required = state.status === 'authenticated' && state.user.must_change_password

 async function submit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault()
  if (submitting) return
  const current = currentPassword
  const next = newPassword
  const confirm = confirmation
  setCurrentPassword('')
  setNewPassword('')
  setConfirmation('')
  setError('')
  if (!current) { setError('請輸入目前密碼。'); return }
  if (Array.from(next).length < 8) { setError('新密碼至少需要 8 個字元。'); return }
  if (next !== confirm) { setError('新密碼與確認密碼不一致。'); return }
  setSubmitting(true)
  try {
   await changePassword(current, next)
  } catch (failure) {
   if (failure instanceof ApiError && failure.status === 401) {
    await retry()
    setError('目前密碼不正確，請重試。')
   } else if (failure instanceof ApiError && failure.status === 400) {
    setError('新密碼無效，請確認至少有 8 個字元。')
   } else {
    setError('暫時無法變更密碼，請稍後重試。')
   }
  } finally { setSubmitting(false) }
 }

 return <main className="flex flex-1 flex-col px-8 pb-10 pt-10">
  <h1 className="text-2xl font-semibold">變更密碼</h1>
  <p className="mt-3 text-sm text-text-secondary">{required ? '首次登入前，請先設定自己的密碼。' : '設定新的登入密碼。'}新密碼至少需要 8 個字元。</p>
  <form onSubmit={submit} className="mt-8 flex flex-col gap-4">
   <label className="flex flex-col gap-2 text-sm">目前密碼
    <input name="current_password" type="password" autoComplete="current-password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} required className="h-12 rounded-xl border border-gray-200 px-4 outline-none focus:border-irish-green" />
   </label>
   <label className="flex flex-col gap-2 text-sm">新密碼
    <input name="new_password" type="password" autoComplete="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required className="h-12 rounded-xl border border-gray-200 px-4 outline-none focus:border-irish-green" />
   </label>
   <label className="flex flex-col gap-2 text-sm">確認新密碼
    <input name="confirm_password" type="password" autoComplete="new-password" value={confirmation} onChange={e => setConfirmation(e.target.value)} required className="h-12 rounded-xl border border-gray-200 px-4 outline-none focus:border-irish-green" />
   </label>
   {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
   <button type="submit" disabled={submitting} className="mt-2 h-12 rounded-xl bg-irish-green font-semibold text-white disabled:opacity-60">{submitting ? '正在變更…' : '變更密碼'}</button>
  </form>
  <div className="mt-6 flex items-center gap-5 text-sm">
   {!required && <Link to="/home" className="text-irish-green">返回首頁</Link>}
   <button type="button" onClick={() => void logout()} className="text-text-secondary">登出</button>
  </div>
 </main>
}
