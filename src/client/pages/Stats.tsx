import { Link } from 'react-router'
import { clientData } from '../services/data'
import { useClientData } from '../services/useClientData'
import DataState from '../components/DataState'
import BottomNav from '../components/BottomNav'

export default function Stats() {
 const { data, loading, error, reload } = useClientData(clientData.getStats)
 return <div className="flex flex-1 flex-col">
  <main className="flex-1 p-5 pt-6" data-source="api">
   <h1 className="text-xl font-bold">學習統計</h1>
   <Link to="/home" className="mt-3 inline-block text-sm text-irish-green">返回首頁</Link>
   <DataState loading={loading} error={error} retry={reload} />
   {data && <dl className="mt-6 grid grid-cols-2 gap-3">
    {[
     ['今日複習', `${data.today_completed_reviews} / ${data.daily_goal}`],
     ['連續學習', `${data.streak_days} 天`], ['最長連續', `${data.longest_streak} 天`],
     ['總卡片', data.total_cards], ['總複習數', data.total_reviews], ['每日目標', `${data.daily_goal} 次`],
    ].map(([label, value]) => <div key={label} className="rounded-2xl border border-gray-100 bg-card-gray p-4"><dt className="text-sm text-text-secondary">{label}</dt><dd className="mt-3 text-2xl font-bold text-text-primary">{value}</dd></div>)}
   </dl>}
  </main><BottomNav />
 </div>
}
