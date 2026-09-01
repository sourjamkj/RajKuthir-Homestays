import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type CalendarEvent, type CalendarSourceStatus, useSyncCalendars } from '@workspace/api-client-react';
import { ClerkProvider, Show, SignIn, useAuth, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import {
  ArrowRight,
  ArrowUpRight,
  AlertCircle,
  Baby,
  BedDouble,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Car,
  Check,
  ChevronDown,
  CircleCheck,
  CookingPot,
  Copy,
  Dog,
  ExternalLink,
  GalleryHorizontalEnd,
  HeartHandshake,
  Instagram,
  Landmark,
  Leaf,
  MapPin,
  Menu,
  MessageCircle,
  Navigation,
  PawPrint,
  Phone,
  Quote,
  Refrigerator,
  RefreshCw,
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
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient();

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in environment.');
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/favicon.svg`,
  },
  variables: {
    colorPrimary: '#2d6658',
    colorForeground: '#23493f',
    colorMutedForeground: '#65766f',
    colorDanger: '#a4513c',
    colorBackground: '#f6f0e7',
    colorInput: '#fffdf8',
    colorInputForeground: '#23493f',
    colorNeutral: '#d9cfc1',
    fontFamily: 'Manrope, sans-serif',
    borderRadius: '0.75rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[#f6f0e7] rounded-2xl w-[440px] max-w-full overflow-hidden',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#23493f] font-serif',
    headerSubtitle: 'text-[#65766f]',
    socialButtonsBlockButtonText: 'text-[#23493f]',
    formFieldLabel: 'text-[#23493f]',
    footerActionLink: 'text-[#2d6658]',
    footerActionText: 'text-[#65766f]',
    dividerText: 'text-[#65766f]',
    formButtonPrimary: 'bg-[#2d6658] hover:bg-[#23493f]',
    formFieldInput: 'bg-[#fffdf8] border-[#d9cfc1] text-[#23493f]',
    footerAction: 'hidden',
    dividerLine: 'bg-[#d9cfc1]',
  },
};

// EDITABLE OWNER CONFIG: update rate, contact details and planning notes here.
const CONFIG = {
  name: 'RAJ KUTHIR HOMESTAYS',
  chapter: 'SOBUJ POTRO',
  place: 'Bolpur / Shantiniketan, West Bengal',
  ratePerNight: 6800,
  advanceShare: 0.3,
  hostPhone: '+91 62903 99165',
  caretakerPhone: '+91 78726 85558',
  mapsUrl: 'https://maps.app.goo.gl/D1tUUb3JfpVdcHwu5',
  instagramUrl: 'https://www.instagram.com/rajkuthirhomestays?igsh=MTBkOWljNTZmbWttdg==',
  reviewUrl: 'https://maps.app.goo.gl/Ptrm6eaXuXNoiXBbA?g_st=ac',
  attractions: [
    { title: 'Sonajhuri', distance: '~4 km', note: 'Editable planning note' },
    { title: 'Local market / main attraction', distance: '~3 km', note: 'Editable planning note' },
  ],
} as const;

const NAV_ITEMS = [
  { label: 'Stay', href: '#stay' },
  { label: 'Experience', href: '#experience' },
  { label: 'Pet Friendly', href: '#pet-friendly' },
  { label: 'Food', href: '#food' },
  { label: 'Gallery', href: '#gallery' },
  { label: 'Location', href: '#location' },
  { label: 'Availability', href: '#availability' },
  { label: 'Reviews', href: '#reviews' },
];

type FeedKey = 'bookingCom' | 'airbnb' | 'makeMyTrip';
type BusyPeriod = {
  id: string;
  source: string;
  label: string;
  start: string;
  end: string;
};

const CALENDAR_FEEDS: Array<{ key: FeedKey; label: string; hint: string }> = [
  { key: 'bookingCom', label: 'Booking.com', hint: 'Paste the property iCal export URL' },
  { key: 'airbnb', label: 'Airbnb', hint: 'Paste the listing calendar export URL' },
  { key: 'makeMyTrip', label: 'MakeMyTrip', hint: 'Paste an iCal link if your partner account provides one' },
];

const DEMO_BOOKINGS: BusyPeriod[] = [
  { id: 'demo-kalpana', source: 'Direct', label: 'Confirmed booking', start: '2026-09-02', end: '2026-09-05' },
  { id: 'demo-biman', source: 'MakeMyTrip', label: 'OTA booking', start: '2026-09-05', end: '2026-09-08' },
  { id: 'demo-reetuparna', source: 'Direct', label: 'Offline booking', start: '2026-09-17', end: '2026-09-25' },
];

const galleryItems = [
  { title: 'The villa', category: 'Home', note: 'Property photography to be added', tone: 'sage' },
  { title: 'Garden hour', category: 'Nature', note: 'Property photography to be added', tone: 'clay' },
  { title: 'A quiet corner', category: 'Details', note: 'Property photography to be added', tone: 'ochre' },
  { title: 'Shantiniketan light', category: 'Nature', note: 'Shantiniketan image to be added', tone: 'ink' },
  { title: 'Shared table', category: 'Details', note: 'Property photography to be added', tone: 'clay' },
  { title: 'Arrive slowly', category: 'Home', note: 'Property photography to be added', tone: 'sage' },
];

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

const phoneHref = (phone: string) => `tel:${phone.replace(/\s/g, '')}`;

const CALENDAR_STORAGE_KEY = 'raj-kuthir-calendar-feeds';

const sourceLabel = (source: string) =>
  CALENDAR_FEEDS.find((feed) => feed.key === source)?.label ?? source;

const dateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const displayDate = (date: Date) =>
  new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(date);

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

const toBusyPeriod = (event: CalendarEvent): BusyPeriod => ({
  id: event.id,
  source: sourceLabel(event.source),
  label: event.title || 'OTA booking',
  start: eventDateKey(event.start),
  end: eventDateKey(event.end),
});

function Home() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [galleryFilter, setGalleryFilter] = useState('All');
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [submitted, setSubmitted] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [feeds, setFeeds] = useState<Record<FeedKey, string>>(() => {
    if (typeof window === 'undefined') {
      return { bookingCom: '', airbnb: '', makeMyTrip: '' };
    }
    try {
      const stored = JSON.parse(window.localStorage.getItem(CALENDAR_STORAGE_KEY) || '{}') as Partial<Record<FeedKey, string>>;
      return {
        bookingCom: stored.bookingCom || '',
        airbnb: stored.airbnb || '',
        makeMyTrip: stored.makeMyTrip || '',
      };
    } catch {
      return { bookingCom: '', airbnb: '', makeMyTrip: '' };
    }
  });
  const [syncedEvents, setSyncedEvents] = useState<BusyPeriod[]>([]);
  const [sourceStatuses, setSourceStatuses] = useState<CalendarSourceStatus[]>([]);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const calendarSync = useSyncCalendars();

  useEffect(() => {
    window.localStorage.setItem(CALENDAR_STORAGE_KEY, JSON.stringify(feeds));
  }, [feeds]);

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

  const nights = useMemo(() => {
    if (!form.checkIn || !form.checkOut) return 0;
    const start = new Date(`${form.checkIn}T00:00:00`);
    const end = new Date(`${form.checkOut}T00:00:00`);
    const difference = Math.ceil((end.getTime() - start.getTime()) / 86400000);
    return Number.isFinite(difference) && difference > 0 ? difference : 0;
  }, [form.checkIn, form.checkOut]);

  const total = nights * CONFIG.ratePerNight;
  const advance = Math.round(total * CONFIG.advanceShare);
  const balance = total - advance;
  const filteredGallery = galleryFilter === 'All' ? galleryItems : galleryItems.filter((item) => item.category === galleryFilter);
  const busyPeriods = useMemo(() => [...DEMO_BOOKINGS, ...syncedEvents], [syncedEvents]);
  const daysInView = useMemo(() => calendarDays(calendarMonth), [calendarMonth]);
  const calendarMonthLabel = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(calendarMonth);
  const whatsappCopy = encodeURIComponent(
    `Hello Raj Kuthir, I would like to enquire about Sobuj Potro.\nName: ${form.name || 'To be shared'}\nDates: ${form.checkIn || 'To be confirmed'} to ${form.checkOut || 'To be confirmed'}${nights ? ` (${nights} night${nights === 1 ? '' : 's'})` : ''}\nGuests: ${form.adults} adults, ${form.children} children, ${form.pets} pets\nPhone: ${form.phone || 'To be shared'}`
  );
  const whatsappUrl = `https://wa.me/916290399165?text=${whatsappCopy}`;

  const scrollToBooking = () => {
    document.getElementById('booking')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setMenuOpen(false);
  };

  const submitEnquiry = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
  };

  const syncCalendarFeeds = () => {
    calendarSync.mutate(
      { data: feeds },
      {
        onSuccess: (response) => {
          setSyncedEvents(response.events.map(toBusyPeriod));
          setSourceStatuses(response.sources);
          setLastSyncedAt(new Date(response.syncedAt).toISOString());
        },
      },
    );
  };

  const shiftCalendarMonth = (amount: number) => {
    setCalendarMonth((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1));
  };

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="fixed inset-x-0 top-0 z-50 border-b border-foreground/10 bg-background/90 backdrop-blur-md" data-testid="site-header">
        <div className="section-shell flex h-[74px] items-center justify-between">
          <a href="#top" className="group flex items-center gap-3" data-testid="link-brand">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-primary text-primary-foreground">
              <Leaf size={19} strokeWidth={1.7} />
            </span>
            <span className="leading-none">
              <span className="block font-mono-ui text-[10px] font-medium tracking-[.18em] text-muted-foreground">RAJ KUTHIR</span>
              <span className="font-journal text-[19px] text-primary">Homestays</span>
            </span>
          </a>

          <nav className="hidden items-center gap-5 lg:flex" aria-label="Main navigation">
            {NAV_ITEMS.map((item) => (
              <a key={item.href} href={item.href} className="text-[11px] font-bold uppercase tracking-[.1em] text-muted-foreground transition-colors hover:text-primary" data-testid={`link-nav-${item.label.toLowerCase().replace(/\s/g, '-')}`}>
                {item.label}
              </a>
            ))}
          </nav>

          <div className="hidden items-center gap-4 md:flex">
            <a href={phoneHref(CONFIG.hostPhone)} className="flex items-center gap-2 text-xs font-bold text-primary" data-testid="link-header-call">
              <Phone size={14} /> Call host
            </a>
            <button onClick={scrollToBooking} className="rounded-full bg-primary px-5 py-3 text-xs font-bold uppercase tracking-[.12em] text-primary-foreground transition-transform hover:-translate-y-0.5 active:scale-95" data-testid="button-header-book">
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
              <button onClick={scrollToBooking} className="mt-2 rounded-full bg-primary px-5 py-3 text-xs font-bold uppercase tracking-[.12em] text-primary-foreground" data-testid="button-mobile-book">
                Check availability
              </button>
            </nav>
          </div>
        )}
      </header>

      <main id="top">
        <section className="relative overflow-hidden pb-16 pt-32 md:pb-24 md:pt-40" aria-labelledby="hero-title">
          <div className="absolute right-[-8rem] top-[-5rem] h-[28rem] w-[28rem] rounded-full bg-secondary/45 blur-3xl" aria-hidden="true" />
          <div className="section-shell relative grid items-center gap-12 lg:grid-cols-[.9fr_1.1fr] lg:gap-20">
            <div className="reveal">
              <p className="eyebrow mb-6 text-accent">A private home in nature</p>
              <h1 id="hero-title" className="max-w-[680px] font-journal text-[clamp(3.5rem,9vw,7.7rem)] leading-[.88] tracking-[-.045em] text-primary">
                Stay for the<br /><em className="text-accent">unhurried</em> hours.
              </h1>
              <p className="mt-8 max-w-[475px] text-[15px] leading-7 text-muted-foreground md:text-[17px]">
                An entire two-bedroom villa in Bolpur, made for couples, families and the four-legged members of the family. Come to Shantiniketan. Take your time.
              </p>
              <div className="mt-9 flex flex-wrap items-center gap-4">
                <button onClick={scrollToBooking} className="group flex items-center gap-3 rounded-full bg-primary px-6 py-4 text-xs font-bold uppercase tracking-[.12em] text-primary-foreground transition-all hover:-translate-y-1 hover:shadow-lg active:scale-95" data-testid="button-hero-book">
                  Check availability <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
                </button>
                <a href="#stay" className="flex items-center gap-2 px-2 py-3 text-xs font-bold uppercase tracking-[.12em] text-primary" data-testid="link-hero-stay">
                  Read the story <ArrowUpRight size={15} />
                </a>
              </div>
              <p className="mt-7 flex items-center gap-2 text-xs text-muted-foreground"><MapPin size={14} className="text-accent" /> {CONFIG.place}</p>
            </div>
            <div className="reveal reveal-delay-2 relative">
              <div className="image-placeholder min-h-[410px] rounded-[2rem] p-6 shadow-xl md:min-h-[560px]" aria-label="Property photography placeholder">
                <div className="relative flex h-full min-h-[358px] flex-col justify-between rounded-[1.45rem] border border-primary-foreground/30 p-6 text-primary-foreground md:min-h-[508px] md:p-8">
                  <div className="flex items-start justify-between">
                    <span className="eyebrow rounded-full border border-primary-foreground/30 px-3 py-2">Sobuj Potro · 01</span>
                    <Sparkles size={20} strokeWidth={1.4} />
                  </div>
                  <div>
                    <p className="eyebrow mb-3 text-secondary">Visual to come</p>
                    <p className="max-w-[270px] font-journal text-4xl leading-[.95] md:text-5xl">Property photography to be added</p>
                    <p className="mt-4 max-w-[260px] text-xs leading-5 text-primary-foreground/75">A considered frame of the villa, garden and the light around it will live here.</p>
                  </div>
                </div>
              </div>
              <div className="absolute -bottom-5 -left-4 hidden max-w-[190px] rounded-2xl bg-secondary px-5 py-4 text-primary shadow-lg sm:block">
                <p className="font-journal text-xl leading-tight">A home, not a room.</p>
                <p className="mt-2 font-mono-ui text-[9px] uppercase tracking-[.13em]">Entire villa · private garden</p>
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

        <section className="section-shell py-24 md:py-36" aria-labelledby="intro-title">
          <div className="grid gap-12 lg:grid-cols-[.75fr_1.25fr] lg:gap-28">
            <div>
              <p className="eyebrow mb-5 text-accent">The idea</p>
              <h2 id="intro-title" className="font-journal text-5xl leading-[.95] text-primary md:text-7xl">Come as guests.<br /><em>Leave lighter.</em></h2>
            </div>
            <div className="max-w-[640px]">
              <p className="text-xl leading-8 text-primary md:text-2xl md:leading-9">Raj Kuthir is a small invitation to do Shantiniketan differently: with a morning that does not need an itinerary, a garden that belongs to your group, and a house that lets everyone find their own corner.</p>
              <div className="mt-9 grid gap-7 border-t border-border pt-7 sm:grid-cols-2">
                <div><p className="font-journal text-3xl text-accent">01</p><p className="mt-2 text-sm leading-6 text-muted-foreground">A private home in nature for the pace of real life.</p></div>
                <div><p className="font-journal text-3xl text-accent">02</p><p className="mt-2 text-sm leading-6 text-muted-foreground">Warm Bengali hospitality, led by a thoughtful local team.</p></div>
              </div>
            </div>
          </div>
        </section>

        <section id="stay" className="scroll-mt-24 bg-primary py-24 text-primary-foreground md:py-32" aria-labelledby="stay-title">
          <div className="section-shell">
            <div className="flex flex-col justify-between gap-8 md:flex-row md:items-end">
              <div><p className="eyebrow mb-5 text-secondary">The stay</p><h2 id="stay-title" className="max-w-[570px] font-journal text-5xl leading-[.94] md:text-7xl">Room to be<br /><em>together.</em></h2></div>
              <p className="max-w-[300px] text-sm leading-6 text-primary-foreground/70">The whole two-bedroom villa is yours. Unpack once, then let the days open up.</p>
            </div>
            <div className="mt-14 grid gap-5 md:grid-cols-[1.15fr_.85fr]">
              <div className="image-placeholder min-h-[385px] rounded-[1.5rem] p-6 md:min-h-[490px]">
                <div className="relative flex h-full min-h-[333px] items-end rounded-[1rem] border border-primary-foreground/25 p-6 md:min-h-[438px]">
                  <div><span className="eyebrow text-secondary">Replace with villa image</span><p className="mt-2 font-journal text-3xl">Property photography to be added</p></div>
                </div>
              </div>
              <div className="grid gap-5 sm:grid-cols-2 md:grid-cols-1">
                <div className="rounded-[1.5rem] border border-primary-foreground/15 bg-primary-foreground/10 p-7">
                  <BedDouble size={25} className="mb-12 text-secondary" strokeWidth={1.4} />
                  <p className="font-journal text-3xl">Two bedrooms.<br />One private home.</p>
                  <p className="mt-4 text-sm leading-6 text-primary-foreground/65">A stay that gives couples and families the freedom to share a table, or not.</p>
                </div>
                <div className="rounded-[1.5rem] bg-secondary p-7 text-primary">
                  <Leaf size={25} className="mb-12 text-primary" strokeWidth={1.4} />
                  <p className="font-journal text-3xl">Your own garden.</p>
                  <p className="mt-4 text-sm leading-6 text-primary/70">A little outdoor space for first tea, last light and paws in the grass.</p>
                </div>
              </div>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {[
                { icon: Car, text: 'On-premise parking' },
                { icon: Wifi, text: 'Wi-Fi' },
                { icon: HeartHandshake, text: 'Warm local care' },
              ].map(({ icon: Icon, text }) => <div key={text} className="flex items-center gap-3 border-t border-primary-foreground/15 py-4 text-sm text-primary-foreground/80"><Icon size={17} className="text-secondary" strokeWidth={1.5} />{text}</div>)}
            </div>
          </div>
        </section>

        <section className="section-shell py-24 md:py-32" aria-labelledby="amenities-title">
          <div className="grid gap-12 lg:grid-cols-[.7fr_1.3fr] lg:gap-24">
            <div><p className="eyebrow mb-5 text-accent">Everything useful</p><h2 id="amenities-title" className="font-journal text-5xl leading-[.95] text-primary md:text-6xl">The small<br /><em>comforts.</em></h2><p className="mt-7 max-w-[300px] text-sm leading-6 text-muted-foreground">The things that make a private stay feel easy, without turning it into a checklist.</p></div>
            <div className="grid grid-cols-2 gap-x-5 gap-y-0 sm:grid-cols-3">
              {[
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
              <div className="image-placeholder min-h-[380px] rounded-[2rem] p-6 shadow-md md:min-h-[490px]" aria-label="Pet-friendly photography placeholder">
                <div className="relative flex h-full min-h-[328px] flex-col justify-between rounded-[1.4rem] border border-primary-foreground/25 p-6 text-primary-foreground md:min-h-[438px]">
                  <Dog size={31} strokeWidth={1.3} />
                  <div><p className="eyebrow text-secondary">Replace with a real moment</p><p className="mt-2 font-journal text-3xl">Pet-friendly story image to be added</p></div>
                </div>
              </div>
            </div>
            <div className="order-1 lg:order-2"><p className="eyebrow mb-5 text-accent">Bring everyone</p><h2 id="pet-title" className="font-journal text-5xl leading-[.94] text-primary md:text-7xl">Good stays<br /><em>include paws.</em></h2><p className="mt-8 max-w-[470px] text-lg leading-8 text-primary/75">This is a home where your pet is welcome, not an exception to negotiate. Tell us who is coming, and we will make the arrival feel comfortable for the whole family.</p><div className="mt-8 flex items-center gap-4 border-t border-primary/15 pt-6"><PawPrint size={23} className="text-accent" strokeWidth={1.5} /><p className="text-sm font-bold text-primary">A genuinely pet-welcoming stay</p></div></div>
          </div>
        </section>

        <section id="experience" className="scroll-mt-24 section-shell py-24 md:py-36" aria-labelledby="experience-title">
          <div className="grid gap-12 lg:grid-cols-[.8fr_1.2fr] lg:gap-24">
            <div><p className="eyebrow mb-5 text-accent">The neighbourhood</p><h2 id="experience-title" className="font-journal text-5xl leading-[.94] text-primary md:text-7xl">Make room<br /><em>for wandering.</em></h2><p className="mt-7 max-w-[320px] text-sm leading-6 text-muted-foreground">Shantiniketan is best met in fragments: a red-earth path, a market pause, a late return home.</p></div>
            <div className="space-y-4">
              {CONFIG.attractions.map((place, index) => <div key={place.title} className="group flex items-center gap-5 border-b border-border py-5 transition-colors hover:border-accent" data-testid={`attraction-${index}`}><span className="font-mono-ui text-xs text-accent">0{index + 1}</span><Landmark size={21} className="text-primary/70" strokeWidth={1.4} /><div className="flex-1"><p className="font-journal text-2xl text-primary">{place.title}</p><p className="mt-1 font-mono-ui text-[9px] uppercase tracking-[.12em] text-muted-foreground">{place.note}</p></div><p className="font-journal text-2xl text-accent">{place.distance}</p><ArrowUpRight size={18} className="text-muted-foreground transition-transform group-hover:-translate-y-1 group-hover:translate-x-1" /></div>)}
              <p className="pt-3 text-xs leading-5 text-muted-foreground">Distances are editable planning notes for the owner and may vary by route.</p>
            </div>
          </div>
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

        <section id="gallery" className="scroll-mt-24 section-shell py-24 md:py-36" aria-labelledby="gallery-title">
          <div className="flex flex-col justify-between gap-8 md:flex-row md:items-end"><div><p className="eyebrow mb-5 text-accent">A visual diary</p><h2 id="gallery-title" className="font-journal text-5xl leading-[.94] text-primary md:text-7xl">Frames to<br /><em>fill later.</em></h2></div><div className="flex flex-wrap gap-2" role="tablist" aria-label="Gallery categories">{['All', 'Home', 'Nature', 'Details'].map((filter) => <button key={filter} onClick={() => setGalleryFilter(filter)} role="tab" aria-selected={galleryFilter === filter} className={`rounded-full border px-4 py-2 text-xs font-bold transition-colors ${galleryFilter === filter ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:border-primary hover:text-primary'}`} data-testid={`button-gallery-${filter.toLowerCase()}`}>{filter}</button>)}</div></div>
          <div className="mt-12 grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-5">
            {filteredGallery.map((item) => <div key={item.title} className={`image-placeholder group min-h-[220px] rounded-[1.25rem] p-4 ${item.tone === 'clay' ? 'before:bg-accent/20' : ''} ${item.tone === 'ochre' ? 'before:bg-secondary/20' : ''} md:min-h-[300px]`} data-testid={`gallery-card-${item.title.toLowerCase().replace(/\s/g, '-')}`}><div className="relative flex h-full min-h-[188px] flex-col justify-between rounded-[.85rem] border border-primary-foreground/20 p-4 text-primary-foreground transition-transform group-hover:scale-[1.02] md:min-h-[268px]"><GalleryHorizontalEnd size={18} className="opacity-75" strokeWidth={1.4} /><div><p className="font-journal text-2xl leading-none">{item.title}</p><p className="mt-2 font-mono-ui text-[9px] uppercase tracking-[.1em] text-primary-foreground/70">{item.note}</p></div></div></div>)}
          </div>
        </section>

        <section id="location" className="scroll-mt-24 bg-primary py-24 text-primary-foreground md:py-32" aria-labelledby="location-title">
          <div className="section-shell grid items-center gap-12 lg:grid-cols-[1fr_1fr] lg:gap-24">
            <div><p className="eyebrow mb-5 text-secondary">Find your way here</p><h2 id="location-title" className="font-journal text-5xl leading-[.94] md:text-7xl">A softer<br /><em>kind of away.</em></h2><p className="mt-8 max-w-[425px] text-lg leading-8 text-primary-foreground/70">In Bolpur / Shantiniketan, West Bengal. Follow the map, then let the pace change.</p><div className="mt-9 flex flex-wrap gap-3"><a href={CONFIG.mapsUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-full bg-secondary px-5 py-3 text-xs font-bold uppercase tracking-[.1em] text-primary transition-transform hover:-translate-y-1" data-testid="link-directions"><Navigation size={15} /> Open directions</a><a href={phoneHref(CONFIG.caretakerPhone)} className="flex items-center gap-2 rounded-full border border-primary-foreground/25 px-5 py-3 text-xs font-bold uppercase tracking-[.1em] text-primary-foreground transition-colors hover:bg-primary-foreground/10" data-testid="link-caretaker-call"><Phone size={15} /> Call caretaker</a></div></div>
            <div className="image-placeholder min-h-[380px] rounded-[2rem] p-6 md:min-h-[460px]"><div className="relative flex h-full min-h-[328px] flex-col justify-between rounded-[1.4rem] border border-primary-foreground/25 p-6 text-primary-foreground md:min-h-[408px]"><div className="flex items-center justify-between"><MapPin size={26} className="text-secondary" /><span className="eyebrow">Map visual to be added</span></div><div><p className="font-journal text-4xl">Shantiniketan image to be added</p><p className="mt-3 text-sm text-primary-foreground/65">Use a real, owner-approved local view here.</p></div></div></div>
          </div>
        </section>

        <section id="availability" className="scroll-mt-24 section-shell py-24 md:py-36" aria-labelledby="availability-title">
          <div className="flex flex-col justify-between gap-8 md:flex-row md:items-end">
            <div>
              <p className="eyebrow mb-5 text-accent">One clear calendar</p>
              <h2 id="availability-title" className="max-w-[650px] font-journal text-5xl leading-[.94] text-primary md:text-7xl">See every<br /><em>stay in one place.</em></h2>
            </div>
            <p className="max-w-[330px] text-sm leading-6 text-muted-foreground">Check the calendar before you plan your stay at Sobuj Potro.</p>
          </div>

          <div className="mt-14 grid gap-5 lg:grid-cols-[.78fr_1.22fr]">
            <Show when="signed-in">
              <div className="rounded-[1.5rem] bg-primary p-6 text-primary-foreground md:p-8">
              <div className="flex items-start justify-between gap-4 border-b border-primary-foreground/15 pb-6">
                <div>
                  <p className="eyebrow text-secondary">Calendar sources</p>
                  <p className="mt-3 font-journal text-3xl">Sync your OTAs.</p>
                </div>
                <Settings2 size={22} className="text-secondary" strokeWidth={1.4} />
              </div>
              <div className="mt-4 flex items-center justify-between gap-4 text-[10px] uppercase tracking-[.08em] text-primary-foreground/55">
                <span>Admin controls</span>
                <AdminSignOutButton />
              </div>
              <div className="mt-6 space-y-5">
                {CALENDAR_FEEDS.map((feed) => {
                  const status = sourceStatuses.find((item) => item.source === feed.key);
                  return (
                    <label key={feed.key} className="block">
                      <span className="flex items-center justify-between gap-3 text-xs font-bold text-primary-foreground">
                        <span>{feed.label}</span>
                        {status && (
                          <span className={`flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[.08em] ${status.status === 'connected' ? 'text-secondary' : status.status === 'error' ? 'text-[#f0a184]' : 'text-primary-foreground/50'}`}>
                            {status.status === 'connected' ? <Check size={12} /> : status.status === 'error' ? <AlertCircle size={12} /> : null}
                            {status.status}
                          </span>
                        )}
                      </span>
                      <input
                        type="url"
                        value={feeds[feed.key]}
                        onChange={(event) => setFeeds((current) => ({ ...current, [feed.key]: event.target.value }))}
                        placeholder={feed.hint}
                        className="mt-2 w-full rounded-lg border border-primary-foreground/20 bg-primary-foreground/10 px-3 py-3 text-xs text-primary-foreground outline-none placeholder:text-primary-foreground/40 focus:border-secondary"
                        aria-label={`${feed.label} iCal feed URL`}
                        data-testid={`input-calendar-${feed.key}`}
                      />
                      {status?.message && <span className={`mt-2 block text-[10px] leading-4 ${status.status === 'error' ? 'text-[#f0a184]' : 'text-primary-foreground/55'}`}>{status.message}</span>}
                    </label>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={syncCalendarFeeds}
                disabled={calendarSync.isPending}
                className="mt-7 flex w-full items-center justify-center gap-2 rounded-full bg-secondary px-5 py-4 text-xs font-bold uppercase tracking-[.11em] text-primary transition-transform hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-70"
                data-testid="button-sync-calendars"
              >
                <RefreshCw size={15} className={calendarSync.isPending ? 'animate-spin' : ''} />
                {calendarSync.isPending ? 'Syncing feeds' : 'Sync calendars'}
              </button>
              {calendarSync.isError && <p className="mt-3 text-center text-[10px] leading-4 text-[#f0a184]">The calendar service could not be reached. Please try again.</p>}
              <AdminFeedLink />
                <p className="mt-5 text-[10px] leading-4 text-primary-foreground/50">Leave a field blank to use the securely stored owner feed. Any URL entered here is sent only when you press Sync calendars and is not shown to guests.</p>
              </div>
            </Show>
            <Show when="signed-out">
              <div className="flex min-h-[420px] flex-col justify-between rounded-[1.5rem] border border-border bg-card p-6 md:p-8">
                <div>
                  <p className="eyebrow text-accent">Guest view</p>
                  <p className="mt-4 max-w-[300px] font-journal text-4xl leading-tight text-primary">Availability is managed privately by the host.</p>
                  <p className="mt-5 max-w-[320px] text-sm leading-6 text-muted-foreground">Browse the calendar here. Dates are updated by the host as reservations change.</p>
                </div>
                <a href={`${basePath}/sign-in`} className="mt-8 inline-flex w-fit items-center gap-2 rounded-full bg-primary px-5 py-3 text-xs font-bold uppercase tracking-[.1em] text-primary-foreground transition-transform hover:-translate-y-0.5" data-testid="link-admin-sign-in">Admin sign in <ArrowUpRight size={15} /></a>
              </div>
            </Show>

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

              <div className="mt-6 grid grid-cols-7 gap-1.5 text-center">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <p key={day} className="pb-2 font-mono-ui text-[9px] uppercase tracking-[.08em] text-muted-foreground">{day}</p>)}
                {daysInView.map((day) => {
                  const key = dateKey(day);
                  const dayEvents = busyPeriods.filter((event) => eventTouchesDay(event, key));
                  const isOutsideMonth = day.getMonth() !== calendarMonth.getMonth();
                  const isToday = key === dateKey(new Date());
                  return (
                    <div key={key} className={`min-h-[76px] rounded-lg border p-2 text-left transition-colors ${isOutsideMonth ? 'border-transparent bg-background/40 opacity-35' : dayEvents.length ? 'border-accent/35 bg-secondary/40' : 'border-border bg-background'} ${isToday ? 'ring-2 ring-accent/60 ring-offset-1 ring-offset-card' : ''}`} data-testid={`calendar-day-${key}`}>
                      <p className={`text-xs font-bold ${isToday ? 'text-accent' : 'text-primary'}`}>{day.getDate()}</p>
                      <div className="mt-2 space-y-1">
                        {dayEvents.slice(0, 2).map((event) => <div key={`${event.id}-${key}`} className={`truncate rounded px-1.5 py-1 text-[9px] font-bold leading-none text-primary ${event.source === 'Airbnb' ? 'bg-[#e7aa84]' : event.source === 'Booking.com' ? 'bg-[#9eb5a7]' : event.source === 'MakeMyTrip' ? 'bg-[#e4c9a4]' : 'bg-[#c8a89a]'}`} title={`${event.source}: ${event.label}`}><Show when="signed-in">{event.source}</Show><Show when="signed-out">Booked</Show></div>)}
                        {dayEvents.length > 2 && <p className="text-[9px] font-bold text-muted-foreground">+{dayEvents.length - 2} more</p>}
                      </div>
                    </div>
                  );
                })}
              </div>

              <Show when="signed-in">
                <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-5 text-[10px] font-bold uppercase tracking-[.08em] text-muted-foreground">
                  <span className="flex items-center gap-2"><i className="h-2 w-2 rounded-full bg-[#c8a89a]" />Existing booking</span>
                  <span className="flex items-center gap-2"><i className="h-2 w-2 rounded-full bg-[#9eb5a7]" />Booking.com</span>
                  <span className="flex items-center gap-2"><i className="h-2 w-2 rounded-full bg-[#e7aa84]" />Airbnb</span>
                  <span className="flex items-center gap-2"><i className="h-2 w-2 rounded-full bg-[#e4c9a4]" />MakeMyTrip</span>
                </div>
                <p className="mt-4 text-[10px] leading-4 text-muted-foreground">Demo blocks from the current planning data are shown in September 2026. Synced OTA events are treated as blocked dates; checkout dates remain available.</p>
                {lastSyncedAt && <p className="mt-2 text-[10px] text-accent">Last synced {new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(lastSyncedAt))}</p>}
              </Show>
              <Show when="signed-out">
                <p className="mt-6 border-t border-border pt-5 text-[10px] leading-4 text-muted-foreground">Dates marked as booked are currently unavailable. Checkout dates remain available.</p>
              </Show>
            </div>
          </div>
        </section>

        <section id="reviews" className="scroll-mt-24 section-shell py-24 md:py-32" aria-labelledby="reviews-title">
          <div className="grid gap-12 lg:grid-cols-[.7fr_1.3fr] lg:gap-24"><div><p className="eyebrow mb-5 text-accent">From guests, soon</p><h2 id="reviews-title" className="font-journal text-5xl leading-[.94] text-primary md:text-6xl">A page for<br /><em>good words.</em></h2><a href={CONFIG.reviewUrl} target="_blank" rel="noreferrer" className="mt-8 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[.1em] text-primary underline decoration-accent decoration-2 underline-offset-4" data-testid="link-google-review">Leave a Google review <ExternalLink size={14} /></a></div><div className="grid gap-4 md:grid-cols-2"><div className="rounded-[1.4rem] border border-border bg-card p-7 md:col-span-2"><div className="flex gap-1 text-accent">{[1, 2, 3, 4, 5].map((number) => <Star key={number} size={15} fill="currentColor" />)}</div><p className="mt-7 font-journal text-3xl leading-tight text-primary">Your first guest story belongs here.</p><p className="mt-4 max-w-[490px] text-sm leading-6 text-muted-foreground">Review placeholder — replace with an approved guest review before publishing.</p></div><div className="rounded-[1.4rem] bg-secondary p-7"><Quote size={23} className="text-primary/50" /><p className="mt-10 text-sm font-bold leading-6 text-primary">Review placeholder — owner to replace.</p></div><div className="rounded-[1.4rem] bg-primary p-7 text-primary-foreground"><Quote size={23} className="text-secondary/70" /><p className="mt-10 text-sm font-bold leading-6">Review placeholder — owner to replace.</p></div></div></div>
        </section>

        <section className="border-t border-border bg-card py-24 md:py-32" aria-labelledby="faq-title">
          <div className="section-shell grid gap-12 lg:grid-cols-[.7fr_1.3fr] lg:gap-24"><div><p className="eyebrow mb-5 text-accent">Before you arrive</p><h2 id="faq-title" className="font-journal text-5xl leading-[.94] text-primary md:text-6xl">The useful<br /><em>answers.</em></h2></div><div>{faqs.map((faq, index) => { const isOpen = openFaq === index; return <div key={faq.question} className="border-t border-border"><button onClick={() => setOpenFaq(isOpen ? null : index)} className="flex w-full items-center justify-between gap-5 py-5 text-left" aria-expanded={isOpen} data-testid={`button-faq-${index}`}><span className="font-journal text-xl text-primary md:text-2xl">{faq.question}</span><span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border text-primary transition-transform ${isOpen ? 'rotate-180' : ''}`}>{isOpen ? <X size={15} /> : <ChevronDown size={15} />}</span></button><div className={`grid transition-[grid-template-rows,opacity] duration-300 ${isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}><div className="overflow-hidden"><p className="max-w-[570px] pb-5 pr-12 text-sm leading-6 text-muted-foreground">{faq.answer}</p></div></div></div>; })}</div></div>
        </section>

        <section id="booking" className="scroll-mt-24 bg-[#e4c9a4] py-24 md:py-32" aria-labelledby="booking-title">
          <div className="section-shell grid gap-12 lg:grid-cols-[.75fr_1.25fr] lg:gap-24"><div><p className="eyebrow mb-5 text-primary/70">Start with a conversation</p><h2 id="booking-title" className="font-journal text-5xl leading-[.92] text-primary md:text-7xl">Make a little<br /><em>room for here.</em></h2><p className="mt-8 max-w-[360px] text-sm leading-6 text-primary/70">Send an enquiry and the host will confirm availability directly. No payment is taken here.</p><div className="mt-9 space-y-3 border-t border-primary/15 pt-6"><a href={phoneHref(CONFIG.hostPhone)} className="flex items-center gap-3 text-sm font-bold text-primary" data-testid="link-booking-host"><Phone size={16} /> Host · {CONFIG.hostPhone}</a><a href={phoneHref(CONFIG.caretakerPhone)} className="flex items-center gap-3 text-sm font-bold text-primary" data-testid="link-booking-caretaker"><HeartHandshake size={16} /> Caretaker · {CONFIG.caretakerPhone}</a></div></div>
            <div className="rounded-[1.5rem] bg-background p-6 shadow-lg md:p-8">
              {submitted ? <div className="flex min-h-[530px] flex-col items-center justify-center text-center" data-testid="status-enquiry-success"><span className="grid h-16 w-16 place-items-center rounded-full bg-primary text-secondary"><Check size={28} /></span><p className="eyebrow mt-7 text-accent">Enquiry received</p><h3 className="mt-3 font-journal text-4xl text-primary">Thank you, {form.name || 'friend'}.</h3><p className="mt-4 max-w-[390px] text-sm leading-6 text-muted-foreground">Your enquiry is ready to share with the host. For the quickest reply, you can also send the selected details on WhatsApp.</p><div className="mt-8 flex flex-wrap justify-center gap-3"><a href={whatsappUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-xs font-bold uppercase tracking-[.1em] text-primary-foreground" data-testid="link-success-whatsapp"><MessageCircle size={15} /> Send on WhatsApp</a><button onClick={() => setSubmitted(false)} className="rounded-full border border-border px-5 py-3 text-xs font-bold uppercase tracking-[.1em] text-primary" data-testid="button-new-enquiry">New enquiry</button></div></div> : <form onSubmit={submitEnquiry} className="space-y-6" data-testid="form-booking-enquiry"><div className="flex items-center justify-between border-b border-border pb-5"><div><p className="font-journal text-3xl text-primary">Enquire to stay</p><p className="mt-1 text-xs text-muted-foreground">A clear estimate, before a conversation.</p></div><Send size={20} className="text-accent" /></div><div className="grid gap-5 sm:grid-cols-2"><label className="block sm:col-span-2"><span className="eyebrow text-muted-foreground">Your name *</span><input required value={form.name} onChange={(event) => updateForm('name', event.target.value)} className="mt-2 w-full border-b border-border bg-transparent px-0 py-3 text-sm text-primary outline-none placeholder:text-muted-foreground/60 focus:border-primary" placeholder="Name" data-testid="input-guest-name" /></label><label className="block"><span className="eyebrow text-muted-foreground">Phone *</span><input required type="tel" value={form.phone} onChange={(event) => updateForm('phone', event.target.value)} className="mt-2 w-full border-b border-border bg-transparent px-0 py-3 text-sm text-primary outline-none placeholder:text-muted-foreground/60 focus:border-primary" placeholder="+91" data-testid="input-guest-phone" /></label><label className="block"><span className="eyebrow text-muted-foreground">Email</span><input type="email" value={form.email} onChange={(event) => updateForm('email', event.target.value)} className="mt-2 w-full border-b border-border bg-transparent px-0 py-3 text-sm text-primary outline-none placeholder:text-muted-foreground/60 focus:border-primary" placeholder="you@example.com" data-testid="input-guest-email" /></label><label className="block"><span className="eyebrow text-muted-foreground">Check-in *</span><input required type="date" min={new Date().toISOString().split('T')[0]} value={form.checkIn} onChange={(event) => updateForm('checkIn', event.target.value)} className="mt-2 w-full border-b border-border bg-transparent px-0 py-3 text-sm text-primary outline-none focus:border-primary" data-testid="input-check-in" /></label><label className="block"><span className="eyebrow text-muted-foreground">Check-out *</span><input required type="date" min={form.checkIn || new Date().toISOString().split('T')[0]} value={form.checkOut} onChange={(event) => updateForm('checkOut', event.target.value)} className="mt-2 w-full border-b border-border bg-transparent px-0 py-3 text-sm text-primary outline-none focus:border-primary" data-testid="input-check-out" /></label></div><div className="grid grid-cols-3 gap-3"><label className="block rounded-xl border border-border p-3"><span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.08em] text-muted-foreground"><Users size={13} /> Adults</span><input required type="number" min="1" value={form.adults} onChange={(event) => updateForm('adults', event.target.value)} className="mt-2 w-full bg-transparent text-lg font-bold text-primary outline-none" data-testid="input-adults" /></label><label className="block rounded-xl border border-border p-3"><span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.08em] text-muted-foreground"><Baby size={13} /> Children</span><input type="number" min="0" value={form.children} onChange={(event) => updateForm('children', event.target.value)} className="mt-2 w-full bg-transparent text-lg font-bold text-primary outline-none" data-testid="input-children" /></label><label className="block rounded-xl border border-border p-3"><span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.08em] text-muted-foreground"><PawPrint size={13} /> Pets</span><input type="number" min="0" value={form.pets} onChange={(event) => updateForm('pets', event.target.value)} className="mt-2 w-full bg-transparent text-lg font-bold text-primary outline-none" data-testid="input-pets" /></label></div><label className="block"><span className="eyebrow text-muted-foreground">Special requests</span><textarea rows={3} value={form.requests} onChange={(event) => updateForm('requests', event.target.value)} className="mt-2 w-full resize-none border-b border-border bg-transparent px-0 py-3 text-sm text-primary outline-none placeholder:text-muted-foreground/60 focus:border-primary" placeholder="Arrival notes, pet details, meal preferences..." data-testid="input-special-requests" /></label><div className="rounded-xl bg-card p-4"><div className="flex items-center justify-between"><p className="text-sm font-bold text-primary">Planning estimate</p><p className="font-mono-ui text-[10px] text-muted-foreground">{nights ? `${nights} night${nights === 1 ? '' : 's'}` : 'Select dates'}</p></div><div className="mt-3 flex items-end justify-between"><div><p className="font-mono-ui text-[10px] uppercase tracking-[.08em] text-muted-foreground">From {currency(CONFIG.ratePerNight)} / night</p><p className="mt-1 text-xs text-muted-foreground">Advance {Math.round(CONFIG.advanceShare * 100)}% · balance after confirmation</p></div><p className="font-journal text-3xl text-primary">{currency(total)}</p></div>{nights > 0 && <div className="mt-3 flex justify-between border-t border-border pt-3 text-xs text-muted-foreground"><span>Advance estimate: {currency(advance)}</span><span>Balance: {currency(balance)}</span></div>}</div><div className="flex flex-col gap-3 sm:flex-row"><button type="submit" className="flex flex-1 items-center justify-center gap-2 rounded-full bg-primary px-5 py-4 text-xs font-bold uppercase tracking-[.11em] text-primary-foreground transition-transform hover:-translate-y-0.5 active:scale-95" data-testid="button-submit-enquiry">Send enquiry <ArrowRight size={15} /></button><a href={whatsappUrl} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 rounded-full border border-primary/25 px-5 py-4 text-xs font-bold uppercase tracking-[.11em] text-primary transition-colors hover:bg-primary/5" data-testid="link-booking-whatsapp"><MessageCircle size={16} /> WhatsApp</a></div><p className="text-center text-[10px] leading-4 text-muted-foreground">Demo rate is editable in the page configuration. Availability and final pricing are confirmed by the host.</p></form>}
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-[#172d25] py-14 pb-28 text-[#f5eadb] md:pb-14" data-testid="site-footer">
        <div className="section-shell"><div className="grid gap-12 border-b border-[#f5eadb]/15 pb-12 md:grid-cols-[1.2fr_.8fr_.8fr]"><div><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-full bg-[#e4c9a4] text-[#172d25]"><Leaf size={19} /></span><span><span className="block font-mono-ui text-[10px] tracking-[.18em] text-[#f5eadb]/70">RAJ KUTHIR</span><span className="font-journal text-2xl">Homestays</span></span></div><p className="mt-6 max-w-[300px] text-sm leading-6 text-[#f5eadb]/60">Sobuj Potro — a private home in nature, in Bolpur / Shantiniketan.</p></div><div><p className="eyebrow mb-5 text-[#e4c9a4]">Explore</p><div className="flex flex-col items-start gap-3 text-sm text-[#f5eadb]/70">{NAV_ITEMS.slice(0, 4).map((item) => <a key={item.href} href={item.href} className="transition-colors hover:text-[#e4c9a4]" data-testid={`link-footer-${item.label.toLowerCase().replace(/\s/g, '-')}`}>{item.label}</a>)}</div></div><div><p className="eyebrow mb-5 text-[#e4c9a4]">Connect</p><div className="flex flex-col items-start gap-3 text-sm text-[#f5eadb]/70"><a href={CONFIG.instagramUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 hover:text-[#e4c9a4]" data-testid="link-footer-instagram"><Instagram size={15} /> Instagram</a><a href={CONFIG.reviewUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 hover:text-[#e4c9a4]" data-testid="link-footer-review"><Star size={15} /> Google Reviews</a><a href={phoneHref(CONFIG.hostPhone)} className="flex items-center gap-2 hover:text-[#e4c9a4]" data-testid="link-footer-call"><Phone size={15} /> {CONFIG.hostPhone}</a></div></div></div><div className="flex flex-col justify-between gap-4 pt-6 text-[10px] uppercase tracking-[.13em] text-[#f5eadb]/40 sm:flex-row"><p>© {new Date().getFullYear()} Raj Kuthir Homestays</p><p>Made for slower days</p></div></div>
      </footer>

      <div className="fixed inset-x-3 bottom-3 z-40 flex items-center gap-2 rounded-full border border-border bg-background/95 p-2 shadow-lg backdrop-blur-md md:hidden" data-testid="mobile-contact-bar"><a href={phoneHref(CONFIG.hostPhone)} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-secondary text-primary" aria-label="Call host" data-testid="button-sticky-call"><Phone size={18} /></a><a href={whatsappUrl} target="_blank" rel="noreferrer" className="flex flex-1 items-center justify-center gap-2 rounded-full bg-primary py-3 text-xs font-bold uppercase tracking-[.1em] text-primary-foreground" data-testid="button-sticky-whatsapp"><MessageCircle size={16} /> Enquire on WhatsApp</a><button onClick={scrollToBooking} className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-border text-primary" aria-label="Book now" data-testid="button-sticky-book"><CalendarDays size={18} /></button></div>
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

function AdminSignOutButton() {
  const { signOut } = useClerk();
  return (
    <button type="button" onClick={() => signOut({ redirectUrl: basePath || "/" })} className="text-secondary underline underline-offset-4 transition-colors hover:text-primary-foreground" data-testid="button-admin-sign-out">
      Sign out
    </button>
  );
}

function AdminFeedLink() {
  const { isSignedIn } = useAuth();
  const [feedUrl, setFeedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isSignedIn) {
      setFeedUrl(null);
      return;
    }

    let active = true;
    fetch(`${basePath}/api/calendar/feed-info`, { credentials: 'include' })
      .then(async (response) => {
        const payload = await response.json() as { feedUrl?: string; error?: string };
        if (!response.ok) throw new Error(payload.error || 'Outbound feed is not configured.');
        if (active) setFeedUrl(payload.feedUrl || null);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Outbound feed is not configured.');
      });

    return () => {
      active = false;
    };
  }, [isSignedIn]);

  if (!isSignedIn) return null;

  const copyFeedUrl = async () => {
    if (!feedUrl) return;
    await navigator.clipboard.writeText(feedUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="mt-6 border-t border-primary-foreground/15 pt-5">
      <p className="text-xs font-bold text-primary-foreground">Outbound calendar feed</p>
      <p className="mt-2 text-[10px] leading-4 text-primary-foreground/55">Paste this private link into any aggregator that accepts an iCal subscription.</p>
      {feedUrl ? (
        <div className="mt-3 flex gap-2">
          <input readOnly value={feedUrl} className="min-w-0 flex-1 rounded-lg border border-primary-foreground/20 bg-primary-foreground/10 px-3 py-2 text-[10px] text-primary-foreground outline-none" aria-label="Outbound calendar feed URL" data-testid="input-outbound-calendar-feed" />
          <button type="button" onClick={copyFeedUrl} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-secondary text-primary" aria-label="Copy outbound calendar feed URL" data-testid="button-copy-calendar-feed">
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
      ) : (
        <p className="mt-3 text-[10px] leading-4 text-[#f0a184]">{error || 'Loading private feed link...'}</p>
      )}
      <p className="mt-2 text-[10px] leading-4 text-primary-foreground/45">Keep this URL private. Anyone with the link can read blocked dates.</p>
    </div>
  );
}

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-10">
      <SignIn routing="path" path={`${basePath}/sign-in`} />
    </div>
  );
}

function Router() {
  return <RoutedErrorBoundary><Switch><Route path="/" component={Home} /><Route path="/sign-in/*?" component={SignInPage} /><Route component={NotFound} /></Switch></RoutedErrorBoundary>;
}

function App() {
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={clerkAppearance} signInUrl={`${basePath}/sign-in`}><QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={basePath}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider></ClerkProvider>;
}

export default App;