import Link from "next/link";
import {
  Bell,
  Image as ImageIcon,
  Camera,
  ChevronRight,
  FileText,
  RefreshCw,
  TrendingUp,
  Target,
  MoreHorizontal,
} from "lucide-react";
import BottomNav from "@/components/BottomNav";
import ProgressRing from "@/components/ProgressRing";
import {
  dailyProgress,
  homeUser,
  recentExtractions,
  weeklyStats,
} from "@/lib/mock-data";

const statBoxes = [
  { key: "new", label: "新卡片", value: weeklyStats.newCards, icon: FileText },
  {
    key: "reviews",
    label: "複習次數",
    value: weeklyStats.reviews,
    icon: RefreshCw,
  },
  {
    key: "streak",
    label: "連續天數",
    value: weeklyStats.streakDays,
    icon: TrendingUp,
  },
  {
    key: "accuracy",
    label: "正確率",
    value: `${weeklyStats.accuracy}%`,
    icon: Target,
  },
];

export default function HomePage() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between px-5 pt-6">
        <h1 className="text-xl font-bold text-text-primary">ReLai</h1>
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-card-gray"
          aria-label="通知"
        >
          <Bell size={20} />
        </button>
      </header>

      <main className="flex-1 overflow-y-auto px-5 pb-6">
        <p className="mt-4 text-lg font-bold text-text-primary">
          Good morning, {homeUser.name} 👋
        </p>
        <p className="text-sm text-text-secondary">今天想學點什麼呢？</p>

        <div className="mt-4 rounded-2xl border border-gray-100 bg-card-gray p-4">
          <textarea
            placeholder="輸入你的筆記、想法或任何英語內容..."
            rows={3}
            readOnly
            className="w-full resize-none bg-transparent text-sm text-text-primary placeholder:text-gray-400 focus:outline-none"
          />
          <div className="mt-2 flex items-center justify-between">
            <div className="flex items-center gap-3 text-gray-400">
              <button
                type="button"
                aria-label="上傳圖片"
                className="transition-colors hover:text-irish-green"
              >
                <ImageIcon size={20} />
              </button>
              <button
                type="button"
                aria-label="拍照"
                className="transition-colors hover:text-irish-green"
              >
                <Camera size={20} />
              </button>
            </div>
            <span className="text-xs text-gray-400">0/5000</span>
          </div>
        </div>

        <section className="mt-6">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-text-primary">
              今日學習進度
            </h2>
            <ChevronRight size={18} className="text-gray-300" />
          </div>
          <div className="mt-3 flex items-center gap-5 rounded-2xl border border-gray-100 bg-card-gray p-5">
            <ProgressRing percent={dailyProgress.percent} />
            <div className="flex flex-col gap-2 text-sm">
              <div>
                <p className="font-semibold text-text-primary">
                  已學習 {dailyProgress.studied} 張卡片
                </p>
              </div>
              <div>
                <p className="text-text-secondary">
                  待複習 {dailyProgress.toReview} 張卡片
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-6">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-text-primary">學習統計</h2>
            <button
              type="button"
              className="flex items-center gap-0.5 text-xs text-text-secondary"
            >
              本週
              <ChevronRight size={14} className="rotate-90" />
            </button>
          </div>
          <div className="mt-3 grid grid-cols-4 gap-2">
            {statBoxes.map(({ key, label, value, icon: Icon }) => (
              <div
                key={key}
                className="flex flex-col items-center gap-1.5 rounded-xl border border-gray-100 bg-card-gray py-4"
              >
                <Icon size={18} className="text-irish-green" />
                <span className="text-base font-bold text-text-primary">
                  {value}
                </span>
                <span className="text-[10px] text-text-secondary">
                  {label}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-6">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-text-primary">近期萃取</h2>
            <button
              type="button"
              className="flex items-center gap-0.5 text-xs text-text-secondary"
            >
              查看全部
              <ChevronRight size={14} />
            </button>
          </div>
          <div className="mt-3 flex flex-col gap-2">
            {recentExtractions.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                className="flex items-center gap-3 rounded-xl border border-gray-100 bg-card-gray p-3 transition-colors hover:bg-gray-100"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-irish-green">
                  <FileText size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-text-primary">
                    {item.title}
                  </p>
                  <p className="text-xs text-text-secondary">
                    萃取 {item.cardCount} 張卡片 · {item.updatedLabel}
                  </p>
                </div>
                <MoreHorizontal size={18} className="shrink-0 text-gray-300" />
              </Link>
            ))}
          </div>
        </section>
      </main>

      <BottomNav />
    </div>
  );
}
