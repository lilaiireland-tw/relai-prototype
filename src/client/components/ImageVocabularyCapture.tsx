import { useState, type ChangeEvent, type FormEvent } from 'react'
import { clientData } from '../services/data'
import type { ImageVocabularySuggestion, VocabularySaveResult } from '../services/types'

type Preview = ImageVocabularySuggestion & { selected: boolean }

export default function ImageVocabularyCapture({ onSaved }: { onSaved: () => void }) {
 const [file, setFile] = useState<File | null>(null)
 const [sourceItemId, setSourceItemId] = useState('')
 const [items, setItems] = useState<Preview[]>([])
 const [busy, setBusy] = useState(false)
 const [message, setMessage] = useState('')
 const [pending, setPending] = useState<VocabularySaveResult[]>([])

 function chooseFile(event: ChangeEvent<HTMLInputElement>) {
  setFile(event.currentTarget.files?.[0] ?? null)
  setItems([]); setSourceItemId(''); setMessage(''); setPending([])
 }

 async function analyze(event: FormEvent) {
  event.preventDefault()
  if (!file || busy) return
  setBusy(true); setMessage(''); setPending([])
  try {
   const result = await clientData.extractImageVocabulary(file)
   setSourceItemId(result.source_item_id)
   setItems(result.suggestions.map(item => ({ ...item, selected: true })))
   setMessage(result.suggestions.length ? '請檢查解析結果並選擇要儲存的單字。' : '這張圖片沒有找到可用的英文單字。')
  } catch { setMessage('圖片解析失敗，請確認圖片格式後重試。') }
  finally { setBusy(false) }
 }

 async function save(event: FormEvent) {
  event.preventDefault()
  const selected = items.filter(item => item.selected)
  if (!sourceItemId || !selected.length || busy) return
  setBusy(true); setMessage(''); setPending([])
  try {
   const result = await clientData.saveVocabulary(sourceItemId, selected.map(item => ({
    headword: item.headword, part_of_speech: item.part_of_speech, zh_tw_definition: item.zh_tw_definition,
    english_example: item.english_example, zh_tw_example_translation: item.zh_tw_example_translation,
   })))
   const saved = result.results.filter(item => item.status === 'saved').length
   const existing = result.results.filter(item => item.status === 'already_saved').length
   const waiting = result.results.filter(item => item.status === 'pending')
   setPending(waiting)
   setMessage(`新增 ${saved} 張，已有 ${existing} 張；${waiting.length} 個詞彙待確認。`)
   if (saved) onSaved()
  } catch { setMessage('儲存失敗，請稍後重試。') }
  finally { setBusy(false) }
 }

 return <section aria-label="從圖片建立單字卡" className="mx-5 mt-4 rounded-2xl border border-gray-200 bg-card-gray p-4">
  <h2 className="font-semibold">從圖片擷取單字</h2>
  <p className="mt-1 text-sm text-text-secondary">上傳一張 JPG、PNG 或 WebP，檢查解析結果後再儲存。</p>
  <form onSubmit={analyze} className="mt-3 flex flex-col gap-3">
   <label className="flex flex-col gap-2 text-sm">英文學習圖片
    <input aria-label="選擇英文學習圖片" type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseFile} disabled={busy} />
   </label>
   <button disabled={!file || busy} className="h-10 rounded-xl bg-irish-green font-semibold text-white disabled:opacity-60">{busy ? '處理中…' : '解析圖片'}</button>
  </form>
  {items.length > 0 && <form onSubmit={save} className="mt-4 flex flex-col gap-3">
   {items.map((item, index) => <label key={`${item.headword}-${index}`} className="flex gap-3 rounded-xl bg-white p-3 text-sm">
    <input type="checkbox" aria-label={`選取 ${item.headword}`} checked={item.selected} disabled={busy}
     onChange={event => { const selected = event.currentTarget.checked; setItems(current => current.map((value, position) => position === index ? { ...value, selected } : value)) }} />
    <span><strong>{item.headword}</strong><span className="ml-2 text-text-secondary">{item.part_of_speech}</span>
     <span className="mt-1 block">{item.zh_tw_definition}</span>
     <span className="mt-1 block text-text-secondary">{item.english_example}</span>
     <span className="block text-text-secondary">{item.zh_tw_example_translation}</span>
    </span>
   </label>)}
   <button disabled={busy || !items.some(item => item.selected)} className="h-10 rounded-xl border border-irish-green font-semibold text-irish-green disabled:opacity-60">{busy ? '儲存中…' : '儲存勾選單字'}</button>
  </form>}
  {message && <p role="status" className="mt-3 text-sm text-text-secondary">{message}</p>}
  {pending.map(item => <p key={item.headword} className="mt-2 rounded-xl border border-amber-200 bg-white p-3 text-sm" role="status">
   {item.headword} 待確認：{item.reason === 'definition_missing' ? '目錄尚無中文釋義'
    : item.reason === 'definition_mismatch' ? '目錄釋義與圖片解析不同'
     : item.reason === 'content_incomplete' ? '目錄缺少例句或翻譯' : '目錄內容在儲存時變更'}。
   目錄釋義：{item.catalog_definition || '（空白）'}；圖片釋義：{items.find(value => value.headword === item.headword)?.zh_tw_definition}。尚未建立卡片。
  </p>)}
 </section>
}
