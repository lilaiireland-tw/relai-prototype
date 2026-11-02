import { useCallback, useState } from 'react'
import { Link } from 'react-router'
import { ArrowLeft, Star } from 'lucide-react'
import BottomNav from '../components/BottomNav'
import DataState from '../components/DataState'
import { clientData } from '../services/data'
import { useClientData } from '../services/useClientData'

export default function VocabularyList() {
 const load = useCallback(() => clientData.listCards('vocabulary'), [])
 const { data, loading, error, reload } = useClientData(load)
 const [favoritesOnly, setFavoritesOnly] = useState(false)
 const cards = (data ?? []).filter(card => !favoritesOnly || card.is_favorite)

 return <div className="flex flex-1 flex-col">
  <header className="flex items-center justify-between px-4 pt-6">
   <Link to="/home" aria-label="返回首頁" className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-card-gray"><ArrowLeft size={20} /></Link>
   <h1 className="text-base font-bold text-text-primary">我的單字</h1>
   <span className="h-10 w-10" />
  </header>
  <main className="flex-1 overflow-y-auto px-5 pb-6 pt-4">
   <div role="group" aria-label="單字篩選" className="flex gap-2">
    <button type="button" aria-pressed={!favoritesOnly} onClick={() => setFavoritesOnly(false)} className={`h-11 flex-1 rounded-xl border px-3 text-sm font-medium ${favoritesOnly ? 'border-gray-200 text-text-secondary' : 'border-irish-green bg-irish-green/5 text-irish-green'}`}>全部</button>
    <button type="button" aria-pressed={favoritesOnly} onClick={() => setFavoritesOnly(true)} className={`h-11 flex-1 rounded-xl border px-3 text-sm font-medium ${favoritesOnly ? 'border-irish-green bg-irish-green/5 text-irish-green' : 'border-gray-200 text-text-secondary'}`}>收藏</button>
   </div>
   <DataState loading={loading} error={error} retry={reload} />
   <div className="mt-4 flex flex-col gap-2">
    {cards.map(card => <Link key={card.id} to={`/cards/${encodeURIComponent(card.id)}`} className="flex min-h-16 items-center justify-between gap-3 rounded-xl border border-gray-100 bg-card-gray px-4 py-3 hover:bg-gray-100">
     <span className="min-w-0"><span className="block truncate font-semibold text-text-primary">{card.front_content}</span><span className="mt-0.5 block text-sm text-text-secondary">{card.part_of_speech}</span></span>
     {card.is_favorite && <Star aria-label="已收藏" size={18} className="shrink-0 fill-irish-green text-irish-green" />}
    </Link>)}
    {!loading && !error && cards.length === 0 && <p className="rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-text-secondary">{favoritesOnly ? '目前沒有收藏的單字。' : '目前沒有單字卡。'}</p>}
   </div>
  </main>
  <BottomNav />
 </div>
}
