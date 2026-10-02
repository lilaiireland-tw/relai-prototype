import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { clientData } from '../services/data'
import { ENGLISH_LEVELS, type EnglishLevel } from '../services/types'
import { useProductSession } from '../components/ProductSession'
import BottomNav from '../components/BottomNav'

export default function Settings() {
 const { settings, setSettings } = useProductSession()
 const [goal, setGoal] = useState(settings.daily_goal)
 const [timezone, setTimezone] = useState(settings.timezone)
 const [level, setLevel] = useState(settings.english_level!)
 const [busy, setBusy] = useState(false)
 const [error, setError] = useState('')
 const [saved, setSaved] = useState(false)
 async function submit(event: FormEvent) {
  event.preventDefault()
  if (busy) return
  setError(''); setSaved(false)
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }) }
  catch { setError('請輸入有效時區，例如 Europe/Dublin。'); return }
  if (!Number.isInteger(goal) || goal < 1 || goal > 100) { setError('每日目標須為 1 到 100 次。'); return }
  setBusy(true)
  try {
   const updated = await clientData.updateSettings({ daily_goal: goal, timezone, english_level: level })
   setSettings(updated); setGoal(updated.daily_goal); setTimezone(updated.timezone); setLevel(updated.english_level!); setSaved(true)
  } catch { setError('設定暫時無法儲存，請重試。') }
  finally { setBusy(false) }
 }
 return <div className="flex flex-1 flex-col">
  <main className="flex-1 p-5 pt-6" data-source="api">
   <h1 className="text-xl font-bold">設定</h1>
   <Link to="/home" className="mt-3 inline-block text-sm text-irish-green">返回首頁</Link>
   <form onSubmit={submit} className="mt-6 flex flex-col gap-4 rounded-2xl border border-gray-100 bg-card-gray p-4">
    <label className="flex flex-col gap-2 text-sm">每日複習目標<input name="daily_goal" type="number" required min={1} max={100} value={goal} disabled={busy} onChange={event => setGoal(Number(event.target.value))} className="h-12 rounded-xl border border-gray-200 px-3" /></label>
    <label className="flex flex-col gap-2 text-sm">時區<input name="timezone" required value={timezone} disabled={busy} onChange={event => setTimezone(event.target.value)} className="h-12 rounded-xl border border-gray-200 px-3" /></label>
    <label className="flex flex-col gap-2 text-sm">英文級別<select name="english_level" value={level} disabled={busy} onChange={event => setLevel(event.target.value as EnglishLevel)} className="h-12 rounded-xl border border-gray-200 px-3">{ENGLISH_LEVELS.map(value => <option key={value}>{value}</option>)}</select></label>
    <p className="text-xs leading-relaxed text-text-secondary">變更級別會保留現有卡片，不會自動加入另一組起始單字卡。</p>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    {saved && <p role="status" className="text-sm text-irish-green">設定已儲存。</p>}
    <button disabled={busy} className="h-12 rounded-xl bg-irish-green font-semibold text-white disabled:opacity-60">{busy ? '正在儲存…' : '儲存設定'}</button>
   </form>
   <Link to="/change-password" className="mt-6 inline-block text-sm text-irish-green">變更密碼</Link>
  </main><BottomNav />
 </div>
}
