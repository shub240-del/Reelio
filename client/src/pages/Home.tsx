/**
 * Reelio marketing homepage.
 *
 * The page composes the existing branded header and hero with the extended
 * product-experience sections. All visuals remain original CSS/SVG/React work;
 * the actual editor remains available through the real project route.
 */
import { Nav } from "@/components/marketing/Nav";
import { Hero } from "@/components/marketing/Hero";
import { ExperienceSections } from "@/components/marketing/ExperienceSections";

export default function Home() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-zinc-100 antialiased">
      <Nav />
      <main id="main">
        <Hero />
        <ExperienceSections />
      </main>
    </div>
  );
}
