import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import {
  getGetPublicCalendarQueryKey,
  useGetPublicCalendar,
} from '@workspace/api-client-react';
import {
  AirVent,
  AlertCircle,
  ArrowRight,
  ArrowUpRight,
  Baby,
  Bath,
  BedDouble,
  CalendarDays,
  Car,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CookingPot,
  Copy,
  Dog,
  ExternalLink,
  GalleryHorizontalEnd,
  HeartHandshake,
  Instagram,
  KeyRound,
  Landmark,
  Leaf,
  LockKeyhole,
  MapPin,
  Menu,
  MessageCircle,
  Navigation,
  PawPrint,
  Phone,
  Quote,
  RefreshCw,
  Refrigerator,
  Send,
  Settings2,
  Sparkles,
  Star,
  Users,
  Utensils,
  Wifi,
  X,
} from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import AdminDashboard from '@/pages/AdminDashboard';
import AdminLogin from '@/pages/AdminLogin';
import AdminEarnings from '@/pages/AdminEarnings';
import AdminRates from '@/pages/AdminRates';
import AdminGuests from '@/pages/AdminGuests';
import HouseRules from '@/pages/HouseRules';
import PetFriendly from '@/pages/PetFriendly';
import Gallery, { GALLERY_TEASER } from '@/pages/Gallery';
import OurStory from '@/pages/OurStory';
import PlacesToVisit from '@/pages/PlacesToVisit';
import Rates from '@/pages/Rates';
import Welcome from '@/pages/Welcome';
import AdminGuestInfo from '@/pages/AdminGuestInfo';
import PreArrival from '@/pages/PreArrival';
import ManagementDocuments from '@/pages/ManagementDocuments';
import {
  useRatePlan,
  rateForNight,
  totalForStay,
  formatRupeesCompact,
  formatRupees,
  breakdownOf,
  surchargePerNight,
  petCharge,
} from '@/lib/rates';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { CONFIG, NEIGHBOURHOOD, asset, basePath, phoneHref, track } from '@/lib/site';
import {
  ADMIN_SESSION_KEY,
  AdminApiError,
  markSessionExpired,
} from '@/lib/admin-api';

/**
 * A signed-out session used to look exactly like an empty business.
 *
 * Each admin page checks /api/admin/me once on mount. When the cookie expired
 * later that check stayed cached as "signed in", while every data query came
 * back 401 — and a 401 rendered as an empty table. The ledger looked wiped,
 * which is precisely how it felt.
 *
 * Catching 401 in one place fixes every screen at once: mark the session
 * signed out, and the guard each admin page already has does the rest.
 */
function onAdminUnauthorised(error: unknown): void {
  if (!(error instanceof AdminApiError) || error.status !== 401) return;

  markSessionExpired();
  queryClient.setQueryData(ADMIN_SESSION_KEY, {
    signedIn: false,
    configured: true,
  });
}

const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onAdminUnauthorised }),
  mutationCache: new MutationCache({ onError: onAdminUnauthorised }),
});

// basePath, CONFIG and asset() now live in lib/site.ts — see the import above.

// Photographs used by the homepage itself. The gallery's twelve live in
// pages/Gallery.tsx with their measured dimensions and alt text; the four
// shown in the teaser below come from there, not from here.
const IMG = {
  villaNight: asset('villa-night.jpg'),
  bedroom: asset('Bedroom.jpg'),
  pet: asset('Pet%20View.jpg'),
  // Two review cards, not three. "Review 3.jpg" repeated Review 1's quote and
  // reviewer over a photograph of a different house, so it was removed rather
  // than shown as a review of this one.
  review1: asset('Review%201.jpg'),
  review2: asset('Review%202.jpg'),
};

/*
 * The marketing posters used to have a homepage section of their own
 * ("Little posters, the whole story."). It was removed: the artwork repeats
 * what the page above it already says in better words, and it sat between the
 * photo gallery and the FAQ, where a guest is looking for answers rather than
 * something to share. The image files stay in the asset folder for use on
 * Instagram and in WhatsApp.
 */

/**
 * Four places for the homepage, and the true total for the link beneath them.
 *
 * Both are derived from NEIGHBOURHOOD rather than typed out, so the homepage
 * cannot end up promising "all 18 places" after someone adds a nineteenth.
 * The four are one from each group: how you arrive, why you came, the nearest
 * afternoon out, and the one worth a whole day.
 */
const NEIGHBOURHOOD_COUNT = NEIGHBOURHOOD.reduce((total, group) => total + group.places.length, 0);

/**
 * One place, whichever group it is in. NEIGHBOURHOOD is `as const`, so every
 * group's `places` is a different tuple type and `flatMap` cannot infer a
 * common element on its own — it gives up and yields `unknown`. Naming the
 * element type, derived from the data rather than written out, fixes that.
 */
type NeighbourhoodPlace = (typeof NEIGHBOURHOOD)[number]['places'][number];

const NEIGHBOURHOOD_TEASER = ['Prantik station', 'Visva-Bharati & Rabindra Bhavan', 'Sonajhuri Khoai Haat', 'Bishnupur']
  .map((title) => NEIGHBOURHOOD.flatMap<NeighbourhoodPlace>((group) => group.places).find((place) => place.title === title))
  .filter((place): place is NonNullable<typeof place> => Boolean(place));

/**
 * The header menu, in the order a visitor meets these things.
 *
 * Anchors are listed in the order their sections appear down the homepage;
 * "Our story" leads because the hero's own button points there. Reordering a
 * section below means reordering its entry here — a menu whose order does not
 * match the page makes people hunt.
 */
const NAV_ITEMS = [
  { label: 'Our story', href: `${basePath}/our-story` },
  // The page, not the section: the homepage's strongest link to the one page
  // written for people searching for a pet-friendly stay.
  { label: 'Pet Friendly', href: `${basePath}/pet-friendly-homestay-shantiniketan` },
  { label: 'Availability', href: '#availability' },
  { label: 'Nearby', href: `${basePath}/places-to-visit-in-shantiniketan` },
  { label: 'Food', href: '#food' },
  { label: 'Gallery', href: `${basePath}/gallery` },
  { label: 'Reviews', href: '#reviews' },
];

type BusyPeriod = {
  id: string;
  source: string;
  label: string;
  start: string;
  end: string;
};


const faqs = [
  {
    question: 'Is Raj Kuthir a private villa?',
    answer: 'Yes. Sobuj Potro is an entire two-bedroom villa with a private garden, so your group can settle in at its own pace.',
  },
  {
    question: 'Can we bring our pet?',
    answer: 'Yes, the stay is genuinely pet-welcoming. Please mention your pet count and anything we should know in the enquiry form so the caretaker can prepare.',
  },
  {
    question: 'Can we cook at the homestay?',
    answer: 'Basic cooking utensils and an induction setup are available, along with a microwave, refrigerator and water filter. A home-cooked meal option can also be arranged through the caretaker.',
  },
  {
    question: 'Is food available nearby?',
    answer: 'Cafe Soi is inside the premises, and Zomato availability makes it easy to order in when you prefer a slower evening at home.',
  },
  {
    question: 'How do I confirm a booking?',
    answer: 'Send an enquiry with your preferred dates. The host will confirm availability and share the final booking details directly. The estimate below is for planning only and does not take payment.',
  },
];

const currency = (amount: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);

const dateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const displayDate = (date: Date) =>
  new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(date);

/** "2026-10-02" -> "2 Oct", the way a date is read in a sentence. */
const shortDate = (iso: string) => {
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day) return iso;
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(Date.UTC(year, month - 1, day)));
};

const eventDateKey = (value: string | Date) =>
  typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);

const calendarDays = (month: Date) => {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
};

const eventTouchesDay = (event: BusyPeriod, day: string) =>
  day >= event.start && day < event.end;

