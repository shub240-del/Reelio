/**
 * Reelio marketing homepage.
 *
 * Original composition, copy and artwork. Every visual on this page is
 * generated from SVG/CSS/React — there are no screenshots, no stock imagery and
 * no borrowed illustrations, so the page cannot 404 on a missing asset and
 * carries no third-party visual identity.
 *
 * Sections are added in milestone order; each is a self-contained component
 * under components/marketing/.
 */
import { Nav } from "@/components/marketing/Nav";
import { Hero } from "@/components/marketing/Hero";

export default function Home() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-zinc-100 antialiased">
      <Nav />
      <main id="main">
        <Hero />
      </main>
    </div>
  );
}
