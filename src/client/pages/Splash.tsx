import { Link } from "react-router";
import { Sparkles } from "lucide-react";

export default function SplashPage() {
  return (
    <div className="flex flex-1 flex-col bg-white px-8 pb-10 pt-16">
      <div className="flex flex-col items-center text-center">
        <div className="flex items-center gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-text-primary">
            ReLai
          </h1>
          <Sparkles size={18} className="text-irish-green" strokeWidth={2.5} />
        </div>
        <p className="mt-1 text-sm text-text-secondary">哩來語感特訓</p>

        <h2 className="mt-10 text-xl font-semibold text-text-primary">
          你的 <span className="text-irish-green">AI</span> 英語第二大腦
        </h2>
        <p className="mt-3 max-w-[260px] text-sm leading-relaxed text-text-secondary">
          自動化萃取、結構化知識，
          <br />
          讓每一次學習，都更有效率。
        </p>
      </div>

      <div className="relative my-12 flex flex-1 items-center justify-center">
        <Sparkles
          size={20}
          className="absolute left-6 top-2 text-irish-green/60"
        />
        <Sparkles
          size={16}
          className="absolute bottom-4 right-8 text-irish-green/40"
        />

        <div className="relative h-56 w-56">
          <div className="absolute inset-x-6 bottom-4 top-8 rounded-2xl bg-card-gray shadow-sm" />
          <div className="absolute inset-x-2 bottom-8 top-2 rotate-[-6deg] rounded-2xl border border-gray-100 bg-white shadow-md" />
          <div className="absolute inset-x-2 bottom-8 top-2 flex flex-col gap-2 rotate-[-6deg] rounded-2xl p-5">
            <div className="h-2 w-16 rounded-full bg-gray-200" />
            <div className="h-2 w-10 rounded-full bg-gray-200" />
          </div>
          <div className="absolute left-1/2 top-1/2 flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-2xl bg-irish-green shadow-lg shadow-irish-green/30">
            <Sparkles size={32} className="text-white" strokeWidth={2} />
          </div>
        </div>
      </div>

      <div className="mb-8 flex items-center justify-center gap-2">
        <span className="h-2 w-2 rounded-full bg-irish-green" />
        <span className="h-2 w-2 rounded-full bg-gray-200" />
        <span className="h-2 w-2 rounded-full bg-gray-200" />
      </div>

      <div className="flex flex-col gap-3">
        <Link
          to="/login"
          className="flex h-12 w-full items-center justify-center rounded-xl bg-irish-green text-base font-semibold text-white transition-colors hover:bg-irish-green-dark"
        >
          開始使用
        </Link>

      </div>
    </div>
  );
}
