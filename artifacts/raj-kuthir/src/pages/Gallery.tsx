import { useEffect, useRef } from 'react';
import { ArrowLeft, ArrowUpRight, ChevronLeft, ChevronRight, Leaf, MessageCircle } from 'lucide-react';

import { asset, basePath, track } from '@/lib/site';

/**
 * The photographs, on a page of their own.
 *
 * This used to be a filtered strip inside the homepage. Two problems with
 * that: the filter meant only one category was ever in the DOM, so a crawler
 * and Google Images saw a third of the pictures; and the images were roughly
 * a megabyte of the homepage's weight, paid for by every visitor whether or
 * not they scrolled that far.
 *
 * Here everything is rendered, grouped rather than filtered, so all twelve
 * photographs are in the markup at once. Only the first two load eagerly —
 * the rest wait until they are near the viewport.
 *
 * Each group is a carousel rather than a grid, which is what keeps the page
 * to a couple of screens instead of six. It is deliberately built on native
 * horizontal scrolling with CSS snap points, not a slider library: every
 * photograph stays in the DOM and in the markup a crawler reads, it swipes on
 * a phone without any JavaScript at all, and the arrows are a convenience on
 * top rather than the only way through. A slider that mounts one slide at a
 * time would hide eleven of the twelve from Google Images.
 *
 * Every `width`/`height` below is measured from the file in public/, not
 * guessed. The browser uses them to reserve the right space before the image
 * arrives, which is what keeps this page's layout shift at zero.
 */

export type Photo = {
  file: string;
  title: string;
  alt: string;
  width: number;
  height: number;
};

const HOUSE: Photo[] = [
  {
    file: 'External%20Villa%20Morning.jpg',
    title: 'The villa, morning',
    alt: 'The two-bedroom villa at Raj Kuthir Homestays, Bolpur, seen from the garden on a clear morning',
    width: 1448,
    height: 1086,
  },
  {
    file: 'villa-night.jpg',
    title: 'Evening lights',
    alt: 'Raj Kuthir Homestays, Sobuj Potro, lit up after sundown',
    width: 1600,
    height: 900,
  },
  {
    file: 'Bedroom.jpg',
    title: 'The bedroom',
    alt: 'A bedroom at Sobuj Potro, Raj Kuthir Homestays, Bolpur',
    width: 896,
    height: 1195,
  },
  {
    file: 'interior-bedroom.jpg',
    title: 'Bedroom, evening',
    alt: 'The second bedroom at Sobuj Potro in the evening',
    width: 847,
    height: 557,
  },
  {
    file: 'interior-living.jpg',
    title: 'The living room',
    alt: 'The living room at Sobuj Potro, Raj Kuthir Homestays',
    width: 598,
    height: 453,
  },
];

const OUTSIDE: Photo[] = [
  {
    file: 'villa-day.jpg',
    title: 'Under open sky',
    alt: 'The villa and its garden at Raj Kuthir Homestays in daylight',
    width: 1536,
    height: 1024,
  },
  {
    file: 'Rabiguru%20Statue.jpg',
    title: 'Rabindranath, in bronze',
    alt: 'A statue of Rabindranath Tagore near Raj Kuthir Homestays, Shantiniketan',
    width: 1254,
    height: 1254,
  },
  {
    file: 'Pet%20View.jpg',
    title: 'Someone else settling in',
    alt: 'A dog at Raj Kuthir Homestays, where pets are welcome',
    width: 1023,
    height: 1537,
  },
];

const DETAILS: Photo[] = [
  {
    file: 'interior-entrance.jpg',
    title: 'The entrance',
    alt: 'The entrance to Sobuj Potro at Raj Kuthir Homestays',
    width: 501,
    height: 453,
  },
  {
    file: 'interior-kitchen.jpg',
    title: 'The kitchen',
    alt: 'The kitchen at Sobuj Potro, with induction hob, microwave and refrigerator',
    width: 677,
    height: 557,
  },
  {
    file: 'Dining%20Space.jpg',
    title: 'Dining space',
    alt: 'The dining space at Sobuj Potro, Raj Kuthir Homestays',
    width: 1024,
    height: 1536,
  },
  {
    file: 'interior-dining.jpg',
    title: 'Set for dinner',
    alt: 'The dining table laid at Sobuj Potro, Raj Kuthir Homestays',
    width: 416,
    height: 453,
  },
];

type Group = {
  id: string;
  eyebrow: string;
  heading: string;
  lede: string;
  photos: Photo[];
};

/**
 * The groups carry the page's actual writing. A wall of pictures with no words
 * ranks for nothing and tells a guest nothing they could not guess; the lede
 * on each group is the part that says what they are looking at.
 */
