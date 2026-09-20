import { useEffect } from 'react';
import { ArrowLeft, ArrowUpRight, Leaf, MessageCircle, Phone } from 'lucide-react';

import { CONFIG, NEIGHBOURHOOD, basePath, phoneHref, track } from '@/lib/site';
import type { NeighbourhoodPlace } from '@/lib/site';

/**
 * Planning page for the commonest trip anyone makes to Shantiniketan: two
 * nights out of Kolkata.
 *
 * Scope is deliberately LOGISTICS — how you get here, when to come, how long
 * things take, where you sleep. The hour-by-hour version lives on
 * /shantiniketan-2-day-itinerary and this page links to it rather than
 * repeating it; two pages competing for the same intent would be worth less
 * than either alone.
 *
 * Distances come from NEIGHBOURHOOD. NOTHING on this page states a train
 * journey time, a fare, a timetable or a season's weather: the repository has
 * not verified any of them, and a travel page that guesses at a departure time
 * is worse than one that names the service and says to check.
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

export default function WeekendFromKolkata() {
  useEffect(() => {
    const previous = document.title;
    document.title = 'Shantiniketan Weekend Trip from Kolkata | Raj Kuthir';
    return () => {
      document.title = previous;
    };
  }, []);

  const prantik = distanceTo('Prantik station');
  const bolpur = distanceTo('Bolpur Shantiniketan station');
  const kolkataAirport = distanceTo('Kolkata airport');
  const andal = distanceTo('Andal airport (Kazi Nazrul Islam)');
  const haat = distanceTo('Sonajhuri Khoai Haat');
  const campus = distanceTo('Visva-Bharati & Rabindra Bhavan');
  const ballavpur = distanceTo('Ballavpur Wildlife Sanctuary');

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-foreground/10 bg-background/90 backdrop-blur-md">
        <div className="section-shell flex h-[74px] items-center justify-between gap-6">
          <a href={`${basePath}/`} className="flex shrink-0 items-center gap-3" data-testid="link-weekend-brand">
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
            data-testid="link-weekend-back"
          >
            <ArrowLeft size={15} /> Back to the stay
          </a>
        </div>
      </header>

      <nav aria-label="Breadcrumb" className="section-shell pt-8">
        <ol className="flex flex-wrap items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[.14em] text-muted-foreground">
          <li><a href={`${basePath}/`} className="hover:text-primary" data-testid="link-weekend-crumb-home">Home</a></li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="text-primary">Weekend from Kolkata</li>
        </ol>
      </nav>

      <main>
        <section className="section-shell pb-14 pt-10 md:pb-20 md:pt-14" aria-labelledby="weekend-title">
          <p className="eyebrow mb-5 text-accent">Two nights out of the city</p>
          <h1 id="weekend-title" className="max-w-[880px] font-journal text-[clamp(2.8rem,7vw,5.6rem)] leading-[.94] tracking-[-.035em] text-primary">
            A Shantiniketan weekend<br /><em>from Kolkata.</em>
          </h1>
          <p className="mt-8 max-w-[640px] text-lg leading-8 text-primary/75">
            Shantiniketan is the weekend Kolkata keeps meaning to take. This is
            the practical version &mdash; how to get here, which days actually
            matter, and where to sleep once you arrive.
          </p>
          <p className="mt-4 max-w-[640px] text-sm leading-6 text-muted-foreground">
            Written from Sobuj Potro, a private two-bedroom villa in Bolpur, so
            every distance below is from a real doorstep rather than from
            &ldquo;Shantiniketan&rdquo; in the abstract.
          </p>
        </section>

        <section className="border-t border-border bg-card py-16 md:py-24" aria-labelledby="weekend-getting-here">
          <div className="section-shell">
            <h2 id="weekend-getting-here" className="max-w-[680px] font-journal text-4xl leading-[.95] text-primary md:text-5xl">
              Getting here<br /><em>from Kolkata.</em>
            </h2>
            <p className="mt-7 max-w-[640px] text-[15px] leading-7 text-muted-foreground md:text-[17px]">
              By train, two stations serve the area. Bolpur Shantiniketan is about {bolpur} from the villa and is where the fast services stop &mdash; the Vande Bharat, the Darjeeling Mail and the Kanchanjunga Express. Prantik is closer at about {prantik} and considerably quieter; it is about fifteen minutes from the house by toto. Most people book to Bolpur out of habit without realising Prantik exists.
            </p>
            <p className="mt-7 max-w-[640px] text-[15px] leading-7 text-muted-foreground md:text-[17px]">
              By road, Kolkata airport is about {kolkataAirport} away, four to five hours by car. Andal (Kazi Nazrul Islam) airport is the nearest at about {andal}, roughly two hours by road. There is parking on the premises if you drive.
            </p>
            <p className="mt-7 max-w-[640px] border-l-2 border-accent/40 pl-5 text-sm leading-6 text-muted-foreground">
              We do not print departure times, fares or journey durations here. Services and timings change, we have not verified them, and a weekend planned around a stale web page is a weekend that starts badly. Check current timings when you book your tickets.
            </p>
          </div>
        </section>

        <section className="py-16 md:py-24" aria-labelledby="weekend-when">
          <div className="section-shell">
            <h2 id="weekend-when" className="max-w-[680px] font-journal text-4xl leading-[.95] text-primary md:text-5xl">
              Which days<br /><em>actually matter.</em>
            </h2>
            <p className="mt-7 max-w-[640px] text-[15px] leading-7 text-muted-foreground md:text-[17px]">
              One fact shapes most weekends here: Sonajhuri Khoai Haat, the forest market about {haat} from the villa, runs on Saturdays and often on Sundays too, from around 2pm. If the haat is the reason you are coming, a Friday-night or Saturday-morning arrival is what makes it work; a Sunday-only trip can miss it entirely.
            </p>
            <p className="mt-7 max-w-[640px] text-[15px] leading-7 text-muted-foreground md:text-[17px]">
              Ballavpur Wildlife Sanctuary, about {ballavpur} away, is best early in the morning &mdash; which in practice means it belongs to the second day, not to an afternoon that has already been spent at the market.
            </p>
            <p className="mt-7 max-w-[640px] text-[15px] leading-7 text-muted-foreground md:text-[17px]">
              Visva-Bharati and Rabindra Bhavan are about {campus} from the house. We do not publish campus opening hours or ticket prices, and days on which the campus is closed to visitors are worth confirming before you build a morning around them.
            </p>
          </div>
        </section>

        <section className="border-t border-border bg-card py-16 md:py-24" aria-labelledby="weekend-shape">
          <div className="section-shell">
            <h2 id="weekend-shape" className="max-w-[680px] font-journal text-4xl leading-[.95] text-primary md:text-5xl">
              The shape of<br /><em>two nights.</em>
            </h2>
            <p className="mt-7 max-w-[640px] text-[15px] leading-7 text-muted-foreground md:text-[17px]">
              Arrive Friday evening or Saturday before noon; check-in is from 12:00. Saturday afternoon goes to the haat and the Kopai; Sunday morning to the Tagore campus or the sanctuary, before an 11:00 check-out. That is the skeleton, and it holds for most people.
            </p>
            <p className="mt-7 flex flex-wrap gap-x-6 gap-y-3 text-xs font-bold uppercase tracking-[.1em] text-primary">
              <a href={`${basePath}/shantiniketan-2-day-itinerary`} className="underline decoration-accent decoration-2 underline-offset-4" data-testid="link-weekend-itinerary">The hour-by-hour itinerary</a>
              <a href={`${basePath}/places-to-visit-in-shantiniketan`} className="underline decoration-accent decoration-2 underline-offset-4" data-testid="link-weekend-places">All eighteen places, with distances</a>
            </p>
          </div>
        </section>

        <section className="py-16 md:py-24" aria-labelledby="weekend-stay">
          <div className="section-shell">
            <h2 id="weekend-stay" className="max-w-[680px] font-journal text-4xl leading-[.95] text-primary md:text-5xl">
              Where you sleep<br /><em>decides the weekend.</em>
            </h2>
            <p className="mt-7 max-w-[640px] text-[15px] leading-7 text-muted-foreground md:text-[17px]">
              Two nights is short enough that a bad base costs you most of it. Sobuj Potro is a private two-bedroom villa in Bolpur &mdash; the whole house, not a room in it &mdash; with two air-conditioned bedrooms, a private garden and parking on the premises. Cafe Soi is on the premises, there is a refrigerator, microwave, water filter and an induction setup with basic utensils, and home-cooked food can be arranged through the caretaker.
            </p>
            <p className="mt-7 max-w-[640px] text-[15px] leading-7 text-muted-foreground md:text-[17px]">
              It suits two couples travelling together or a family with children, because everybody is in one house rather than in adjacent rooms. Pets are welcome, on published terms.
            </p>
            <p className="mt-7 flex flex-wrap gap-x-6 gap-y-3 text-xs font-bold uppercase tracking-[.1em] text-primary">
              <a href={`${basePath}/`} className="underline decoration-accent decoration-2 underline-offset-4" data-testid="link-weekend-home">The villa in Shantiniketan</a>
              <a href={`${basePath}/homestay-near-sonajhuri-haat`} className="underline decoration-accent decoration-2 underline-offset-4" data-testid="link-weekend-sonajhuri">Staying near the haat</a>
              <a href={`${basePath}/homestay-near-visva-bharati`} className="underline decoration-accent decoration-2 underline-offset-4" data-testid="link-weekend-visva">Staying near the campus</a>
              <a href={`${basePath}/rates`} className="underline decoration-accent decoration-2 underline-offset-4" data-testid="link-weekend-rates2">Rates</a>
            </p>
          </div>
        </section>


        <section className="bg-primary py-20 text-primary-foreground md:py-28" aria-labelledby="weekend-cta">
          <div className="section-shell grid gap-10 lg:grid-cols-[1.1fr_.9fr] lg:items-end">
            <div>
              <p className="eyebrow mb-5 text-secondary">Enquire direct</p>
              <h2 id="weekend-cta" className="max-w-[560px] font-journal text-4xl leading-[.94] md:text-6xl">
                Book the house,<br /><em>then the train.</em>
              </h2>
              <p className="mt-7 max-w-[470px] text-lg leading-8 text-primary-foreground/70">
                Two bedrooms, a private garden and parking on the premises. Weekends go first, so dates are worth asking about early. Enquire direct &mdash; no platform fee, and the host confirms.
              </p>
              <p className="mt-5 flex flex-wrap gap-x-6 gap-y-3 text-xs font-bold uppercase tracking-[.1em]">
                <a href={`${basePath}/rates`} className="underline decoration-secondary decoration-2 underline-offset-4 hover:text-secondary" data-testid="link-weekend-rates">
                  Rates and tariff
                </a>
                <a href={`${basePath}/gallery`} className="underline decoration-secondary decoration-2 underline-offset-4 hover:text-secondary" data-testid="link-weekend-gallery">
                  See the villa
                </a>
                <a href={`${basePath}/pet-friendly-homestay-shantiniketan`} className="underline decoration-secondary decoration-2 underline-offset-4 hover:text-secondary" data-testid="link-weekend-pet">
                  Staying with a pet
                </a>
              </p>
            </div>
            <div className="flex flex-wrap gap-3 lg:justify-end">
              <a
                href={`${basePath}/#availability`}
                onClick={() => track('check_availability', { placement: 'weekend' })}
                className="flex items-center gap-2 rounded-full bg-secondary px-5 py-3 text-xs font-bold uppercase tracking-[.1em] text-primary transition-transform hover:-translate-y-0.5"
                data-testid="link-weekend-book"
              >
                Check availability <ArrowUpRight size={15} />
              </a>
              <a
                href={`https://wa.me/916290399165?text=${encodeURIComponent(
                  'Hello Raj Kuthir, we are planning a weekend in Shantiniketan from Kolkata and would like to enquire about a stay at Sobuj Potro.',
                )}`}
                target="_blank"
                rel="noreferrer"
                onClick={() => track('whatsapp_click', { placement: 'weekend' })}
                className="flex items-center gap-2 rounded-full border border-primary-foreground/25 px-5 py-3 text-xs font-bold uppercase tracking-[.1em] text-primary-foreground transition-colors hover:bg-primary-foreground/10"
                data-testid="link-weekend-whatsapp"
              >
                <MessageCircle size={15} /> WhatsApp
              </a>
              <a
                href={phoneHref(CONFIG.hostPhone)}
                className="flex items-center gap-2 rounded-full border border-primary-foreground/25 px-5 py-3 text-xs font-bold uppercase tracking-[.1em] text-primary-foreground transition-colors hover:bg-primary-foreground/10"
                data-testid="link-weekend-call"
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
