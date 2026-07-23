"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { Menu, ShoppingBasket, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { SignOutButton } from "@/components/auth/sign-out-button";
import {
  getRouteContext,
  getVisibleNavigation,
} from "@/components/layout/navigation";
import { SidebarNavigation } from "@/components/layout/sidebar-navigation";

export function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const drawerPanelRef = useRef<HTMLDivElement>(null);
  const items = getVisibleNavigation(session?.user.permissions ?? []);
  const route = getRouteContext(pathname);

  const closeMobileNavigation = useCallback((restoreFocus = true) => {
    setMobileOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => menuTriggerRef.current?.focus());
    }
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMobileNavigation();
        return;
      }

      if (event.key === "Tab") {
        const focusableElements = Array.from(
          drawerPanelRef.current?.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ) ?? [],
        ).filter((element) => element.getAttribute("aria-hidden") !== "true");
        const first = focusableElements[0];
        const last = focusableElements.at(-1);

        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [closeMobileNavigation, mobileOpen]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <div className="min-h-screen bg-muted/30">
      <a
        href="#main-content"
        className="fixed left-3 top-3 z-[70] -translate-y-20 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg outline-none transition-transform focus:translate-y-0 focus:ring-2 focus:ring-ring focus:ring-offset-2 motion-reduce:transition-none"
      >
        Skip to main content
      </a>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-20 flex-col border-r border-border bg-card md:flex xl:w-64">
        <Link
          href="/"
          className="flex h-[57px] items-center justify-center gap-3 border-b border-border px-3 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring xl:justify-start xl:px-5"
        >
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ShoppingBasket aria-hidden="true" className="size-5" />
          </span>
          <span className="sr-only text-lg font-semibold tracking-tight xl:not-sr-only">
            GroceryRMS
          </span>
        </Link>
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <SidebarNavigation
            items={items}
            pathname={pathname}
            label="Primary navigation"
            compact
          />
        </div>
        <div className="border-t border-border p-3">
          <p className="sr-only truncate text-sm font-medium xl:not-sr-only">
            {session?.user.name ?? "Signed in"}
          </p>
          <p className="sr-only mt-0.5 truncate text-xs text-muted-foreground xl:not-sr-only">
            Secure workspace
          </p>
        </div>
      </aside>

      <div className="min-w-0 md:pl-20 xl:pl-64">
        <header className="sticky top-0 z-20 flex h-[57px] items-center justify-between border-b border-border bg-card/95 px-3 backdrop-blur sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <button
              ref={menuTriggerRef}
              type="button"
              aria-label="Open navigation menu"
              aria-controls="mobile-navigation"
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen(true)}
              className="inline-flex size-11 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:hidden"
            >
              <Menu aria-hidden="true" className="size-5" />
            </button>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold sm:text-base">
                {route.title}
              </p>
              <p className="hidden truncate text-xs text-muted-foreground sm:block">
                {route.description}
              </p>
            </div>
          </div>
          <SignOutButton />
        </header>

        <main id="main-content" tabIndex={-1} className="min-w-0 outline-none">
          {children}
        </main>
      </div>

      {mobileOpen ? (
        <div
          className="fixed inset-0 z-50 md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation menu"
        >
          <button
            type="button"
            aria-label="Close navigation menu"
            className="absolute inset-0 bg-black/45"
            onClick={() => closeMobileNavigation()}
          />
          <div
            ref={drawerPanelRef}
            id="mobile-navigation"
            className="relative flex h-full w-[min(88vw,20rem)] flex-col border-r border-border bg-card shadow-2xl"
          >
            <div className="flex h-[57px] items-center justify-between border-b border-border px-4">
              <Link
                href="/"
                onClick={() => closeMobileNavigation(false)}
                className="flex items-center gap-2 rounded-md font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <ShoppingBasket aria-hidden="true" className="size-4" />
                </span>
                GroceryRMS
              </Link>
              <button
                ref={closeButtonRef}
                type="button"
                aria-label="Close navigation menu"
                onClick={() => closeMobileNavigation()}
                className="inline-flex size-11 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X aria-hidden="true" className="size-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <SidebarNavigation
                items={items}
                pathname={pathname}
                label="Mobile navigation"
                onNavigate={() => closeMobileNavigation(false)}
              />
            </div>
            <div className="border-t border-border p-4">
              <p className="truncate text-sm font-medium">
                {session?.user.name ?? "Signed in"}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Secure workspace
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