const GROUPS: Group[] = [
  {
    id: 'the-house',
    eyebrow: 'Inside',
    heading: 'The house\nitself.',
    lede: 'Two bedrooms, a living room and the whole place to yourselves — there is no shared lobby, no other party in the next room, and no front desk to pass on your way out.',
    photos: HOUSE,
  },
  {
    id: 'outside',
    eyebrow: 'Outside',
    heading: 'The garden,\nand around.',
    lede: 'The garden is yours for the length of the stay, and Shantiniketan starts at the gate. Pets are welcome here in writing, not as a favour asked at the door.',
    photos: OUTSIDE,
  },
  {
    id: 'the-details',
    eyebrow: 'The details',
    heading: 'The small\nthings.',
    lede: 'A kitchen with an induction hob, microwave, refrigerator and water filter, and a table big enough to sit around. Home-cooked meals can be arranged through the caretaker, and Cafe Soi is on the premises.',
    photos: DETAILS,
  },
];

/** Flat list, in page order. */
export const GALLERY: Photo[] = GROUPS.flatMap((group) => group.photos);

/**
 * The two the homepage shows.
 *
 * Two rather than a row of four: the homepage is a path to an enquiry, not a
 * contact sheet, and two large frames read better than four small ones. One
 * outside, one in — enough to say what kind of house this is, and to make
 * "view all" worth clicking. Defined here so the homepage can never drift out
 * of step with the gallery it links to.
 */
export const GALLERY_TEASER: Photo[] = ['The villa, morning', 'The bedroom']
  .map((title) => GALLERY.find((photo) => photo.title === title))
  .filter((photo): photo is Photo => Boolean(photo));


/**
 * One group's photographs, as a swipeable rail.
 *
 * `scroll-snap` does the work. The arrows nudge by most of the visible width
 * rather than exactly one card, so a partially visible photograph at the edge
 * is a hint that there is more, not a thing that gets skipped.
 */
function PhotoRail({ photos, label, startEager }: { photos: Photo[]; label: string; startEager: boolean }) {
  const rail = useRef<HTMLDivElement>(null);

  const nudge = (direction: 1 | -1) => {
    const el = rail.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.82, behavior: 'smooth' });
  };

  return (
    <div className="relative mt-8">
      <div
        ref={rail}
        role="region"
        aria-label={label}
        tabIndex={0}
        className="flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth pb-3 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {photos.map((photo, index) => (
          <figure
            key={photo.file}
            className="group relative m-0 aspect-[4/3] w-[82%] shrink-0 snap-start overflow-hidden rounded-[1.4rem] sm:w-[52%] lg:w-[38%]"
            data-testid={`gallery-photo-${photo.file.split('.')[0]!.toLowerCase().replace(/%20|\s/g, '-')}`}
          >
            <img
              src={asset(photo.file)}
              alt={photo.alt}
              width={photo.width}
              height={photo.height}
              loading={startEager && index === 0 ? 'eager' : 'lazy'}
              decoding="async"
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />
            <figcaption className="absolute inset-x-0 bottom-0 p-4">
              <p className="font-journal text-2xl leading-none text-white">{photo.title}</p>
            </figcaption>
          </figure>
        ))}
      </div>

      <button
        type="button"
        onClick={() => nudge(-1)}
        aria-label={`Scroll ${label} back`}
        className="absolute -left-2 top-1/2 hidden h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-border bg-background/95 text-primary shadow-lg backdrop-blur transition-colors hover:border-primary sm:grid"
      >
        <ChevronLeft size={18} />
      </button>
      <button
        type="button"
        onClick={() => nudge(1)}
        aria-label={`Scroll ${label} forward`}
        className="absolute -right-2 top-1/2 hidden h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-border bg-background/95 text-primary shadow-lg backdrop-blur transition-colors hover:border-primary sm:grid"
      >
        <ChevronRight size={18} />
      </button>
    </div>
  );
}

