"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Home, Languages, LogOut } from "lucide-react";

import { useAuth } from "@/components/AuthProvider";

const tabs = [
  { key: "home", label: "首頁", href: "/home", icon: Home },
  { key: "cards", label: "單字卡", href: "/flashcards", icon: BookOpen },
  { key: "errors", label: "錯誤卡", href: "/error-log", icon: Languages },
];

export default function BottomNav() {
  const pathname = usePathname();
  const { logout } = useAuth();

  return (
    <nav className="sticky bottom-0 z-10 flex border-t border-gray-100 bg-white px-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2">
      {tabs.map((tab) => {
        const isActive = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        const Icon = tab.icon;

        return (
          <Link
            key={tab.key}
            href={tab.href}
            className={`flex flex-1 flex-col items-center gap-1 py-1 transition-colors ${
              isActive ? "text-irish-green" : "text-text-secondary"
            }`}
          >
            <Icon size={22} strokeWidth={isActive ? 2.5 : 2} />
            <span className="text-[11px] font-medium">{tab.label}</span>
          </Link>
        );
      })}

      <button
        type="button"
        onClick={() => void logout()}
        className="flex flex-1 flex-col items-center gap-1 py-1 text-text-secondary transition-colors hover:text-irish-green"
      >
        <LogOut size={22} />
        <span className="text-[11px] font-medium">登出</span>
      </button>
    </nav>
  );
}
