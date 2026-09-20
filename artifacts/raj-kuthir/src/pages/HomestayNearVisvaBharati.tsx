import { useEffect } from 'react';
import { ArrowLeft, ArrowUpRight, Leaf, MessageCircle, Phone } from 'lucide-react';

import { CONFIG, NEIGHBOURHOOD, basePath, phoneHref, track } from '@/lib/site';
import type { NeighbourhoodPlace } from '@/lib/site';

/**
 * A landing page for people whose reason for coming to Shantiniketan is the
 * university — a convocation, an admission, Poush Mela, or simply Rabindra
 * Bhavan — and who need somewhere to stay near it.
 *
 * Distinct from the places page, which is about what to see; this is about
 * where to sleep when the campus is the fixed point of the trip.
 *
 * Every distance is read from NEIGHBOURHOOD. No opening hours, ticket prices,
 * term dates or event dates appear anywhere on this page: the site has not
 * verified any of them, and a stale one would send a guest across town for
 * nothing.
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

export default function HomestayNearVisvaBharati() {
  useEffect(() => {
    const previous = document.title;
    document.title = 'Homestay near Visva-Bharati, Shantiniketan | Raj Kuthir';
    return () => {
      document.title = previous;
    };
  }, []);

  const campus = distanceTo('Visva-Bharati & Rabindra Bhavan');
  const srijani = distanceTo('Srijani Shilpagram');
  const amarKutir = distanceTo('Amar Kutir');
  const prantik = distanceTo('Prantik station');
  const bolpur = distanceTo('Bolpur Shantiniketan station');

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-foreground/10 bg-background/90 backdrop-blur-md">
        <div className="section-shell flex h-[74px] items-center justify-between gap-6">
          <a href={`${basePath}/`} className="flex shrink-0 items-center gap-3" data-testid="link-visva-bharati-brand">
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
            data-testid="link-visva-bharati-back"
          >
            <ArrowLeft size={15} /> Back to the stay
          </a>
        </div>
      </header>

      <nav aria-label="Breadcrumb" className="section-shell pt-8">
        <ol className="flex flex-wrap items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[.14em] text-muted-foreground">
          <li><a href={`${basePath}/`} className="hover:text-primary" data-testid="link-visva-bharati-crumb-home">Home</a></li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="text-primary">Near Visva-Bharati</li>
        </ol>
      </nav>

      <main>
        <section className="section-shell pb-14 pt-10 md:pb-20 md:pt-14" aria-labelledby="visva-bharati-title">
          <p className="eyebrow mb-5 text-accent">Near the Tagore campus</p>
          <h1 id="visva-bharati-title" className="max-w-[880px] font-journal text-[clamp(2.8rem,7vw,5.6rem)] leading-[.94] tracking-[-.035em] text-primary">
            Homestay near<br /><em>Visva-Bharati.</em>
          </h1>
          <p className="mt-8 max-w-[640px] text-lg leading-8 text-primary/75">
            Sobuj Potro is a private two-bedroom villa in Bolpur, about {campus}
            by road from Visva-Bharati and Rabindra Bhavan &mdash; close enough
            for a morning on the campus and an afternoon back at the house.
          </p>
          <p className="mt-4 max-w-[640px] text-sm leading-6 text-muted-foreground">
            The whole house is yours: two air-conditioned bedrooms, a private
            garden and parking on the premises.
          </p>
        </section>

        <section className="border-t border-border bg-card py-16 md:py-24" aria-labelledby="visva-campus">
          <div className="section-shell">
            <h2 id="visva-campus" className="max-w-[680px] font-journal text-4xl leading-[.95] text-primary md:text-5xl">
              The campus, and what<br /><em>sits around it.</em>
            </h2>
            <p className="mt-7 max-w-[640px] text-[15px] leading-7 text-muted-foreground md:text-[17px]">
              Visva-Bharati and Rabindra Bhavan &mdash; Tagore's university, and the museum in the houses he lived in &mdash; are about {campus} from the villa by road. Upasana Griha and Chhatimtala, the glass prayer hall and the place the school began, are about the same. So is Kala Bhavana, the art school. All of it is one short ride from the house rather than a day's planning.
            </p>
            <p className="mt-7 max-w-[640px] text-[15px] leading-7 text-muted-foreground md:text-[17px]">
              A little further out: Srijani Shilpagram at about {srijani}, and Amar Kutir, the Sriniketan co-operative known for leatherwork, batik and kantha, at about {amarKutir}.
            </p>
            <p className="mt-7 max-w-[640px] border-l-2 border-accent/40 pl-5 text-sm leading-6 text-muted-foreground">
              We do not publish campus opening hours, ticket prices or event dates here. They change, we have not verified them, and a guest sent across town on the strength of a stale web page is a worse outcome than a guest who asked. The caretaker can tell you what is open on the day you are here.
            </p>
          </div>
        </section>

        <section className="py-16 md:py-24" aria-labelledby="visva-house">
          <div className="section-shell">
            <h2 id="visva-house" className="max-w-[680px] font-journal text-4xl leading-[.95] text-primary md:text-5xl">
              Not a room.<br /><em>The whole villa.</em>
            </h2>
            <p className="mt-7 max-w-[640px] text-[15px] leading-7 text-muted-foreground md:text-[17px]">
              Two bedrooms, both air-conditioned, a private garden, and parking on the premises. There is a refrigerator, a microwave, a water filter and basic utensils with an induction setup; Cafe Soi is on the premises, home-cooked food can be arranged through the caretaker, and Zomato delivers to the area. For a family in town for a convocation, or two couples sharing, it means one house rather than adjacent hotel rooms.
            </p>
            <p className="mt-7 max-w-[640px] text-[15px] leading-7 text-muted-foreground md:text-[17px]">
              Pets are welcome, with the terms published rather than negotiated at the door.
            </p>
            <p className="mt-7 flex flex-wrap gap-x-6 gap-y-3 text-xs font-bold uppercase tracking-[.1em] text-primary">
              <a href={`${basePath}/`} className="underline decoration-accent decoration-2 underline-offset-4" data-testid="link-visva-bharati-home">The villa in Shantiniketan</a>
              <a href={`${basePath}/places-to-visit-in-shantiniketan`} className="underline decoration-accent decoration-2 underline-offset-4" data-testid="link-visva-bharati-places">Everything else nearby</a>
            </p>
          </div>
        </section>

        <section className="border-t border-border bg-card py-16 md:py-24" aria-labelledby="visva-arriving">
          <div className="section-shell">
            <h2 id="visva-arriving" className="max-w-[680px] font-journal text-4xl leading-[.95] text-primary md:text-5xl">
              Getting here<br /><em>for the campus.</em>
            </h2>
            <p className="mt-7 max-w-[640px] text-[15px] leading-7 text-muted-foreground md:text-[17px]">
              Prantik station is about {prantik} from the house and is the closer of the two, as well as the quieter. Bolpur Shantiniketan is about {bolpur} away and is where the fast trains stop &mdash; the Vande Bharat, the Darjeeling Mail, the Kanchanjunga Express.
            </p>
            <p className="mt-7 max-w-[640px] text-[15px] leading-7 text-muted-foreground md:text-[17px]">
              A toto handles anything close by, including the campus; the caretaker can arrange a car for the longer trips. If you have driven down, there is parking on the premises. Check-in is from 12:00 and check-out by 11:00.
            </p>
          </div>
        </section>


        <section className="bg-primary py-20 text-primary-foreground md:py-28" aria-labelledby="visva-bharati-cta">
          <div className="section-shell grid gap-10 lg:grid-cols-[1.1fr_.9fr] lg:items-end">
            <div>
              <p className="eyebrow mb-5 text-secondary">Enquire direct</p>
              <h2 id="visva-bharati-cta" className="max-w-[560px] font-journal text-4xl leading-[.94] md:text-6xl">
                A quiet house,<br /><em>a short ride from the campus.</em>
              </h2>
              <p className="mt-7 max-w-[470px] text-lg leading-8 text-primary-foreground/70">
                Two bedrooms, a private garden and parking on the premises in Bolpur. Enquire direct &mdash; no platform fee, and the host confirms your dates personally.
              </p>
              <p className="mt-5 flex flex-wrap gap-x-6 gap-y-3 text-xs font-bold uppercase tracking-[.1em]">
                <a href={`${basePath}/rates`} className="underline decoration-secondary decoration-2 underline-offset-4 hover:text-secondary" data-testid="link-visva-bharati-rates">
                  Rates and tariff
                </a>
                <a href={`${basePath}/gallery`} className="underline decoration-secondary decoration-2 underline-offset-4 hover:text-secondary" data-testid="link-visva-bharati-gallery">
                  See the villa
                </a>
                <a href={`${basePath}/pet-friendly-homestay-shantiniketan`} className="underline decoration-secondary decoration-2 underline-offset-4 hover:text-secondary" data-testid="link-visva-bharati-pet">
                  Staying with a pet
                </a>
              </p>
            </div>
            <div className="flex flex-wrap gap-3 lg:justify-end">
              <a
                href={`${basePath}/#availability`}
                onClick={() => track('check_availability', { placement: 'visva-bharati' })}
                className="flex items-center gap-2 rounded-full bg-secondary px-5 py-3 text-xs font-bold uppercase tracking-[.1em] text-primary transition-transform hover:-translate-y-0.5"
                data-testid="link-visva-bharati-book"
              >
                Check availability <ArrowUpRight size={15} />
              </a>
              <a
                href={`https://wa.me/916290399165?text=${encodeURIComponent(
                  'Hello Raj Kuthir, we are visiting Visva-Bharati in Shantiniketan and would like to enquire about a stay at Sobuj Potro.',
                )}`}
                target="_blank"
                rel="noreferrer"
                onClick={() => track('whatsapp_click', { placement: 'visva-bharati' })}
                className="flex items-center gap-2 rounded-full border border-primary-foreground/25 px-5 py-3 text-xs font-bold uppercase tracking-[.1em] text-primary-foreground transition-colors hover:bg-primary-foreground/10"
                data-testid="link-visva-bharati-whatsapp"
              >
                <MessageCircle size={15} /> WhatsApp
              </a>
              <a
                href={phoneHref(CONFIG.hostPhone)}
                className="flex items-center gap-2 rounded-full border border-primary-foreground/25 px-5 py-3 text-xs font-bold uppercase tracking-[.1em] text-primary-foreground transition-colors hover:bg-primary-foreground/10"
                data-testid="link-visva-bharati-call"
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
