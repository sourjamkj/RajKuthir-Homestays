import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
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
import { AlertIcon, CalendarIcon, CaretDownIcon, CaretLeftIcon, CaretRightIcon, CheckIcon, CloseIcon, ExternalIcon, InstagramIcon, LeafIcon, LockIcon, MapPinIcon, MenuIcon, PhoneIcon, StarIcon, WhatsappIcon } from '@/components/icons';
import {
  latestCheckOut,
  nextStaySelection,
  stayFromDrag,
  stayIsFree,
  type StayBlock,
  type StaySelection,
} from '@/lib/stay-dates';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import AdminDashboard from '@/pages/AdminDashboard';
import AdminLogin from '@/pages/AdminLogin';
import AdminEarnings from '@/pages/AdminEarnings';
import AdminRates from '@/pages/AdminRates';
import AdminGuests from '@/pages/AdminGuests';
import AdminReviews from '@/pages/AdminReviews';
import HouseRules from '@/pages/HouseRules';
import Policies from '@/pages/Policies';
import PetFriendly from '@/pages/PetFriendly';
import Gallery, { GALLERY_TEASER } from '@/pages/Gallery';
import OurStory from '@/pages/OurStory';
import PlacesToVisit from '@/pages/PlacesToVisit';
import HomestayNearSonajhuri from '@/pages/HomestayNearSonajhuri';
import HomestayNearVisvaBharati from '@/pages/HomestayNearVisvaBharati';
import WeekendFromKolkata from '@/pages/WeekendFromKolkata';
import TwoDayItinerary from '@/pages/TwoDayItinerary';
import PoushMelaStay from '@/pages/PoushMelaStay';
import BasantaUtsavStay from '@/pages/BasantaUtsavStay';
import CafeSoi from '@/pages/CafeSoi';
import Rates from '@/pages/Rates';
import Welcome from '@/pages/Welcome';
import AdminGuestInfo from '@/pages/AdminGuestInfo';
import AdminCaretakerConsole from '@/pages/AdminCaretakerConsole';
import PreArrival from '@/pages/PreArrival';
import Offer from '@/pages/Offer';
import Pay from '@/pages/Pay';
import GuestInvoice from '@/pages/GuestInvoice';
import ManagementDocuments from '@/pages/ManagementDocuments';
import Feedback from '@/pages/Feedback';
import { CAFE_HOURS } from '@/content/cafe-menu';
import AdminCompliance from '@/pages/AdminCompliance';
import {
  useRatePlan,
  rateForNight,
  totalForStay,
  formatRupeesCompact,
  formatRupees,
  breakdownOf,
  surchargePerNight,
  petCharge,
  petChargeText,
  securityDepositText,
  minimumStayFor,
  type RatePlan,
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


/**
 * The homepage answers. Every figure comes from the live rate plan
 * (/api/rates) — none is typed here — and each priced answer has a version
 * without figures for the prerendered page and for the moment before the
 * plan loads, so a stale price can never be baked into the HTML.
 */
type Faq = { question: string; answer: string };

function homeFaqs(plan: RatePlan | undefined): Faq[] {
  const ladder = plan?.ladder;
  const extras = plan?.extras;
  const maxGuests = plan?.maxGuests ?? 5;
  const peakNames = [...new Set((plan?.peaks ?? []).map((p) => p.label))].slice(0, 3);
  const deposit = securityDepositText(extras, formatRupees);

  const rates = ladder
    ? [
        `You book the whole villa, priced by the night for your party: ${formatRupees(ladder.weekdayBasePaise)} Sunday–Thursday and ${formatRupees(ladder.weekendBasePaise)} Friday–Saturday for up to ${ladder.includedGuests} guests, plus ${formatRupees(ladder.extraGuestPaise)} a night for each guest after that, up to ${maxGuests}.`,
        ladder.weeklyDiscountPercent > 0 ? `Stays of ${ladder.weeklyMinNights} nights or more are ${ladder.weeklyDiscountPercent}% off.` : '',
        peakNames.length ? `Festival dates (${peakNames.join(', ')}) are one flat rate for the whole villa, whatever your party size, with a minimum stay.` : '',
        'The calendar shows the exact total for your dates before you pay anything.',
        deposit ?? '',
      ]
    : [
        'You book the whole villa, priced by the night for your party, a little more on Friday and Saturday nights. Festival dates have their own rates and a minimum stay.',
        'The calendar shows the exact total for your dates before you pay anything, and the full rate card is on the Rates page.',
      ];

  const bedding = extras
    ? `The rate card covers up to ${maxGuests} guests, and children count as guests: two adults and two little ones are a party of four. Beyond ${maxGuests}, each extra person is ${formatRupees(extras.extraAdultPaise)} a night, or ${formatRupees(extras.extraChildPaise)} for a child under ${extras.childUnderAge}, with an extra bed made up for them. For ${maxGuests + 1} or more guests, message us on WhatsApp so we can set the house up before you arrive.`
    : `The rate card covers up to ${maxGuests} guests, and children count as guests. Larger groups can stay, with extra bedding at a per-person charge a night. For ${maxGuests + 1} or more guests, message us on WhatsApp so we can set the house up before you arrive.`;

  const pets = [
    'Yes, pets are welcome.',
    extras ? petChargeText(extras, formatRupees) : 'There is a small pet charge, shown with your total before you pay.',
    'Please keep them off beds, sofas and linen, and add your pets in the booking form so the caretaker can prepare. Damage or soiling is charged as set out in the house rules.',
  ];

  return [
    {
      question: 'Is Raj Kuthir a private villa?',
      answer: 'Yes. Sobuj Potro is an entire two-bedroom villa with a private garden, so your group can settle in at its own pace.',
    },
    { question: 'How are the room rates worked out?', answer: rates.filter(Boolean).join(' ') },
    { question: 'We are more than five. Is extra bedding available?', answer: bedding },
    { question: 'Can we bring our pet?', answer: pets.join(' ') },
    {
      question: 'What ID do we need, and how does verification work?',
      answer:
        'Every adult staying needs a valid government photo ID, such as Aadhaar, passport, driving licence or voter ID. It is a legal requirement for homestays, not a formality. After you book we send you a private link: upload the IDs there at least 48 hours before check-in, that is by 12 noon two days before you arrive. Guests who are not Indian nationals need their passport and Indian visa, and we file the Form C with the FRRO within 24 hours of arrival, as the law requires. Your documents are stored securely and used only for the guest register the law asks us to keep.',
    },
    {
      question: 'Can we cook at the homestay?',
      answer: 'Basic cooking utensils and an induction setup are available, along with a microwave, refrigerator and water filter. A home-cooked meal option can also be arranged through the caretaker.',
    },
    {
      question: 'Is food available nearby?',
      answer: `Cafe Soi is inside the premises, open ${CAFE_HOURS}, and Zomato availability makes it easy to order in when you prefer a slower evening at home.`,
    },
    {
      // Guests spell the name every way: say so in plain words, once.
      question: 'Is it Raj Kuthir, Raj Kutir or Rajkuthir?',
      answer: 'All three. You will see the name written each way. It is the same place: Raj Kuthir Homestays, Sobuj Potro, a private two-bedroom villa in Bolpur, Shantiniketan.',
    },
    {
      question: 'How do I confirm a booking?',
      answer: 'Pick your dates on the calendar, hold them and pay the advance by UPI. We confirm as soon as we see the payment, and the balance is paid at check-in. For six or more guests, or stays over 30 nights, message us on WhatsApp.',
    },
  ];
}

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

  // Where the page sits relative to the hero photograph. The header is glass
  // only while it floats on the photo; the phone booking bar waits until the
  // photo has scrolled away. The server renders the top of the page: header
  // over the photo, no bar.
  const heroRef = useRef<HTMLElement | null>(null);
  const [overHero, setOverHero] = useState(true);
  const [pastHero, setPastHero] = useState(false);
  // While the booking section is on screen, a phone shows the calendar and the
  // form and nothing floating over them: the directions / arrival-pack buttons
  // and the contact bar step aside (the quote bar still appears with dates).
  const [inBooking, setInBooking] = useState(false);
  useEffect(() => {
    const section = document.getElementById('booking');
    if (!section || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setInBooking(Boolean(entry?.isIntersecting)), {
      // "On screen" means it fills the middle of the viewport, not a sliver at an edge.
      rootMargin: '-35% 0px -35% 0px',
    });
    observer.observe(section);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const bottom = heroRef.current?.getBoundingClientRect().bottom ?? 0;
      setOverHero(bottom > 74);
      setPastHero(bottom <= 0);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
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
  const faqs = useMemo(() => homeFaqs(ratePlan.data), [ratePlan.data]);
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
  /* A peak period's minimum stay. The server refuses to quote a shorter one,
     so the form says so up front instead of taking an enquiry it can't price. */
  const shortStay = useMemo(() => {
    if (!form.checkIn || !form.checkOut) return null;
    const rule = minimumStayFor(ratePlan.data, form.checkIn, form.checkOut);
    return rule && nights > 0 && nights < rule.minNights ? rule : null;
  }, [ratePlan.data, form.checkIn, form.checkOut, nights]);
  const extrasPaise =
    surchargePerNight(ratePlan.data, breakdown) * nights +
    petCharge(ratePlan.data, breakdown, nights);
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

  // Only the weeks this month needs: a sixth row of next month's greyed days
  // cost a phone a whole screen-height of nothing.
  const daysInView = useMemo(() => {
    const days = calendarDays(calendarMonth);
    while (days.length > 28 && days.slice(-7).every((d) => d.getMonth() !== calendarMonth.getMonth())) days.splice(-7, 7);
    return days;
  }, [calendarMonth]);
  const calendarMonthLabel = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(calendarMonth);

  /*
    Picking the stay straight off the calendar.

    The selection is not held in its own state — it *is* form.checkIn and
    form.checkOut. Clicking a day writes to the form, and typing in the form's
    date fields repaints the grid, because both read the same two strings.
    Keeping a second copy here is what would let the two drift apart.
  */
  const stayBlocks: StayBlock[] = busyPeriods;
  const todayKey = dateKey(new Date());
  /** Set while the guest has a check-in but no check-out, to shade the run they are hovering. */
  const [hoverDay, setHoverDay] = useState<string | null>(null);

  /*
    Dragging across the grid.

    One end of the stay stands still — `dragAnchor` — while the other follows
    the pointer. Which end is pinned depends on where the press landed: on a
    bare day it is that day, on one of the two handles it is the opposite end,
    which is what lets a finished stay be stretched from either side rather
    than cleared and rebuilt.

    `dragMoved` exists because a press that never travels is a click, and a
    click means something different (see nextStaySelection). The ref is read
    by the click handler to swallow the click the browser fires after a drag
    that happens to end where it began.
  */
  const [dragAnchor, setDragAnchor] = useState<string | null>(null);
  const [dragDay, setDragDay] = useState<string | null>(null);
  const [dragMoved, setDragMoved] = useState(false);
  const justDragged = useRef(false);

  const applySelection = (next: StaySelection) => {
    setForm((current) => ({ ...current, checkIn: next.checkIn, checkOut: next.checkOut }));
    setSubmitError(null);
  };

  /* What the grid paints: the drag in progress, else what the form holds.
     A press that has not travelled yet is still a click, so the existing
     stay stays on screen rather than blinking down to a single day. */
  const shownStay: StaySelection =
    dragAnchor && dragDay && dragMoved
      ? stayFromDrag(stayBlocks, dragAnchor, dragDay)
      : { checkIn: form.checkIn, checkOut: form.checkOut };

  const choosingCheckOut = Boolean(shownStay.checkIn) && !shownStay.checkOut;
  const previewEnd =
    !dragAnchor && choosingCheckOut && hoverDay && stayIsFree(stayBlocks, shownStay.checkIn, hoverDay)
      ? hoverDay
      : null;
  /** Where a stay starting on the chosen check-in has to stop, if anything is in the way. */
  const checkOutCeiling = shownStay.checkIn ? latestCheckOut(stayBlocks, shownStay.checkIn) : null;

  /*
    The figure shown beside the calendar, or nothing at all.

    Null rather than zero everywhere the number would be a guess: mid-drag,
    before /api/rates has answered, and when the chosen nights clash with a
    booking — there the conflict warning is the honest answer, not a price.
    Same arithmetic as the estimate in the form below, read from the same
    state, so the two can never quote different totals.
  */
  const quotedStay = useMemo(
    () =>
      dragAnchor || dateConflict || nights <= 0 || fromRate === null
        ? null
        : { nights, total },
    [dragAnchor, dateConflict, nights, fromRate, total],
  );

  const beginDrag = (day: string) => {
    const complete = Boolean(form.checkIn && form.checkOut);
    const anchor = complete && day === form.checkIn
      ? form.checkOut
      : complete && day === form.checkOut
        ? form.checkIn
        : day;

    setDragAnchor(anchor);
    setDragDay(day);
    setDragMoved(false);
    setHoverDay(null);
  };

  const extendDrag = (day: string) => {
    setDragDay(day);
    setDragMoved(true);
  };

  // The release may land anywhere — off the grid, off the window — so the
  // drag is finished from the window rather than from a day cell.
  useEffect(() => {
    if (!dragAnchor) return;

    const finish = () => {
      if (dragMoved && dragDay) {
        applySelection(stayFromDrag(stayBlocks, dragAnchor, dragDay));
        justDragged.current = true;
      }
      setDragAnchor(null);
      setDragDay(null);
      setDragMoved(false);
    };

    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    return () => {
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
  });

  const pickDay = (day: string) => {
    // Swallow the click the browser fires at the end of a drag.
    if (justDragged.current) {
      justDragged.current = false;
      return;
    }

    applySelection(
      nextStaySelection({ checkIn: form.checkIn, checkOut: form.checkOut }, day, stayBlocks),
    );
    setHoverDay(null);
  };

  /*
    Taking the guest from a finished date choice to the form, the way the OTAs
    do it: the price appears the moment the second date lands, and the button
    next to it is the way forward. Scrolling alone leaves people looking at a
    form with no cursor in it, so the first field is focused once the scroll
    has settled — after it, not during, or the browser fights its own animation.
  */
  const enquiryCardRef = useRef<HTMLDivElement | null>(null);
  // Once the form itself is on screen, the quote bar has done its job and
  // would only cover the form's own button.
  const [formInView, setFormInView] = useState(false);
  useEffect(() => {
    const card = enquiryCardRef.current;
    if (!card || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setFormInView(Boolean(entry?.isIntersecting)), { threshold: 0.2 });
    observer.observe(card);
    return () => observer.disconnect();
  }, []);
  const nameFieldRef = useRef<HTMLInputElement | null>(null);

  const goToEnquiry = () => {
    enquiryCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.setTimeout(() => nameFieldRef.current?.focus({ preventScroll: true }), 500);
  };

  const clearStayDates = () => {
    setForm((current) => ({ ...current, checkIn: '', checkOut: '' }));
    setHoverDay(null);
    setSubmitError(null);
  };
  /*
   * WhatsApp is for questions now, not for booking: the form books. A message
   * from a blank form is a plain hello; once the guest has given a name or
   * dates, the details ride along so the host can answer without asking back.
   * The same text, opened with "I would like to book", is how a party the site
   * cannot book online (six or more, over thirty nights, online booking
   * paused) reaches the host. Nothing is filed as an enquiry either way.
   */
  const hasEnquiryDetail = Boolean(form.name.trim() || (form.checkIn && form.checkOut));

  const whatsappText = (opening: string) => {
    const lines = [opening];
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
  };

  const whatsappUrl = `https://wa.me/916290399165?text=${encodeURIComponent(whatsappText('Hello Raj Kuthir, I have a question about staying at Sobuj Potro.'))}`;
  const bookByWhatsappUrl = `https://wa.me/916290399165?text=${encodeURIComponent(whatsappText('Hello Raj Kuthir, I would like to book Sobuj Potro.'))}`;

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

  /*
    ONE FORM, ONE WAY TO FINISH: BOOK.

    The guest fills dates, party, name and phone once. The server prices it
    (/api/book/quote — the same quoteForEnquiry the owner's quotes use) and
    the only button is "Hold dates & pay". There is no "send an enquiry" any
    more (the owner's decision, November 2026). Parties above five, stays over
    thirty nights, and times the owner has paused online booking cannot be
    booked here, so for those the button becomes "Message us on WhatsApp to
    book", with the dates and party already typed. Nothing is filed as an
    enquiry from this form.
  */
  type ServerQuote = {
    available: boolean;
    reason?: string;
    totalPaise?: number;
    advancePaise?: number;
    balancePaise?: number;
    advancePercent?: number;
    holdMinutes?: number;
    onlineBooking?: boolean;
  };
  const [serverQuote, setServerQuote] = useState<ServerQuote | null>(null);
  const [paying, setPaying] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);
  const enquiryOnly = partySize > 5 || nights > 30;

  useEffect(() => {
    setServerQuote(null);
    if (!form.checkIn || !form.checkOut || nights < 1 || enquiryOnly || dateConflict || shortStay) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch('/api/book/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          checkIn: form.checkIn,
          checkOut: form.checkOut,
          adults: Number(form.adults) || 1,
          children: Number(form.children) || 0,
          pets: Number(form.pets) || 0,
        }),
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((body: ServerQuote | null) => setServerQuote(body))
        .catch(() => undefined);
    }, 400);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [form.checkIn, form.checkOut, form.adults, form.children, form.pets, nights, enquiryOnly, dateConflict, shortStay]);

  const canPayOnline = Boolean(
    serverQuote?.available && serverQuote.onlineBooking && serverQuote.advancePaise && !enquiryOnly && !dateConflict && !shortStay,
  );
  const bookingPaused = Boolean(serverQuote?.available && serverQuote.onlineBooking === false);
  /** The site cannot book this one: the host books it over WhatsApp instead. */
  const bookByMessage = (enquiryOnly && nights > 0) || bookingPaused;
  const bookingNote = enquiryOnly && nights > 0
    ? `${partySize > 5 ? `For ${partySize} guests` : 'For stays over 30 nights'} we book by message. WhatsApp opens with your dates and party already filled in.`
    : bookingPaused
      ? 'Online booking is paused just now. Message us on WhatsApp and we will book these dates for you.'
      : serverQuote && !serverQuote.available && serverQuote.reason && !dateConflict && !shortStay
        ? serverQuote.reason
        : null;
  const bookButtonIdle = !form.checkIn || !form.checkOut
    ? 'Choose your dates to book'
    : dateConflict || shortStay || (serverQuote && !serverQuote.available)
      ? 'Choose other dates'
      : 'Checking the price…';

  const startBooking = async () => {
    setSubmitError(null);
    if (!formRef.current?.reportValidity()) return;
    setPaying(true);
    try {
      const response = await fetch('/api/book/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          phone: form.phone,
          email: form.email || null,
          requests: form.requests || null,
          checkIn: form.checkIn,
          checkOut: form.checkOut,
          adults: Number(form.adults) || 1,
          children: Number(form.children) || 0,
          pets: Number(form.pets) || 0,
        }),
      });
      const body = await response.json().catch(() => ({}) as { payUrl?: string; error?: string });
      if (response.ok && body.payUrl) {
        track('book_pay_hold');
        window.location.assign(`${basePath}${body.payUrl}`);
        return;
      }
      setSubmitError(body.error ?? 'Could not hold those dates. Please try again, or message us on WhatsApp.');
      if (response.status === 409) void publicCalendar.refetch();
    } catch {
      setSubmitError('Could not reach the server. Please check your connection, or message us on WhatsApp.');
    } finally {
      setPaying(false);
    }
  };

  const shiftCalendarMonth = (amount: number) => {
    setCalendarMonth((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1));
  };

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header
        className={`fixed inset-x-0 top-0 z-50 ${overHero && !menuOpen ? 'glass-bar glass-tint border-x-0 border-t-0' : 'border-b border-foreground/10 bg-background'}`}
        data-testid="site-header"
        data-glass={overHero && !menuOpen ? 'true' : undefined}
      >
        <div className="section-shell flex h-[74px] items-center justify-between gap-6">
          <a href="#top" className="group flex shrink-0 items-center gap-3" data-testid="link-brand">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-primary text-primary-foreground">
              <LeafIcon size="md" />
            </span>
            <span className="leading-none">
              <span className="block font-mono-ui text-xs font-medium tracking-[.18em] text-muted-foreground">RAJ KUTHIR</span>
              <span className="font-journal text-[19px] text-primary">Homestays</span>
            </span>
          </a>

          <nav className="hidden min-w-0 items-center gap-4 xl:flex" aria-label="Main navigation">
            {NAV_ITEMS.map((item) => (
              <a key={item.href} href={item.href} className="text-[13px] font-medium text-muted-foreground transition-colors hover:text-primary" data-testid={`link-nav-${item.label.toLowerCase().replace(/\s/g, '-')}`}>
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
              <PhoneIcon />
            </a>
            <a
              href={`${basePath}/admin`}
              className="grid h-10 w-10 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary"
              aria-label="Owner sign in"
              title="Owner sign in"
              data-testid="link-header-admin"
            >
              <LockIcon />
            </a>
            <button onClick={scrollToAvailability} className="ml-1 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5 active:scale-95" data-testid="button-header-book">
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
            {menuOpen ? <CloseIcon size="md" /> : <MenuIcon size="md" />}
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
              <button onClick={scrollToAvailability} className="mt-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground" data-testid="button-mobile-book">
                Check availability
              </button>
              <div className="mt-3 border-t border-border pt-4">
                <a href={`${basePath}/admin`} onClick={() => setMenuOpen(false)} className="flex items-center gap-2 text-[13px] font-medium text-primary" data-testid="link-mobile-admin-login">
                  <LockIcon /> Admin login
                </a>
                <p className="mt-2 pl-6 text-xs leading-4 text-muted-foreground">Private owner access to calendar controls</p>
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
        <section ref={heroRef} className="on-dark relative isolate flex min-h-[clamp(560px,86vh,880px)] items-end overflow-hidden" aria-labelledby="hero-title">
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
          <div className="absolute inset-0 bg-gradient-to-t from-night/92 via-night/45 to-night/5" aria-hidden="true" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_45%,transparent_30%,rgba(10,23,18,.6)_100%)]" aria-hidden="true" />

          <div className="section-shell relative z-10 w-full pb-14 pt-40 md:pb-20 md:pt-48">
            <div className="reveal max-w-[820px]">
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
                and the four-legged members of the family. Come to Shantiniketan (also spelt Santiniketan).
                Take your time.
              </p>
              <div className="mt-10 flex flex-wrap items-center gap-4">
                <a href="#availability" className="group flex items-center gap-3 rounded-full bg-secondary px-6 py-4 text-sm font-semibold text-primary transition-all hover:-translate-y-1 hover:shadow-xl active:scale-95" data-testid="button-hero-book">
                  Check availability                </a>
                <a href={`${basePath}/our-story`} className="flex items-center gap-2 rounded-full border border-white/30 px-6 py-4 text-sm font-semibold text-white transition-colors hover:bg-white/10" data-testid="link-hero-stay">
                  Read the story                </a>
              </div>
            </div>
          </div>
        </section>

        <section className="border-y border-border bg-card" aria-label="Stay highlights">
          <div className="section-shell grid grid-cols-2 divide-x divide-border md:grid-cols-4">
            {[
              { title: 'Entire villa', detail: 'Two bedrooms' },
              { title: 'Pet-welcoming', detail: 'Bring the whole family' },
              { title: 'On-premise parking', detail: 'Arrive with ease' },
              { title: 'Wi-Fi included', detail: 'Stay connected, lightly' },
            ].map(({ title, detail }) => (
              <div key={title} className="flex min-h-[112px] flex-col justify-center gap-2 px-4 py-5 md:px-8" data-testid={`highlight-${title.toLowerCase().replace(/\s/g, '-')}`}>
                <div><p className="text-sm font-bold text-primary">{title}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div>
              </div>
            ))}
          </div>
        </section>

        <section className="section-shell py-24 md:py-32" aria-labelledby="amenities-title">
          <div className="grid gap-12 lg:grid-cols-[.7fr_1.3fr] lg:gap-24">
            <div><h2 id="amenities-title" className="font-journal text-5xl leading-[.95] text-primary md:text-6xl">The small<br />comforts.</h2><p className="mt-7 max-w-[300px] text-sm leading-6 text-muted-foreground">The things that make a private stay feel easy, without turning it into a checklist.</p></div>
            <div className="grid grid-cols-2 gap-x-5 gap-y-0 sm:grid-cols-3">
              {/* Each of these is marked up as an amenity by the server
                  (VERIFIED_AMENITIES in api-server/src/lib/seo.ts), and a test
                  fails if the markup claims one that is not written here. */}
              {[
                { label: 'Two bedrooms, two king beds' },
                { label: 'Air conditioning in both bedrooms' },
                { label: 'Two bathrooms' },
                { label: 'Basic cooking utensils' },
                { label: 'Induction setup' },
                { label: 'Microwave & refrigerator' },
                { label: 'Water filter' },
                { label: 'Wi-Fi' },
                { label: 'On-premise parking' },
              ].map(({ label }) => <div key={label} className="border-t border-border py-6"><p className="max-w-[145px] text-sm font-bold leading-5 text-primary">{label}</p></div>)}
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
            <div className="order-1 lg:order-2"><h2 id="pet-title" className="font-journal text-5xl leading-[.94] text-primary md:text-7xl">Good stays<br />include paws.</h2><p className="mt-8 max-w-[470px] text-lg leading-8 text-primary/75">This is a home where your pet is welcome, not an exception to negotiate. Tell us who is coming, and we will make the arrival feel comfortable for the whole family.</p><div className="mt-8 flex items-center gap-4 border-t border-primary/15 pt-6"><p className="text-sm font-bold text-primary">A genuinely pet-welcoming stay</p></div><a href={`${basePath}/pet-friendly-homestay-shantiniketan`} className="mt-7 inline-flex items-center gap-2 text-sm font-semibold text-primary underline decoration-accent decoration-2 underline-offset-4" data-testid="link-pet-friendly-page">Staying here with a pet</a></div>
          </div>
        </section>

        {/* ------------------------------------------- dates and enquiry
            One banner, not two sections. The calendar and the enquiry form
            were the same job split across two stops on the page: people read
            the dates, scrolled on, and had to come back. Nothing about how
            either one works has changed — same state, same rates, same
            submit — only where they sit and what they look like.

            "Check availability" anywhere on the site lands here. */}
        <section id="booking" className="scroll-mt-24 bg-sand py-24 md:py-32" aria-labelledby="booking-title">
          <div className="section-shell">
            <div className="flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
              <div>
                <h2 id="booking-title" className="max-w-[620px] font-journal text-5xl leading-[.92] text-primary md:text-7xl">
                  Make a little<br />room for here.
                </h2>
                <p className="mt-8 max-w-[430px] text-sm leading-6 text-primary/75">
                  The calendar below combines every channel Sobuj Potro is listed
                  on, so what shows as free really is. Found your dates? Book them
                  right here: hold the nights, pay the advance by UPI and skip the
                  platform fees. The balance is paid at check-in.
                </p>

                {/* Said before anybody asks. A family arriving to find two
                    children they thought were free on the bill is a bad first
                    hour, and the honest version costs one paragraph. */}
                {ratePlan.data?.extras && (
                  <ul className="mt-6 max-w-[430px] space-y-2 border-l-2 border-primary/20 pl-4 text-[13px] leading-6 text-primary/75" data-testid="list-charges-note">
                    {ratePlan.data.ladder && (
                      <li>
                        {formatRupees(ratePlan.data.ladder.weekdayBasePaise)} a night
                        Sunday&ndash;Thursday and {formatRupees(ratePlan.data.ladder.weekendBasePaise)}{' '}
                        Friday&ndash;Saturday for up to {ratePlan.data.ladder.includedGuests} guests,
                        plus {formatRupees(ratePlan.data.ladder.extraGuestPaise)} a night for each
                        guest after that. Stays of {ratePlan.data.ladder.weeklyMinNights} nights or
                        more are {ratePlan.data.ladder.weeklyDiscountPercent}% off.
                      </li>
                    )}
                    <li>
                      Children under {ratePlan.data.extras.childUnderAge} count as
                      guests. Two adults and two little ones are a party of four,
                      at the four-guest price, with no separate child fee.
                    </li>
                    <li>
                      Above {ratePlan.data.maxGuests} guests, each extra person is{' '}
                      {formatRupees(ratePlan.data.extras.extraAdultPaise)} a night, or{' '}
                      {formatRupees(ratePlan.data.extras.extraChildPaise)} for a child
                      under {ratePlan.data.extras.childUnderAge}.
                    </li>
                    <li>
                      {petChargeText(ratePlan.data.extras, formatRupees)}
                    </li>
                    {securityDepositText(ratePlan.data.extras, formatRupees) && (
                      <li data-testid="text-booking-deposit">{securityDepositText(ratePlan.data.extras, formatRupees)}</li>
                    )}
                  </ul>
                )}
                <p className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-[12px] font-medium text-primary">
                  <a href={`${basePath}/rates`} className="underline decoration-accent decoration-2 underline-offset-4" data-testid="link-booking-rates">The full rate card</a>
                  <a href={`${basePath}/pet-friendly-homestay-shantiniketan`} className="underline decoration-accent decoration-2 underline-offset-4" data-testid="link-booking-pet">Travelling with a pet?</a>
                </p>
              </div>
              <div className="flex flex-col gap-3 border-t border-primary/15 pt-6 lg:border-0 lg:pt-0 lg:text-right">
                <a href={phoneHref(CONFIG.hostPhone)} className="flex items-center gap-3 text-sm font-bold text-primary lg:justify-end" data-testid="link-booking-host">
                  <PhoneIcon /> Host &middot; {CONFIG.hostPhone}
                </a>
                <a href={phoneHref(CONFIG.caretakerPhone)} className="flex items-center gap-3 text-sm font-bold text-primary lg:justify-end" data-testid="link-booking-caretaker">
                  Caretaker &middot; {CONFIG.caretakerPhone}
                </a>
              </div>
            </div>

            {/* Calendar and enquiry side by side: one row, so nobody has to
                scroll between reading the dates and asking for them. The card
                that used to sit here explained that the calendar combines every
                channel — that sentence is in the section intro above now, read
                once rather than filling half a column with empty space. */}
            <div id="availability" className="scroll-mt-24 mt-12 grid items-start gap-5 lg:grid-cols-2">
            <div className="rounded-[1.5rem] border border-border bg-card p-3.5 sm:p-5 md:p-8">
              <div className="flex flex-row items-center justify-between gap-3 border-b border-border pb-4 sm:pb-5">
                <div>
                  <p className="eyebrow text-accent">Availability</p>
                  <p className="mt-1 font-journal text-2xl text-primary sm:mt-2 sm:text-3xl">{calendarMonthLabel}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => shiftCalendarMonth(-1)} className="grid h-9 w-9 place-items-center rounded-full border border-border text-primary transition-colors hover:border-primary" aria-label="Previous month" data-testid="button-calendar-previous"><CaretLeftIcon /></button>
                  <button type="button" onClick={() => setCalendarMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))} className="rounded-full border border-border px-3 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-primary" data-testid="button-calendar-today">Today</button>
                  <button type="button" onClick={() => shiftCalendarMonth(1)} className="grid h-9 w-9 place-items-center rounded-full border border-border text-primary transition-colors hover:border-primary" aria-label="Next month" data-testid="button-calendar-next"><CaretRightIcon /></button>
                </div>
              </div>

              {/* One to five, and no further. The rate card covers those
                  occupancies and the grid shows exactly what it covers; a
                  larger party is priced at the form below, where the children
                  and pets that change the number are actually asked for.
                  Picking a number here fills the form in, so choosing the
                  dates and the party is one gesture rather than two. */}
              <div className="mt-4 border-b border-border pb-4 sm:mt-5 sm:pb-5">
                <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                  <span className="text-[13px] font-medium text-muted-foreground">Prices for</span>
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
                  <span className="text-xs text-muted-foreground">{calendarGuests === 1 ? 'guest' : 'guests'}</span>
                </div>

                <p className="mt-3 hidden text-xs leading-5 text-muted-foreground sm:block" data-testid="text-large-party-note">
                  Staying with more than {ratePlan.data?.maxGuests ?? 5}? Put the
                  numbers into the booking form below and the estimate there works
                  out the whole party, children and pets included.
                </p>
              </div>

              {/* Said where the eye is, before the first tap. After it, the
                  strip under the grid takes over. */}
              <p className="mt-4 text-[13px] font-medium text-primary sm:mt-5" data-testid="text-calendar-hint">
                {!shownStay.checkIn
                  ? 'Tap your check-in date, then your check-out date.'
                  : !shownStay.checkOut
                    ? 'Now tap your check-out date.'
                    : 'Your dates are in the booking form. Tap a new date to start again.'}
              </p>

              <div className="mt-3 grid select-none grid-cols-7 gap-1 text-center sm:gap-1.5">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <p key={day} className="pb-1 text-xs text-muted-foreground sm:pb-2 sm:text-[13px]"><span className="sm:hidden">{day.slice(0, 1)}</span><span className="hidden sm:inline">{day}</span></p>)}
                {daysInView.map((day) => {
                  const key = dateKey(day);
                  const dayEvents = busyPeriods.filter((event) => eventTouchesDay(event, key));
                  const isOutsideMonth = day.getMonth() !== calendarMonth.getMonth();
                  const isToday = key === todayKey;
                  const isPast = key < todayKey;
                  const nightPaise = rateForNight(ratePlan.data, key, calendarGuests);
                  const held = dayEvents.length > 0;

                  const isCheckIn = Boolean(shownStay.checkIn) && key === shownStay.checkIn;
                  const isCheckOut = Boolean(shownStay.checkOut) && key === shownStay.checkOut;
                  const inRange =
                    Boolean(shownStay.checkIn && shownStay.checkOut) &&
                    key > shownStay.checkIn &&
                    key < shownStay.checkOut;
                  const inPreview =
                    previewEnd !== null && key > shownStay.checkIn && key < previewEnd;

                  /* A held night can still be a legal check-out: it is the
                     morning the next guest arrives, and a check-out claims no
                     night of its own. */
                  const isReachableCheckOut =
                    choosingCheckOut &&
                    key > shownStay.checkIn &&
                    stayIsFree(stayBlocks, shownStay.checkIn, key);

                  const onEnds = isCheckIn || isCheckOut;
                  const between = inRange || inPreview;

                  // An end of the current stay stays live even when it sits on
                  // a held night, or the handle could not be picked up again.
                  const selectable =
                    !isOutsideMonth && !isPast && (!held || isReachableCheckOut || onEnds);

                  const tone = onEnds
                    ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                    : between
                      ? 'border-primary/45 bg-sage'
                      : isOutsideMonth
                        ? 'border-transparent bg-background/40 opacity-35'
                        : held
                          ? 'border-accent/35 bg-secondary/40'
                          : isPast
                            ? 'border-border bg-background opacity-40'
                            : 'border-border bg-background';

                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={!selectable}
                      onClick={() => pickDay(key)}
                      onPointerDown={(event) => {
                        // Touch keeps tapping: a drag there would fight the
                        // page scroll, and tap-tap already sets both dates.
                        if (event.pointerType === 'touch' || !selectable) return;
                        // Without this the press captures the pointer and no
                        // other day ever sees it, so the drag would never move.
                        event.currentTarget.releasePointerCapture?.(event.pointerId);
                        beginDrag(key);
                      }}
                      onPointerEnter={() => {
                        if (dragAnchor) extendDrag(key);
                        else if (selectable) setHoverDay(key);
                      }}
                      onPointerLeave={() => {
                        if (!dragAnchor) setHoverDay(null);
                      }}
                      aria-pressed={onEnds}
                      aria-label={`${shortDate(key)}${held ? ', booked' : ''}${isCheckIn ? ', check-in' : ''}${isCheckOut ? ', check-out' : ''}`}
                      className={`min-h-[46px] rounded-lg border p-1 text-left transition-colors sm:min-h-[76px] sm:p-2 ${tone} ${isToday ? 'ring-2 ring-accent/60 ring-offset-1 ring-offset-card' : ''} ${selectable ? 'cursor-pointer hover:border-primary' : 'cursor-default'} ${onEnds ? 'md:cursor-ew-resize' : ''}`}
                      data-testid={`calendar-day-${key}`}
                    >
                      <span className={`block text-xs font-bold ${onEnds ? 'text-primary-foreground' : isToday ? 'text-accent' : 'text-primary'}`}>{day.getDate()}</span>
                      <span className="mt-1 block space-y-1 sm:mt-2">
                        {dayEvents.slice(0, 1).map((event) => <span key={`${event.id}-${key}`} className="hidden truncate rounded bg-clay px-1.5 py-1 text-xs font-bold leading-none text-primary sm:block" title="Booked">Booked</span>)}
                        {/* On a phone a booked night is the clay colour alone: "B…" helped nobody. */}
                        {held && !onEnds && <span className="block h-1.5 w-full rounded-full bg-clay sm:hidden" aria-hidden="true" />}
                        {nightPaise !== null && !isOutsideMonth && !(held && !onEnds) && (
                          <span className={`block font-mono-ui text-[10px] leading-none tracking-tight sm:text-xs sm:tracking-normal ${onEnds ? 'text-primary-foreground/80' : 'text-muted-foreground'}`} data-testid={`calendar-price-${key}`}>
                            {formatRupeesCompact(nightPaise)}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* What the guest has picked so far, and the way back out of it.
                  The same two strings are already in the form below, so this
                  strip is a confirmation rather than a second control. */}
              {shownStay.checkIn && (
                <div
                  className="mt-5 rounded-xl border border-primary/25 bg-primary/5 px-4 py-3"
                  role="status"
                  data-testid="text-calendar-selection"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    {shownStay.checkOut ? (
                      <p className="text-xs leading-5 text-primary">
                        <span className="font-bold">{shortDate(shownStay.checkIn)} → {shortDate(shownStay.checkOut)}</span>
                        {nights > 0 && !dragAnchor && <> · {nights} night{nights === 1 ? '' : 's'}</>}
                        <span className="text-muted-foreground">
                          {' '}· drag either end, or tap a new date, to change it
                        </span>
                      </p>
                    ) : (
                      <p className="text-xs leading-5 text-primary">
                        Check-in <span className="font-bold">{shortDate(shownStay.checkIn)}</span>
                        <span className="text-muted-foreground">
                          {' '}· now pick your check-out
                          {checkOutCeiling ? ` (up to ${shortDate(checkOutCeiling)}, the next booking)` : ''}
                        </span>
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={clearStayDates}
                      className="rounded-full border border-border px-3 py-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                      data-testid="button-clear-dates"
                    >
                      Clear
                    </button>
                  </div>

                  {/* The price the moment the stay is complete, next to the way
                      forward — the thing the OTA listings do that a plain date
                      picker does not. Held back mid-drag: a number that flickers
                      under the thumb reads as instability, not feedback. */}
                  {quotedStay && (
                    <div className="mt-3 flex flex-wrap items-end justify-between gap-3 border-t border-primary/15 pt-3">
                      <div>
                        <p className="font-journal text-3xl leading-none text-primary" data-testid="text-calendar-total">
                          {currency(quotedStay.total)}
                        </p>
                        <p className="mt-1.5 text-xs leading-4 text-muted-foreground">
                          For {quotedStay.nights} night{quotedStay.nights === 1 ? '' : 's'} ·{' '}
                          {form.adults} adult{Number(form.adults) === 1 ? '' : 's'}
                          {Number(form.children) > 0 ? ` · ${form.children} child${Number(form.children) === 1 ? '' : 'ren'}` : ''}
                          {Number(form.pets) > 0 ? ` · ${form.pets} pet${Number(form.pets) === 1 ? '' : 's'}` : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={goToEnquiry}
                        className="flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5 active:scale-95"
                        data-testid="button-calendar-reserve"
                      >
                        Book these dates
                      </button>
                    </div>
                  )}
                </div>
              )}

              <p className="mt-6 border-t border-border pt-5 text-xs leading-4 text-muted-foreground">Tap a date for your check-in and another for your check-out, or drag across the nights you want. Either way, they fill the booking form. Once a stay is set you can drag either end to adjust it. Dates marked as booked are unavailable, though a checkout day remains open for a new arrival.</p>
           </div>

            <div ref={enquiryCardRef} className="scroll-mt-24 rounded-[1.5rem] bg-background p-6 shadow-lg md:p-8">
              <form ref={formRef} onSubmit={(event) => { event.preventDefault(); if (canPayOnline) void startBooking(); }} className="space-y-6" data-testid="form-booking-enquiry"><div className="flex items-center justify-between border-b border-border pb-5"><div><p className="font-journal text-3xl text-primary">Book your stay</p><p className="mt-1 text-xs text-muted-foreground">Hold the dates and pay the advance by UPI. The balance is paid at check-in.</p></div></div><div className="grid gap-5 sm:grid-cols-2"><label className="block sm:col-span-2"><span className="eyebrow text-muted-foreground">Your name *</span><input required minLength={2} maxLength={80} autoComplete="name" ref={nameFieldRef} value={form.name} onChange={(event) => updateForm('name', event.target.value)} className="mt-2 w-full border-b border-border bg-transparent px-0 py-3 text-sm text-primary placeholder:text-muted-foreground/60 focus:border-primary" placeholder="Name" data-testid="input-guest-name" /></label><label className="block"><span className="eyebrow text-muted-foreground">Phone *</span><input required type="tel" inputMode="tel" autoComplete="tel" maxLength={20} pattern="(\+?91[- ]?|0)?[6-9][0-9]{9}" title="A 10-digit Indian mobile number, with or without +91" value={form.phone} onChange={(event) => updateForm('phone', event.target.value)} className="mt-2 w-full border-b border-border bg-transparent px-0 py-3 text-sm text-primary placeholder:text-muted-foreground/60 focus:border-primary" placeholder="+91 98765 43210" data-testid="input-guest-phone" /></label><label className="block"><span className="eyebrow text-muted-foreground">Email</span><input type="email" autoComplete="email" maxLength={200} value={form.email} onChange={(event) => updateForm('email', event.target.value)} className="mt-2 w-full border-b border-border bg-transparent px-0 py-3 text-sm text-primary placeholder:text-muted-foreground/60 focus:border-primary" placeholder="you@example.com" data-testid="input-guest-email" /></label><label className="block"><span className="eyebrow text-muted-foreground">Check-in *</span><input required type="date" min={new Date().toISOString().split('T')[0]} value={form.checkIn} onChange={(event) => updateForm('checkIn', event.target.value)} className="mt-2 w-full border-b border-border bg-transparent px-0 py-3 text-sm text-primary focus:border-primary" data-testid="input-check-in" /></label><label className="block"><span className="eyebrow text-muted-foreground">Check-out *</span><input required type="date" min={form.checkIn || new Date().toISOString().split('T')[0]} value={form.checkOut} onChange={(event) => updateForm('checkOut', event.target.value)} className="mt-2 w-full border-b border-border bg-transparent px-0 py-3 text-sm text-primary focus:border-primary" data-testid="input-check-out" /></label></div>{dateConflict && <p className="flex items-start gap-2 rounded-xl border border-terracotta/40 bg-terracotta/5 px-4 py-3 text-[13px] leading-6 text-terracotta" role="alert" data-testid="text-date-conflict"><AlertIcon className="mt-0.5 shrink-0" /><span>Those nights are already taken: {shortDate(eventDateKey(dateConflict.startDate))} to {shortDate(eventDateKey(dateConflict.endDate))} is booked. Pick other dates and the estimate will update.</span></p>}{shortStay && <p className="flex items-start gap-2 rounded-xl border border-terracotta/40 bg-terracotta/5 px-4 py-3 text-[13px] leading-6 text-terracotta" role="alert" data-testid="text-minimum-stay"><AlertIcon className="mt-0.5 shrink-0" /><span>{shortStay.label} has a {shortStay.minNights}-night minimum stay. Add a night and the estimate will update.</span></p>}<div className="grid grid-cols-3 gap-3"><label className="block rounded-xl border border-border p-3"><span className="flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground">Adults</span><input required type="number" min="1" value={form.adults} onChange={(event) => updateForm('adults', event.target.value)} className="mt-2 w-full bg-transparent text-lg font-bold text-primary" data-testid="input-adults" /></label><label className="block rounded-xl border border-border p-3"><span className="flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground">Children</span><input type="number" min="0" value={form.children} onChange={(event) => updateForm('children', event.target.value)} className="mt-2 w-full bg-transparent text-lg font-bold text-primary" data-testid="input-children" /></label><label className="block rounded-xl border border-border p-3"><span className="flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground">Pets</span><input type="number" min="0" value={form.pets} onChange={(event) => updateForm('pets', event.target.value)} className="mt-2 w-full bg-transparent text-lg font-bold text-primary" data-testid="input-pets" /></label></div><label className="block"><span className="eyebrow text-muted-foreground">Special requests</span><textarea rows={3} value={form.requests} onChange={(event) => updateForm('requests', event.target.value)} className="mt-2 w-full resize-none border-b border-border bg-transparent px-0 py-3 text-sm text-primary placeholder:text-muted-foreground/60 focus:border-primary" placeholder="Arrival notes, pet details, meal preferences..." data-testid="input-special-requests" /></label><div className="rounded-xl bg-card p-4"><div className="flex items-center justify-between"><p className="text-sm font-bold text-primary">Planning estimate</p><p className="font-mono-ui text-xs text-muted-foreground">{nights ? `${nights} night${nights === 1 ? '' : 's'}` : 'Select dates'}</p></div><div className="mt-3 flex items-end justify-between"><div><p className="text-[13px] text-muted-foreground">{fromRate === null ? 'Check availability & current rate' : `From ${currency(fromRate)} / night`}</p><p className="mt-1 text-xs text-muted-foreground">{(serverQuote?.advancePercent ?? 0) >= 100 ? 'Peak dates: paid in full at booking' : `Advance ${serverQuote?.advancePercent ?? Math.round(CONFIG.advanceShare * 100)}% now · balance at check-in`}</p></div><p className="font-journal text-3xl text-primary" data-testid="text-estimate-total">{serverQuote?.available && serverQuote.totalPaise ? currency(serverQuote.totalPaise / 100) : nights > 0 && fromRate !== null ? currency(total) : '—'}</p></div>{nights > 0 && extrasPaise > 0 && <p className="mt-3 border-t border-border pt-3 text-xs leading-5 text-muted-foreground" data-testid="text-estimate-extras">Includes {currency(Math.round(extrasPaise / 100))} for {[breakdown.extraChildren + breakdown.extraAdults > 0 ? `${breakdown.extraChildren + breakdown.extraAdults} guest${breakdown.extraChildren + breakdown.extraAdults === 1 ? '' : 's'} above ${ratePlan.data?.maxGuests ?? 5}` : null, breakdown.pets > 0 ? `${breakdown.pets} pet${breakdown.pets === 1 ? '' : 's'}` : null].filter(Boolean).join(' and ')}.</p>}{nights > 0 && stay.discounted && <p className="mt-3 border-t border-border pt-3 text-xs leading-5 text-muted-foreground" data-testid="text-estimate-weekly">Includes the {ratePlan.data?.ladder?.weeklyDiscountPercent ?? 10}% weekly-stay discount.</p>}{nights > 0 && <div className="mt-3 flex justify-between border-t border-border pt-3 text-xs text-muted-foreground"><span>Advance: {currency(serverQuote?.available && serverQuote.advancePaise ? serverQuote.advancePaise / 100 : advance)}</span><span>Balance: {currency(serverQuote?.available && serverQuote.balancePaise !== undefined ? serverQuote.balancePaise / 100 : balance)}</span></div>}</div>{submitError && <p className="flex items-start gap-2 rounded-xl border border-terracotta/40 bg-terracotta/5 px-4 py-3 text-[13px] leading-6 text-terracotta" role="alert" data-testid="text-submit-error"><AlertIcon className="mt-0.5 shrink-0" /><span>{submitError}</span></p>}{bookingNote && <p className="rounded-xl bg-secondary/60 px-4 py-3 text-[13px] leading-5 text-primary" data-testid="text-booking-note">{bookingNote}</p>}{bookByMessage ? <a href={bookByWhatsappUrl} target="_blank" rel="noreferrer" onClick={() => track('book_by_whatsapp')} className="flex w-full items-center justify-center gap-2 rounded-full bg-primary px-5 py-4 text-sm font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5 active:scale-95" data-testid="link-book-by-whatsapp"><WhatsappIcon /> Message us on WhatsApp to book</a> : <button type="submit" disabled={!canPayOnline || paying} className="flex w-full items-center justify-center gap-2 rounded-full bg-primary px-5 py-4 text-sm font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5 active:scale-95 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50" data-testid="button-book-pay">{paying ? 'Holding your dates…' : canPayOnline && serverQuote?.advancePaise ? <>Hold dates &amp; pay {currency(serverQuote.advancePaise / 100)}</> : bookButtonIdle}</button>}{canPayOnline && <p className="text-center text-xs leading-5 text-muted-foreground" data-testid="text-hold-note">Paying holds these dates for {serverQuote?.holdMinutes ?? 30} minutes. We confirm as soon as we see the payment.</p>}<p className="text-center text-xs leading-4 text-muted-foreground">By booking you agree to our <a href={`${basePath}/house-rules`} className="underline decoration-accent decoration-1 underline-offset-2 hover:text-primary" data-testid="link-form-house-rules">house rules</a>.</p></form>
            </div>
            </div>
          </div>
        </section>

        {/* The same quote, kept within thumb reach on a phone.

            On a narrow screen the calendar and the form are stacked, so the
            price scrolls off the moment the guest looks at anything else. This
            bar follows them down until they act on it, and is never shown on desktop, where the strip beside
            the calendar is already on screen next to the form. */}
        {quotedStay && !formInView && (
          <div
            className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-4 border-t border-border bg-background px-5 py-3 shadow-[0_-6px_24px_rgba(0,0,0,.08)] lg:hidden"
            data-testid="bar-mobile-reserve"
          >
            <div className="min-w-0">
              <p className="font-journal text-2xl leading-none text-primary">{currency(quotedStay.total)}</p>
              <p className="mt-1 truncate text-xs leading-4 text-muted-foreground">
                {shortDate(form.checkIn)} → {shortDate(form.checkOut)} · {quotedStay.nights} night
                {quotedStay.nights === 1 ? '' : 's'}
              </p>
            </div>
            <button
              type="button"
              onClick={goToEnquiry}
              className="flex shrink-0 items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground active:scale-95"
              data-testid="button-mobile-reserve"
            >
              Book these dates
            </button>
          </div>
        )}

        {/* ------------------------------------------------- neighbourhood
            A taste of it. All eighteen places, with their road distances from
            the villa, live on /places-to-visit-in-shantiniketan — a page that
            answers a question people ask Google before they have chosen
            anywhere to stay. */}
        <section id="experience" className="scroll-mt-24 section-shell py-24 md:py-32" aria-labelledby="experience-title">
          <div className="flex flex-col justify-between gap-8 md:flex-row md:items-end">
            <div>
              <h2 id="experience-title" className="font-journal text-5xl leading-[.94] text-primary md:text-7xl">Make room<br />for wandering.</h2>
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
            className="mt-9 inline-flex items-center gap-2 text-sm font-semibold text-primary underline decoration-accent decoration-2 underline-offset-4"
            data-testid="link-places-page"
          >
            Read more: all {NEIGHBOURHOOD_COUNT} places, with distances          </a>

          {/* The trip pages had only the places page pointing at them, which
              left them two hops from the front door and getting none of the
              homepage's weight. Planning is the question a visitor asks
              immediately after "what is there", so this is where the links
              belong. */}
          <p className="mt-6 flex flex-wrap gap-x-6 gap-y-3 text-[13px] font-medium text-primary">
            <a
              href={`${basePath}/shantiniketan-weekend-trip-from-kolkata`}
              className="underline decoration-accent decoration-2 underline-offset-4"
              data-testid="link-home-weekend"
            >
              Planning a weekend from Kolkata
            </a>
            <a
              href={`${basePath}/shantiniketan-2-day-itinerary`}
              className="underline decoration-accent decoration-2 underline-offset-4"
              data-testid="link-home-itinerary"
            >
              What two days here look like
            </a>
          </p>
        </section>

        <section id="food" className="scroll-mt-24 border-y border-border bg-card py-24 md:py-32" aria-labelledby="food-title">
          <div className="section-shell"><div className="flex flex-col justify-between gap-8 md:flex-row md:items-end"><div><h2 id="food-title" className="font-journal text-5xl leading-[.94] text-primary md:text-7xl">A kitchen<br />with options.</h2></div><p className="max-w-[290px] text-sm leading-6 text-muted-foreground">The best meal plan is the one that leaves room for another cup of tea.</p></div>
            <div className="mt-14 grid gap-4 md:grid-cols-3">
              {[
                { title: 'Cafe Soi', text: 'Cafe Soi is inside the premises when you want a meal without leaving your little orbit.', href: `${basePath}/cafe-soi-shantiniketan` },
                { title: 'Make it yours', text: 'Basic cooking utensils, induction setup, microwave, refrigerator and a water filter are available.' },
                { title: 'Cooked with care', text: 'Ask the caretaker about the home-cooked meal option. Zomato is available too.' },
              ].map(({ title, text, href }: { title: string; text: string; href?: string }, index) => {
                const className = `lift block rounded-[1.4rem] p-7 ${index === 1 ? 'bg-primary text-primary-foreground' : 'border border-border bg-background'}`;
                const body = (
                  <>
                    <p className="mt-16 font-journal text-3xl">{title}</p>
                    <p className={`mt-4 text-sm leading-6 ${index === 1 ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>{text}</p>
                    {href && (
                      <p className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-primary underline decoration-accent decoration-2 underline-offset-4">
                        See the full menu                      </p>
                    )}
                  </>
                );
                return href ? (
                  <a key={title} href={href} className={`${className} transition-colors hover:border-primary`} data-testid="link-home-cafe">
                    {body}
                  </a>
                ) : (
                  <div key={title} className={className}>{body}</div>
                );
              })}
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
              <h2 id="gallery-title" className="font-journal text-5xl leading-[.94] text-primary md:text-7xl">A look<br />around home.</h2>
            </div>
            <a
              href={`${basePath}/gallery`}
              className="inline-flex items-center gap-2 text-sm font-semibold text-primary underline decoration-accent decoration-2 underline-offset-4"
              data-testid="link-gallery-page"
            >
              View all photos            </a>
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
              <h2 id="faq-title" className="font-journal text-4xl leading-[.96] text-primary md:text-5xl">
                The useful answers.
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
                        {isOpen ? <CloseIcon /> : <CaretDownIcon />}
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
                className="inline-flex items-center gap-2 text-sm font-semibold text-primary underline decoration-accent decoration-2 underline-offset-4"
                data-testid="link-faq-house-rules"
              >
                Read the full house rules              </a>
            </div>
          </div>
        </section>

        <section id="reviews" className="scroll-mt-24 section-shell py-16 md:py-20" aria-labelledby="reviews-title">
          <ReviewCarousel />
        </section>

      </main>

      {/* Two lines. The first is everything a guest might click — brand,
          every page, and the ways to reach us, with Instagram and reviews as
          icons so the row fits on a laptop. The second is the small print.
          It scrolls with the page — only the header is pinned. */}
      <footer className="on-dark bg-forest py-6 pb-28 text-footer-ink md:pb-6" data-testid="site-footer">
        <div className="section-shell">
          <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
            <div className="flex items-center gap-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-sand text-forest"><LeafIcon /></span>
              <span className="font-journal text-lg leading-none">Raj Kuthir <span className="text-footer-ink/60">Homestays</span></span>
            </div>
            <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-footer-ink/70" aria-label="Footer navigation">
              <a href={`${basePath}/our-story`} className="transition-colors hover:text-sand" data-testid="link-footer-story">Our story</a>
              <a href={`${basePath}/places-to-visit-in-shantiniketan`} className="transition-colors hover:text-sand" data-testid="link-footer-places">Places to visit</a>
              <a href={`${basePath}/shantiniketan-weekend-trip-from-kolkata`} className="transition-colors hover:text-sand" data-testid="link-footer-weekend">Weekend from Kolkata</a>
              <a href={`${basePath}/homestay-near-visva-bharati`} className="transition-colors hover:text-sand" data-testid="link-footer-visva-bharati">Near Visva-Bharati</a>
              <a href={`${basePath}/homestay-near-sonajhuri-haat`} className="transition-colors hover:text-sand" data-testid="link-footer-sonajhuri">Near Sonajhuri Haat</a>
              <a href={`${basePath}/poush-mela-stay-shantiniketan`} className="transition-colors hover:text-sand" data-testid="link-footer-poush-mela">Poush Mela stay</a>
              <a href={`${basePath}/basanta-utsav-stay-shantiniketan`} className="transition-colors hover:text-sand" data-testid="link-footer-basanta-utsav">Basanta Utsav stay</a>
              <a href={`${basePath}/cafe-soi-shantiniketan`} className="transition-colors hover:text-sand" data-testid="link-footer-cafe">Cafe Soi menu</a>
              <a href={`${basePath}/gallery`} className="transition-colors hover:text-sand" data-testid="link-footer-gallery">Photos</a>
              <a href={`${basePath}/pet-friendly-homestay-shantiniketan`} className="transition-colors hover:text-sand" data-testid="link-footer-pet">Staying with a pet</a>
              <a href={`${basePath}/rates`} className="transition-colors hover:text-sand" data-testid="link-footer-rates">Rates</a>
              <a href={`${basePath}/house-rules`} className="transition-colors hover:text-sand" data-testid="link-footer-house-rules">House rules</a>
              <a href={`${basePath}/welcome`} className="transition-colors hover:text-sand" data-testid="link-footer-welcome">Arriving guests</a>
              <a href={`${basePath}/cancellation-refund-policy`} className="transition-colors hover:text-sand" data-testid="link-footer-cancellation">Cancellation &amp; refunds</a>
              <a href={`${basePath}/terms`} className="transition-colors hover:text-sand" data-testid="link-footer-terms">Terms</a>
              <a href={`${basePath}/privacy-policy`} className="transition-colors hover:text-sand" data-testid="link-footer-privacy">Privacy</a>
              <a href={`${basePath}/contact`} className="transition-colors hover:text-sand" data-testid="link-footer-contact">Contact</a>
            </nav>
            <div className="flex items-center gap-4 text-sm text-footer-ink/70">
              <a href={CONFIG.instagramUrl} target="_blank" rel="noreferrer" className="transition-colors hover:text-sand" aria-label="Instagram" data-testid="link-footer-instagram"><InstagramIcon /></a>
              <a href={CONFIG.reviewUrl} target="_blank" rel="noreferrer" className="transition-colors hover:text-sand" aria-label="Google reviews" data-testid="link-footer-review"><StarIcon /></a>
              <a href={phoneHref(CONFIG.hostPhone)} className="flex items-center gap-2 transition-colors hover:text-sand" data-testid="link-footer-call"><PhoneIcon /> {CONFIG.hostPhone}</a>
            </div>
          </div>

          <div className="mt-4 flex flex-col justify-between gap-1.5 border-t border-footer-ink/15 pt-3 text-[13px] text-footer-ink/40 sm:flex-row">
            <p>© {new Date().getFullYear()} Raj Kuthir Homestays · Made for slower days</p>
            <p className="normal-case tracking-[.04em]" data-testid="text-footer-udyam">MSME Udyam: UDYAM-WB-04-0087351</p>
            <p className="normal-case tracking-[.04em] text-footer-ink/30" data-testid="text-footer-credit">Developed by Sourja Mukherjee</p>
          </div>
        </div>
      </footer>

      {/* The two things a guest needs that are not on the page: how to get
          here, and what to do once they have booked. Both follow them down
          every screen. On a phone they wait until the hero photo has
          scrolled away, so they never sit on top of its buttons, and then
          sit clear of the booking bar below them; on a laptop they take the
          bottom-right corner, where nothing else lives. */}
      <div className={`fixed bottom-[5.4rem] right-3 z-40 flex-col items-end gap-2 md:bottom-6 md:right-6 ${inBooking ? 'hidden' : pastHero ? 'flex' : 'hidden md:flex'}`}>
        <a
          href={CONFIG.mapsUrl}
          target="_blank"
          rel="noreferrer"
          onClick={() => track('directions_click', { placement: 'floating' })}
          className="group flex items-center gap-2 rounded-full bg-secondary px-4 py-3 text-primary shadow-xl ring-1 ring-primary/15 transition-transform hover:-translate-y-0.5 active:scale-95 md:gap-3 md:px-5 md:py-4"
          aria-label="Get directions to Raj Kuthir Homestays on Google Maps"
          data-testid="link-floating-directions"
        >
          <MapPinIcon className="shrink-0" />
          <span className="text-[13px] font-medium">Get directions</span>
        </a>
        <a
          href={`${basePath}/welcome`}
          onClick={() => track('arrival_pack_click', { placement: 'floating' })}
          className="group flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-primary-foreground shadow-xl ring-1 ring-secondary/25 transition-transform hover:-translate-y-0.5 active:scale-95 md:gap-3 md:px-5 md:py-4"
          aria-label="Open my arrival pack — for guests with a confirmed booking"
          data-testid="link-floating-arrival"
        >
         
          <span className="text-[13px] font-medium">Arrival pack</span>
        </a>
      </div>

      {/* The phone booking bar: glass, because it floats over whatever is
          scrolling beneath it. It appears once the hero photo has gone (the
          hero has its own buttons) and steps aside while the quote bar above
          is showing. */}
      {pastHero && !quotedStay && !inBooking && (
        <div className="glass-bar fixed inset-x-3 bottom-3 z-40 flex items-center gap-2 rounded-full p-2 md:hidden" data-testid="mobile-contact-bar">
          <a href={phoneHref(CONFIG.hostPhone)} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-secondary text-primary" aria-label={`Call the host on ${CONFIG.hostPhone}`} data-testid="button-sticky-call">
            <PhoneIcon size="md" />
          </a>
          <button type="button" onClick={scrollToAvailability} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-primary text-sm font-semibold text-primary-foreground" data-testid="button-sticky-book">
            <CalendarIcon /> Check dates
          </button>
          <a href={whatsappUrl} target="_blank" rel="noreferrer" className="flex h-11 flex-1 items-center justify-center gap-2 rounded-full border border-primary/20 bg-background text-sm font-semibold text-primary" data-testid="button-sticky-whatsapp">
            <WhatsappIcon /> WhatsApp
          </a>
        </div>
      )}
    </div>
  );
}

/*
  Guest reviews, as written on Google. Quoted in the guest's own words —
  trimmed with an ellipsis where a review runs long, capitals and spelling
  tidied, never reworded. These used to be two tall image cards that filled
  a screen and a half on a phone; as text they read in one strip, and a new
  review is one more entry here.

  `image` is optional: drop a rendered 4:3 review card into /public and set
  it, and that card shows the image instead of the text. The quote stays as
  the image's alt text, so it is still read out and still indexed.
*/
type GuestReview = { name: string; text: string; image?: string };

const REVIEWS: readonly GuestReview[] = [
  {
    name: 'Roshni Chakraborty',
    text: '…honestly our stay better than anywhere else we stayed. The host and caretaker were very helpful and caring, we had a very peaceful and luxurious stay… Literally the perfect break from everything.',
  },
  {
    name: 'Angela Banerjee',
    text: 'It was a serene experience staying at Raj Kuthir. The place is immaculate, the kitchen well furnished and the garden beautiful. The host, Mr Sourjyo, is a generous and amicable host. Overall, we would highly recommend Raj Kuthir homestays.',
  },
  {
    name: 'Adrija Banerjee',
    text: "Beautiful place! A little outside the City. Perfect for people who want to stay away from the noise. The owner was extremely helpful and friendly. The place is pet friendly too. Not only that my fur baby got lots of love from our caretaker as well :D So if you're planning a vacation to Shantiniketan soon with your fur baby, this is the spot!",
  },
  {
    name: 'Swarup Banik',
    text: 'This is an awe inspiring property amidst the green corridor of Bolpur, Shantiniketan. The place offers a plethora of options to sit back and relax while soaking in the rustic vibe… When in Bolpur, look no further and settle for this value for money space.',
  },
  {
    name: 'Santanu Paul',
    text: 'Wanna feel real vibes of Santiniketan - the best place to go for. Enjoyed the serenity in secured privacy where we remain ourselves only. Starting from the decor to support for anything, we had maximum satisfaction.',
  },
  {
    name: 'Lipi Paul',
    text: 'We spent a weekend at Sobujpotro. It was a great experience. The place is well furnished, clean, beautifully maintained. You can cook yourself or order from the canteen. The owner took very good care of us and regularly stayed in touch on call. Highly recommended.',
  },
  {
    name: 'Kaushik Das',
    text: 'Clean air, peaceful environment, lots of greenery in surrounding areas. Perfect place to detox from city life. Would highly recommend this place if you are looking for a nice relaxing vacation.',
  },
  {
    name: 'Uday Sankar Chattopadhyay',
    text: 'This is a quiet and serene place, ideal for those who want to stay away from city crowd for a while. This unit is comfortable, self sufficient. I loved this place.',
  },
  {
    name: 'Sukanta Moule',
    text: 'You can use the bungalow for your family of 6 to 7 and will get a good space of drawing room and a useful kitchen. Overall it was a nice experience and hope visit again.',
  },
];

/*
  One row of review cards that scrolls sideways. Native overflow with scroll
  snapping, so a phone swipes it and a trackpad scrolls it with no library;
  the arrow buttons are for mouse users and step one card at a time.
*/
function ReviewCarousel() {
  const trackRef = useRef<HTMLDivElement | null>(null);

  const step = (direction: 1 | -1) => {
    const track = trackRef.current;
    if (!track) return;
    const card = track.querySelector<HTMLElement>('[data-review-card]');
    const distance = card ? card.offsetWidth + 16 : track.clientWidth;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    track.scrollBy({ left: direction * distance, behavior: reduceMotion ? 'auto' : 'smooth' });
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <h2 id="reviews-title" className="font-journal text-4xl leading-none text-primary md:text-5xl">
            Kind <em>words.</em>
          </h2>
        </div>
        <div className="flex items-center gap-4">
          <a href={CONFIG.leaveReviewUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm font-semibold text-primary underline decoration-accent decoration-2 underline-offset-4" data-testid="link-google-review">
            Leave a Google review <ExternalIcon />
          </a>
          <div className="hidden items-center gap-2 sm:flex">
            <button type="button" onClick={() => step(-1)} className="grid h-9 w-9 place-items-center rounded-full border border-border text-primary transition-colors hover:border-primary" aria-label="Previous reviews" data-testid="button-reviews-previous"><CaretLeftIcon /></button>
            <button type="button" onClick={() => step(1)} className="grid h-9 w-9 place-items-center rounded-full border border-border text-primary transition-colors hover:border-primary" aria-label="More reviews" data-testid="button-reviews-next"><CaretRightIcon /></button>
          </div>
        </div>
      </div>

      <div
        ref={trackRef}
        className="mt-8 flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="region"
        aria-label="Guest reviews"
        tabIndex={0}
        data-testid="carousel-reviews"
      >
        {REVIEWS.map((review) => (
          <figure
            key={review.name}
            data-review-card
            className={`flex w-[85%] shrink-0 snap-start flex-col justify-between rounded-[1.25rem] border border-border bg-card sm:w-[calc(50%-8px)] lg:w-[calc((100%-32px)/3)] ${review.image ? 'p-2' : 'p-6'}`}
          >
            {review.image ? (
              <img
                src={review.image}
                alt={`Google review by ${review.name}: “${review.text}”`}
                width={1200}
                height={900}
                loading="lazy"
                decoding="async"
                className="aspect-[4/3] w-full rounded-[.9rem] object-cover"
              />
            ) : (
              <>
                <div>
                  <p className="flex items-center gap-1.5 text-[13px] font-medium text-primary">
                    <StarIcon weight="fill" className="text-accent" /> 5 out of 5
                  </p>
                  <blockquote className="mt-4 text-sm leading-6 text-primary/85">“{review.text}”</blockquote>
                </div>
                <figcaption className="mt-5 text-xs font-bold text-primary">
                  {review.name}
                  <span className="font-normal text-muted-foreground"> · Google review</span>
                </figcaption>
              </>
            )}
          </figure>
        ))}
      </div>
    </div>
  );
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
        <Route path="/terms">{() => <Policies kind="terms" />}</Route>
        <Route path="/privacy-policy">{() => <Policies kind="privacy" />}</Route>
        <Route path="/cancellation-refund-policy">{() => <Policies kind="cancellation" />}</Route>
        <Route path="/contact">{() => <Policies kind="contact" />}</Route>
        {/* SEO landing page. Adding a route here also requires an entry in
            api-server/src/lib/seo.ts — a test enforces it. */}
        <Route path="/pet-friendly-homestay-shantiniketan" component={PetFriendly} />
        <Route path="/gallery" component={Gallery} />
        <Route path="/our-story" component={OurStory} />
        <Route path="/places-to-visit-in-shantiniketan" component={PlacesToVisit} />
        {/* Local search landings: one accommodation intent each, distinct from
            the places page, which is about what to see rather than where to
            sleep. */}
        <Route path="/homestay-near-sonajhuri-haat" component={HomestayNearSonajhuri} />
        <Route path="/homestay-near-visva-bharati" component={HomestayNearVisvaBharati} />
        {/* Travel planning. Logistics and the itinerary are separate pages on
            purpose: one intent each, linked to one another. */}
        <Route path="/shantiniketan-weekend-trip-from-kolkata" component={WeekendFromKolkata} />
        <Route path="/shantiniketan-2-day-itinerary" component={TwoDayItinerary} />
        {/* Festival stays: dates, minimum stay and price read from the live
            rate plan's peak periods. */}
        <Route path="/poush-mela-stay-shantiniketan" component={PoushMelaStay} />
        <Route path="/basanta-utsav-stay-shantiniketan" component={BasantaUtsavStay} />
        {/* The café on the grounds, open to everyone; menu from content/cafe-menu.ts. */}
        <Route path="/cafe-soi-shantiniketan" component={CafeSoi} />
        {/* Public rate card, read live from /api/rates. */}
        <Route path="/rates" component={Rates} />
        {/* Guest arrival pack, unlocked with a booking reference. */}
        <Route path="/welcome" component={Welcome} />
        {/* Capability links. The token rides in the URL fragment, not the
            path, so it never reaches the server, the proxy access log or a
            Referer header — see the note in PreArrival.tsx. The path itself
            carries no parameter and is safe to serve to anyone. */}
        <Route path="/pre-arrival" component={PreArrival} />
        <Route path="/pay" component={Pay} />
        <Route path="/offer" component={Offer} />
        <Route path="/invoice" component={GuestInvoice} />
        <Route path="/management-documents" component={ManagementDocuments} />
        {/* The complaints & suggestions book (notice-board QR). Not indexed. */}
        <Route path="/feedback" component={Feedback} />
        <Route path="/admin" component={AdminDashboard} />
        <Route path="/admin/login" component={AdminLogin} />
        <Route path="/admin/earnings" component={AdminEarnings} />
        <Route path="/admin/rates" component={AdminRates} />
        <Route path="/admin/guests" component={AdminGuests} />
        <Route path="/admin/reviews" component={AdminReviews} />
        <Route path="/admin/guest-info" component={AdminGuestInfo} />
        <Route path="/admin/caretaker" component={AdminCaretakerConsole} />
        <Route path="/admin/compliance" component={AdminCompliance} />
        {/* Legacy sign-in path, kept so existing bookmarks still land somewhere useful. */}
        <Route path="/sign-in/*?" component={AdminLogin} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

/**
 * `ssrPath` is only passed by the build-time prerender (entry-server.tsx),
 * which renders each public page to HTML without a browser.
 */
function App({ ssrPath }: { ssrPath?: string } = {}) {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={basePath} ssrPath={ssrPath}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
