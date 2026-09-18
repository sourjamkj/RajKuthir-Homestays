import { useEffect } from 'react';
import { ArrowLeft, ArrowUpRight, Leaf, MessageCircle, Phone } from 'lucide-react';

import { CONFIG, NEIGHBOURHOOD, basePath, phoneHref, track } from '@/lib/site';

/**
 * The hour-by-hour companion to /shantiniketan-weekend-trip-from-kolkata.
 *
 * That page is logistics — trains, distances, which days matter. This one is
 * the plan itself, and the two link to each other rather than each carrying
 * half of both.
 *
 * The itinerary is built from facts the site already publishes: the road
 * distances in NEIGHBOURHOOD, the haat's Saturday/Sunday-from-2pm window, the
 * sanctuary being best early, and the house's own 12:00 check-in and 11:00
 * check-out. No opening hour, ticket price, meal time or journey duration is
 * invented to fill a slot — where the site does not know, the page says so.
 */

/**
 * Road distances are never typed here. They are looked up by title from
 * NEIGHBOURHOOD in lib/site.ts, the same list the homepage teaser and the
 * places page read, so a correction in one place corrects every page at once
 * and this landing can never quietly disagree with the rest of the site about
 * how far away something is.
 */
const distanceTo = (title: string) =>
  NEIGHBOURHOOD.flatMap((group) => group.places).find((place) => place.title === title)
    ?.distance ?? null;

