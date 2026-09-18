import { useEffect, useMemo } from 'react';
import {
  AirVent,
  ArrowLeft,
  ArrowUpRight,
  Bath,
  BedDouble,
  CalendarDays,
  Car,
  CookingPot,
  Leaf,
  MapPin,
  MessageCircle,
  PawPrint,
  Phone,
  Wifi,
} from 'lucide-react';

import { formatRupees, useRatePlan } from '@/lib/rates';
import { CONFIG, basePath, phoneHref, track } from '@/lib/site';

/**
 * The rate card, on a page a search engine can find.
 *
 * WHERE THE NUMBERS COME FROM
 *
 * Nowhere in this file. Every figure is read from /api/rates through
 * useRatePlan — the same query, the same cache and the same formatting the
 * homepage calendar and the enquiry estimate use. The owner changes a price in
 * Admin → Rates and this page, the calendar and the estimate all move
 * together. A test fails if a rupee amount is ever typed into this file.
 *
 * When the plan has not loaded, the page says so and points at the calendar
 * rather than showing a figure nobody has checked. A price on the page is a
 * price a guest will hold us to.
 *
 * WHAT IT DOES NOT SAY
 *
 * It shows the standing rate for each party size. Dated overrides (a festival,
 * a busy weekend) are applied per night by the calendar, so they are pointed
 * to rather than repeated here, where a list of periods and prices would be a
 * second place for them to go stale.
 */

const COVERED = [
  { icon: BedDouble, label: 'The entire villa — two bedrooms, two king beds' },
  { icon: AirVent, label: 'Air conditioning in both bedrooms' },
  { icon: Bath, label: 'Two bathrooms' },
  { icon: CookingPot, label: 'A kitchen with induction setup, microwave, refrigerator and water filter' },
  { icon: Leaf, label: 'The private garden' },
  { icon: Car, label: 'On-premise parking' },
  { icon: Wifi, label: 'Wi-Fi' },
];

