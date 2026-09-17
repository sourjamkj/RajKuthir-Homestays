import { useEffect } from 'react';
import { ArrowLeft, ArrowUpRight, Landmark, Leaf, MessageCircle, Phone } from 'lucide-react';

import { CONFIG, NEIGHBOURHOOD, basePath, phoneHref, track } from '@/lib/site';

/**
 * Places to visit in Shantiniketan, measured from the doorstep.
 *
 * This was the "neighbourhood" section on the homepage. It earns a page of
 * its own because, unlike most of the site, it answers a question people type
 * into Google before they have chosen anywhere to stay — and because the
 * material is genuinely useful: eighteen places with road distances from the
 * villa rather than from "Shantiniketan" in the abstract.
 *
 * Every distance and note comes from NEIGHBOURHOOD in lib/site.ts, which is
 * the single source of truth shared with the homepage teaser. Do not retype
 * them here.
 *
 * The FAQ below is mirrored in api-server/src/lib/seo.ts as FAQPage structured
 * data. Google requires the marked-up answer to match what a visitor can read,
 * and a test asserts it — change one and you must change the other.
 */

export const PLACES_FAQ = [
  {
    q: 'Which station should we book to for Shantiniketan?',
    a: 'Prantik is the closer of the two at about 5 km from the villa, and the quieter. Bolpur Shantiniketan is about 9 km away and is where the fast trains stop — the Vande Bharat, Darjeeling Mail and Kanchanjunga Express. Most people book to Bolpur out of habit, which is worth knowing if you would rather arrive somewhere calmer.',
  },
  {
    q: 'When is the Sonajhuri forest market on?',
    a: 'Saturdays, and often Sundays too, from about 2pm. It is roughly 4 km from the villa — close enough that a toto will take you and wait.',
  },
  {
    q: 'How do people get around once they are here?',
    a: 'A toto for anything close by; the caretaker can arrange a car for the full-day trips such as Tarapith, Bishnupur or Massanjore. There is parking on the premises if you have driven down.',
  },
  {
    q: 'How far is the Tagore campus from the villa?',
    a: 'About 6 km to Visva-Bharati and Rabindra Bhavan, and the same to Upasana Griha, Chhatimtala and Kala Bhavana — all of it within one short ride of the house.',
  },
];

