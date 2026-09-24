"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Activity, LogOut, Menu, Moon, Sun, X, type LucideIcon } from "lucide-react";
import { useUiStore } from "@/store/ui-store";
import { cn } from "@/lib/utils";
import { NotificationBell, NotificationPanel } from "./notification-panel";

export interface ShellNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/** Exact match for a section's home, prefix match for everything else. */
export function isNavActive(pathname: string, href: string, home: string): boolean {
  return href === home ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

function NavLinks({ items, home, onNavigate }: { items: ShellNavItem[]; home: string; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <ul className="flex flex-col gap-1">
      {items.map(({ href, label, icon: Icon }) => {
        const active = isNavActive(pathname, href, home);
        return (
          <li key={href}>
            <Link
              href={href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-base",
                active ? "bg-primary-surface font-medium text-primary" : "text-muted hover:bg-surface-muted hover:text-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              {label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function ThemeToggle() {
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const dark =
    theme === "dark" ||
    (theme === "system" && typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      className="rounded-md p-2 text-muted hover:bg-surface-muted hover:text-foreground"
      aria-label={dark ? "Use light theme" : "Use dark theme"}
    >
      {dark ? <Sun className="size-5" aria-hidden="true" /> : <Moon className="size-5" aria-hidden="true" />}
    </button>
  );
}

/**
 * The signed-in frame shared by the patient portal and the staff workspace
 * (docs/04-UI-UX.md §2.4): a sidebar on tablet/desktop, a drawer on phones,
 * and a top bar with an optional search slot, the notification bell, the
 * theme toggle, and sign-out.
 */
export function AppShell({
  items,
  home,
  navLabel,
  context,
  userName,
  onLogout,
  search,
  maxWidth = "max-w-5xl",
  children,
}: {
  items: ShellNavItem[];
  home: string;
  navLabel: string;
  /** Shown under the brand and in the phone header (e.g. the hospital). */
  context?: string;
  userName: string;
  onLogout: () => void;
  search?: ReactNode;
  maxWidth?: string;
  children: ReactNode;
}) {
  const mobileNavOpen = useUiStore((s) => s.mobileNavOpen);
  const setMobileNavOpen = useUiStore((s) => s.setMobileNavOpen);
  return (
    <div className="flex min-h-full flex-1">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-border bg-surface px-3 py-4 md:flex">
        <Link href={home} className="mb-6 flex items-center gap-2 px-3 text-primary">
          <Activity className="size-5" aria-hidden="true" />
          <span className="font-semibold">MedCore</span>
        </Link>
        <nav aria-label={navLabel}>
          <NavLinks items={items} home={home} />
        </nav>
        {context && <div className="mt-auto px-3 text-xs text-subtle">{context}</div>}
      </aside>

      <DialogPrimitive.Root open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/30 md:hidden" />
          <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 w-72 border-r border-border bg-surface p-4 md:hidden">
            <div className="mb-4 flex items-center justify-between">
              <DialogPrimitive.Title className="font-semibold">Menu</DialogPrimitive.Title>
              <DialogPrimitive.Close className="rounded-md p-1 text-subtle hover:bg-surface-muted">
                <X className="size-4" aria-hidden="true" />
                <span className="sr-only">Close menu</span>
              </DialogPrimitive.Close>
            </div>
            <DialogPrimitive.Description className="sr-only">{navLabel} navigation</DialogPrimitive.Description>
            <nav aria-label={navLabel}>
              <NavLinks items={items} home={home} onNavigate={() => setMobileNavOpen(false)} />
            </nav>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-border bg-surface/95 px-4 backdrop-blur md:px-6">
          <button
            type="button"
            className="rounded-md p-2 text-muted hover:bg-surface-muted md:hidden"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="size-5" aria-hidden="true" />
          </button>
          {search ? (
            <div className="min-w-0 flex-1">{search}</div>
          ) : (
            context && <span className="truncate text-sm text-muted md:hidden">{context}</span>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <NotificationBell />
            <ThemeToggle />
            <span className="mx-2 hidden text-sm text-muted lg:inline">{userName}</span>
            <button
              type="button"
              onClick={onLogout}
              className="flex items-center gap-1 rounded-md px-2 py-2 text-sm text-muted hover:bg-surface-muted hover:text-foreground"
            >
              <LogOut className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Sign out</span>
              <span className="sr-only sm:hidden">Sign out</span>
            </button>
          </div>
        </header>
        <main className={cn("mx-auto w-full flex-1 px-4 py-6 md:px-6", maxWidth)}>{children}</main>
      </div>
      <NotificationPanel />
    </div>
  );
}
