import { useMemo } from "react";
import { useClientData } from "../services/useClientData";
import { Link } from "react-router";
import {
  BookOpen,
  ChevronRight,
  Languages,
  RefreshCw,
  Target,
  UserCircle2,
} from "lucide-react";

import BottomNav from "../components/BottomNav";
import ProgressRing from "../components/ProgressRing";
import { useDemoSession } from "../components/DemoSession";
import { clientData } from "../services/data";
import WorkerHealth from "../components/WorkerHealth";

export default function HomePage() {
  const { profile } = useDemoSession();
  const { data: bootstrap, error, reload: refreshBootstrap } = useClientData(() => clientData.getHome());
  const flashcards = bootstrap?.cards ?? [];

  const vocabularyCards = useMemo(
    () => flashcards.filter((card) => card.card_type === "vocabulary"),
    [flashcards],
  );
  const errorCards = useMemo(
    () => flashcards.filter((card) => card.card_type === "error_log"),
    [flashcards],
  );

  const stats = bootstrap?.stats;
  const settings = bootstrap?.settings;
  const dailyGoal = settings?.daily_goal ?? 10;
  const completedReviews = Math.min(bootstrap?.today_reviews ?? 0, dailyGoal);
  const progressPercent =
    dailyGoal > 0 ? Math.min(100, Math.round((completedReviews / dailyGoal) * 100)) : 0;

  return (
    <>
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between px-5 pt-6">
          <div>
            <h1 className="text-xl font-bold text-text-primary">ReLai</h1>
            <p data-source={clientData.source} className="text-sm text-text-secondary">示範模式 · 首頁、卡片、統計與設定：模擬資料</p>
          </div>
          <button
            type="button"
            onClick={() => void refreshBootstrap()}
            className="flex h-10 w-10 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-card-gray"
            aria-label="重新整理"
          >
            <RefreshCw size={18} />
          </button>
        </header>

        <main className="flex-1 overflow-y-auto px-5 pb-6">
          <WorkerHealth />
          <div className="mt-5 rounded-2xl border border-gray-100 bg-card-gray p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-irish-green">
                <UserCircle2 size={28} />
              </div>
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-text-primary">
                  {profile?.display_name || profile?.username || "Alex"}
                </p>
                <p className="truncate text-sm text-text-secondary">{profile?.username || "demo"}</p>
              </div>
            </div>
          </div>

          <section className="mt-6">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-text-primary">今日進度</h2>
              <span className="text-xs text-text-secondary">目標 {dailyGoal} 次</span>
            </div>
            <div className="mt-3 flex items-center gap-5 rounded-2xl border border-gray-100 bg-card-gray p-5">
              <ProgressRing percent={progressPercent} />
              <div className="flex flex-col gap-2 text-sm">
                <p className="font-semibold text-text-primary">已完成 {completedReviews} 次複習</p>
                <p className="text-text-secondary">連續學習 {stats?.streak_days ?? 0} 天</p>
                <p className="text-text-secondary">累計建立 {stats?.total_cards_created ?? 0} 張卡片</p>
              </div>
            </div>
          </section>

          <section className="mt-6 grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-gray-100 bg-card-gray p-4">
              <div className="flex items-center gap-2 text-irish-green">
                <BookOpen size={18} />
                <span className="text-sm font-semibold">單字卡</span>
              </div>
              <p className="mt-3 text-2xl font-bold text-text-primary">{vocabularyCards.length}</p>
            </div>
            <div className="rounded-2xl border border-gray-100 bg-card-gray p-4">
              <div className="flex items-center gap-2 text-irish-green">
                <Languages size={18} />
                <span className="text-sm font-semibold">錯誤卡</span>
              </div>
              <p className="mt-3 text-2xl font-bold text-text-primary">{errorCards.length}</p>
            </div>
            <div className="rounded-2xl border border-gray-100 bg-card-gray p-4">
              <div className="flex items-center gap-2 text-irish-green">
                <RefreshCw size={18} />
                <span className="text-sm font-semibold">總複習數</span>
              </div>
              <p className="mt-3 text-2xl font-bold text-text-primary">{stats?.total_reviews ?? 0}</p>
            </div>
            <div className="rounded-2xl border border-gray-100 bg-card-gray p-4">
              <div className="flex items-center gap-2 text-irish-green">
                <Target size={18} />
                <span className="text-sm font-semibold">時區</span>
              </div>
              <p className="mt-3 text-lg font-bold text-text-primary">
                {settings?.timezone ?? "Asia/Taipei"}
              </p>
            </div>
          </section>

          <section className="mt-6">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-text-primary">最近建立的卡片</h2>
              <Link to="/cards" className="flex items-center gap-1 text-xs text-text-secondary">
                查看更多
                <ChevronRight size={14} />
              </Link>
            </div>
            <div className="mt-3 flex flex-col gap-2">
              {flashcards.slice(0, 4).map((card) => (
                <Link
                  key={card.id}
                  to={card.card_type === "error_log" ? "/error-log" : "/cards"}
                  className="rounded-xl border border-gray-100 bg-card-gray p-4 transition-colors hover:bg-gray-100"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate text-sm font-semibold text-text-primary">
                      {card.front_content}
                    </p>
                    <span className="shrink-0 text-[11px] text-text-secondary">
                      {card.card_type === "error_log" ? "Error Log" : "Vocabulary"}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-text-secondary">{card.back_content}</p>
                </Link>
              ))}
              {flashcards.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-sm text-text-secondary">
                  目前沒有卡片。
                </div>
              ) : null}
            </div>
          </section>

          {error ? (
            <div className="mt-6 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          ) : null}
        </main>

        <BottomNav />
      </div>
    </>
  );
}
