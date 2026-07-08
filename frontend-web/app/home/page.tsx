"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BookOpen,
  ChevronRight,
  Languages,
  RefreshCw,
  Target,
  UserCircle2,
} from "lucide-react";

import BottomNav from "@/components/BottomNav";
import ProgressRing from "@/components/ProgressRing";
import RequireAuth from "@/components/RequireAuth";
import { useAuth } from "@/components/AuthProvider";
import { apiClient } from "@/lib/api";
import type { Flashcard } from "@/lib/types";

export default function HomePage() {
  const { token, bootstrap, refreshBootstrap } = useAuth();
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadFlashcards() {
      if (!token) {
        return;
      }
      try {
        const response = await apiClient.listFlashcards(token);
        setFlashcards(response.items);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "讀取字卡失敗");
      }
    }

    void loadFlashcards();
  }, [token]);

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
  const profile = bootstrap?.profile;
  const dailyGoal = settings?.daily_review_goal ?? 10;
  const completedReviews = Math.min(stats?.total_reviews ?? 0, dailyGoal);
  const progressPercent =
    dailyGoal > 0 ? Math.min(100, Math.round((completedReviews / dailyGoal) * 100)) : 0;

  return (
    <RequireAuth>
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between px-5 pt-6">
          <div>
            <h1 className="text-xl font-bold text-text-primary">ReLai</h1>
            <p className="text-sm text-text-secondary">已連接本地 FastAPI</p>
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
          <div className="mt-5 rounded-2xl border border-gray-100 bg-card-gray p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-irish-green">
                <UserCircle2 size={28} />
              </div>
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-text-primary">
                  {profile?.display_name || profile?.email || "使用者"}
                </p>
                <p className="truncate text-sm text-text-secondary">{profile?.email}</p>
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
                <span className="text-sm font-semibold">介面語言</span>
              </div>
              <p className="mt-3 text-lg font-bold text-text-primary">
                {settings?.interface_language ?? "zh-TW"}
              </p>
            </div>
          </section>

          <section className="mt-6">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-text-primary">最近建立的卡片</h2>
              <Link href="/flashcards" className="flex items-center gap-1 text-xs text-text-secondary">
                查看更多
                <ChevronRight size={14} />
              </Link>
            </div>
            <div className="mt-3 flex flex-col gap-2">
              {flashcards.slice(0, 4).map((card) => (
                <Link
                  key={card.id}
                  href={card.card_type === "error_log" ? "/error-log" : "/flashcards"}
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
                  目前帳號還沒有卡片。先用 backend 或之後的 ingestion flow 建立資料即可看到內容。
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
    </RequireAuth>
  );
}