export default function TwoDayItinerary() {
  useEffect(() => {
    const previous = document.title;
    document.title = '2-Day Shantiniketan Itinerary | Raj Kuthir Homestays';
    return () => {
      document.title = previous;
    };
  }, []);

  const haat = distanceTo('Sonajhuri Khoai Haat');
  const kopai = distanceTo('Kopai River');
  const campus = distanceTo('Visva-Bharati & Rabindra Bhavan');
  const ballavpur = distanceTo('Ballavpur Wildlife Sanctuary');
  const srijani = distanceTo('Srijani Shilpagram');
  const amarKutir = distanceTo('Amar Kutir');
  const kankalitala = distanceTo('Kankalitala');

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-foreground/10 bg-background/90 backdrop-blur-md">
        <div className="section-shell flex h-[74px] items-center justify-between gap-6">
          <a href={`${basePath}/`} className="flex shrink-0 items-center gap-3" data-testid="link-itinerary-brand">
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
            data-testid="link-itinerary-back"
          >
            <ArrowLeft size={15} /> Back to the stay
          </a>
        </div>
      </header>

      <nav aria-label="Breadcrumb" className="section-shell pt-8">
        <ol className="flex flex-wrap items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[.14em] text-muted-foreground">
          <li><a href={`${basePath}/`} className="hover:text-primary" data-testid="link-itinerary-crumb-home">Home</a></li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="text-primary">2-day itinerary</li>
        </ol>
      </nav>

      <main>
        <section className="section-shell pb-14 pt-10 md:pb-20 md:pt-14" aria-labelledby="itinerary-title">
          <p className="eyebrow mb-5 text-accent">Day one, day two</p>
          <h1 id="itinerary-title" className="max-w-[880px] font-journal text-[clamp(2.8rem,7vw,5.6rem)] leading-[.94] tracking-[-.035em] text-primary">
            A 2-day itinerary<br /><em>for Shantiniketan.</em>
          </h1>
          <p className="mt-8 max-w-[640px] text-lg leading-8 text-primary/75">
            Two days is enough for Shantiniketan if you do not try to do all of
            it. This plan puts the market on the first afternoon and the campus
            on the second morning, because that is the order the place itself
            suggests.
          </p>
          <p className="mt-4 max-w-[640px] text-sm leading-6 text-muted-foreground">
            Every distance is by road from Sobuj Potro in Bolpur. Times of day
            are suggestions; the only fixed points are the haat&rsquo;s
            afternoon and our 12:00 check-in and 11:00 check-out.
          </p>
        </section>

        <section className="border-t border-border bg-card py-16 md:py-24" aria-labelledby="itinerary-day-one">
          <div className="section-shell">
            <h2 id="itinerary-day-one" className="max-w-[680px] font-journal text-4xl leading-[.95] text-primary md:text-5xl">
              Day one:<br /><em>the market afternoon.</em>
            </h2>
            <p className="mt-7 max-w-[640px] text-[15px] leading-7 text-muted-foreground md:text-[17px]">
              <strong className="font-bold text-primary">Before noon &mdash; arrive.</strong> Check-in at Sobuj Potro is from 12:00. If you have come by train, Prantik is the closer station and a toto from there takes about fifteen minutes; if you have driven, there is parking on the premises. Drop the bags, then go straight out &mdash; the afternoon is the part of day one that is time-bound.
            </p>
            <p className="mt-7 max-w-[640px] text-[15px] leading-7 text-muted-foreground md:text-[17px]">
              <strong className="font-bold text-primary">From about 2pm &mdash; Sonajhuri Khoai Haat.</strong> The forest market in the khoai, about {haat} away, runs on Saturdays and often Sundays too, from around 2pm. A toto will take you and wait, which is easier than parking at the edge of the forest. What is on sale changes with the season; the caretaker knows this week's version.
            </p>
            <p className="mt-7 max-w-[640px] text-[15px] leading-7 text-muted-foreground md:text-[17px]">
              <strong className="font-bold text-primary">Late afternoon &mdash; the Kopai.</strong> About {kopai} away and in the same direction as the haat, so it costs almost nothing to add. This is the &lsquo;amader chhoto nodi&rsquo; of the poem.
            </p>
            <p className="mt-7 max-w-[640px] text-[15px] leading-7 text-muted-foreground md:text-[17px]">
              <strong className="font-bold text-primary">Evening &mdash; back at the house.</strong> Cafe Soi is on the premises. The villa has a refrigerator, microwave, water filter and an induction setup with basic utensils; home-cooked food can be arranged through the caretaker, and Zomato delivers to the area. Nobody has to go out again.
            </p>
            <p className="mt-7 max-w-[640px] border-l-2 border-accent/40 pl-5 text-sm leading-6 text-muted-foreground">
              If your first day is not a Saturday or Sunday, the haat may not be running. Swap day one and day two rather than turning up hopefully &mdash; the campus does not keep market hours.
            </p>
          </div>
        </section>

        <section className="py-16 md:py-24" aria-labelledby="itinerary-day-two">
          <div className="section-shell">
            <h2 id="itinerary-day-two" className="max-w-[680px] font-journal text-4xl leading-[.95] text-primary md:text-5xl">
              Day two:<br /><em>the campus morning.</em>
            </h2>
            <p className="mt-7 max-w-[640px] text-[15px] leading-7 text-muted-foreground md:text-[17px]">
              <strong className="font-bold text-primary">Early &mdash; Ballavpur, if you want it.</strong> The wildlife sanctuary is about {ballavpur} away and is best early in the morning, for the deer and the birds. It is the one thing on this list that genuinely rewards getting up, and it has to come before the campus rather than after.
            </p>
            <p className="mt-7 max-w-[640px] text-[15px] leading-7 text-muted-foreground md:text-[17px]">
              <strong className="font-bold text-primary">Mid-morning &mdash; the Tagore campus.</strong> Visva-Bharati and Rabindra Bhavan are about {campus} from the house; Upasana Griha and Chhatimtala, the glass prayer hall and the place the school began, about the same; Kala Bhavana, the art school, likewise. All three sit close enough together to be one outing rather than three. Confirm what is open on the day &mdash; we do not publish campus hours or ticket prices, because we have not verified them.
            </p>
            <p className="mt-7 max-w-[640px] text-[15px] leading-7 text-muted-foreground md:text-[17px]">
              <strong className="font-bold text-primary">Before 11:00 &mdash; check out.</strong> Check-out is 11:00, so on a strict two-day trip the campus morning either happens before it or after it with the bags in the car. Ask the caretaker; it is the kind of thing that is easier arranged than assumed.
            </p>
            <p className="mt-7 max-w-[640px] text-[15px] leading-7 text-muted-foreground md:text-[17px]">
              <strong className="font-bold text-primary">If you have the afternoon &mdash; crafts, or a temple.</strong> Srijani Shilpagram is about {srijani} away, Amar Kutir &mdash; the Sriniketan co-operative known for leatherwork, batik and kantha &mdash; about {amarKutir}. Kankalitala, one of the 51 Shakta piths, sits on the bank of the Kopai about {kankalitala} away.
            </p>
          </div>
        </section>

        <section className="border-t border-border bg-card py-16 md:py-24" aria-labelledby="itinerary-stay">
          <div className="section-shell">
            <h2 id="itinerary-stay" className="max-w-[680px] font-journal text-4xl leading-[.95] text-primary md:text-5xl">
              Where the two days<br /><em>begin and end.</em>
            </h2>
            <p className="mt-7 max-w-[640px] text-[15px] leading-7 text-muted-foreground md:text-[17px]">
              The plan above assumes one base you come back to rather than a check-in on each day, which is why it can put the market in one afternoon and the campus in the next morning without losing half of either to logistics. Sobuj Potro is a private two-bedroom villa in Bolpur: the whole house, two air-conditioned bedrooms, a private garden, parking on the premises, and pets welcome on published terms.
            </p>
            <p className="mt-7 flex flex-wrap gap-x-6 gap-y-3 text-xs font-bold uppercase tracking-[.1em] text-primary">
              <a href={`${basePath}/shantiniketan-weekend-trip-from-kolkata`} className="underline decoration-accent decoration-2 underline-offset-4" data-testid="link-itinerary-weekend">Getting here from Kolkata</a>
              <a href={`${basePath}/places-to-visit-in-shantiniketan`} className="underline decoration-accent decoration-2 underline-offset-4" data-testid="link-itinerary-places">All eighteen places, with distances</a>
              <a href={`${basePath}/homestay-near-visva-bharati`} className="underline decoration-accent decoration-2 underline-offset-4" data-testid="link-itinerary-visva">Staying near the campus</a>
              <a href={`${basePath}/rates`} className="underline decoration-accent decoration-2 underline-offset-4" data-testid="link-itinerary-rates2">Rates</a>
            </p>
          </div>
        </section>


        <section className="bg-primary py-20 text-primary-foreground md:py-28" aria-labelledby="itinerary-cta">
          <div className="section-shell grid gap-10 lg:grid-cols-[1.1fr_.9fr] lg:items-end">
            <div>
              <p className="eyebrow mb-5 text-secondary">Enquire direct</p>
              <h2 id="itinerary-cta" className="max-w-[560px] font-journal text-4xl leading-[.94] md:text-6xl">
                The plan needs<br /><em>somewhere to start.</em>
              </h2>
              <p className="mt-7 max-w-[470px] text-lg leading-8 text-primary-foreground/70">
                Sobuj Potro is a private two-bedroom villa in Bolpur with a garden and parking on the premises &mdash; five minutes of the plan above, and the rest of it is yours. Enquire direct.
              </p>
              <p className="mt-5 flex flex-wrap gap-x-6 gap-y-3 text-xs font-bold uppercase tracking-[.1em]">
                <a href={`${basePath}/rates`} className="underline decoration-secondary decoration-2 underline-offset-4 hover:text-secondary" data-testid="link-itinerary-rates">
                  Rates and tariff
                </a>
                <a href={`${basePath}/gallery`} className="underline decoration-secondary decoration-2 underline-offset-4 hover:text-secondary" data-testid="link-itinerary-gallery">
                  See the villa
                </a>
                <a href={`${basePath}/pet-friendly-homestay-shantiniketan`} className="underline decoration-secondary decoration-2 underline-offset-4 hover:text-secondary" data-testid="link-itinerary-pet">
                  Staying with a pet
                </a>
              </p>
            </div>
            <div className="flex flex-wrap gap-3 lg:justify-end">
              <a
                href={`${basePath}/#availability`}
                onClick={() => track('check_availability', { placement: 'itinerary' })}
                className="flex items-center gap-2 rounded-full bg-secondary px-5 py-3 text-xs font-bold uppercase tracking-[.1em] text-primary transition-transform hover:-translate-y-0.5"
                data-testid="link-itinerary-book"
              >
                Check availability <ArrowUpRight size={15} />
              </a>
              <a
                href={`https://wa.me/916290399165?text=${encodeURIComponent(
                  'Hello Raj Kuthir, we are planning two days in Shantiniketan and would like to enquire about a stay at Sobuj Potro.',
                )}`}
                target="_blank"
                rel="noreferrer"
                onClick={() => track('whatsapp_click', { placement: 'itinerary' })}
                className="flex items-center gap-2 rounded-full border border-primary-foreground/25 px-5 py-3 text-xs font-bold uppercase tracking-[.1em] text-primary-foreground transition-colors hover:bg-primary-foreground/10"
                data-testid="link-itinerary-whatsapp"
              >
                <MessageCircle size={15} /> WhatsApp
              </a>
              <a
                href={phoneHref(CONFIG.hostPhone)}
                className="flex items-center gap-2 rounded-full border border-primary-foreground/25 px-5 py-3 text-xs font-bold uppercase tracking-[.1em] text-primary-foreground transition-colors hover:bg-primary-foreground/10"
                data-testid="link-itinerary-call"
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
