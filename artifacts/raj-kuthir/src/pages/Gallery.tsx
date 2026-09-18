import { useEffect } from 'react';
import { ArrowLeft, ArrowUpRight, Leaf, MessageCircle, Phone } from 'lucide-react';

import { CONFIG, asset, basePath, phoneHref, track } from '@/lib/site';

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

export default function Gallery() {
  useEffect(() => {
    const previous = document.title;
    document.title = 'Villa Photos in Shantiniketan | Raj Kuthir Homestays';
    return () => {
      document.title = previous;
    };
  }, []);

  let rendered = 0;

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
      <nav aria-label="Breadcrumb" className="section-shell pt-8">
        <ol className="flex flex-wrap items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[.14em] text-muted-foreground">
          <li><a href={`${basePath}/`} className="hover:text-primary" data-testid="link-gallery-crumb-home">Home</a></li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="text-primary">Photos</li>
        </ol>
      </nav>

      <main>
        {/* ---------------------------------------------------------- hero */}
        <section className="section-shell pb-14 pt-10 md:pb-20 md:pt-14" aria-labelledby="gallery-hero">
          <p className="eyebrow mb-5 text-accent">A visual diary</p>
          <h1 id="gallery-hero" className="max-w-[760px] font-journal text-[clamp(3rem,7vw,5.5rem)] leading-[.92] tracking-[-.035em] text-primary">
            A look<br /><em>around home.</em>
          </h1>
          <p className="mt-8 max-w-[560px] text-lg leading-8 text-primary/75">
            {GALLERY.length} photographs of Sobuj Potro — the rooms as they are, the
            garden, and the short walk into Shantiniketan. Nothing here is a stock
            picture of somewhere else.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <a
              href={`${basePath}/#availability`}
              onClick={() => track('check_availability', { placement: 'gallery_hero' })}
              className="flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-xs font-bold uppercase tracking-[.1em] text-primary-foreground transition-transform hover:-translate-y-0.5"
              data-testid="link-gallery-hero-book"
            >
              Check availability <ArrowUpRight size={15} />
            </a>
            <a
              href={`${basePath}/pet-friendly-homestay-shantiniketan`}
              className="flex items-center gap-2 rounded-full border border-primary/25 px-5 py-3 text-xs font-bold uppercase tracking-[.1em] text-primary transition-colors hover:bg-primary/5"
              data-testid="link-gallery-pet"
            >
              Staying here with a pet
            </a>
          </div>
        </section>

        {/* -------------------------------------------------------- groups */}
        {GROUPS.map((group, groupIndex) => (
          <section
            key={group.id}
            id={group.id}
            className={`scroll-mt-24 py-16 md:py-24 ${groupIndex % 2 === 1 ? 'border-y border-border bg-card' : ''}`}
            aria-labelledby={`${group.id}-title`}
          >
            <div className="section-shell">
              <div className="grid gap-8 lg:grid-cols-[.8fr_1.2fr] lg:gap-16">
                <div>
                  <p className="eyebrow mb-5 text-accent">{group.eyebrow}</p>
                  <h2
                    id={`${group.id}-title`}
                    className="whitespace-pre-line font-journal text-4xl leading-[.95] text-primary md:text-6xl"
                  >
                    {group.heading}
                  </h2>
                </div>
                <p className="max-w-[520px] self-end text-base leading-7 text-muted-foreground">
                  {group.lede}
                </p>
              </div>

              <div className="mt-12 grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-5">
                {group.photos.map((photo) => {
                  // The first two pictures on the page are what a visitor sees
                  // immediately; everything after waits for the scroll.
                  const eager = rendered++ < 2;
                  return (
                    <figure
                      key={photo.file}
                      className="group relative m-0 min-h-[220px] overflow-hidden rounded-[1.25rem] md:min-h-[300px]"
                      data-testid={`gallery-photo-${photo.file.split('.')[0]!.toLowerCase().replace(/%20|\s/g, '-')}`}
                    >
                      <img
                        src={asset(photo.file)}
                        alt={photo.alt}
                        width={photo.width}
                        height={photo.height}
                        loading={eager ? 'eager' : 'lazy'}
                        decoding="async"
                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.05]"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />
                      <figcaption className="absolute inset-x-0 bottom-0 p-4">
                        <p className="font-journal text-2xl leading-none text-white">{photo.title}</p>
                      </figcaption>
                    </figure>
                  );
                })}
              </div>
            </div>
          </section>
        ))}

        {/* ------------------------------------------------------ closing */}
        <section className="bg-primary py-20 text-primary-foreground md:py-28" aria-labelledby="gallery-cta">
          <div className="section-shell grid gap-10 lg:grid-cols-[1.1fr_.9fr] lg:items-end">
            <div>
              <p className="eyebrow mb-5 text-secondary">Seen enough</p>
              <h2 id="gallery-cta" className="max-w-[540px] font-journal text-4xl leading-[.94] md:text-6xl">
                The rest is<br /><em>better in person.</em>
              </h2>
              <p className="mt-7 max-w-[460px] text-lg leading-8 text-primary-foreground/70">
                Tell us your dates and who is coming, and the host will confirm
                availability directly. No payment is taken on this site.
              </p>
            </div>
            <div className="flex flex-wrap gap-3 lg:justify-end">
              <a
                href={`${basePath}/#availability`}
                onClick={() => track('check_availability', { placement: 'gallery_footer' })}
                className="flex items-center gap-2 rounded-full bg-secondary px-5 py-3 text-xs font-bold uppercase tracking-[.1em] text-primary transition-transform hover:-translate-y-0.5"
                data-testid="link-gallery-cta-book"
              >
                Enquire to stay <ArrowUpRight size={15} />
              </a>
              <a
                href={`https://wa.me/916290399165?text=${encodeURIComponent(
                  'Hello Raj Kuthir, I have been looking at the photos of Sobuj Potro and would like to enquire about a stay.',
                )}`}
                target="_blank"
                rel="noreferrer"
                onClick={() => track('whatsapp_click', { placement: 'gallery_footer' })}
                className="flex items-center gap-2 rounded-full border border-primary-foreground/25 px-5 py-3 text-xs font-bold uppercase tracking-[.1em] text-primary-foreground transition-colors hover:bg-primary-foreground/10"
                data-testid="link-gallery-whatsapp"
              >
                <MessageCircle size={15} /> WhatsApp
              </a>
              <a
                href={phoneHref(CONFIG.hostPhone)}
                className="flex items-center gap-2 rounded-full border border-primary-foreground/25 px-5 py-3 text-xs font-bold uppercase tracking-[.1em] text-primary-foreground transition-colors hover:bg-primary-foreground/10"
                data-testid="link-gallery-call"
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
            <a href={`${basePath}/house-rules`} className="hover:text-[#e4c9a4]">House rules</a>
            <a href={`${basePath}/#availability`} className="hover:text-[#e4c9a4]">Check availability</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
