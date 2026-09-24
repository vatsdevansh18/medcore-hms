"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Activity, LogOut, Menu, Moon, Sun, X } from "lucide-react";
import { UserRole } from "@medcore/types";
import { useAuth } from "@/hooks/use-auth";
import { useRealtime } from "@/hooks/use-realtime";
import { useUiStore } from "@/store/ui-store";
import { cn } from "@/lib/utils";
import { ROUTES } from "@/constants";
import { FullPageLoader } from "@/components/modules/full-page-loader";
import { NotificationBell, NotificationPanel } from "@/components/modules/notification-panel";
import { PORTAL_NAV, isActive } from "@/components/modules/portal-nav";

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <ul className="flex flex-col gap-1">
      {PORTAL_NAV.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
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

function ThemeToggle() {
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
 * The patient portal shell: sidebar on tablet/desktop, a drawer on phones
 * (docs/04-UI-UX.md §2.4, mobile-first per §4). Signed-out visitors go to
 * sign-in; staff go to their own home. This is UX only: every API call is
 * authorized server-side (FR-RBAC-002).
 */
export default function PortalLayout({ children }: { children: ReactNode }) {
  const { status, user, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const mobileNavOpen = useUiStore((s) => s.mobileNavOpen);
  const setMobileNavOpen = useUiStore((s) => s.setMobileNavOpen);
  useRealtime();

  useEffect(() => {
    if (status === "anonymous") router.replace(`${ROUTES.login}?next=${encodeURIComponent(pathname)}`);
    else if (status === "authenticated" && user && user.role !== UserRole.PATIENT) router.replace(ROUTES.staff);
  }, [status, user, router, pathname]);

  if (status !== "authenticated" || !user || user.role !== UserRole.PATIENT) return <FullPageLoader />;

  return (
    <div className="flex min-h-full flex-1">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-border bg-surface px-3 py-4 md:flex">
        <Link href={ROUTES.portal} className="mb-6 flex items-center gap-2 px-3 text-primary">
          <Activity className="size-5" aria-hidden="true" />
          <span className="font-semibold">MedCore</span>
        </Link>
        <nav aria-label="Portal">
          <NavLinks />
        </nav>
        <div className="mt-auto px-3 text-xs text-subtle">{user.hospital?.name}</div>
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
            <DialogPrimitive.Description className="sr-only">Portal navigation</DialogPrimitive.Description>
            <nav aria-label="Portal">
              <NavLinks onNavigate={() => setMobileNavOpen(false)} />
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
          <span className="truncate text-sm text-muted md:hidden">{user.hospital?.name}</span>
          <div className="ml-auto flex items-center gap-1">
            <NotificationBell />
            <ThemeToggle />
            <span className="mx-2 hidden text-sm text-muted sm:inline">
              {user.firstName} {user.lastName}
            </span>
            <button
              type="button"
              onClick={() => void logout()}
              className="flex items-center gap-1 rounded-md px-2 py-2 text-sm text-muted hover:bg-surface-muted hover:text-foreground"
            >
              <LogOut className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Sign out</span>
              <span className="sr-only sm:hidden">Sign out</span>
            </button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 md:px-6">{children}</main>
      </div>
      <NotificationPanel />
    </div>
  );
}
