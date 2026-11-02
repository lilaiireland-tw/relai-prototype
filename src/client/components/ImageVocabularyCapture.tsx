import { useState, type ChangeEvent, type FormEvent } from 'react'
import { Link } from 'react-router'
import { clientData } from '../services/data'
import type { ImageVocabularySuggestion, VocabularySaveResult } from '../services/types'

type Preview = ImageVocabularySuggestion & { selected: boolean }
type ReviewNeeded = Extract<VocabularySaveResult, { status: 'review_needed' }>

export default function ImageVocabularyCapture() {
 const [file, setFile] = useState<File | null>(null)
 const [sourceItemId, setSourceItemId] = useState('')
 const [items, setItems] = useState<Preview[]>([])
 const [busy, setBusy] = useState(false)
 const [message, setMessage] = useState('')
 const [reviewNeeded, setReviewNeeded] = useState<ReviewNeeded[]>([])
 const [hasSaved, setHasSaved] = useState(false)

 function chooseFile(event: ChangeEvent<HTMLInputElement>) {
  setFile(event.currentTarget.files?.[0] ?? null)
  setItems([]); setSourceItemId(''); setMessage(''); setReviewNeeded([]); setHasSaved(false)
 }

 async function analyze(event: FormEvent) {
  event.preventDefault()
  if (!file || busy) return
  setBusy(true); setMessage(''); setReviewNeeded([]); setHasSaved(false)
  try {
   const result = await clientData.extractImageVocabulary(file)
   setSourceItemId(result.source_item_id)
   setItems(result.suggestions.map(item => ({ ...item, selected: true })))
   setMessage(result.suggestions.length ? '請檢查辨識結果，選擇要儲存的單字。' : '這張圖片沒有找到可用的英文單字，請換一張圖片再試。')
  } catch { setMessage('辨識服務暫時無法完成，請重試或稍後再試。') }
  finally { setBusy(false) }
 }

 async function save(event: FormEvent) {
  event.preventDefault()
  const selected = items.filter(item => item.selected)
  if (!sourceItemId || !selected.length || busy) return
  setBusy(true); setMessage(''); setReviewNeeded([]); setHasSaved(false)
  try {
   const result = await clientData.saveVocabulary(sourceItemId, selected.map(item => ({
    headword: item.headword, part_of_speech: item.part_of_speech,
    semantic_sense: item.semantic_sense, source_context: item.source_context,
   })))
   const saved = result.results.filter(item => item.status === 'saved').length
   const existing = result.results.filter(item => item.status === 'already_saved').length
   const waiting = result.results.filter((item): item is ReviewNeeded => item.status === 'review_needed')
   setReviewNeeded(waiting)
   setHasSaved(saved + existing > 0)
   setMessage(`已儲存 ${saved} 個單字，${existing} 個已在單字卡中，${waiting.length} 個需要管理員審核。`)
  } catch { setMessage('儲存暫時無法完成，請重試。') }
  finally { setBusy(false) }
 }

 return <section aria-label="AI 英文單字辨識" className="mx-auto mt-4 w-full max-w-lg rounded-2xl border border-gray-200 bg-card-gray p-4 sm:p-5">
  <h2 className="font-semibold">選擇英文學習圖片</h2>
  <p className="mt-1 text-sm text-text-secondary">支援 JPG、PNG 和 WebP。請確認圖片中有清楚可讀的英文。</p>
  <form onSubmit={analyze} className="mt-3 flex flex-col gap-3">
   <label className="flex min-h-12 flex-col justify-center gap-1 rounded-xl border border-gray-200 bg-white p-3 text-sm">拍攝圖片
    <input aria-label="拍攝英文學習圖片" type="file" accept="image/*" capture="environment" onChange={chooseFile} disabled={busy} />
   </label>
   <label className="flex min-h-12 flex-col justify-center gap-1 rounded-xl border border-gray-200 bg-white p-3 text-sm">從相簿或檔案選擇
    <input aria-label="選擇英文學習圖片" type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseFile} disabled={busy} />
   </label>
   {file && <p className="truncate text-xs text-text-secondary">{file.name}</p>}
   <button disabled={!file || busy} className="h-12 rounded-xl bg-irish-green font-semibold text-white disabled:opacity-60">{busy ? '正在處理…' : '解析圖片'}</button>
  </form>
  {items.length > 0 && <form onSubmit={save} className="mt-4 flex flex-col gap-3">
   {items.map((item, index) => <label key={`${item.headword}-${index}`} className="flex gap-3 rounded-xl bg-white p-3 text-sm">
    <input type="checkbox" aria-label={`選擇 ${item.headword}`} checked={item.selected} disabled={busy}
     onChange={event => { const selected = event.currentTarget.checked; setItems(current => current.map((value, position) => position === index ? { ...value, selected } : value)) }} />
    <span><strong>{item.headword}</strong><span className="ml-2 text-text-secondary">{item.part_of_speech}</span>
     <span className="mt-1 block">{item.semantic_sense}</span>
     <span className="mt-1 block text-text-secondary">語境：{item.source_context}</span>
    </span>
   </label>)}
   <button disabled={busy || !items.some(item => item.selected)} className="h-12 rounded-xl border border-irish-green font-semibold text-irish-green disabled:opacity-60">{busy ? '正在儲存…' : '儲存勾選單字'}</button>
  </form>}
  {message && <p role="status" className="mt-3 text-sm text-text-secondary">{message}</p>}
  {hasSaved && <Link to="/vocabulary" className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-irish-green underline">查看我的單字卡</Link>}
  {reviewNeeded.map(item => <p key={`${item.headword}-${item.candidate_id}`} className="mt-2 rounded-xl border border-amber-200 bg-white p-3 text-sm" role="status">
   {item.headword} 尚未加入單字卡，正在等待目錄審核。管理員核准後，請重新送出這組選詞。
   <span className="block text-xs text-text-secondary">審核編號：{item.candidate_id}</span>
  </p>)}
 </section>
}
