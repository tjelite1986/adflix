"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Clapperboard,
  Users,
  Menu,
  Sparkles,
  Settings,
  ArrowLeft,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useBackDismiss } from "@/lib/use-back-dismiss";
import { useModal } from "@/lib/use-modal";

// Two tabs and a Menu button. elite-v2 carried the video section inside its
// own global bar; standing alone, the app draws its own.
const TABS = [
  { label: "Library", href: "/videos", icon: Clapperboard },
  { label: "Performers", href: "/performers", icon: Users },
] as const;

interface MenuLink {
  label: string;
  href: string;
  icon: typeof Users;
}

export default function BottomNav({
  isAdmin = false,
  eliteUrl,
  children,
}: {
  isAdmin?: boolean;
  /** Where the login comes from — the door back to it. Absent when unset. */
  eliteUrl?: string | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the sheet when a menu link navigates away.
  useEffect(() => setMenuOpen(false), [pathname]);
  useBackDismiss(menuOpen, () => setMenuOpen(false));
  // Escape closes the menu sheet and the page behind it cannot scroll.
  useModal(menuOpen, () => setMenuOpen(false));

  const links: MenuLink[] = [
    { label: "Analysis", href: "/videos/analysis", icon: Sparkles },
    ...(isAdmin ? [{ label: "Settings", href: "/settings", icon: Settings }] : []),
  ];

  // /performer/<slug> belongs to the Performers tab, /videos/<id> to Library.
  const activeHref =
    TABS.find((t) =>
      t.href === "/performers"
        ? pathname.startsWith("/performer")
        : pathname.startsWith(t.href)
    )?.href ?? null;

  return (
    <>
      <div className="pt-[env(safe-area-inset-top)] pb-[calc(3.5rem+env(safe-area-inset-bottom))]">
        {children}
      </div>

      {/* z-40: below every fullscreen overlay so they cover the bar; hidden
          during immersive playback by the [data-immersive-hide] rule in
          globals.css. */}
      <nav
        data-immersive-hide
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-white/10 bg-black/60 pb-[env(safe-area-inset-bottom)] backdrop-blur"
      >
        {TABS.map(({ label, href, icon: Icon }) => {
          const active = !menuOpen && href === activeHref;
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] transition",
                active ? "text-[var(--accent)]" : "text-white/50 hover:text-white/80"
              )}
            >
              <Icon size={22} strokeWidth={active ? 2.4 : 2} />
              {label}
            </Link>
          );
        })}
        <button
          onClick={() => setMenuOpen(true)}
          className={cn(
            "flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] transition",
            menuOpen ? "text-[var(--accent)]" : "text-white/50 hover:text-white/80"
          )}
        >
          <Menu size={22} strokeWidth={menuOpen ? 2.4 : 2} />
          Menu
        </button>
      </nav>

      {menuOpen && (
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end bg-black/50"
          onClick={() => setMenuOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
        >
          <div
            className="rounded-t-2xl bg-neutral-900 pb-[env(safe-area-inset-bottom)] text-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <span className="font-semibold">Adflix</span>
              <button onClick={() => setMenuOpen(false)} aria-label="Close menu">
                <X size={20} />
              </button>
            </div>
            <div className="py-1">
              {links.map(({ label, href, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className="flex items-center gap-3 px-5 py-3 text-sm transition hover:bg-white/5"
                >
                  <Icon size={18} className="text-white/60" />
                  {label}
                </Link>
              ))}
              {eliteUrl && (
                <>
                  <div className="my-1 border-t border-white/10" />
                  {/* A plain <a>: this address is not one of this app's routes. */}
                  <a
                    href={eliteUrl}
                    className="flex items-center gap-3 px-5 py-3 text-sm transition hover:bg-white/5"
                  >
                    <ArrowLeft size={18} className="text-white/60" />
                    Back to Elite
                  </a>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