export default function Rates() {
  useEffect(() => {
    const previous = document.title;
    // Must match the server-rendered <title> in api-server/src/lib/seo.ts.
    document.title = 'Shantiniketan Homestay Rates & Tariff | Raj Kuthir';
    return () => {
      document.title = previous;
    };
  }, []);

  const plan = useRatePlan();

  /** Party size → standing nightly rate, in the order a guest reads them. */
  const rows = useMemo(
    () =>
      Object.entries(plan.data?.rates ?? {})
        .map(([guests, paise]) => ({ guests: Number(guests), paise }))
        .filter((row) => Number.isInteger(row.guests) && row.guests > 0 && row.paise > 0)
        .sort((a, b) => a.guests - b.guests),
    [plan.data],
  );

  const extras = plan.data?.extras;
  const maxGuests = plan.data?.maxGuests ?? 5;

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-foreground/10 bg-background/90 backdrop-blur-md">
        <div className="section-shell flex h-[74px] items-center justify-between gap-6">
          <a href={`${basePath}/`} className="flex shrink-0 items-center gap-3" data-testid="link-rates-brand">
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
            data-testid="link-rates-back"
          >
            <ArrowLeft size={15} /> Back to the stay
          </a>
        </div>
      </header>

      {/* Breadcrumb, matching the BreadcrumbList the server emits. */}
      <nav aria-label="Breadcrumb" className="section-shell pt-8">
        <ol className="flex flex-wrap items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[.14em] text-muted-foreground">
          <li><a href={`${basePath}/`} className="hover:text-primary" data-testid="link-rates-crumb-home">Home</a></li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="text-primary">Rates</li>
        </ol>
      </nav>

      <main>
        {/* ---------------------------------------------------------- hero */}
        <section className="section-shell pb-14 pt-10 md:pb-20 md:pt-14" aria-labelledby="rates-title">
          <p className="eyebrow mb-5 text-accent">Before you enquire</p>
          <h1 id="rates-title" className="max-w-[880px] font-journal text-[clamp(2.8rem,7vw,5.6rem)] leading-[.94] tracking-[-.035em] text-primary">
            Homestay rates<br /><em>in Shantiniketan.</em>
          </h1>
          <p className="mt-8 max-w-[620px] text-lg leading-8 text-primary/75">
            The full tariff for a night at Sobuj Potro &mdash; the price of the
            whole two-bedroom villa in Bolpur, not a room in it. What you pay
            depends on how many of you are staying and on your dates; the house
            you get is the same.
          </p>
          <p className="mt-4 max-w-[620px] text-sm leading-6 text-muted-foreground">
            These are read live from the same rate card as the availability
            calendar and the enquiry estimate, so the three always agree.
          </p>
          <p className="mt-4 max-w-[620px] text-sm leading-6 text-muted-foreground">
            Working out how many nights you need first? There is a{' '}
            <a
              href={`${basePath}/shantiniketan-2-day-itinerary`}
              className="text-primary underline decoration-accent decoration-2 underline-offset-4"
              data-testid="link-rates-itinerary"
            >
              two-day plan for Shantiniketan
            </a>{' '}
            and a page on{' '}
            <a
              href={`${basePath}/shantiniketan-weekend-trip-from-kolkata`}
              className="text-primary underline decoration-accent decoration-2 underline-offset-4"
              data-testid="link-rates-weekend"
            >
              getting here from Kolkata
            </a>
            .
          </p>
        </section>

        {/* ---------------------------------------------------- rate card */}
        <section className="border-y border-border bg-card py-16 md:py-24" aria-labelledby="rate-card-title">
          <div className="section-shell grid gap-12 lg:grid-cols-[.8fr_1.2fr] lg:gap-20">
            <div>
              <p className="eyebrow mb-5 text-accent">Per night</p>
              <h2 id="rate-card-title" className="font-journal text-4xl leading-[.95] text-primary md:text-5xl">
                The rate card.
              </h2>
              <p className="mt-6 max-w-[380px] text-sm leading-6 text-muted-foreground">
                The standing rate for each party size. Some dates may be priced
                differently, so the availability calendar shows the exact rate
                for every night before you ask.
              </p>
            </div>

            <div>
              {plan.isLoading ? (
                <p className="rounded-[1.2rem] border border-border bg-background px-6 py-8 text-sm text-muted-foreground" data-testid="text-rates-loading">
                  Loading the current rate card&hellip;
                </p>
              ) : rows.length === 0 ? (
                <div className="rounded-[1.2rem] border border-border bg-background px-6 py-8" data-testid="text-rates-unavailable">
                  <p className="text-sm leading-6 text-primary">
                    The rate card could not be loaded just now.
                  </p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    The availability calendar shows the rate for each night, or
                    call the host on {CONFIG.hostPhone}.
                  </p>
                </div>
              ) : (
                <table className="w-full border-collapse text-left" data-testid="table-rates">
                  <caption className="sr-only">Standing nightly rate for the whole villa, by number of guests</caption>
                  <thead>
                    <tr className="border-b border-border">
                      <th scope="col" className="py-3 font-mono-ui text-[10px] font-normal uppercase tracking-[.12em] text-muted-foreground">Guests</th>
                      <th scope="col" className="py-3 text-right font-mono-ui text-[10px] font-normal uppercase tracking-[.12em] text-muted-foreground">Per night, whole villa</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.guests} className="border-b border-border" data-testid={`row-rate-${row.guests}`}>
                        <th scope="row" className="py-5 font-journal text-2xl font-normal text-primary">
                          {row.guests} {row.guests === 1 ? 'guest' : 'guests'}
                        </th>
                        <td className="py-5 text-right font-journal text-2xl text-accent">{formatRupees(row.paise)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <a
                href={`${basePath}/#availability`}
                onClick={() => track('check_availability', { placement: 'rates_card' })}
                className="mt-8 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[.1em] text-primary underline decoration-accent decoration-2 underline-offset-4"
                data-testid="link-rates-calendar"
              >
                See the rate for your dates <ArrowUpRight size={14} />
              </a>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------- extras
            The same three sentences the booking section shows, from the same
            numbers. Said up front because a family finding a surcharge they
            did not expect is a worse first hour than reading it here. */}
        {extras && (
          <section className="section-shell py-16 md:py-24" aria-labelledby="extras-title">
            <p className="eyebrow mb-5 text-accent">Who is coming</p>
            <h2 id="extras-title" className="max-w-[640px] font-journal text-4xl leading-[.95] text-primary md:text-5xl">
              Children, larger parties<br /><em>and pets.</em>
            </h2>
            <ul className="mt-10 grid gap-4 lg:grid-cols-3" data-testid="list-rates-extras">
              <li className="rounded-[1.4rem] border border-border bg-card p-7 text-sm leading-6 text-muted-foreground">
                Children under {extras.childUnderAge} count as guests. Two adults
                and two little ones are a party of four, at the four-guest price
                &mdash; nothing extra.
              </li>
              <li className="rounded-[1.4rem] border border-border bg-card p-7 text-sm leading-6 text-muted-foreground">
                Above {maxGuests} guests, each extra person is{' '}
                {formatRupees(extras.extraAdultPaise)} a night, or{' '}
                {formatRupees(extras.extraChildPaise)} for a child under{' '}
                {extras.childUnderAge}.
              </li>
              <li className="rounded-[1.4rem] border border-border bg-card p-7 text-sm leading-6 text-muted-foreground">
                Pets are {formatRupees(extras.petPaise)} for the stay, not per
                night. Everything else about bringing one is on the page for
                guests who{' '}
                <a href={`${basePath}/pet-friendly-homestay-shantiniketan`} className="text-primary underline decoration-accent decoration-2 underline-offset-4" data-testid="link-rates-pet">
                  stay with their pet in Shantiniketan
                </a>
                .
              </li>
            </ul>
          </section>
        )}

        {/* ------------------------------------------------ what it covers */}
        <section className={`py-16 md:py-24 ${extras ? 'border-t border-border bg-card' : ''}`} aria-labelledby="covers-title">
          <div className="section-shell grid gap-12 lg:grid-cols-[.8fr_1.2fr] lg:gap-20">
            <div>
              <p className="eyebrow mb-5 text-accent">For that price</p>
              <h2 id="covers-title" className="font-journal text-4xl leading-[.95] text-primary md:text-5xl">
                What the rate<br /><em>covers.</em>
              </h2>
              <p className="mt-6 max-w-[380px] text-sm leading-6 text-muted-foreground">
                One party at a time, and the whole house. Check-in is from
                12:00 PM and check-out by 11:00 AM &mdash; the rest is in the{' '}
                <a href={`${basePath}/house-rules`} className="text-primary underline decoration-accent decoration-1 underline-offset-2" data-testid="link-rates-house-rules">
                  house rules
                </a>
                .
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {COVERED.map(({ icon: Icon, label }) => (
                <div key={label} className="flex items-start gap-3 rounded-[1.1rem] border border-border bg-background px-5 py-4">
                  <Icon size={18} className="mt-0.5 shrink-0 text-accent" strokeWidth={1.5} />
                  <span className="text-sm leading-6 text-primary">{label}</span>
                </div>
              ))}
              <a
                href={`${basePath}/pet-friendly-homestay-shantiniketan`}
                className="flex items-start gap-3 rounded-[1.1rem] border border-border bg-background px-5 py-4 transition-colors hover:border-primary"
                data-testid="link-rates-pet-card"
              >
                <PawPrint size={18} className="mt-0.5 shrink-0 text-accent" strokeWidth={1.5} />
                <span className="text-sm leading-6 text-primary">Pets welcome, in the house rules</span>
              </a>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------- location */}
        <section className="section-shell py-16 md:py-24" aria-labelledby="rates-where-title">
          <div className="grid gap-10 lg:grid-cols-[.8fr_1.2fr] lg:gap-20">
            <div>
              <p className="eyebrow mb-5 text-accent">Where it is</p>
              <h2 id="rates-where-title" className="font-journal text-4xl leading-[.95] text-primary md:text-5xl">
                Bolpur,<br /><em>Shantiniketan.</em>
              </h2>
            </div>
            <div className="max-w-[620px] space-y-5 text-base leading-7 text-muted-foreground">
              <p>
                <MapPin size={15} className="mr-2 inline text-accent" />
                {CONFIG.place}. Cafe Soi is on the premises, and the Tagore
                campus, the Sonajhuri market and both railway stations are a
                short ride away.
              </p>
              <p className="flex flex-wrap gap-x-6 gap-y-3 text-xs font-bold uppercase tracking-[.1em] text-primary">
                <a href={`${basePath}/gallery`} className="underline decoration-accent decoration-2 underline-offset-4" data-testid="link-rates-gallery">
                  See the villa
                </a>
                <a href={`${basePath}/places-to-visit-in-shantiniketan`} className="underline decoration-accent decoration-2 underline-offset-4" data-testid="link-rates-places">
                  Places to visit nearby
                </a>
                <a href={`${basePath}/our-story`} className="underline decoration-accent decoration-2 underline-offset-4" data-testid="link-rates-story">
                  Our story
                </a>
              </p>
            </div>
          </div>
        </section>

        {/* -------------------------------------------------------- closing */}
        <section className="bg-primary py-20 text-primary-foreground md:py-28" aria-labelledby="rates-cta">
          <div className="section-shell grid gap-10 lg:grid-cols-[1.1fr_.9fr] lg:items-end">
            <div>
              <p className="eyebrow mb-5 text-secondary">When you have dates</p>
              <h2 id="rates-cta" className="max-w-[560px] font-journal text-4xl leading-[.94] md:text-6xl">
                Book direct,<br /><em>with the owner.</em>
              </h2>
              <p className="mt-7 max-w-[470px] text-lg leading-8 text-primary-foreground/70">
                Pick your dates on the calendar and send an enquiry. The host
                confirms availability and the final amount directly, and no
                payment is taken on this site.
              </p>
            </div>
            <div className="flex flex-wrap gap-3 lg:justify-end">
              <a
                href={`${basePath}/#availability`}
                onClick={() => track('check_availability', { placement: 'rates' })}
                className="flex items-center gap-2 rounded-full bg-secondary px-5 py-3 text-xs font-bold uppercase tracking-[.1em] text-primary transition-transform hover:-translate-y-0.5"
                data-testid="link-rates-book"
              >
                <CalendarDays size={15} /> Check availability
              </a>
              <a
                href={`https://wa.me/916290399165?text=${encodeURIComponent(
                  'Hello Raj Kuthir, I have been looking at the rates for Sobuj Potro and would like to enquire about a stay.',
                )}`}
                target="_blank"
                rel="noreferrer"
                onClick={() => track('whatsapp_click', { placement: 'rates' })}
                className="flex items-center gap-2 rounded-full border border-primary-foreground/25 px-5 py-3 text-xs font-bold uppercase tracking-[.1em] text-primary-foreground transition-colors hover:bg-primary-foreground/10"
                data-testid="link-rates-whatsapp"
              >
                <MessageCircle size={15} /> WhatsApp
              </a>
              <a
                href={phoneHref(CONFIG.hostPhone)}
                className="flex items-center gap-2 rounded-full border border-primary-foreground/25 px-5 py-3 text-xs font-bold uppercase tracking-[.1em] text-primary-foreground transition-colors hover:bg-primary-foreground/10"
                data-testid="link-rates-call"
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
            <a href={`${basePath}/pet-friendly-homestay-shantiniketan`} className="hover:text-[#e4c9a4]">Staying with a pet</a>
            <a href={`${basePath}/gallery`} className="hover:text-[#e4c9a4]">Photos</a>
            <a href={`${basePath}/places-to-visit-in-shantiniketan`} className="hover:text-[#e4c9a4]">Places to visit</a>
            <a href={`${basePath}/house-rules`} className="hover:text-[#e4c9a4]">House rules</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
