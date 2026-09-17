import { useEffect } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  BedDouble,
  Car,
  HeartHandshake,
  Leaf,
  MessageCircle,
  PawPrint,
  Phone,
  Wifi,
} from 'lucide-react';

import { CONFIG, asset, basePath, phoneHref, track } from '@/lib/site';
import { ABOUT } from '@/content/about';

/**
 * The story of the house, on a page of its own.
 *
 * Two things moved here from the homepage: "The idea", which had been parked
 * in content/about.ts waiting for exactly this page, and "Room to be
 * together" — the section the hero's "Read the story" button used to jump to.
 * The homepage is shorter for it, and this page can be linked, shared and
 * found on its own.
 *
 * Everything here is already published elsewhere on the site. Nothing about
 * the owners, the history of the house or how long it has been let is
 * invented to fill the page out; when there is more to say, say it here.
 */

export default function OurStory() {
  useEffect(() => {
    const previous = document.title;
    document.title = 'Our Story | Raj Kuthir Homestays, Shantiniketan';
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-foreground/10 bg-background/90 backdrop-blur-md">
        <div className="section-shell flex h-[74px] items-center justify-between gap-6">
          <a href={`${basePath}/`} className="flex shrink-0 items-center gap-3" data-testid="link-story-brand">
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
            data-testid="link-story-back"
          >
            <ArrowLeft size={15} /> Back to the stay
          </a>
        </div>
      </header>

      {/* Breadcrumb, matching the BreadcrumbList the server emits. */}
      <nav aria-label="Breadcrumb" className="section-shell pt-8">
        <ol className="flex flex-wrap items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[.14em] text-muted-foreground">
          <li><a href={`${basePath}/`} className="hover:text-primary" data-testid="link-story-crumb-home">Home</a></li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="text-primary">Our story</li>
        </ol>
      </nav>

      <main>
        {/* ---------------------------------------------------------- hero */}
        <section className="section-shell pb-16 pt-10 md:pb-24 md:pt-14" aria-labelledby="story-title">
          <p className="eyebrow mb-5 text-accent">{ABOUT.eyebrow}</p>
          <h1 id="story-title" className="max-w-[820px] font-journal text-[clamp(3rem,7.5vw,6rem)] leading-[.92] tracking-[-.035em] text-primary">
            {ABOUT.heading[0]}<br /><em>{ABOUT.heading[1]}</em>
          </h1>
          <div className="mt-10 grid gap-10 lg:grid-cols-[1.15fr_.85fr] lg:gap-20">
            <p className="text-xl leading-8 text-primary md:text-2xl md:leading-9">{ABOUT.lede}</p>
            <div className="grid gap-7 self-end border-t border-border pt-7 sm:grid-cols-2 lg:border-t-0 lg:pt-0">
              {ABOUT.points.map((point, index) => (
                <div key={point}>
                  <p className="font-journal text-3xl text-accent">{String(index + 1).padStart(2, '0')}</p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{point}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------- the house
            "Room to be together", lifted from the homepage unchanged — the
            same words, the same photograph, now somewhere a visitor arrives
            deliberately rather than scrolls past. */}
        <section id="the-house" className="scroll-mt-24 bg-primary py-24 text-primary-foreground md:py-32" aria-labelledby="house-title">
          <div className="section-shell">
            <div className="flex flex-col justify-between gap-8 md:flex-row md:items-end">
              <div>
                <p className="eyebrow mb-5 text-secondary">The stay</p>
                <h2 id="house-title" className="max-w-[570px] font-journal text-5xl leading-[.94] md:text-7xl">Room to be<br /><em>together.</em></h2>
              </div>
              <p className="max-w-[300px] text-sm leading-6 text-primary-foreground/70">
                The whole two-bedroom villa is yours. Unpack once, then let the days open up.
              </p>
            </div>
            <div className="mt-14 grid gap-5 md:grid-cols-[1.15fr_.85fr]">
              <img
                src={asset('Bedroom.jpg')}
                alt="A bedroom at Sobuj Potro, Raj Kuthir Homestays, Bolpur"
                width={896}
                height={1195}
                loading="lazy"
                decoding="async"
                className="min-h-[385px] w-full rounded-[1.5rem] object-cover md:min-h-[490px]"
              />
              <div className="grid gap-5 sm:grid-cols-2 md:grid-cols-1">
                <div className="rounded-[1.5rem] border border-primary-foreground/15 bg-primary-foreground/10 p-7">
                  <BedDouble size={25} className="mb-12 text-secondary" strokeWidth={1.4} />
                  <p className="font-journal text-3xl">Two bedrooms.<br />One private home.</p>
                  <p className="mt-4 text-sm leading-6 text-primary-foreground/65">
                    A stay that gives couples and families the freedom to share a table, or not.
                  </p>
                </div>
                <div className="rounded-[1.5rem] bg-secondary p-7 text-primary">
                  <Leaf size={25} className="mb-12 text-primary" strokeWidth={1.4} />
                  <p className="font-journal text-3xl">Your own garden.</p>
                  <p className="mt-4 text-sm leading-6 text-primary/70">
                    A little outdoor space for first tea, last light and paws in the grass.
                  </p>
                </div>
              </div>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {[
                { icon: Car, text: 'On-premise parking' },
                { icon: Wifi, text: 'Wi-Fi' },
                { icon: HeartHandshake, text: 'Warm local care' },
              ].map(({ icon: Icon, text }) => (
                <div key={text} className="flex items-center gap-3 border-t border-primary-foreground/15 py-4 text-sm text-primary-foreground/80">
                  <Icon size={17} className="text-secondary" strokeWidth={1.5} />
                  {text}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------ the place */}
        <section className="section-shell py-24 md:py-32" aria-labelledby="place-title">
          <div className="grid gap-12 lg:grid-cols-[.8fr_1.2fr] lg:gap-20">
            <div>
              <p className="eyebrow mb-5 text-accent">Where it is</p>
              <h2 id="place-title" className="font-journal text-5xl leading-[.94] text-primary md:text-6xl">A house in<br /><em>Shantiniketan.</em></h2>
            </div>
            <div className="max-w-[620px] space-y-6 text-base leading-7 text-muted-foreground">
              <p>
                Raj Kuthir Homestays is in Bolpur, on the edge of Shantiniketan
                in West Bengal — close enough to Visva-Bharati and the Tagore
                campus for a morning visit, far enough out that the evenings
                belong to you. The chapter here is called Sobuj Potro.
              </p>
              <p>
                It is an entire two-bedroom villa with its own garden, not a
                room in someone else&rsquo;s house. There is parking on the
                premises, Wi-Fi, a kitchen you are welcome to use, and Cafe Soi
                on site for the evenings nobody feels like cooking. Pets are
                written into the house rules rather than negotiated at the
                door. If you want to{' '}
                <a href={`${basePath}/pet-friendly-homestay-shantiniketan`} className="text-primary underline decoration-accent decoration-1 underline-offset-2 hover:text-accent" data-testid="link-story-pet-inline">
                  stay with your pet in Shantiniketan
                </a>
                , the details are on a page of their own.
              </p>
              <p>
                A caretaker looks after arrivals, meals that need arranging,
                and the car for a day out. Enquiries come
                straight to the owner &mdash; there is no front desk and no
                agent in between.
              </p>
              <div className="flex flex-wrap gap-3 pt-2">
                <a href={`${basePath}/gallery`} className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[.1em] text-primary underline decoration-accent decoration-2 underline-offset-4" data-testid="link-story-gallery">
                  See the photographs <ArrowUpRight size={14} />
                </a>
                <a href={`${basePath}/pet-friendly-homestay-shantiniketan`} className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[.1em] text-primary underline decoration-accent decoration-2 underline-offset-4" data-testid="link-story-pet">
                  <PawPrint size={14} /> Staying here with a pet
                </a>
                <a href={`${basePath}/house-rules`} className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[.1em] text-primary underline decoration-accent decoration-2 underline-offset-4" data-testid="link-story-rules">
                  Read the house rules <ArrowUpRight size={14} />
                </a>
                <a href={`${basePath}/rates`} className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[.1em] text-primary underline decoration-accent decoration-2 underline-offset-4" data-testid="link-story-rates">
                  See the rates <ArrowUpRight size={14} />
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------- closing */}
        <section className="border-t border-border bg-card py-20 md:py-28" aria-labelledby="story-cta">
          <div className="section-shell grid gap-10 lg:grid-cols-[1.1fr_.9fr] lg:items-end">
            <div>
              <p className="eyebrow mb-5 text-accent">When you are ready</p>
              <h2 id="story-cta" className="max-w-[540px] font-journal text-4xl leading-[.94] text-primary md:text-6xl">
                Come and see<br /><em>for yourselves.</em>
              </h2>
              <p className="mt-7 max-w-[460px] text-base leading-7 text-muted-foreground">
                Tell us your dates and who is coming, and the host will confirm
                availability directly. No payment is taken on this site.
              </p>
            </div>
            <div className="flex flex-wrap gap-3 lg:justify-end">
              <a
                href={`${basePath}/#booking`}
                onClick={() => track('check_availability', { placement: 'our_story' })}
                className="flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-xs font-bold uppercase tracking-[.1em] text-primary-foreground transition-transform hover:-translate-y-0.5"
                data-testid="link-story-book"
              >
                Check availability <ArrowUpRight size={15} />
              </a>
              <a
                href={`https://wa.me/916290399165?text=${encodeURIComponent(
                  'Hello Raj Kuthir, I have been reading about Sobuj Potro and would like to enquire about a stay.',
                )}`}
                target="_blank"
                rel="noreferrer"
                onClick={() => track('whatsapp_click', { placement: 'our_story' })}
                className="flex items-center gap-2 rounded-full border border-border px-5 py-3 text-xs font-bold uppercase tracking-[.1em] text-primary transition-colors hover:border-primary"
                data-testid="link-story-whatsapp"
              >
                <MessageCircle size={15} /> WhatsApp
              </a>
              <a
                href={phoneHref(CONFIG.hostPhone)}
                className="flex items-center gap-2 rounded-full border border-border px-5 py-3 text-xs font-bold uppercase tracking-[.1em] text-primary transition-colors hover:border-primary"
                data-testid="link-story-call"
              >
                <Phone size={15} /> {CONFIG.hostPhone}
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
            <a href={`${basePath}/rates`} className="hover:text-[#e4c9a4]">Rates</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
