import { Link } from 'react-router'
import { ArrowLeft } from 'lucide-react'
import BottomNav from '../components/BottomNav'
import ImageVocabularyCapture from '../components/ImageVocabularyCapture'

export default function Capture() {
 return <div className="flex flex-1 flex-col">
  <header className="flex items-center justify-between px-4 pt-6">
   <Link to="/home" aria-label="返回首頁" className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-card-gray"><ArrowLeft size={20} /></Link>
   <h1 className="text-base font-bold text-text-primary">AI 辨識</h1>
   <span className="h-10 w-10" />
  </header>
  <main className="flex-1 overflow-y-auto px-5 pb-6 pt-4">
   <p className="text-sm leading-relaxed text-text-secondary">拍下或上傳包含英文的圖片，AI 會自動選字並建立單字卡，讓你直接開始學習。</p>
   <ImageVocabularyCapture />
  </main>
  <BottomNav />
 </div>
}
