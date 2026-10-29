import { useEffect, type ReactNode } from 'react';
import { ArrowLeft, ArrowUpRight, CalendarDays, Leaf, MessageCircle, Phone } from 'lucide-react';

import { formatRupees, rateForNight, useRatePlan, type PeakPeriod, type RatePlan } from '@/lib/rates';
import { CONFIG, basePath, phoneHref, track } from '@/lib/site';

/**
 * The frame shared by the festival landings (Poush Mela, Basanta Utsav).
 *
 * The dates, minimum stay and price are never typed into the page: they are
 * read from the live rate plan's peak period whose id starts with `peakId`,
 * the same entry the calendar and the enquiry estimate price from. When the
 * owner rolls a peak over to next year in the console, this page follows.
 * Prerendered HTML shows the loading line; the browser fills in the figures.
 */

const IST_TODAY = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

function addDays(iso: string, days: number): string {
  const at = new Date(`${iso}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

export function prettyDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y!, m! - 1, d!)),
  );
}

/** The next (or current) peak period for this festival; the latest one if all are past. */
export function festivalPeak(plan: RatePlan | undefined, peakId: string, today: string): PeakPeriod | null {
  const matches = (plan?.peaks ?? []).filter((peak) => peak.id.startsWith(peakId)).sort((a, b) => a.startDate.localeCompare(b.startDate));
  return matches.find((peak) => peak.endDate > today) ?? null;
}

/** Lowest and highest nightly price for two guests across the peak's nights. */
export function peakPriceRange(plan: RatePlan | undefined, peak: PeakPeriod): { low: number; high: number } | null {
  const prices: number[] = [];
  for (let night = peak.startDate; night < peak.endDate; night = addDays(night, 1)) {
    const price = rateForNight(plan, night, 2);
    if (typeof price === 'number' && price > 0) prices.push(price);
  }
  if (!prices.length) return null;
  return { low: Math.min(...prices), high: Math.max(...prices) };
}

function PeakFacts({ peakId, festival }: { peakId: string; festival: string }) {
  const plan = useRatePlan();
  if (plan.isLoading || !plan.data) {
    return <p className="text-[15px] leading-7 text-muted-foreground">Reading this year&rsquo;s dates and rates&hellip;</p>;
  }
  const peak = festivalPeak(plan.data, peakId, IST_TODAY());
  if (!peak) {
    return (
      <p className="text-[15px] leading-7 text-muted-foreground">
        The {festival} dates for the coming year are not set on our calendar yet. Message us and we will tell you as soon as they are.
      </p>
    );
  }
  const range = peakPriceRange(plan.data, peak);
  const lastNight = addDays(peak.endDate, -1);
  return (
    <dl className="grid gap-5 sm:grid-cols-3" data-testid="festival-peak">
      <div>
        <dt className="font-mono-ui text-[10px] uppercase tracking-[.14em] text-muted-foreground">Peak nights</dt>
        <dd className="mt-2 font-journal text-2xl leading-tight text-primary">
          {prettyDay(peak.startDate)} &ndash; {prettyDay(lastNight)}
        </dd>
        <dd className="mt-1 text-xs text-muted-foreground">{peak.label}</dd>
      </div>
      <div>
        <dt className="font-mono-ui text-[10px] uppercase tracking-[.14em] text-muted-foreground">Minimum stay</dt>
        <dd className="mt-2 font-journal text-2xl leading-tight text-primary">
          {peak.minNights} night{peak.minNights === 1 ? '' : 's'}
        </dd>
      </div>
      <div>
        <dt className="font-mono-ui text-[10px] uppercase tracking-[.14em] text-muted-foreground">Whole villa, two guests</dt>
        <dd className="mt-2 font-journal text-2xl leading-tight text-primary tabular-nums">
          {range ? (range.low === range.high ? formatRupees(range.low) : `${formatRupees(range.low)} – ${formatRupees(range.high)}`) : 'On request'}
        </dd>
        <dd className="mt-1 text-xs text-muted-foreground">a night, booked direct; more guests on the rates page</dd>
      </div>
    </dl>
  );
}

export type FestivalStayProps = {
  /** Used for test ids, analytics placement and the WhatsApp message. */
  slug: string;
  festival: string;
  /** The id prefix of this festival's peak period in the rate plan. */
  peakId: string;
  documentTitle: string;
  eyebrow: string;
  heading: ReactNode;
  breadcrumb: string;
  intro: ReactNode;
  /** The festival itself, and anything a guest should check before planning around it. */
  about: { heading: ReactNode; body: ReactNode };
  ctaHeading: ReactNode;
};

export function FestivalStay(props: FestivalStayProps) {
  const { slug } = props;
  useEffect(() => {
    const previous = document.title;
    document.title = props.documentTitle;
    return () => {
      document.title = previous;
    };
  }, [props.documentTitle]);

  const link = 'underline decoration-accent decoration-2 underline-offset-4';

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-foreground/10 bg-background/90 backdrop-blur-md">
        <div className="section-shell flex h-[74px] items-center justify-between gap-6">
          <a href={`${basePath}/`} className="flex shrink-0 items-center gap-3" data-testid={`link-${slug}-brand`}>
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
            data-testid={`link-${slug}-back`}
          >
            <ArrowLeft size={15} /> Back to the stay
          </a>
        </div>
      </header>

      <nav aria-label="Breadcrumb" className="section-shell pt-8">
        <ol className="flex flex-wrap items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[.14em] text-muted-foreground">
          <li><a href={`${basePath}/`} className="hover:text-primary" data-testid={`link-${slug}-crumb-home`}>Home</a></li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="text-primary">{props.breadcrumb}</li>
        </ol>
      </nav>

      <main>
        <section className="section-shell pb-14 pt-10 md:pb-20 md:pt-14" aria-labelledby={`${slug}-title`}>
          <p className="eyebrow mb-5 text-accent">{props.eyebrow}</p>
          <h1 id={`${slug}-title`} className="max-w-[880px] font-journal text-[clamp(2.8rem,7vw,5.6rem)] leading-[.94] tracking-[-.035em] text-primary">
            {props.heading}
          </h1>
          <div className="mt-8 max-w-[640px] space-y-4 text-lg leading-8 text-primary/75">{props.intro}</div>
        </section>

        <section className="border-t border-border bg-card py-16 md:py-24" aria-labelledby={`${slug}-dates`}>
          <div className="section-shell">
            <p className="eyebrow mb-5 flex items-center gap-2 text-accent"><CalendarDays size={14} /> From our live calendar</p>
            <h2 id={`${slug}-dates`} className="max-w-[680px] font-journal text-4xl leading-[.95] text-primary md:text-5xl">
              Dates, minimum stay<br /><em>and the rate.</em>
            </h2>
            <div className="mt-10 max-w-[860px]">
              <PeakFacts peakId={props.peakId} festival={props.festival} />
            </div>
            <p className="mt-8 max-w-[640px] text-sm leading-6 text-muted-foreground">
              These are the same figures the availability calendar and the enquiry estimate use. Festival weeks are the first to fill, and the whole villa is let to one party, so there is only ever one booking for these nights.
            </p>
          </div>
        </section>

        <section className="py-16 md:py-24" aria-labelledby={`${slug}-about`}>
          <div className="section-shell">
            <h2 id={`${slug}-about`} className="max-w-[680px] font-journal text-4xl leading-[.95] text-primary md:text-5xl">
              {props.about.heading}
            </h2>
            <div className="mt-7 max-w-[640px] space-y-7 text-[15px] leading-7 text-muted-foreground md:text-[17px]">{props.about.body}</div>
          </div>
        </section>

        <section className="border-t border-border bg-card py-16 md:py-24" aria-labelledby={`${slug}-house`}>
          <div className="section-shell">
            <h2 id={`${slug}-house`} className="max-w-[680px] font-journal text-4xl leading-[.95] text-primary md:text-5xl">
              A whole house in<br /><em>the busiest week.</em>
            </h2>
            <div className="mt-7 max-w-[640px] space-y-7 text-[15px] leading-7 text-muted-foreground md:text-[17px]">
              <p>
                Sobuj Potro is let as one villa: two air-conditioned bedrooms, a living room, a private garden and parking on the premises. When the town is at its fullest, nobody else is in the next room and there is no queue at a front desk. Check-in is from 12:00 and check-out by 11:00.
              </p>
              <p>
                Totos are the easiest way between the house and the crowds, and the caretaker can help you find one. Local cars can be arranged, and Ola and Uber run here too, subject to availability &mdash; in a festival week, ask us a day ahead rather than on the morning.
              </p>
              <p className="flex flex-wrap gap-x-6 gap-y-3 text-xs font-bold uppercase tracking-[.1em] text-primary">
                <a href={`${basePath}/`} className={link} data-testid={`link-${slug}-home`}>The villa in Shantiniketan</a>
                <a href={`${basePath}/places-to-visit-in-shantiniketan`} className={link} data-testid={`link-${slug}-places`}>Places to visit</a>
                <a href={`${basePath}/rates`} className={link} data-testid={`link-${slug}-rates`}>Rates and tariff</a>
                <a href={`${basePath}/pet-friendly-homestay-shantiniketan`} className={link} data-testid={`link-${slug}-pet`}>Staying with a pet</a>
                <a href={`${basePath}/house-rules`} className={link} data-testid={`link-${slug}-rules`}>House rules</a>
              </p>
            </div>
          </div>
        </section>

        <section className="bg-primary py-20 text-primary-foreground md:py-28" aria-labelledby={`${slug}-cta`}>
          <div className="section-shell grid gap-10 lg:grid-cols-[1.1fr_.9fr] lg:items-end">
            <div>
              <p className="eyebrow mb-5 text-secondary">Enquire direct</p>
              <h2 id={`${slug}-cta`} className="max-w-[560px] font-journal text-4xl leading-[.94] md:text-6xl">{props.ctaHeading}</h2>
              <p className="mt-7 max-w-[470px] text-lg leading-8 text-primary-foreground/70">
                Book the villa direct &mdash; no platform fee, and the host confirms.
              </p>
            </div>
            <div className="flex flex-wrap gap-3 lg:justify-end">
              <a
                href={`${basePath}/#availability`}
                onClick={() => track('check_availability', { placement: slug })}
                className="flex items-center gap-2 rounded-full bg-secondary px-5 py-3 text-xs font-bold uppercase tracking-[.1em] text-primary transition-transform hover:-translate-y-0.5"
                data-testid={`link-${slug}-book`}
              >
                Check availability <ArrowUpRight size={15} />
              </a>
              <a
                href={`https://wa.me/916290399165?text=${encodeURIComponent(
                  `Hello Raj Kuthir, we are coming to Shantiniketan for ${props.festival} and would like to enquire about a stay at Sobuj Potro.`,
                )}`}
                target="_blank"
                rel="noreferrer"
                onClick={() => track('whatsapp_click', { placement: slug })}
                className="flex items-center gap-2 rounded-full border border-primary-foreground/25 px-5 py-3 text-xs font-bold uppercase tracking-[.1em] text-primary-foreground transition-colors hover:bg-primary-foreground/10"
                data-testid={`link-${slug}-whatsapp`}
              >
                <MessageCircle size={15} /> WhatsApp
              </a>
              <a
                href={phoneHref(CONFIG.hostPhone)}
                className="flex items-center gap-2 rounded-full border border-primary-foreground/25 px-5 py-3 text-xs font-bold uppercase tracking-[.1em] text-primary-foreground transition-colors hover:bg-primary-foreground/10"
                data-testid={`link-${slug}-call`}
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
            <a href={`${basePath}/poush-mela-stay-shantiniketan`} className="hover:text-[#e4c9a4]">Poush Mela stay</a>
            <a href={`${basePath}/basanta-utsav-stay-shantiniketan`} className="hover:text-[#e4c9a4]">Basanta Utsav stay</a>
            <a href={`${basePath}/places-to-visit-in-shantiniketan`} className="hover:text-[#e4c9a4]">Places to visit</a>
            <a href={`${basePath}/gallery`} className="hover:text-[#e4c9a4]">Photos</a>
            <a href={`${basePath}/rates`} className="hover:text-[#e4c9a4]">Rates</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
