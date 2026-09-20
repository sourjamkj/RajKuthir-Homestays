import { useEffect } from 'react';
import { ArrowLeft, ArrowUpRight, Leaf, MessageCircle, Phone } from 'lucide-react';

import { CONFIG, NEIGHBOURHOOD, basePath, phoneHref, track } from '@/lib/site';
import type { NeighbourhoodPlace } from '@/lib/site';

/**
 * A landing page for people searching for somewhere to stay near Sonajhuri
 * Khoai Haat, rather than for Shantiniketan in general.
 *
 * It is not a second copy of the places page. That one answers "what is there
 * to do here"; this one answers "where do we sleep if the market is the reason
 * we are coming" — which is a different question, asked at a different point in
 * the trip, and deserves the house's own facts rather than a list of sights.
 *
 * EVERY factual claim on this page is already published elsewhere on the site:
 * the distances come from NEIGHBOURHOOD, the market days and time from the same
 * entry, and the amenities from the homepage. Nothing here may be invented — no
 * walking distance, no drive time, no market stall count.
 */

/**
 * Road distances are never typed here. They are looked up by title from
 * NEIGHBOURHOOD in lib/site.ts, the same list the homepage teaser and the
 * places page read, so a correction in one place corrects every page at once
 * and this landing can never quietly disagree with the rest of the site about
 * how far away something is.
 */
const distanceTo = (title: string) =>
  NEIGHBOURHOOD.flatMap<NeighbourhoodPlace>((group) => group.places).find((place) => place.title === title)
    ?.distance ?? null;

