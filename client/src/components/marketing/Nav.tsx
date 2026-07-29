/**
 * Sticky marketing navigation.
 *
 * Starts transparent over the hero and fades in a glass background once the
 * page scrolls, so the hero reads full-bleed without the bar competing with it.
 *
 * Accessibility: a skip link precedes it, the mobile sheet traps nothing but
 * closes on Escape and on route change, every control is a real button/anchor
 * with a visible focus ring, and the current section is exposed via
 * aria-current.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Menu, X } from "lucide-react";
import { ReelioLogo } from "@/components/brand/ReelioLogo";
import { useExistingAnchors } from "./primitives";

const LINKS = [
  { label: "Features", href: "#features" },
  { label: "How it works", href: "#workflow" },
  { label: "Templates", href: "#templates" },
  { label: "Pricing", href: "#pricing" },
  { label: "FAQ", href: "#faq" },
  { label: "Contact", href: "#contact" },
] as const;

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string>("");
  // Only offer links whose section is actually on the page. Sections land over
  // several milestones, and a nav link that scrolls nowhere reads as broken.
  const available = useExistingAnchors(LINKS.map((l) => l.href));
  const links = LINKS.filter((l) => available.has(l.href));
  const availableKey = links.map((l) => l.href).join(",");

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Highlight the section currently in view.
  useEffect(() => {
    const ids = links.map((l) => l.href.slice(1));
    const sections = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActive(`#${visible.target.id}`);
      },
      { rootMargin: "-45% 0px -50% 0px", threshold: [0, 0.25, 0.6] },
    );
    sections.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, [availableKey]);

  // Escape closes the mobile sheet; lock scroll while it is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-[var(--reelio-violet)] focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        Skip to content
      </a>

      <header
        className={[
          "fixed inset-x-0 top-0 z-50 transition-all duration-300",
          scrolled
            ? "border-b border-white/[0.07] bg-[#0a0a0f]/80 backdrop-blur-xl"
            : "border-b border-transparent bg-transparent",
        ].join(" ")}
      >
        <nav aria-label="Main" className="mx-auto flex h-16 w-full max-w-[1200px] items-center justify-between px-5 sm:px-8">
          <Link href="/" className="reelio-focus shrink-0" aria-label="Reelio home">
            <ReelioLogo size={30} />
          </Link>

          <ul className="hidden items-center gap-1 lg:flex">
            {links.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  aria-current={active === link.href ? "true" : undefined}
                  className={[
                    "reelio-focus rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    active === link.href ? "text-white" : "text-zinc-400 hover:text-white",
                  ].join(" ")}
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>

          <div className="flex items-center gap-2">
            <Link
              href="/projects"
              className="reelio-focus hidden rounded-lg px-3 py-2 text-sm font-medium text-zinc-300 transition-colors hover:text-white sm:block"
            >
              Sign in
            </Link>
            <Link
              href="/projects"
              className="reelio-focus rounded-lg bg-[var(--reelio-violet)] px-4 py-2 text-sm font-semibold text-white shadow-[0_0_0_1px_rgba(255,255,255,0.08)_inset] transition-all hover:bg-[var(--reelio-violet-hi)] hover:shadow-[0_8px_24px_-8px_var(--reelio-violet)]"
            >
              Get started
            </Link>
            {links.length > 0 ? (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-controls="mobile-menu"
              aria-label={open ? "Close menu" : "Open menu"}
              className="reelio-focus rounded-lg p-2 text-zinc-300 transition-colors hover:text-white lg:hidden"
            >
              {open ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
            </button>
            ) : null}
          </div>
        </nav>

        {open && links.length > 0 ? (
          <div
            id="mobile-menu"
            className="border-t border-white/[0.07] bg-[#0a0a0f]/95 backdrop-blur-xl lg:hidden"
          >
            <ul className="mx-auto flex max-w-[1200px] flex-col gap-1 px-5 py-4 sm:px-8">
              {links.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    onClick={() => setOpen(false)}
                    className="reelio-focus block rounded-lg px-3 py-3 text-[15px] font-medium text-zinc-300 transition-colors hover:bg-white/[0.04] hover:text-white"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </header>
    </>
  );
}

export default Nav;
