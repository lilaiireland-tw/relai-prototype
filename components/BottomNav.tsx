"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Layers, BarChart2, Settings } from "lucide-react";

const tabs = [
  { key: "home", label: "首頁", href: "/home", icon: Home, enabled: true },
  {
    key: "cards",
    label: "卡片庫",
    href: "/flashcards",
    icon: Layers,
    enabled: true,
  },
  {
    key: "stats",
    label: "統計",
    href: "#",
    icon: BarChart2,
    enabled: false,
  },
  {
    key: "settings",
    label: "設定",
    href: "#",
    icon: Settings,
    enabled: false,
  },
];

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="sticky bottom-0 z-10 flex border-t border-gray-100 bg-white px-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2">
      {tabs.map((tab) => {
        const isActive =
          tab.href !== "#" &&
          (pathname === tab.href || pathname.startsWith(tab.href));
        const Icon = tab.icon;

        if (!tab.enabled) {
          return (
            <div
              key={tab.key}
              className="flex flex-1 cursor-not-allowed flex-col items-center gap-1 py-1 text-gray-300"
              aria-disabled
            >
              <Icon size={22} strokeWidth={isActive ? 2.5 : 2} />
              <span className="text-[11px]">{tab.label}</span>
            </div>
          );
        }

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
    </nav>
  );
}