export default function HomestayNearSonajhuri() {
  useEffect(() => {
    const previous = document.title;
    document.title = 'Homestay near Sonajhuri Haat, Shantiniketan | Raj Kuthir';
    return () => {
      document.title = previous;
    };
  }, []);

  const haat = distanceTo('Sonajhuri Khoai Haat');
  const kopai = distanceTo('Kopai River');
  const prantik = distanceTo('Prantik station');
  const bolpur = distanceTo('Bolpur Shantiniketan station');

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-foreground/10 bg-background/90 backdrop-blur-md">
        <div className="section-shell flex h-[74px] items-center justify-between gap-6">
          <a href={`${basePath}/`} className="flex shrink-0 items-center gap-3" data-testid="link-sonajhuri-brand">
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
            data-testid="link-sonajhuri-back"
          >
            <ArrowLeft size={15} /> Back to the stay
          </a>
        </div>
      </header>

      <nav aria-label="Breadcrumb" className="section-shell pt-8">
        <ol className="flex flex-wrap items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[.14em] text-muted-foreground">
          <li><a href={`${basePath}/`} className="hover:text-primary" data-testid="link-sonajhuri-crumb-home">Home</a></li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="text-primary">Near Sonajhuri Haat</li>
        </ol>
      </nav>

      <main>
        <section className="section-shell pb-14 pt-10 md:pb-20 md:pt-14" aria-labelledby="sonajhuri-title">
          <p className="eyebrow mb-5 text-accent">Near the forest market</p>
          <h1 id="sonajhuri-title" className="max-w-[880px] font-journal text-[clamp(2.8rem,7vw,5.6rem)] leading-[.94] tracking-[-.035em] text-primary">
            Homestay near<br /><em>Sonajhuri Haat.</em>
          </h1>
          <p className="mt-8 max-w-[640px] text-lg leading-8 text-primary/75">
            Sobuj Potro is a private two-bedroom villa in Bolpur, about {haat} by
            road from Sonajhuri Khoai Haat &mdash; the forest market in the
            khoai, held on Saturdays and often Sundays too, from around 2pm.
          </p>
          <p className="mt-4 max-w-[640px] text-sm leading-6 text-muted-foreground">
            You get the whole house, not a room in it: two air-conditioned
            bedrooms, a private garden and parking on the premises.
          </p>
        </section>

        <section className="border-t border-border bg-card py-16 md:py-24" aria-labelledby="sonajhuri-market">
          <div className="section-shell">
            <h2 id="sonajhuri-market" className="max-w-[680px] font-journal text-4xl leading-[.95] text-primary md:text-5xl">
              The haat, and how<br /><em>guests get to it.</em>
            </h2>
            <p className="mt-7 max-w-[640px] text-[15px] leading-7 text-muted-foreground md:text-[17px]">
              Sonajhurir Hat sits in the khoai &mdash; the eroded red-earth badlands &mdash; about {haat} from the villa by road. It runs on Saturdays, and often on Sundays as well, from about 2pm. It is close enough that a toto will take you and wait, which is what most of our guests do rather than trying to park at the edge of the forest.
            </p>
            <p className="mt-7 max-w-[640px] text-[15px] leading-7 text-muted-foreground md:text-[17px]">
              The Kopai River is about {kopai} away, in the same direction. Between the two, an afternoon out of the house is an afternoon, not an expedition &mdash; you can be back before dark without having planned around it.
            </p>
            <p className="mt-7 max-w-[640px] border-l-2 border-accent/40 pl-5 text-sm leading-6 text-muted-foreground">
              We are not going to tell you how long the walk is or what the market sells this season. Both change, and a web page that guesses is worse than one that says ask. The caretaker knows this week's version and will tell you.
            </p>
          </div>
        </section>

        <section className="py-16 md:py-24" aria-labelledby="sonajhuri-house">
          <div className="section-shell">
            <h2 id="sonajhuri-house" className="max-w-[680px] font-journal text-4xl leading-[.95] text-primary md:text-5xl">
              The house you<br /><em>come back to.</em>
            </h2>
            <p className="mt-7 max-w-[640px] text-[15px] leading-7 text-muted-foreground md:text-[17px]">
              The whole villa is yours for the stay. Two bedrooms, both air-conditioned, a private garden, and parking on the premises if you have driven from Kolkata. There is a refrigerator, a microwave, a water filter and basic utensils with an induction setup, so a late return from the market does not have to mean going out again to eat. Cafe Soi is on the premises, home-cooked food can be arranged through the caretaker, and Zomato delivers to the area.
            </p>
            <p className="mt-7 max-w-[640px] text-[15px] leading-7 text-muted-foreground md:text-[17px]">
              Pets are welcome, and what that means in practice &mdash; including the one-off charge &mdash; is set out in full on the page for guests travelling with a dog. Nothing about it is a surprise at the door.
            </p>
            <p className="mt-7 flex flex-wrap gap-x-6 gap-y-3 text-xs font-bold uppercase tracking-[.1em] text-primary">
              <a href={`${basePath}/`} className="underline decoration-accent decoration-2 underline-offset-4" data-testid="link-sonajhuri-home">The villa in Shantiniketan</a>
              <a href={`${basePath}/places-to-visit-in-shantiniketan`} className="underline decoration-accent decoration-2 underline-offset-4" data-testid="link-sonajhuri-places">Everything else nearby</a>
            </p>
          </div>
        </section>

        <section className="border-t border-border bg-card py-16 md:py-24" aria-labelledby="sonajhuri-arriving">
          <div className="section-shell">
            <h2 id="sonajhuri-arriving" className="max-w-[680px] font-journal text-4xl leading-[.95] text-primary md:text-5xl">
              Arriving for<br /><em>a market weekend.</em>
            </h2>
            <p className="mt-7 max-w-[640px] text-[15px] leading-7 text-muted-foreground md:text-[17px]">
              Prantik is the nearer station at about {prantik} from the house, and the quieter of the two. Bolpur Shantiniketan is about {bolpur} away and is where the fast trains stop &mdash; the Vande Bharat, the Darjeeling Mail, the Kanchanjunga Express. Most people book to Bolpur out of habit, which is worth knowing if you would rather arrive somewhere calmer with the market on your mind.
            </p>
            <p className="mt-7 max-w-[640px] text-[15px] leading-7 text-muted-foreground md:text-[17px]">
              If you are driving, there is parking on the premises. Check-in is from 12:00 and check-out by 11:00, so a Saturday arrival puts you at the house well before the haat opens.
            </p>
          </div>
        </section>


        <section className="bg-primary py-20 text-primary-foreground md:py-28" aria-labelledby="sonajhuri-cta">
          <div className="section-shell grid gap-10 lg:grid-cols-[1.1fr_.9fr] lg:items-end">
            <div>
              <p className="eyebrow mb-5 text-secondary">Enquire direct</p>
              <h2 id="sonajhuri-cta" className="max-w-[560px] font-journal text-4xl leading-[.94] md:text-6xl">
                Go to the haat.<br /><em>Come back to a whole house.</em>
              </h2>
              <p className="mt-7 max-w-[470px] text-lg leading-8 text-primary-foreground/70">
                Two bedrooms, a private garden and parking on the premises in Bolpur, a short ride from the khoai. Enquire direct &mdash; no platform fee, and the host confirms.
              </p>
              <p className="mt-5 flex flex-wrap gap-x-6 gap-y-3 text-xs font-bold uppercase tracking-[.1em]">
                <a href={`${basePath}/rates`} className="underline decoration-secondary decoration-2 underline-offset-4 hover:text-secondary" data-testid="link-sonajhuri-rates">
                  Rates and tariff
                </a>
                <a href={`${basePath}/gallery`} className="underline decoration-secondary decoration-2 underline-offset-4 hover:text-secondary" data-testid="link-sonajhuri-gallery">
                  See the villa
                </a>
                <a href={`${basePath}/pet-friendly-homestay-shantiniketan`} className="underline decoration-secondary decoration-2 underline-offset-4 hover:text-secondary" data-testid="link-sonajhuri-pet">
                  Staying with a pet
                </a>
              </p>
            </div>
            <div className="flex flex-wrap gap-3 lg:justify-end">
              <a
                href={`${basePath}/#availability`}
                onClick={() => track('check_availability', { placement: 'sonajhuri' })}
                className="flex items-center gap-2 rounded-full bg-secondary px-5 py-3 text-xs font-bold uppercase tracking-[.1em] text-primary transition-transform hover:-translate-y-0.5"
                data-testid="link-sonajhuri-book"
              >
                Check availability <ArrowUpRight size={15} />
              </a>
              <a
                href={`https://wa.me/916290399165?text=${encodeURIComponent(
                  'Hello Raj Kuthir, we are coming to Shantiniketan for Sonajhuri Haat and would like to enquire about a stay at Sobuj Potro.',
                )}`}
                target="_blank"
                rel="noreferrer"
                onClick={() => track('whatsapp_click', { placement: 'sonajhuri' })}
                className="flex items-center gap-2 rounded-full border border-primary-foreground/25 px-5 py-3 text-xs font-bold uppercase tracking-[.1em] text-primary-foreground transition-colors hover:bg-primary-foreground/10"
                data-testid="link-sonajhuri-whatsapp"
              >
                <MessageCircle size={15} /> WhatsApp
              </a>
              <a
                href={phoneHref(CONFIG.hostPhone)}
                className="flex items-center gap-2 rounded-full border border-primary-foreground/25 px-5 py-3 text-xs font-bold uppercase tracking-[.1em] text-primary-foreground transition-colors hover:bg-primary-foreground/10"
                data-testid="link-sonajhuri-call"
              >
                <Phone size={15} /> Call the host
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
              Sobuj Potro &mdash; a private two-bedroom villa with a garden in Bolpur / Shantiniketan.
            </p>
          </div>
          <div className="flex flex-col gap-2 text-sm text-[#f5eadb]/70 sm:text-right">
            <a href={`${basePath}/`} className="hover:text-[#e4c9a4]">The stay</a>
            <a href={`${basePath}/places-to-visit-in-shantiniketan`} className="hover:text-[#e4c9a4]">Places to visit</a>
            <a href={`${basePath}/pet-friendly-homestay-shantiniketan`} className="hover:text-[#e4c9a4]">Staying with a pet</a>
            <a href={`${basePath}/gallery`} className="hover:text-[#e4c9a4]">Photos</a>
            <a href={`${basePath}/rates`} className="hover:text-[#e4c9a4]">Rates</a>
            <a href={`${basePath}/house-rules`} className="hover:text-[#e4c9a4]">House rules</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
