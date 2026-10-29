import { useEffect } from 'react';
import { ArrowLeft, ArrowUpRight, Coffee, Leaf, Phone } from 'lucide-react';

import { CAFE_MENU, CAFE_PHONE, CAFE_PHONE_HREF, MENU_UPDATED } from '@/content/cafe-menu';
import { basePath, track } from '@/lib/site';

/**
 * Cafe Soi, the café on the grounds of Sobuj Potro, open to everyone.
 *
 * The menu and prices come from content/cafe-menu.ts, typed out from the
 * café's own menu. Nothing here is invented: no opening hours (the page says
 * to call), no ratings, no claims about the kitchen beyond the menu itself.
 */

function prettyDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y!, m! - 1, d!)),
  );
}

const rupee = (price: number) => `₹${price.toLocaleString('en-IN')}`;

export default function CafeSoi() {
  useEffect(() => {
    const previous = document.title;
    document.title = 'Cafe Soi, Shantiniketan — Menu & Prices | Raj Kuthir';
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-foreground/10 bg-background/90 backdrop-blur-md">
        <div className="section-shell flex h-[74px] items-center justify-between gap-6">
          <a href={`${basePath}/`} className="flex shrink-0 items-center gap-3" data-testid="link-cafe-brand">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-primary text-primary-foreground">
              <Leaf size={19} strokeWidth={1.7} />
            </span>
            <span className="leading-none">
              <span className="block font-mono-ui text-[10px] font-medium tracking-[.18em] text-muted-foreground">RAJ KUTHIR</span>
              <span className="font-journal text-[19px] text-primary">Homestays</span>
            </span>
          </a>
          <a
            href={`${basePath}/`}
            className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.1em] text-muted-foreground transition-colors hover:text-primary"
            data-testid="link-cafe-back"
          >
            <ArrowLeft size={15} /> Back to the stay
          </a>
        </div>
      </header>

      <nav aria-label="Breadcrumb" className="section-shell pt-8">
        <ol className="flex flex-wrap items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[.14em] text-muted-foreground">
          <li><a href={`${basePath}/`} className="hover:text-primary" data-testid="link-cafe-crumb-home">Home</a></li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="text-primary">Cafe Soi</li>
        </ol>
      </nav>

      <main>
        <section className="section-shell pb-12 pt-10 md:pb-16 md:pt-14" aria-labelledby="cafe-title">
          <p className="eyebrow mb-5 flex items-center gap-2 text-accent"><Coffee size={14} /> Open to everyone</p>
          <h1 id="cafe-title" className="max-w-[880px] font-journal text-[clamp(2.8rem,7vw,5.6rem)] leading-[.94] tracking-[-.035em] text-primary">
            Cafe Soi,<br /><em>Shantiniketan.</em>
          </h1>
          <div className="mt-8 max-w-[640px] space-y-4 text-lg leading-8 text-primary/75">
            <p>
              Cafe Soi is on the grounds of Sobuj Potro in Bolpur, and it is open to everyone, not only to guests
              staying at the villa. Bengali home cooking, breakfast combos, tea and snacks, cooked fresh to order in
              Santiniketan.
            </p>
            <p className="text-sm leading-6 text-muted-foreground">
              Prices are in rupees and are <strong className="text-primary">plus 5% GST</strong>. Everything is
              cooked to order, so some dishes depend on the day&rsquo;s availability. Menu updated {prettyDate(MENU_UPDATED)}.
            </p>
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href={CAFE_PHONE_HREF}
              onClick={() => track('cafe_call', { placement: 'cafe-hero' })}
              className="flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-xs font-bold uppercase tracking-[.1em] text-primary-foreground transition-transform hover:-translate-y-0.5"
              data-testid="link-cafe-call"
            >
              <Phone size={15} /> Call the café · {CAFE_PHONE}
            </a>
          </div>
          <nav aria-label="Menu sections" className="mt-10 flex flex-wrap gap-2">
            {CAFE_MENU.map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                className="rounded-full border border-border px-4 py-2 text-[11px] font-bold uppercase tracking-[.09em] text-primary transition-colors hover:border-primary"
                data-testid={`link-cafe-section-${section.id}`}
              >
                {section.title}
              </a>
            ))}
          </nav>
        </section>

        {CAFE_MENU.map((section, index) => (
          <section
            key={section.id}
            id={section.id}
            className={`scroll-mt-24 py-14 md:py-20 ${index % 2 === 0 ? 'border-t border-border bg-card' : ''}`}
            aria-labelledby={`cafe-${section.id}`}
          >
            <div className="section-shell">
              <h2 id={`cafe-${section.id}`} className="max-w-[760px] font-journal text-4xl leading-[.95] text-primary md:text-5xl">
                {section.title}
              </h2>
              <div className="mt-10 grid gap-x-12 gap-y-10 md:grid-cols-2">
                {section.groups.map((group) => (
                  <div key={group.title}>
                    <h3 className="font-mono-ui text-[10px] uppercase tracking-[.14em] text-accent">{group.title}</h3>
                    <ul className="mt-4 divide-y divide-border/70">
                      {group.items.map((item, itemIndex) => (
                        <li key={`${itemIndex}-${item.name}`} className="flex items-baseline justify-between gap-4 py-2.5 text-[15px]">
                          <span className="text-primary">{item.name}</span>
                          <span className="shrink-0 font-semibold tabular-nums text-primary">{rupee(item.price)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              <p className="mt-8 text-xs text-muted-foreground">Prices plus 5% GST · cooked to order, subject to availability.</p>
            </div>
          </section>
        ))}

        <section className="bg-primary py-20 text-primary-foreground md:py-28" aria-labelledby="cafe-stay">
          <div className="section-shell grid gap-10 lg:grid-cols-[1.1fr_.9fr] lg:items-end">
            <div>
              <p className="eyebrow mb-5 text-secondary">Stay a night or two</p>
              <h2 id="cafe-stay" className="max-w-[560px] font-journal text-4xl leading-[.94] md:text-6xl">
                Lunch at the café.<br /><em>A whole villa to come back to.</em>
              </h2>
              <p className="mt-7 max-w-[470px] text-lg leading-8 text-primary-foreground/70">
                Sobuj Potro is a private two-bedroom villa with a garden, on the same grounds as the café. Staying with
                us? Order a little ahead for lunch and dinner.
              </p>
              <p className="mt-5 flex flex-wrap gap-x-6 gap-y-3 text-xs font-bold uppercase tracking-[.1em]">
                <a href={`${basePath}/`} className="underline decoration-secondary decoration-2 underline-offset-4 hover:text-secondary" data-testid="link-cafe-home">The villa</a>
                <a href={`${basePath}/rates`} className="underline decoration-secondary decoration-2 underline-offset-4 hover:text-secondary" data-testid="link-cafe-rates">Rates</a>
                <a href={`${basePath}/pet-friendly-homestay-shantiniketan`} className="underline decoration-secondary decoration-2 underline-offset-4 hover:text-secondary" data-testid="link-cafe-pet">Staying with a pet</a>
                <a href={`${basePath}/places-to-visit-in-shantiniketan`} className="underline decoration-secondary decoration-2 underline-offset-4 hover:text-secondary" data-testid="link-cafe-places">Places to visit</a>
              </p>
            </div>
            <div className="flex flex-wrap gap-3 lg:justify-end">
              <a
                href={`${basePath}/#availability`}
                onClick={() => track('check_availability', { placement: 'cafe' })}
                className="flex items-center gap-2 rounded-full bg-secondary px-5 py-3 text-xs font-bold uppercase tracking-[.1em] text-primary transition-transform hover:-translate-y-0.5"
                data-testid="link-cafe-book"
              >
                Check availability <ArrowUpRight size={15} />
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-[#172d25] py-14 text-[#f5eadb]">
        <div className="section-shell flex flex-col justify-between gap-6 sm:flex-row sm:items-center">
          <div>
            <p className="font-journal text-2xl">Raj Kuthir Homestays</p>
            <p className="mt-2 max-w-[420px] text-sm text-[#f5eadb]/60">
              Sobuj Potro &mdash; a private two-bedroom villa with a garden in Bolpur / Shantiniketan, with Cafe Soi on the grounds.
            </p>
          </div>
          <div className="flex flex-col gap-2 text-sm text-[#f5eadb]/70 sm:text-right">
            <a href={`${basePath}/`} className="hover:text-[#e4c9a4]">The stay</a>
            <a href={`${basePath}/places-to-visit-in-shantiniketan`} className="hover:text-[#e4c9a4]">Places to visit</a>
            <a href={`${basePath}/homestay-near-sonajhuri-haat`} className="hover:text-[#e4c9a4]">Near Sonajhuri Haat</a>
            <a href={`${basePath}/gallery`} className="hover:text-[#e4c9a4]">Photos</a>
            <a href={`${basePath}/rates`} className="hover:text-[#e4c9a4]">Rates</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