export default function PlacesToVisit() {
  useEffect(() => {
    const previous = document.title;
    document.title = 'Places to Visit in Shantiniketan | Raj Kuthir Homestays';
    return () => {
      document.title = previous;
    };
  }, []);

  const placeCount = NEIGHBOURHOOD.reduce((total, group) => total + group.places.length, 0);

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-foreground/10 bg-background/90 backdrop-blur-md">
        <div className="section-shell flex h-[74px] items-center justify-between gap-6">
          <a href={`${basePath}/`} className="flex shrink-0 items-center gap-3" data-testid="link-places-brand">
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
            data-testid="link-places-back"
          >
            <ArrowLeft size={15} /> Back to the stay
          </a>
        </div>
      </header>

      {/* Breadcrumb, matching the BreadcrumbList the server emits. */}
      <nav aria-label="Breadcrumb" className="section-shell pt-8">
        <ol className="flex flex-wrap items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[.14em] text-muted-foreground">
          <li><a href={`${basePath}/`} className="hover:text-primary" data-testid="link-places-crumb-home">Home</a></li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="text-primary">Places to visit</li>
        </ol>
      </nav>

      <main>
        {/* ---------------------------------------------------------- hero */}
        <section className="section-shell pb-14 pt-10 md:pb-20 md:pt-14" aria-labelledby="places-title">
          <p className="eyebrow mb-5 text-accent">The neighbourhood</p>
          <h1 id="places-title" className="max-w-[880px] font-journal text-[clamp(2.8rem,7vw,5.6rem)] leading-[.94] tracking-[-.035em] text-primary">
            Places to visit<br /><em>in Shantiniketan.</em>
          </h1>
          <p className="mt-8 max-w-[620px] text-lg leading-8 text-primary/75">
            {placeCount} of them, with the distance by road from our doorstep in
            Bolpur rather than from the town in general &mdash; because
            &ldquo;near Shantiniketan&rdquo; can mean a five-minute toto ride or
            a two-hour drive, and it matters which.
          </p>
          <p className="mt-4 max-w-[620px] text-sm leading-6 text-muted-foreground">
            Shantiniketan is best met in fragments: a red-earth path, a market
            pause, a late return home.
          </p>
        </section>

        {/* -------------------------------------------------------- the list */}
        <section className="section-shell pb-8" aria-label="Places grouped by how far they are">
          <div className="space-y-10">
            {NEIGHBOURHOOD.map((group) => (
              <div key={group.group} data-testid={`places-${group.group.toLowerCase().replace(/[^a-z]+/g, '-')}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border pb-4">
                  <h2 className="font-journal text-3xl text-primary md:text-4xl">{group.group}</h2>
                  <p className="max-w-[420px] text-xs leading-5 text-muted-foreground">{group.note}</p>
                </div>
                <div>
                  {group.places.map((place) => (
                    <div
                      key={place.title}
                      className="flex items-center gap-5 border-b border-border py-5"
                      data-testid={`place-${place.title.toLowerCase().replace(/[^a-z]+/g, '-')}`}
                    >
                      <Landmark size={19} className="shrink-0 text-primary/60" strokeWidth={1.4} />
                      <div className="min-w-0 flex-1">
                        <p className="font-journal text-xl text-primary md:text-2xl">{place.title}</p>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">{place.note}</p>
                      </div>
                      <p className="shrink-0 font-journal text-xl text-accent md:text-2xl">{place.distance}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="pt-6 text-xs leading-5 text-muted-foreground">
            Distances are by road from the villa and rounded to the nearest
            useful number. Routes and traffic vary.
          </p>
          <p className="max-w-[640px] pt-4 text-sm leading-6 text-muted-foreground" data-testid="text-places-pets">
            Travelling with a dog? Whether a particular market, temple or
            sanctuary lets pets in changes from season to season, and we have
            not verified it for any of the places above &mdash; ask the
            caretaker before you set out. Everything about the house itself is
            on the page for our{' '}
            <a href={`${basePath}/pet-friendly-homestay-shantiniketan`} className="text-primary underline decoration-accent decoration-2 underline-offset-4" data-testid="link-places-pet">
              pet-friendly homestay in Shantiniketan
            </a>
            .
          </p>
        </section>

        {/* --------------------------------------------------------- the FAQ
            Rendered in full, never behind a toggle: the answers are marked up
            as FAQPage structured data, and Google requires marked-up text to
            be text a visitor can actually read. */}
        <section className="border-y border-border bg-card py-20 md:py-28" aria-labelledby="places-faq-title">
          <div className="section-shell grid gap-12 lg:grid-cols-[.7fr_1.3fr] lg:gap-20">
            <div>
              <p className="eyebrow mb-5 text-accent">Before you plan</p>
              <h2 id="places-faq-title" className="font-journal text-4xl leading-[.95] text-primary md:text-5xl">
                The practical<br /><em>questions.</em>
              </h2>
            </div>
            <dl className="space-y-8">
              {PLACES_FAQ.map((item) => (
                <div key={item.q} className="border-t border-border pt-6">
                  <dt className="font-journal text-2xl leading-tight text-primary">{item.q}</dt>
                  <dd className="mt-3 max-w-[640px] text-sm leading-7 text-muted-foreground">{item.a}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* ------------------------------------------------------- closing */}
        <section className="bg-primary py-20 text-primary-foreground md:py-28" aria-labelledby="places-cta">
          <div className="section-shell grid gap-10 lg:grid-cols-[1.1fr_.9fr] lg:items-end">
            <div>
              <p className="eyebrow mb-5 text-secondary">Somewhere to come back to</p>
              <h2 id="places-cta" className="max-w-[560px] font-journal text-4xl leading-[.94] md:text-6xl">
                A whole villa,<br /><em>at the end of the day.</em>
              </h2>
              <p className="mt-7 max-w-[470px] text-lg leading-8 text-primary-foreground/70">
                Two bedrooms, a private garden and parking on the premises, in
                Bolpur &mdash; near Prantik station and a short ride from the
                Tagore campus.
              </p>
              <p className="mt-5 flex flex-wrap gap-x-6 gap-y-3 text-xs font-bold uppercase tracking-[.1em]">
                <a href={`${basePath}/gallery`} className="underline decoration-secondary decoration-2 underline-offset-4 hover:text-secondary" data-testid="link-places-gallery">
                  See the villa
                </a>
                <a href={`${basePath}/rates`} className="underline decoration-secondary decoration-2 underline-offset-4 hover:text-secondary" data-testid="link-places-rates">
                  Rates
                </a>
              </p>
            </div>
            <div className="flex flex-wrap gap-3 lg:justify-end">
              <a
                href={`${basePath}/#booking`}
                onClick={() => track('check_availability', { placement: 'places_to_visit' })}
                className="flex items-center gap-2 rounded-full bg-secondary px-5 py-3 text-xs font-bold uppercase tracking-[.1em] text-primary transition-transform hover:-translate-y-0.5"
                data-testid="link-places-book"
              >
                Check availability <ArrowUpRight size={15} />
              </a>
              <a
                href={`https://wa.me/916290399165?text=${encodeURIComponent(
                  'Hello Raj Kuthir, I am planning a trip to Shantiniketan and would like to enquire about a stay at Sobuj Potro.',
                )}`}
                target="_blank"
                rel="noreferrer"
                onClick={() => track('whatsapp_click', { placement: 'places_to_visit' })}
                className="flex items-center gap-2 rounded-full border border-primary-foreground/25 px-5 py-3 text-xs font-bold uppercase tracking-[.1em] text-primary-foreground transition-colors hover:bg-primary-foreground/10"
                data-testid="link-places-whatsapp"
              >
                <MessageCircle size={15} /> WhatsApp
              </a>
              <a
                href={phoneHref(CONFIG.caretakerPhone)}
                className="flex items-center gap-2 rounded-full border border-primary-foreground/25 px-5 py-3 text-xs font-bold uppercase tracking-[.1em] text-primary-foreground transition-colors hover:bg-primary-foreground/10"
                data-testid="link-places-caretaker"
              >
                <Phone size={15} /> Caretaker
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
            <a href={`${basePath}/pet-friendly-homestay-shantiniketan`} className="hover:text-[#e4c9a4]">Staying with a pet</a>
            <a href={`${basePath}/gallery`} className="hover:text-[#e4c9a4]">Photos</a>
            <a href={`${basePath}/our-story`} className="hover:text-[#e4c9a4]">Our story</a>
            <a href={`${basePath}/house-rules`} className="hover:text-[#e4c9a4]">House rules</a>
            <a href={`${basePath}/rates`} className="hover:text-[#e4c9a4]">Rates</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
