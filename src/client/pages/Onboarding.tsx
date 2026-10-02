import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { useProductSession } from '../components/ProductSession'
import { clientData } from '../services/data'
import { ENGLISH_LEVELS, type EnglishLevel } from '../services/types'
import { useAuthSession } from '../components/AuthSession'

export default function Onboarding() {
 const { settings, setSettings } = useProductSession()
 const { logout } = useAuthSession()
 const navigate = useNavigate()
 const [level, setLevel] = useState<EnglishLevel | ''>('')
 const [busy, setBusy] = useState(false)
 const [error, setError] = useState('')
 if (settings.english_level !== null) return <Navigate to="/home" replace />
 async function submit(event: FormEvent) {
  event.preventDefault()
  if (!level || busy) return
  setBusy(true); setError('')
  try {
   const result = await clientData.selectLevel(level)
   setSettings({ ...settings, english_level: result.english_level })
   void navigate('/home', { replace: true })
  } catch { setError('暫時無法建立起始單字卡，請稍後重試。') }
  finally { setBusy(false) }
 }
 return <main className="flex flex-1 flex-col px-8 pb-10 pt-10">
  <h1 className="text-2xl font-semibold">選擇你的英文級別</h1>
  <p className="mt-3 text-sm leading-relaxed text-text-secondary">選擇 A1、A2、B1 或 B2，取得該級別的第一組 CEFR-J 起始單字卡，開始複習。</p>
  <form onSubmit={submit} className="mt-8 flex flex-col gap-4">
   <fieldset disabled={busy} className="grid grid-cols-2 gap-3"><legend className="mb-3 text-sm">英文級別</legend>
    {ENGLISH_LEVELS.map(value => <label key={value} className="flex items-center gap-3 rounded-xl border border-gray-200 bg-card-gray p-4">
     <input type="radio" name="english_level" value={value} checked={level === value} onChange={() => setLevel(value)} required />{value}
    </label>)}
   </fieldset>
   {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
   <button disabled={!level || busy} className="h-12 rounded-xl bg-irish-green font-semibold text-white disabled:opacity-60">{busy ? '正在準備…' : '開始使用'}</button>
  </form>
  <button type="button" onClick={() => void logout()} className="mt-6 text-sm text-text-secondary">登出</button>
 </main>
}