function Home() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [submitted, setSubmitted] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const publicCalendar = useGetPublicCalendar({
    query: {
      queryKey: getGetPublicCalendarQueryKey(),
      staleTime: 60_000,
      refetchInterval: 5 * 60_000,
      refetchOnMount: 'always',
    },
  });

  const ratePlan = useRatePlan();
  // Occupancy the calendar prices are shown for. Prices vary by guest count,
  // so the grid has to be told which one to display.
  const [calendarGuests, setCalendarGuests] = useState(2);
  /** Set when the server refuses the dates, so the guest is told rather than thanked. */
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: '',
    phone: '',
    email: '',
    checkIn: '',
    checkOut: '',
    adults: '2',
    children: '0',
    pets: '0',
    requests: '',
  });

  const updateForm = (key: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (submitted) setSubmitted(false);
  };

  // Everyone staying counts towards occupancy pricing, children included.
  const partySize = useMemo(
    () => Math.max(1, (Number(form.adults) || 0) + (Number(form.children) || 0)),
    [form.adults, form.children],
  );

  /*
    The estimate is where a large party actually gets priced. The calendar
    above only shows what the rate card covers, one to five; everything that
    moves the number beyond that — a sixth head, a pet — is asked for here, so
    this is the only place that can answer honestly.
  */
  const party = useMemo(
    () => ({
      adults: Number(form.adults) || 0,
      children: Number(form.children) || 0,
      pets: Number(form.pets) || 0,
    }),
    [form.adults, form.children, form.pets],
  );

  const stay = useMemo(
    () => totalForStay(ratePlan.data, form.checkIn, form.checkOut, partySize),
    [ratePlan.data, form.checkIn, form.checkOut, partySize],
  );

  const breakdown = useMemo(
    () => breakdownOf(ratePlan.data, party),
    [ratePlan.data, party],
  );

  const nights = stay.nights;
  const extrasPaise =
    surchargePerNight(ratePlan.data, breakdown) * nights +
    petCharge(ratePlan.data, breakdown);
  const total = Math.round((stay.totalPaise + extrasPaise) / 100);
  const advance = Math.round(total * CONFIG.advanceShare);
  const balance = total - advance;

  /**
   * Headline "from" price: the cheapest standing rate the server reports.
   *
   * Null until /api/rates answers, and deliberately so. This used to fall back
   * to a hardcoded constant, which meant every visitor whose request had not
   * resolved yet — and everyone hitting the site while the API was down — was
   * quoted a number nobody had checked against the live rate plan or the OTA
   * listings. A price shown on the page is a price the guest will hold us to,
   * so when we do not know it we say so instead of guessing.
   */
  const fromRate = useMemo(() => {
    const rates = Object.values(ratePlan.data?.rates ?? {});
    return rates.length ? Math.min(...rates) / 100 : null;
  }, [ratePlan.data]);
  const busyPeriods = useMemo(
    () =>
      (publicCalendar.data?.blocks ?? []).map((block, index) => ({
        id: `public-block-${index}-${block.startDate}`,
        source: 'Booked',
        label: 'Unavailable',
        start: eventDateKey(block.startDate),
        end: eventDateKey(block.endDate),
      })),
    [publicCalendar.data?.blocks],
  );
  /*
    Does the stay the guest has typed run into dates that are already taken?

    Same half-open rule as the server: a range ends where the next begins, so
    arriving the morning somebody else leaves is not a clash. Computed from
    the blocks already fetched to paint the calendar, so the warning appears
    as the dates are picked rather than after the form is sent.
  */
  const dateConflict = useMemo(() => {
    if (!form.checkIn || !form.checkOut || form.checkOut <= form.checkIn) return null;

    return (
      (publicCalendar.data?.blocks ?? []).find(
        (block) =>
          form.checkIn < eventDateKey(block.endDate) &&
          eventDateKey(block.startDate) < form.checkOut,
      ) ?? null
    );
  }, [publicCalendar.data?.blocks, form.checkIn, form.checkOut]);

  const daysInView = useMemo(() => calendarDays(calendarMonth), [calendarMonth]);
  const calendarMonthLabel = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(calendarMonth);
  /*
   * The WhatsApp message, written from what the guest has actually typed.
   *
   * It used to fill every blank with "To be shared" / "To be confirmed", so
   * tapping the sticky WhatsApp bar without touching the form sent the host a
   * message with a name of "To be shared" and no dates — an enquiry that could
   * not be answered and, because that button never talks to the server, was
   * never recorded either. The first real enquiry this site received arrived
   * that way.
   *
   * Now a field that is empty is left out. A message sent from a blank form is
   * a plain hello, which is at least honestly a plain hello; once the guest has
   * given a name or dates, the details ride along.
   */
  const hasEnquiryDetail = Boolean(form.name.trim() || (form.checkIn && form.checkOut));

  const whatsappMessage = (() => {
    const lines = ['Hello Raj Kuthir, I would like to enquire about Sobuj Potro.'];
    if (!hasEnquiryDetail) return lines.join('\n');

    if (form.name.trim()) lines.push(`Name: ${form.name.trim()}`);
    if (form.checkIn && form.checkOut) {
      lines.push(
        `Dates: ${form.checkIn} to ${form.checkOut}${nights ? ` (${nights} night${nights === 1 ? '' : 's'})` : ''}`,
      );
    }
    lines.push(`Guests: ${form.adults} adults, ${form.children} children, ${form.pets} pets`);
    if (form.phone.trim()) lines.push(`Phone: ${form.phone.trim()}`);
    return lines.join('\n');
  })();

  const whatsappUrl = `https://wa.me/916290399165?text=${encodeURIComponent(whatsappMessage)}`;

  /*
   * "Check availability" means the calendar, not the section it sits in.
   * This used to scroll to #booking — the banner headline — leaving the grid
   * itself below the fold, so the button named after the calendar stopped
   * short of it. Every "Check availability" on the site now lands on the same
   * element: the calendar and the enquiry form, side by side.
   */
  const scrollToAvailability = () => {
    document.getElementById('availability')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setMenuOpen(false);
  };

  /**
   * Which button in the form was pressed.
   *
   * Both of them submit. The WhatsApp one used to be a bare link that opened
   * wa.me straight from an empty form, so an enquiry made that way never
   * reached /api/enquiries and never existed as far as the owner's console was
   * concerned. It is a submit button now: the enquiry is recorded first, and
   * WhatsApp is offered afterwards.
   */
  const [handOffToWhatsApp, setHandOffToWhatsApp] = useState(false);

  const submitEnquiry = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitError(null);

    /*
      This used to be fire-and-forget, on the reasoning that a guest who filled
      the form should see the thank-you whatever the server did. That was fine
      while the only failures were ours. It stopped being fine the moment the
      server began refusing dates that are already booked: the guest was shown
      a thank-you for an enquiry that had been rejected and never stored, and
      the owner never saw it either. Nobody found out until somebody went
      looking.

      So a refusal the guest can act on is now shown to them. Everything else
      — a dropped connection, a 500 — still ends in the thank-you, because
      those are not the guest's fault and the WhatsApp route still works.
    */
    try {
      const response = await fetch('/api/enquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          phone: form.phone,
          email: form.email || null,
          checkIn: form.checkIn || null,
          checkOut: form.checkOut || null,
          adults: form.adults || null,
          children: form.children || null,
          pets: form.pets || null,
          requests: form.requests || null,
        }),
      });

      if (response.status === 409 || response.status === 400) {
        const body = await response.json().catch(() => ({}) as { error?: string });
        setSubmitError(
          typeof body.error === 'string'
            ? body.error
            : 'Those dates are not available. Please try different ones.',
        );
        void publicCalendar.refetch();
        return;
      }
    } catch {
      /* the guest is not the right person to show a dropped connection to */
    }

    setSubmitted(true);

    // The enquiry is stored either way. WhatsApp is a convenience on top of
    // it, so a blocked popup costs nothing — the success panel that just
    // appeared carries the same link, one real click away.
    if (handOffToWhatsApp) {
      window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
      setHandOffToWhatsApp(false);
    }
  };

  const shiftCalendarMonth = (amount: number) => {
    setCalendarMonth((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1));
  };

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="fixed inset-x-0 top-0 z-50 border-b border-foreground/10 bg-background/90 backdrop-blur-md" data-testid="site-header">
        <div className="section-shell flex h-[74px] items-center justify-between gap-6">
          <a href="#top" className="group flex shrink-0 items-center gap-3" data-testid="link-brand">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-primary text-primary-foreground">
              <Leaf size={19} strokeWidth={1.7} />
            </span>
            <span className="leading-none">
              <span className="block font-mono-ui text-[10px] font-medium tracking-[.18em] text-muted-foreground">RAJ KUTHIR</span>
              <span className="font-journal text-[19px] text-primary">Homestays</span>
            </span>
          </a>

          <nav className="hidden min-w-0 items-center gap-4 xl:flex" aria-label="Main navigation">
            {NAV_ITEMS.map((item) => (
              <a key={item.href} href={item.href} className="text-[11px] font-bold uppercase tracking-[.1em] text-muted-foreground transition-colors hover:text-primary" data-testid={`link-nav-${item.label.toLowerCase().replace(/\s/g, '-')}`}>
                {item.label}
              </a>
            ))}
          </nav>

          <div className="hidden shrink-0 items-center gap-2 md:flex">
            <a
              href={phoneHref(CONFIG.hostPhone)}
              className="grid h-10 w-10 place-items-center rounded-full border border-border text-primary transition-colors hover:border-primary hover:bg-primary/5"
              aria-label={`Call the host on ${CONFIG.hostPhone}`}
              title="Call host"
              data-testid="link-header-call"
            >
              <Phone size={15} />
            </a>
            <a
              href={`${basePath}/admin`}
              className="grid h-10 w-10 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary"
              aria-label="Owner sign in"
              title="Owner sign in"
              data-testid="link-header-admin"
            >
              <LockKeyhole size={14} />
            </a>
            <button onClick={scrollToAvailability} className="ml-1 rounded-full bg-primary px-5 py-3 text-xs font-bold uppercase tracking-[.12em] text-primary-foreground transition-transform hover:-translate-y-0.5 active:scale-95" data-testid="button-header-book">
              Check availability
            </button>
          </div>

          <button
            className="grid h-11 w-11 place-items-center rounded-full border border-border text-primary md:hidden"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
            aria-expanded={menuOpen}
            data-testid="button-mobile-menu"
          >
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
        {menuOpen && (
          <div className="border-t border-border bg-card px-5 py-5 md:hidden" data-testid="mobile-navigation">
            <nav className="flex flex-col gap-4" aria-label="Mobile navigation">
              {NAV_ITEMS.map((item) => (
                <a key={item.href} href={item.href} onClick={() => setMenuOpen(false)} className="font-journal text-2xl text-primary" data-testid={`link-mobile-${item.label.toLowerCase().replace(/\s/g, '-')}`}>
                  {item.label}
                </a>
              ))}
              <button onClick={scrollToAvailability} className="mt-2 rounded-full bg-primary px-5 py-3 text-xs font-bold uppercase tracking-[.12em] text-primary-foreground" data-testid="button-mobile-book">
                Check availability
              </button>
              <div className="mt-3 border-t border-border pt-4">
                <a href={`${basePath}/admin`} onClick={() => setMenuOpen(false)} className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.1em] text-primary" data-testid="link-mobile-admin-login">
                  <LockKeyhole size={15} /> Admin login
                </a>
                <p className="mt-2 pl-6 text-[10px] leading-4 text-muted-foreground">Private owner access to calendar controls</p>
              </div>
            </nav>
          </div>
        )}
      </header>

      <main id="top">
        {/* --------------------------------------------------------- cover
            The villa after sundown, full width, with the headline sitting in
            the dark at the foot of the frame.

            This photograph is the Largest Contentful Paint for the whole site,
            so it is the one image that loads eagerly and at high priority —
            everything else on the page waits its turn. Its dimensions are
            declared so the browser reserves the frame before the bytes land,
            which is what keeps the headline from jumping as it arrives. */}
        <section className="relative isolate flex min-h-[clamp(560px,86vh,880px)] items-end overflow-hidden" aria-labelledby="hero-title">
          <img
            src={IMG.villaNight}
            alt="Raj Kuthir Homestays, Sobuj Potro, lit up after sundown in Bolpur, Shantiniketan"
            width={1600}
            height={900}
            loading="eager"
            fetchPriority="high"
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover"
          />
          {/* Two overlays rather than one: a vertical wash dark enough to carry
              white type at the foot, and a soft vignette that keeps the eye on
              the lit house rather than the corners. */}
          <div className="absolute inset-0 bg-gradient-to-t from-[#0a1712]/92 via-[#0a1712]/45 to-[#0a1712]/5" aria-hidden="true" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_45%,transparent_30%,rgba(10,23,18,.6)_100%)]" aria-hidden="true" />

          <div className="section-shell relative z-10 w-full pb-14 pt-40 md:pb-20 md:pt-48">
            <div className="reveal max-w-[820px]">
              <span className="mb-7 flex items-center gap-3">
                <span className="h-px w-10 bg-secondary/70" aria-hidden="true" />
                <span className="whitespace-nowrap font-mono-ui text-[9px] uppercase tracking-[.22em] text-secondary sm:text-[10px] sm:tracking-[.3em]">Bolpur &middot; Shantiniketan</span>
              </span>
              {/* The h1 says what the place is, in the hero's display type; the
                  tagline beneath it says what it feels like. Same typeface,
                  colours and italic accent as before — the words swapped roles.
                  "2-Bedroom" is kept on one line so the hyphen never breaks. */}
              <h1 id="hero-title" className="font-journal text-[clamp(2.5rem,6.6vw,5.4rem)] leading-[.95] tracking-[-.035em] text-white [text-wrap:balance]">
                Private <span className="whitespace-nowrap">2-Bedroom</span> Villa <em className="text-secondary">in Shantiniketan</em>
              </h1>
              <p className="mt-5 font-journal text-[clamp(1.55rem,3.1vw,2.5rem)] leading-[1.05] tracking-[-.02em] text-white/90">
                Stay for the <em className="text-secondary">unhurried</em> hours.
              </p>
              <p className="mt-8 max-w-[520px] text-[15px] leading-7 text-white/75 md:text-[17px]">
                An entire two-bedroom villa in Bolpur, made for couples, families
                and the four-legged members of the family. Come to Shantiniketan.
                Take your time.
              </p>
              <div className="mt-10 flex flex-wrap items-center gap-4">
                <a href="#availability" className="group flex items-center gap-3 rounded-full bg-secondary px-6 py-4 text-xs font-bold uppercase tracking-[.12em] text-primary transition-all hover:-translate-y-1 hover:shadow-xl active:scale-95" data-testid="button-hero-book">
                  Check availability <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
                </a>
                <a href={`${basePath}/our-story`} className="flex items-center gap-2 rounded-full border border-white/30 px-6 py-4 text-xs font-bold uppercase tracking-[.12em] text-white transition-colors hover:bg-white/10" data-testid="link-hero-stay">
                  Read the story <ArrowUpRight size={15} />
                </a>
              </div>
            </div>
          </div>
        </section>

        <section className="border-y border-border bg-card" aria-label="Stay highlights">
          <div className="section-shell grid grid-cols-2 divide-x divide-border md:grid-cols-4">
            {[
              { icon: HouseIcon, title: 'Entire villa', detail: 'Two bedrooms' },
              { icon: PawPrint, title: 'Pet-welcoming', detail: 'Bring the whole family' },
              { icon: Car, title: 'On-premise parking', detail: 'Arrive with ease' },
              { icon: Wifi, title: 'Wi-Fi included', detail: 'Stay connected, lightly' },
            ].map(({ icon: Icon, title, detail }) => (
              <div key={title} className="flex min-h-[112px] flex-col justify-center gap-2 px-4 py-5 md:px-8" data-testid={`highlight-${title.toLowerCase().replace(/\s/g, '-')}`}>
                <Icon size={19} strokeWidth={1.5} className="text-accent" />
                <div><p className="text-sm font-bold text-primary">{title}</p><p className="mt-1 text-[11px] text-muted-foreground">{detail}</p></div>
              </div>
            ))}
          </div>
        </section>

        <section className="section-shell py-24 md:py-32" aria-labelledby="amenities-title">
          <div className="grid gap-12 lg:grid-cols-[.7fr_1.3fr] lg:gap-24">
            <div><p className="eyebrow mb-5 text-accent">Everything useful</p><h2 id="amenities-title" className="font-journal text-5xl leading-[.95] text-primary md:text-6xl">The small<br /><em>comforts.</em></h2><p className="mt-7 max-w-[300px] text-sm leading-6 text-muted-foreground">The things that make a private stay feel easy, without turning it into a checklist.</p></div>
            <div className="grid grid-cols-2 gap-x-5 gap-y-0 sm:grid-cols-3">
              {/* Each of these is marked up as an amenity by the server
                  (VERIFIED_AMENITIES in api-server/src/lib/seo.ts), and a test
                  fails if the markup claims one that is not written here. */}
              {[
                { icon: BedDouble, label: 'Two bedrooms, two king beds' },
                { icon: AirVent, label: 'Air conditioning in both bedrooms' },
                { icon: Bath, label: 'Two bathrooms' },
                { icon: CookingPot, label: 'Basic cooking utensils' },
                { icon: Utensils, label: 'Induction setup' },
                { icon: Refrigerator, label: 'Microwave & refrigerator' },
                { icon: CircleCheck, label: 'Water filter' },
                { icon: Wifi, label: 'Wi-Fi' },
                { icon: Car, label: 'On-premise parking' },
              ].map(({ icon: Icon, label }) => <div key={label} className="border-t border-border py-6"><Icon size={22} className="mb-5 text-accent" strokeWidth={1.4} /><p className="max-w-[145px] text-sm font-bold leading-5 text-primary">{label}</p></div>)}
            </div>
          </div>
        </section>

        <section id="pet-friendly" className="scroll-mt-24 bg-secondary/60 py-24 md:py-32" aria-labelledby="pet-title">
          <div className="section-shell grid items-center gap-12 lg:grid-cols-[1.1fr_.9fr] lg:gap-24">
            <div className="order-2 lg:order-1">
              <img
                src={IMG.pet}
                alt="A pet relaxing at the door of Raj Kuthir"
                width={1023}
                height={1537}
                loading="lazy"
                decoding="async"
                className="min-h-[380px] w-full rounded-[2rem] object-cover shadow-md md:min-h-[490px]"
              />
            </div>
            <div className="order-1 lg:order-2"><p className="eyebrow mb-5 text-accent">Bring everyone</p><h2 id="pet-title" className="font-journal text-5xl leading-[.94] text-primary md:text-7xl">Good stays<br /><em>include paws.</em></h2><p className="mt-8 max-w-[470px] text-lg leading-8 text-primary/75">This is a home where your pet is welcome, not an exception to negotiate. Tell us who is coming, and we will make the arrival feel comfortable for the whole family.</p><div className="mt-8 flex items-center gap-4 border-t border-primary/15 pt-6"><PawPrint size={23} className="text-accent" strokeWidth={1.5} /><p className="text-sm font-bold text-primary">A genuinely pet-welcoming stay</p></div><a href={`${basePath}/pet-friendly-homestay-shantiniketan`} className="mt-7 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[.1em] text-primary underline decoration-accent decoration-2 underline-offset-4" data-testid="link-pet-friendly-page">Staying here with a pet <ArrowUpRight size={14} /></a></div>
          </div>
        </section>

        {/* ------------------------------------------- dates and enquiry
            One banner, not two sections. The calendar and the enquiry form
            were the same job split across two stops on the page: people read
            the dates, scrolled on, and had to come back. Nothing about how
            either one works has changed — same state, same rates, same
            submit — only where they sit and what they look like.

            "Check availability" anywhere on the site lands here. */}
        <section id="booking" className="scroll-mt-24 bg-[#e4c9a4] py-24 md:py-32" aria-labelledby="booking-title">
          <div className="section-shell">
            <div className="flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
              <div>
                <p className="eyebrow mb-5 text-primary/70">Dates, then a conversation</p>
                <h2 id="booking-title" className="max-w-[620px] font-journal text-5xl leading-[.92] text-primary md:text-7xl">
                  Make a little<br /><em>room for here.</em>
                </h2>
                <p className="mt-8 max-w-[430px] text-sm leading-6 text-primary/75">
                  The calendar below combines every channel Sobuj Potro is listed
                  on, so what shows as free really is. Found your dates? Send the
                  enquiry underneath and skip the platform fees &mdash; the host
                  confirms directly, and no payment is taken here.
                </p>

                {/* Said before anybody asks. A family arriving to find two
                    children they thought were free on the bill is a bad first
                    hour, and the honest version costs one paragraph. */}
                {ratePlan.data?.extras && (
                  <ul className="mt-6 max-w-[430px] space-y-2 border-l-2 border-primary/20 pl-4 text-[13px] leading-6 text-primary/75" data-testid="list-charges-note">
                    <li>
                      Children under {ratePlan.data.extras.childUnderAge} count as
                      guests. Two adults and two little ones are a party of four,
                      at the four-guest price &mdash; nothing extra.
                    </li>
                    <li>
                      Above {ratePlan.data.maxGuests} guests, each extra person is{' '}
                      {formatRupees(ratePlan.data.extras.extraAdultPaise)} a night, or{' '}
                      {formatRupees(ratePlan.data.extras.extraChildPaise)} for a child
                      under {ratePlan.data.extras.childUnderAge}.
                    </li>
                    <li>
                      Pets are {formatRupees(ratePlan.data.extras.petPaise)} for the
                      stay, not per night.
                    </li>
                  </ul>
                )}
                <p className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-[12px] font-bold uppercase tracking-[.08em] text-primary">
                  <a href={`${basePath}/rates`} className="underline decoration-accent decoration-2 underline-offset-4" data-testid="link-booking-rates">The full rate card</a>
                  <a href={`${basePath}/pet-friendly-homestay-shantiniketan`} className="underline decoration-accent decoration-2 underline-offset-4" data-testid="link-booking-pet">Travelling with a pet?</a>
                </p>
              </div>
              <div className="flex flex-col gap-3 border-t border-primary/15 pt-6 lg:border-0 lg:pt-0 lg:text-right">
                <a href={phoneHref(CONFIG.hostPhone)} className="flex items-center gap-3 text-sm font-bold text-primary lg:justify-end" data-testid="link-booking-host">
                  <Phone size={16} /> Host &middot; {CONFIG.hostPhone}
                </a>
                <a href={phoneHref(CONFIG.caretakerPhone)} className="flex items-center gap-3 text-sm font-bold text-primary lg:justify-end" data-testid="link-booking-caretaker">
                  <HeartHandshake size={16} /> Caretaker &middot; {CONFIG.caretakerPhone}
                </a>
              </div>
            </div>

            {/* Calendar and enquiry side by side: one row, so nobody has to
                scroll between reading the dates and asking for them. The card
                that used to sit here explained that the calendar combines every
                channel — that sentence is in the section intro above now, read
                once rather than filling half a column with empty space. */}
            <div id="availability" className="scroll-mt-24 mt-12 grid items-start gap-5 lg:grid-cols-2">
            <div className="rounded-[1.5rem] border border-border bg-card p-5 md:p-8">
              <div className="flex flex-col justify-between gap-4 border-b border-border pb-5 sm:flex-row sm:items-center">
                <div>
                  <p className="eyebrow text-accent">Availability</p>
                  <p className="mt-2 font-journal text-3xl text-primary">{calendarMonthLabel}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => shiftCalendarMonth(-1)} className="grid h-9 w-9 place-items-center rounded-full border border-border text-primary transition-colors hover:border-primary" aria-label="Previous month" data-testid="button-calendar-previous"><ChevronLeft size={16} /></button>
                  <button type="button" onClick={() => setCalendarMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))} className="rounded-full border border-border px-3 py-2 text-[10px] font-bold uppercase tracking-[.1em] text-muted-foreground transition-colors hover:border-primary hover:text-primary" data-testid="button-calendar-today">Today</button>
                  <button type="button" onClick={() => shiftCalendarMonth(1)} className="grid h-9 w-9 place-items-center rounded-full border border-border text-primary transition-colors hover:border-primary" aria-label="Next month" data-testid="button-calendar-next"><ChevronRight size={16} /></button>
                </div>
              </div>

              {/* One to five, and no further. The rate card covers those
                  occupancies and the grid shows exactly what it covers; a
                  larger party is priced at the form below, where the children
                  and pets that change the number are actually asked for.
                  Picking a number here fills the form in, so choosing the
                  dates and the party is one gesture rather than two. */}
              <div className="mt-5 border-b border-border pb-5">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-[10px] font-bold uppercase tracking-[.08em] text-muted-foreground">Prices for</span>
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="Number of guests">
                    {[1, 2, 3, 4, 5].map((count) => (
                      <button
                        key={count}
                        type="button"
                        onClick={() => {
                          setCalendarGuests(count);
                          updateForm('adults', String(count));
                        }}
                        aria-pressed={calendarGuests === count}
                        className={`h-9 min-w-9 rounded-full border px-3 text-xs font-bold transition-colors ${calendarGuests === count ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:border-primary hover:text-primary'}`}
                        data-testid={`button-calendar-guests-${count}`}
                      >
                        {count}
                      </button>
                    ))}

                  </div>
                  <span className="text-[10px] text-muted-foreground">{calendarGuests === 1 ? 'guest' : 'guests'}</span>
                </div>

                <p className="mt-3 text-[11px] leading-5 text-muted-foreground" data-testid="text-large-party-note">
                  Staying with more than {ratePlan.data?.maxGuests ?? 5}? Put the
                  numbers into the enquiry form below and the estimate there works
                  out the whole party, children and pets included.
                </p>
              </div>

              <div className="mt-6 grid grid-cols-7 gap-1.5 text-center">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <p key={day} className="pb-2 font-mono-ui text-[9px] uppercase tracking-[.08em] text-muted-foreground">{day}</p>)}
                {daysInView.map((day) => {
                  const key = dateKey(day);
                  const dayEvents = busyPeriods.filter((event) => eventTouchesDay(event, key));
                  const isOutsideMonth = day.getMonth() !== calendarMonth.getMonth();
                  const isToday = key === dateKey(new Date());
                  const nightPaise = rateForNight(ratePlan.data, key, calendarGuests);
                  return (
                    <div key={key} className={`min-h-[76px] rounded-lg border p-2 text-left transition-colors ${isOutsideMonth ? 'border-transparent bg-background/40 opacity-35' : dayEvents.length ? 'border-accent/35 bg-secondary/40' : 'border-border bg-background'} ${isToday ? 'ring-2 ring-accent/60 ring-offset-1 ring-offset-card' : ''}`} data-testid={`calendar-day-${key}`}>
                      <p className={`text-xs font-bold ${isToday ? 'text-accent' : 'text-primary'}`}>{day.getDate()}</p>
                      <div className="mt-2 space-y-1">
                        {dayEvents.slice(0, 1).map((event) => <div key={`${event.id}-${key}`} className="truncate rounded bg-[#c8a89a] px-1.5 py-1 text-[9px] font-bold leading-none text-primary" title="Booked">Booked</div>)}
                        {nightPaise !== null && !isOutsideMonth && (
                          <p className={`font-mono-ui text-[10px] leading-none ${dayEvents.length ? 'text-muted-foreground/50 line-through' : 'text-muted-foreground'}`} data-testid={`calendar-price-${key}`}>
                            {formatRupeesCompact(nightPaise)}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <p className="mt-6 border-t border-border pt-5 text-[10px] leading-4 text-muted-foreground">Dates marked as booked are currently unavailable. Checkout days remain available for a new arrival.</p>
           </div>

            <div className="rounded-[1.5rem] bg-background p-6 shadow-lg md:p-8">
              {submitted ? <div className="flex min-h-[530px] flex-col items-center justify-center text-center" data-testid="status-enquiry-success"><span className="grid h-16 w-16 place-items-center rounded-full bg-primary text-secondary"><Check size={28} /></span><p className="eyebrow mt-7 text-accent">Enquiry received</p><h3 className="mt-3 font-journal text-4xl text-primary">Thank you, {form.name || 'friend'}.</h3><p className="mt-4 max-w-[390px] text-sm leading-6 text-muted-foreground">Your enquiry is ready to share with the host. For the quickest reply, you can also send the selected details on WhatsApp.</p><div className="mt-8 flex flex-wrap justify-center gap-3"><a href={whatsappUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-xs font-bold uppercase tracking-[.1em] text-primary-foreground" data-testid="link-success-whatsapp"><MessageCircle size={15} /> Send on WhatsApp</a><button onClick={() => setSubmitted(false)} className="rounded-full border border-border px-5 py-3 text-xs font-bold uppercase tracking-[.1em] text-primary" data-testid="button-new-enquiry">New enquiry</button></div></div> : <form onSubmit={submitEnquiry} className="space-y-6" data-testid="form-booking-enquiry"><div className="flex items-center justify-between border-b border-border pb-5"><div><p className="font-journal text-3xl text-primary">Enquire to stay</p><p className="mt-1 text-xs text-muted-foreground">A clear estimate, before a conversation.</p></div><Send size={20} className="text-accent" /></div><div className="grid gap-5 sm:grid-cols-2"><label className="block sm:col-span-2"><span className="eyebrow text-muted-foreground">Your name *</span><input required minLength={2} maxLength={80} autoComplete="name" value={form.name} onChange={(event) => updateForm('name', event.target.value)} className="mt-2 w-full border-b border-border bg-transparent px-0 py-3 text-sm text-primary outline-none placeholder:text-muted-foreground/60 focus:border-primary" placeholder="Name" data-testid="input-guest-name" /></label><label className="block"><span className="eyebrow text-muted-foreground">Phone *</span><input required type="tel" inputMode="tel" autoComplete="tel" maxLength={20} pattern="(\+?91[- ]?|0)?[6-9][0-9]{9}" title="A 10-digit Indian mobile number, with or without +91" value={form.phone} onChange={(event) => updateForm('phone', event.target.value)} className="mt-2 w-full border-b border-border bg-transparent px-0 py-3 text-sm text-primary outline-none placeholder:text-muted-foreground/60 focus:border-primary" placeholder="+91 98765 43210" data-testid="input-guest-phone" /></label><label className="block"><span className="eyebrow text-muted-foreground">Email</span><input type="email" autoComplete="email" maxLength={200} value={form.email} onChange={(event) => updateForm('email', event.target.value)} className="mt-2 w-full border-b border-border bg-transparent px-0 py-3 text-sm text-primary outline-none placeholder:text-muted-foreground/60 focus:border-primary" placeholder="you@example.com" data-testid="input-guest-email" /></label><label className="block"><span className="eyebrow text-muted-foreground">Check-in *</span><input required type="date" min={new Date().toISOString().split('T')[0]} value={form.checkIn} onChange={(event) => updateForm('checkIn', event.target.value)} className="mt-2 w-full border-b border-border bg-transparent px-0 py-3 text-sm text-primary outline-none focus:border-primary" data-testid="input-check-in" /></label><label className="block"><span className="eyebrow text-muted-foreground">Check-out *</span><input required type="date" min={form.checkIn || new Date().toISOString().split('T')[0]} value={form.checkOut} onChange={(event) => updateForm('checkOut', event.target.value)} className="mt-2 w-full border-b border-border bg-transparent px-0 py-3 text-sm text-primary outline-none focus:border-primary" data-testid="input-check-out" /></label></div>{dateConflict && <p className="flex items-start gap-2 rounded-xl border border-[#A65E45]/40 bg-[#A65E45]/5 px-4 py-3 text-[13px] leading-6 text-[#A65E45]" role="alert" data-testid="text-date-conflict"><CircleAlert size={15} className="mt-0.5 shrink-0" /><span>Those nights are already taken &mdash; {shortDate(eventDateKey(dateConflict.startDate))} to {shortDate(eventDateKey(dateConflict.endDate))} is booked. Pick other dates and the estimate will update.</span></p>}<div className="grid grid-cols-3 gap-3"><label className="block rounded-xl border border-border p-3"><span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.08em] text-muted-foreground"><Users size={13} /> Adults</span><input required type="number" min="1" value={form.adults} onChange={(event) => updateForm('adults', event.target.value)} className="mt-2 w-full bg-transparent text-lg font-bold text-primary outline-none" data-testid="input-adults" /></label><label className="block rounded-xl border border-border p-3"><span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.08em] text-muted-foreground"><Baby size={13} /> Children</span><input type="number" min="0" value={form.children} onChange={(event) => updateForm('children', event.target.value)} className="mt-2 w-full bg-transparent text-lg font-bold text-primary outline-none" data-testid="input-children" /></label><label className="block rounded-xl border border-border p-3"><span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.08em] text-muted-foreground"><PawPrint size={13} /> Pets</span><input type="number" min="0" value={form.pets} onChange={(event) => updateForm('pets', event.target.value)} className="mt-2 w-full bg-transparent text-lg font-bold text-primary outline-none" data-testid="input-pets" /></label></div><label className="block"><span className="eyebrow text-muted-foreground">Special requests</span><textarea rows={3} value={form.requests} onChange={(event) => updateForm('requests', event.target.value)} className="mt-2 w-full resize-none border-b border-border bg-transparent px-0 py-3 text-sm text-primary outline-none placeholder:text-muted-foreground/60 focus:border-primary" placeholder="Arrival notes, pet details, meal preferences..." data-testid="input-special-requests" /></label><div className="rounded-xl bg-card p-4"><div className="flex items-center justify-between"><p className="text-sm font-bold text-primary">Planning estimate</p><p className="font-mono-ui text-[10px] text-muted-foreground">{nights ? `${nights} night${nights === 1 ? '' : 's'}` : 'Select dates'}</p></div><div className="mt-3 flex items-end justify-between"><div><p className="font-mono-ui text-[10px] uppercase tracking-[.08em] text-muted-foreground">{fromRate === null ? 'Check availability & current rate' : `From ${currency(fromRate)} / night`}</p><p className="mt-1 text-xs text-muted-foreground">Advance {Math.round(CONFIG.advanceShare * 100)}% · balance after confirmation</p></div><p className="font-journal text-3xl text-primary">{nights > 0 && fromRate !== null ? currency(total) : '—'}</p></div>{nights > 0 && extrasPaise > 0 && <p className="mt-3 border-t border-border pt-3 text-[11px] leading-5 text-muted-foreground" data-testid="text-estimate-extras">Includes {currency(Math.round(extrasPaise / 100))} for {[breakdown.extraChildren + breakdown.extraAdults > 0 ? `${breakdown.extraChildren + breakdown.extraAdults} guest${breakdown.extraChildren + breakdown.extraAdults === 1 ? '' : 's'} above ${ratePlan.data?.maxGuests ?? 5}` : null, breakdown.pets > 0 ? `${breakdown.pets} pet${breakdown.pets === 1 ? '' : 's'}` : null].filter(Boolean).join(' and ')}.</p>}{nights > 0 && <div className="mt-3 flex justify-between border-t border-border pt-3 text-xs text-muted-foreground"><span>Advance estimate: {currency(advance)}</span><span>Balance: {currency(balance)}</span></div>}</div>{submitError && <p className="flex items-start gap-2 rounded-xl border border-[#A65E45]/40 bg-[#A65E45]/5 px-4 py-3 text-[13px] leading-6 text-[#A65E45]" role="alert" data-testid="text-submit-error"><CircleAlert size={15} className="mt-0.5 shrink-0" /><span>{submitError}</span></p>}<div className="flex flex-col gap-3 sm:flex-row"><button type="submit" disabled={Boolean(dateConflict)} className="flex flex-1 items-center justify-center gap-2 rounded-full bg-primary px-5 py-4 text-xs font-bold uppercase tracking-[.11em] text-primary-foreground transition-transform hover:-translate-y-0.5 active:scale-95 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-40" data-testid="button-submit-enquiry">Send enquiry <ArrowRight size={15} /></button><button type="submit" onClick={() => setHandOffToWhatsApp(true)} disabled={Boolean(dateConflict)} className="flex items-center justify-center gap-2 rounded-full border border-primary/25 px-5 py-4 text-xs font-bold uppercase tracking-[.11em] text-primary transition-colors hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-40" data-testid="link-booking-whatsapp"><MessageCircle size={16} /> WhatsApp</button></div><p className="text-center text-[10px] leading-4 text-muted-foreground">Availability and final pricing are confirmed by the host. By sending an enquiry you agree to our <a href={`${basePath}/house-rules`} className="underline decoration-accent decoration-1 underline-offset-2 hover:text-primary" data-testid="link-form-house-rules">house rules</a>.</p></form>}
            </div>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------- neighbourhood
            A taste of it. All eighteen places, with their road distances from
            the villa, live on /places-to-visit-in-shantiniketan — a page that
            answers a question people ask Google before they have chosen
            anywhere to stay. */}
        <section id="experience" className="scroll-mt-24 section-shell py-24 md:py-32" aria-labelledby="experience-title">
          <div className="flex flex-col justify-between gap-8 md:flex-row md:items-end">
            <div>
              <p className="eyebrow mb-5 text-accent">The neighbourhood</p>
              <h2 id="experience-title" className="font-journal text-5xl leading-[.94] text-primary md:text-7xl">Make room<br /><em>for wandering.</em></h2>
            </div>
            <p className="max-w-[330px] text-sm leading-6 text-muted-foreground">
              Shantiniketan is best met in fragments: a red-earth path, a market
              pause, a late return home.
            </p>
          </div>

          <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {NEIGHBOURHOOD_TEASER.map((place) => (
              <a
                key={place.title}
                href={`${basePath}/places-to-visit-in-shantiniketan`}
                className="group flex items-start gap-4 rounded-[1.25rem] border border-border bg-card p-5 transition-colors hover:border-primary"
                data-testid={`teaser-${place.title.toLowerCase().replace(/[^a-z]+/g, '-')}`}
              >
                <Landmark size={18} className="mt-1 shrink-0 text-primary/60" strokeWidth={1.4} />
                <span className="min-w-0">
                  <span className="block font-journal text-xl leading-tight text-primary">{place.title}</span>
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">{place.note}</span>
                  <span className="mt-2 block font-journal text-lg text-accent">{place.distance}</span>
                </span>
              </a>
            ))}
          </div>

          <a
            href={`${basePath}/places-to-visit-in-shantiniketan`}
            className="mt-9 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[.1em] text-primary underline decoration-accent decoration-2 underline-offset-4"
            data-testid="link-places-page"
          >
            Read more &mdash; all {NEIGHBOURHOOD_COUNT} places, with distances <ArrowUpRight size={14} />
          </a>
        </section>

        <section id="food" className="scroll-mt-24 border-y border-border bg-card py-24 md:py-32" aria-labelledby="food-title">
          <div className="section-shell"><div className="flex flex-col justify-between gap-8 md:flex-row md:items-end"><div><p className="eyebrow mb-5 text-accent">Eat at your pace</p><h2 id="food-title" className="font-journal text-5xl leading-[.94] text-primary md:text-7xl">A kitchen<br /><em>with options.</em></h2></div><p className="max-w-[290px] text-sm leading-6 text-muted-foreground">The best meal plan is the one that leaves room for another cup of tea.</p></div>
            <div className="mt-14 grid gap-4 md:grid-cols-3">
              {[
                { icon: Sparkles, title: 'Cafe Soi', text: 'Cafe Soi is inside the premises when you want a meal without leaving your little orbit.' },
                { icon: CookingPot, title: 'Make it yours', text: 'Basic cooking utensils, induction setup, microwave, refrigerator and a water filter are available.' },
                { icon: HeartHandshake, title: 'Cooked with care', text: 'Ask the caretaker about the home-cooked meal option. Zomato is available too.' },
              ].map(({ icon: Icon, title, text }, index) => <div key={title} className={`lift rounded-[1.4rem] p-7 ${index === 1 ? 'bg-primary text-primary-foreground' : 'border border-border bg-background'}`}><Icon size={24} className={index === 1 ? 'text-secondary' : 'text-accent'} strokeWidth={1.4} /><p className="mt-16 font-journal text-3xl">{title}</p><p className={`mt-4 text-sm leading-6 ${index === 1 ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>{text}</p></div>)}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------- gallery
            A teaser, not the gallery. The twelve photographs live on /gallery
            so the homepage does not make every visitor download a megabyte of
            pictures to reach the enquiry form below them. */}
        <section id="gallery" className="scroll-mt-24 section-shell py-24 md:py-36" aria-labelledby="gallery-title">
          <div className="flex flex-col justify-between gap-8 md:flex-row md:items-end">
            <div>
              <p className="eyebrow mb-5 text-accent">A visual diary</p>
              <h2 id="gallery-title" className="font-journal text-5xl leading-[.94] text-primary md:text-7xl">A look<br /><em>around home.</em></h2>
            </div>
            <a
              href={`${basePath}/gallery`}
              className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[.1em] text-primary underline decoration-accent decoration-2 underline-offset-4"
              data-testid="link-gallery-page"
            >
              View all photos <ArrowUpRight size={14} />
            </a>
          </div>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 md:gap-5">
            {GALLERY_TEASER.map((photo) => (
              <a
                key={photo.file}
                href={`${basePath}/gallery`}
                className="group relative block min-h-[280px] overflow-hidden rounded-[1.4rem] md:min-h-[420px]"
                data-testid={`gallery-teaser-${photo.file.split('.')[0]!.toLowerCase().replace(/%20|\s/g, '-')}`}
              >
                <img
                  src={asset(photo.file)}
                  alt={photo.alt}
                  width={photo.width}
                  height={photo.height}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.05]"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 p-4">
                  <p className="font-journal text-2xl leading-none text-white md:text-3xl">{photo.title}</p>
                </div>
              </a>
            ))}
          </div>
        </section>

        <section className="border-t border-border bg-card py-24 md:py-32" aria-labelledby="faq-title">
          {/* One centred column, not the wide two-column split this section
              used to be. Five short answers spread across a 1180px page read
              as a list of loose ends; held to a single readable measure they
              read as a set. Each question is its own card, so an open answer
              belongs visibly to the question above it. */}
          <div className="mx-auto w-full max-w-[780px] px-5 md:px-8">
            <div className="text-center">
              <p className="eyebrow mb-4 text-accent">Before you arrive</p>
              <h2 id="faq-title" className="font-journal text-4xl leading-[.96] text-primary md:text-5xl">
                The useful <em>answers.</em>
              </h2>
            </div>

            <div className="mt-12 flex flex-col gap-3">
              {faqs.map((faq, index) => {
                const isOpen = openFaq === index;
                return (
                  <div
                    key={faq.question}
                    className={`overflow-hidden rounded-2xl border bg-background transition-colors ${isOpen ? 'border-accent' : 'border-border'}`}
                  >
                    <button
                      onClick={() => setOpenFaq(isOpen ? null : index)}
                      className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left md:px-6 md:py-5"
                      aria-expanded={isOpen}
                      data-testid={`button-faq-${index}`}
                    >
                      <span className="font-journal text-lg text-primary md:text-xl">{faq.question}</span>
                      <span
                        className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border text-primary transition-transform ${isOpen ? 'rotate-180' : ''}`}
                      >
                        {isOpen ? <X size={15} /> : <ChevronDown size={15} />}
                      </span>
                    </button>
                    <div
                      className={`grid transition-[grid-template-rows,opacity] duration-300 ${isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
                    >
                      <div className="overflow-hidden">
                        <p className="px-5 pb-5 text-sm leading-6 text-muted-foreground md:px-6 md:pb-6">
                          {faq.answer}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-10 text-center">
              <a
                href={`${basePath}/house-rules`}
                className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[.1em] text-primary underline decoration-accent decoration-2 underline-offset-4"
                data-testid="link-faq-house-rules"
              >
                Read the full house rules <ArrowUpRight size={14} />
              </a>
            </div>
          </div>
        </section>

        <section id="reviews" className="scroll-mt-24 section-shell py-24 md:py-32" aria-labelledby="reviews-title">
          <div className="grid gap-12 lg:grid-cols-[.7fr_1.3fr] lg:gap-24"><div><p className="eyebrow mb-5 text-accent">From our guests</p><h2 id="reviews-title" className="font-journal text-5xl leading-[.94] text-primary md:text-6xl">Kind<br /><em>words.</em></h2><a href={CONFIG.leaveReviewUrl} target="_blank" rel="noreferrer" className="mt-8 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[.1em] text-primary underline decoration-accent decoration-2 underline-offset-4" data-testid="link-google-review">Leave a Google review <ExternalLink size={14} /></a></div><div className="grid gap-4 sm:grid-cols-2"><img src={IMG.review1} alt="Guest review card: Sukanta Moule on the space, kitchen and value for families" width={768} height={1376} loading="lazy" decoding="async" className="w-full rounded-[1.4rem] object-cover shadow-sm" /><img src={IMG.review2} alt="Guest review card: Adrija Banerjee on a quiet, pet-friendly stay and a helpful owner" width={656} height={1604} loading="lazy" decoding="async" className="w-full rounded-[1.4rem] object-cover shadow-sm" /></div></div>
        </section>

      </main>

      {/* A slim band, laid out like the header rather than the four-column
          block this used to be: brand and contacts on one row, every page on
          the next, the small print on a third. The tall empty column under
          the tagline is gone. It scrolls with the page — only the header is
          pinned. */}
      <footer className="bg-[#172d25] py-8 pb-28 text-[#f5eadb] md:pb-8" data-testid="site-footer">
        <div className="section-shell">
          {/* Row one — who this is, and how to reach them. */}
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#e4c9a4] text-[#172d25]"><Leaf size={17} /></span>
              <span>
                <span className="block font-mono-ui text-[10px] tracking-[.18em] text-[#f5eadb]/70">RAJ KUTHIR</span>
                <span className="font-journal text-xl leading-tight">Homestays</span>
              </span>
              <span className="hidden border-l border-[#f5eadb]/15 pl-4 text-xs leading-5 text-[#f5eadb]/55 lg:block">Sobuj Potro — a private home in nature,<br />in Bolpur / Shantiniketan.</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-[#f5eadb]/70">
              <a href={CONFIG.instagramUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 transition-colors hover:text-[#e4c9a4]" data-testid="link-footer-instagram"><Instagram size={15} /> Instagram</a>
              <a href={CONFIG.reviewUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 transition-colors hover:text-[#e4c9a4]" data-testid="link-footer-review"><Star size={15} /> Google Reviews</a>
              <a href={phoneHref(CONFIG.hostPhone)} className="flex items-center gap-2 transition-colors hover:text-[#e4c9a4]" data-testid="link-footer-call"><Phone size={15} /> {CONFIG.hostPhone}</a>
            </div>
          </div>

          {/* Row two — every page, inline. The same seven links, one line of
              height instead of seven. */}
          <nav className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[#f5eadb]/15 pt-5 text-sm text-[#f5eadb]/70" aria-label="Footer navigation">
            <a href={`${basePath}/our-story`} className="transition-colors hover:text-[#e4c9a4]" data-testid="link-footer-story">Our story</a>
            <a href={`${basePath}/places-to-visit-in-shantiniketan`} className="transition-colors hover:text-[#e4c9a4]" data-testid="link-footer-places">Places to visit</a>
            <a href={`${basePath}/gallery`} className="transition-colors hover:text-[#e4c9a4]" data-testid="link-footer-gallery">Photos</a>
            <a href={`${basePath}/pet-friendly-homestay-shantiniketan`} className="transition-colors hover:text-[#e4c9a4]" data-testid="link-footer-pet">Staying with a pet</a>
            <a href={`${basePath}/rates`} className="transition-colors hover:text-[#e4c9a4]" data-testid="link-footer-rates">Rates</a>
            <a href={`${basePath}/house-rules`} className="transition-colors hover:text-[#e4c9a4]" data-testid="link-footer-house-rules">House rules</a>
            <a href={`${basePath}/welcome`} className="transition-colors hover:text-[#e4c9a4]" data-testid="link-footer-welcome">Arriving guests</a>
          </nav>

          {/* Row three — the small print. */}
          <div className="mt-5 flex flex-col justify-between gap-2 border-t border-[#f5eadb]/15 pt-4 text-[10px] uppercase tracking-[.13em] text-[#f5eadb]/40 sm:flex-row">
            <p>© {new Date().getFullYear()} Raj Kuthir Homestays</p>
            <p>Made for slower days</p>
          </div>
        </div>
      </footer>

      {/* The two things a guest needs that are not on the page: how to get
          here, and what to do once they have booked. Both follow them down
          every screen. The stack sits clear of the mobile contact bar below
          it; on a laptop it takes the bottom-right corner, where nothing
          else lives. */}
      <div className="fixed bottom-[5.4rem] right-3 z-40 flex flex-col items-end gap-2 md:bottom-6 md:right-6">
        <a
          href={CONFIG.mapsUrl}
          target="_blank"
          rel="noreferrer"
          onClick={() => track('directions_click', { placement: 'floating' })}
          className="group flex items-center gap-2 rounded-full bg-secondary px-4 py-3 text-primary shadow-xl ring-1 ring-primary/15 transition-transform hover:-translate-y-0.5 active:scale-95 md:gap-3 md:px-5 md:py-4"
          aria-label="Get directions to Raj Kuthir Homestays on Google Maps"
          data-testid="link-floating-directions"
        >
          <Navigation size={17} strokeWidth={1.7} className="shrink-0" />
          <span className="text-[11px] font-bold uppercase tracking-[.1em]">Get directions</span>
        </a>
        <a
          href={`${basePath}/welcome`}
          onClick={() => track('arrival_pack_click', { placement: 'floating' })}
          className="group flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-primary-foreground shadow-xl ring-1 ring-secondary/25 transition-transform hover:-translate-y-0.5 active:scale-95 md:gap-3 md:px-5 md:py-4"
          aria-label="Open my arrival pack — for guests with a confirmed booking"
          data-testid="link-floating-arrival"
        >
          <KeyRound size={17} strokeWidth={1.6} className="shrink-0" />
          <span className="text-[11px] font-bold uppercase tracking-[.1em]">Arrival pack</span>
        </a>
      </div>

      <div className="fixed inset-x-3 bottom-3 z-40 flex items-center gap-2 rounded-full border border-border bg-background/95 p-2 shadow-lg backdrop-blur-md md:hidden" data-testid="mobile-contact-bar"><a href={phoneHref(CONFIG.hostPhone)} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-secondary text-primary" aria-label="Call host" data-testid="button-sticky-call"><Phone size={18} /></a><a href={whatsappUrl} target="_blank" rel="noreferrer" className="flex flex-1 items-center justify-center gap-2 rounded-full bg-primary py-3 text-xs font-bold uppercase tracking-[.1em] text-primary-foreground" data-testid="button-sticky-whatsapp"><MessageCircle size={16} /> Enquire on WhatsApp</a><button onClick={scrollToAvailability} className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-border text-primary" aria-label="Book now" data-testid="button-sticky-book"><CalendarDays size={18} /></button></div>
    </div>
  );
}

function HouseIcon(props: { size?: number; strokeWidth?: number; className?: string }) {
  return <svg width={props.size ?? 20} height={props.size ?? 20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={props.strokeWidth ?? 2} strokeLinecap="round" strokeLinejoin="round" className={props.className} aria-hidden="true"><path d="m3 11 9-8 9 8" /><path d="M5 10v10h14V10" /><path d="M9 20v-6h6v6" /></svg>;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/house-rules" component={HouseRules} />
        {/* SEO landing page. Adding a route here also requires an entry in
            api-server/src/lib/seo.ts — a test enforces it. */}
        <Route path="/pet-friendly-homestay-shantiniketan" component={PetFriendly} />
        <Route path="/gallery" component={Gallery} />
        <Route path="/our-story" component={OurStory} />
        <Route path="/places-to-visit-in-shantiniketan" component={PlacesToVisit} />
        {/* Public rate card, read live from /api/rates. */}
        <Route path="/rates" component={Rates} />
        {/* Guest arrival pack, unlocked with a booking reference. */}
        <Route path="/welcome" component={Welcome} />
        {/* Capability links. The token rides in the URL fragment, not the
            path, so it never reaches the server, the proxy access log or a
            Referer header — see the note in PreArrival.tsx. The path itself
            carries no parameter and is safe to serve to anyone. */}
        <Route path="/pre-arrival" component={PreArrival} />
        <Route path="/management-documents" component={ManagementDocuments} />
        <Route path="/admin" component={AdminDashboard} />
        <Route path="/admin/login" component={AdminLogin} />
        <Route path="/admin/earnings" component={AdminEarnings} />
        <Route path="/admin/rates" component={AdminRates} />
        <Route path="/admin/guests" component={AdminGuests} />
        <Route path="/admin/guest-info" component={AdminGuestInfo} />
        {/* Legacy sign-in path, kept so existing bookmarks still land somewhere useful. */}
        <Route path="/sign-in/*?" component={AdminLogin} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={basePath}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