export default function Gallery() {
  useEffect(() => {
    const previous = document.title;
    // Must match the server-rendered <title> in api-server/src/lib/seo.ts.
    document.title = 'Raj Kuthir Homestays Gallery | Shantiniketan Villa';
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-foreground/10 bg-background/90 backdrop-blur-md">
        <div className="section-shell flex h-[74px] items-center justify-between gap-6">
          <a href={`${basePath}/`} className="flex shrink-0 items-center gap-3" data-testid="link-gallery-brand">
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
            data-testid="link-gallery-back"
          >
            <ArrowLeft size={15} /> Back to the stay
          </a>
        </div>
      </header>

      {/* Breadcrumb, matching the BreadcrumbList the server emits. */}
      <nav aria-label="Breadcrumb" className="section-shell pt-7">
        <ol className="flex flex-wrap items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[.14em] text-muted-foreground">
          <li><a href={`${basePath}/`} className="hover:text-primary" data-testid="link-gallery-crumb-home">Home</a></li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="text-primary">Photos</li>
        </ol>
      </nav>

      <main>
        {/* ---------------------------------------------------------- hero */}
        <section className="section-shell pb-4 pt-8 md:pb-6 md:pt-10" aria-labelledby="gallery-hero">
          <p className="eyebrow mb-4 text-accent">A visual diary</p>
          <h1 id="gallery-hero" className="max-w-[760px] font-journal text-[clamp(2.6rem,6vw,4.6rem)] leading-[.94] tracking-[-.035em] text-primary">
            A look <em>around home.</em>
          </h1>
          <p className="mt-5 max-w-[620px] text-base leading-7 text-muted-foreground">
            {GALLERY.length} photographs of Sobuj Potro &mdash; the rooms as they
            are, the garden, and the short walk into Shantiniketan. Swipe each
            row. Nothing here is a stock picture of somewhere else.
          </p>
          <p className="mt-3 max-w-[620px] text-sm leading-6 text-muted-foreground">
            Bringing a dog? Read about{' '}
            <a href={`${basePath}/pet-friendly-homestay-shantiniketan`} className="text-primary underline decoration-accent decoration-2 underline-offset-4" data-testid="link-gallery-pet">
              our pet-friendly villa
            </a>
            , or see the{' '}
            <a href={`${basePath}/rates`} className="text-primary underline decoration-accent decoration-2 underline-offset-4" data-testid="link-gallery-rates">
              current rates
            </a>
            .
          </p>
        </section>

        {/* -------------------------------------------------------- rails */}
        {GROUPS.map((group, groupIndex) => (
          <section
            key={group.id}
            id={group.id}
            className={`scroll-mt-24 py-10 md:py-14 ${groupIndex % 2 === 1 ? 'border-y border-border bg-card' : ''}`}
            aria-labelledby={`${group.id}-title`}
          >
            <div className="section-shell">
              <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                  <p className="eyebrow mb-3 text-accent">{group.eyebrow}</p>
                  <h2
                    id={`${group.id}-title`}
                    className="font-journal text-3xl leading-tight text-primary md:text-4xl"
                  >
                    {group.heading.replace('\n', ' ')}
                  </h2>
                </div>
                <p className="max-w-[540px] text-sm leading-6 text-muted-foreground">{group.lede}</p>
              </div>

              <PhotoRail
                photos={group.photos}
                label={group.eyebrow}
                startEager={groupIndex === 0}
              />
            </div>
          </section>
        ))}
      </main>

      {/* The page's actions, floating rather than parked in a band at the
          bottom. The point of a gallery is to look; the moment someone is
          ready to ask, the button is already under their thumb. */}
      <div className="fixed bottom-4 right-3 z-40 flex flex-col items-end gap-2 md:bottom-6 md:right-6">
        <a
          href={`${basePath}/#booking`}
          onClick={() => track('check_availability', { placement: 'gallery_floating' })}
          className="flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-primary-foreground shadow-xl ring-1 ring-secondary/25 transition-transform hover:-translate-y-0.5 active:scale-95 md:gap-3 md:px-5 md:py-4"
          data-testid="link-gallery-floating-book"
        >
          <span className="text-[11px] font-bold uppercase tracking-[.1em]">Check availability</span>
          <ArrowUpRight size={16} className="shrink-0" />
        </a>
        <a
          href={`https://wa.me/916290399165?text=${encodeURIComponent(
            'Hello Raj Kuthir, I have been looking at the photos of Sobuj Potro and would like to enquire about a stay.',
          )}`}
          target="_blank"
          rel="noreferrer"
          onClick={() => track('whatsapp_click', { placement: 'gallery_floating' })}
          className="flex items-center gap-2 rounded-full bg-secondary px-4 py-3 text-primary shadow-xl ring-1 ring-primary/15 transition-transform hover:-translate-y-0.5 active:scale-95 md:gap-3 md:px-5 md:py-4"
          data-testid="link-gallery-whatsapp"
        >
          <MessageCircle size={16} className="shrink-0" />
          <span className="text-[11px] font-bold uppercase tracking-[.1em]">WhatsApp</span>
        </a>
      </div>

      <footer className="bg-[#172d25] py-12 pb-24 text-[#f5eadb] md:pb-12">
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
            <a href={`${basePath}/places-to-visit-in-shantiniketan`} className="hover:text-[#e4c9a4]">Places to visit</a>
            <a href={`${basePath}/our-story`} className="hover:text-[#e4c9a4]">Our story</a>
            <a href={`${basePath}/house-rules`} className="hover:text-[#e4c9a4]">House rules</a>
            <a href={`${basePath}/rates`} className="hover:text-[#e4c9a4]">Rates</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
