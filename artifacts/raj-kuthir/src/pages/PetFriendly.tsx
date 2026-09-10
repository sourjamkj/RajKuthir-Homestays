import { useEffect } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Car,
  ChefHat,
  Coffee,
  Leaf,
  MapPin,
  MessageCircle,
  Moon,
  PawPrint,
  Phone,
  Refrigerator,
  Train,
  Wifi,
} from 'lucide-react';

import { CONFIG, asset, basePath, phoneHref } from '@/lib/site';

/**
 * Landing page for people searching for somewhere to stay in Shantiniketan
 * with a dog.
 *
 * WHAT THIS PAGE IS ALLOWED TO SAY
 *
 * Everything here is either already published on this site (the house rules,
 * the neighbourhood distances) or confirmed by the owner. Nothing about pet
 * charges, pet numbers, size or breed limits, fencing, pet amenities or vets
 * is stated, because none of it is confirmed — and inventing reassurance for
 * someone deciding whether their dog can travel is the worst possible place
 * to guess. Where a fact is missing the page says so and points at the
 * enquiry, which is more useful to a guest than a confident sentence that
 * turns out to be wrong at the gate.
 *
 * The quiet-hours section is deliberately prominent. Raj Kuthir sits among
 * bungalows whose owners live here, and a dog that barks at night is the one
 * genuine risk in bringing a pet to this particular property. Saying it before
 * someone books is worth more than the bookings it costs.
 */

const FAQ_ANCHOR = 'pet-faq';

/**
 * These pairs are also emitted as FAQPage structured data by the server
 * (artifacts/api-server/src/lib/seo.ts). Google requires the markup to match
 * what a visitor can actually read, so a test asserts every question below
 * appears verbatim in both places. Change one, change the other.
 */
export const PET_FAQ = [
  {
    q: 'Are pets actually allowed, or just tolerated?',
    a: 'Genuinely allowed. Pets are written into our published house rules, not granted as an exception at the door. Tell us who is coming when you enquire so the caretaker can have the house ready.',
  },
  {
    q: 'Is the garden fenced?',
    a: 'We are not going to tell you the garden is escape-proof, because that depends entirely on your dog. Message us before you travel and describe them honestly — how they are off-lead, whether they bolt — and we will tell you plainly what to expect rather than guess on a web page.',
  },
  {
    q: 'Is there an extra charge for bringing a pet?',
    a: 'Confirm it with us when you enquire — rates vary by dates and occupancy, so anything quoted here would be out of date. What is already published is the damage side: pet damage or soiling is charged from ₹1,000, and that is on the house rules page along with everything else.',
  },
  {
    q: 'Can we leave our dog in the villa while we go out?',
    a: 'The whole villa is yours, so there is no lobby or corridor to worry about. The thing to think about is noise: the bungalows here sit close together and their owners live in them, so a dog that barks when left alone is a real problem. Talk to the caretaker about your plans for the day.',
  },
  {
    q: 'How do we get there with a pet?',
    a: 'There is parking on the premises if you drive, which most guests travelling with a dog prefer. By train, Prantik station is about 5 km away and Bolpur Shantiniketan about 9 km — Prantik is the closer of the two, which surprises most people.',
  },
  {
    q: 'Where do we eat if we would rather not leave the pet alone?',
    a: 'Cafe Soi is on the premises. The villa also has a refrigerator, microwave, water filter and basic utensils for simple meals, home-cooked food can be arranged through the caretaker, and Zomato delivers to the area subject to the usual conditions.',
  },
];

const villaFeatures = [
  { icon: Wifi, label: 'High-speed Wi-Fi' },
  { icon: Car, label: 'Parking on the premises' },
  { icon: Refrigerator, label: 'Refrigerator and microwave' },
  { icon: ChefHat, label: 'Basic cooking utensils' },
  { icon: Coffee, label: 'Cafe Soi on site' },
  { icon: PawPrint, label: 'Pets in the house rules' },
];

export default function PetFriendly() {
  useEffect(() => {
    const previous = document.title;
    document.title = 'Pet-Friendly Villa in Shantiniketan | Raj Kuthir Homestays';
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-foreground/10 bg-background/90 backdrop-blur-md">
        <div className="section-shell flex h-[74px] items-center justify-between gap-6">
          <a href={`${basePath}/`} className="flex shrink-0 items-center gap-3" data-testid="link-pet-brand">
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
            data-testid="link-pet-back"
          >
            <ArrowLeft size={15} /> Back to the stay
          </a>
        </div>
      </header>

      {/* Breadcrumb, matching the BreadcrumbList the server emits. */}
      <nav aria-label="Breadcrumb" className="section-shell pt-8">
        <ol className="flex flex-wrap items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[.14em] text-muted-foreground">
          <li><a href={`${basePath}/`} className="hover:text-primary" data-testid="link-pet-crumb-home">Home</a></li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="text-primary">Pet-friendly villa</li>
        </ol>
      </nav>

      <main>
        {/* ---------------------------------------------------------- hero */}
        <section className="section-shell pb-16 pt-10 md:pb-20 md:pt-14">
          <div className="grid gap-12 lg:grid-cols-[1.15fr_.85fr] lg:items-center lg:gap-20">
            <div>
              <p className="eyebrow mb-6 text-accent">Travelling with your dog</p>
              <h1 className="max-w-[720px] font-journal text-[clamp(2.7rem,6.5vw,5rem)] leading-[.94] tracking-[-.03em] text-primary">
                Pet-friendly in Shantiniketan,<br /><em className="text-accent">and we mean it.</em>
              </h1>
              <p className="mt-8 max-w-[560px] text-[15px] leading-7 text-muted-foreground md:text-[17px]">
                Raj Kuthir &ndash; Sobuj Potro is a private two-bedroom villa in Bolpur with its own garden.
                You get the whole house, so there is no front desk to clear your dog with, no corridor to
                walk them down, and nobody else&rsquo;s pet on the other side of the wall.
              </p>

              <div className="mt-9 flex flex-wrap gap-3">
                <a
                  href={`${basePath}/#booking`}
                  className="flex items-center gap-2 rounded-full bg-primary px-6 py-4 text-xs font-bold uppercase tracking-[.12em] text-primary-foreground transition-transform hover:-translate-y-0.5"
                  data-testid="link-pet-check-availability"
                >
                  <CalendarDays size={15} /> Check availability &amp; current rate
                </a>
                <a
                  href={`https://wa.me/916290399165?text=${encodeURIComponent(
                    'Hello Raj Kuthir, I would like to enquire about a stay at Sobuj Potro. I am travelling with a pet.',
                  )}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 rounded-full border border-border px-6 py-4 text-xs font-bold uppercase tracking-[.12em] text-primary transition-colors hover:border-primary"
                  data-testid="link-pet-whatsapp-hero"
                >
                  <MessageCircle size={15} /> Enquire on WhatsApp
                </a>
              </div>

              <p className="mt-6 flex items-center gap-2 font-mono-ui text-[11px] text-muted-foreground">
                <MapPin size={13} className="text-accent" /> Bolpur / Shantiniketan, West Bengal
              </p>
            </div>

            <div className="overflow-hidden rounded-[1.4rem] border border-border bg-card">
              <img
                src={asset('Pet View.jpg')}
                alt="A dog in the garden at Raj Kuthir Homestays, Sobuj Potro, Bolpur"
                width={1023}
                height={1537}
                loading="eager"
                decoding="async"
                className="h-full w-full object-cover"
                data-testid="img-pet-hero"
              />
            </div>
          </div>
        </section>

        {/* ------------------------------------------- why a villa works */}
        <section className="border-y border-border bg-card py-20 md:py-24" aria-labelledby="why-title">
          <div className="section-shell grid gap-12 lg:grid-cols-[.75fr_1.25fr] lg:gap-20">
            <div>
              <p className="eyebrow mb-5 text-accent">Why a villa, not a room</p>
              <h2 id="why-title" className="font-journal text-4xl leading-[.96] text-primary md:text-6xl">
                The whole<br /><em>house is yours.</em>
              </h2>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              {[
                {
                  title: 'Nothing to negotiate at the door',
                  text: 'Pets are in our published house rules, so there is no conversation at check-in about whether your dog is allowed in. It is settled before you book.',
                },
                {
                  title: 'No shared spaces',
                  text: 'No lobby, no lift, no corridor, no other guests. For a nervous or reactive dog that removes most of what makes travelling hard.',
                },
                {
                  title: 'The garden opens off the house',
                  text: 'They can go out without being walked through anywhere. First tea outside, last light outside, and paws in the grass in between.',
                },
                {
                  title: 'A caretaker who knows you are coming',
                  text: 'Tell us about your pet when you enquire and the house is prepared for them, rather than the caretaker finding out on arrival.',
                },
              ].map(({ title, text }) => (
                <div key={title} className="rounded-[1.4rem] border border-border bg-background p-7" data-testid={`card-why-${title.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '')}`}>
                  <p className="font-journal text-2xl leading-tight text-primary">{title}</p>
                  <p className="mt-4 text-sm leading-6 text-muted-foreground">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------ the villa */}
        <section className="section-shell py-20 md:py-24" aria-labelledby="villa-title">
          <div className="flex flex-col justify-between gap-8 md:flex-row md:items-end">
            <div>
              <p className="eyebrow mb-5 text-accent">The stay</p>
              <h2 id="villa-title" className="font-journal text-4xl leading-[.96] text-primary md:text-6xl">
                Two bedrooms,<br /><em>a garden, a kitchen.</em>
              </h2>
            </div>
            <p className="max-w-[340px] text-sm leading-6 text-muted-foreground">
              A private bungalow rather than a room in someone else&rsquo;s building &mdash; which is most of why it
              works for a stay with a pet.
            </p>
          </div>

          <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { file: 'interior-entrance.jpg', alt: 'The entrance at Sobuj Potro', w: 501, h: 453 },
              { file: 'interior-living.jpg', alt: 'The living room at Sobuj Potro', w: 598, h: 453 },
              { file: 'interior-dining.jpg', alt: 'The dining space at Sobuj Potro', w: 416, h: 453 },
              { file: 'interior-kitchen.jpg', alt: 'The kitchen at Sobuj Potro', w: 677, h: 557 },
            ].map(({ file, alt, w, h }) => (
              <div key={file} className="overflow-hidden rounded-[1.1rem] border border-border bg-card">
                <img
                  src={asset(file)}
                  alt={alt}
                  width={w}
                  height={h}
                  loading="lazy"
                  decoding="async"
                  className="aspect-[4/3] w-full max-w-full object-cover"
                />
              </div>
            ))}
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {villaFeatures.map(({ icon: Icon, label }) => (
              <div key={label} className="flex items-center gap-3 rounded-[1.1rem] border border-border bg-card px-6 py-5">
                <Icon size={19} className="shrink-0 text-accent" strokeWidth={1.5} />
                <span className="text-sm text-primary">{label}</span>
              </div>
            ))}
          </div>
        </section>

        {/* --------------------------------- the honest bit: quiet hours */}
        <section className="bg-primary py-20 text-primary-foreground md:py-24" aria-labelledby="quiet-title">
          <div className="section-shell grid gap-10 lg:grid-cols-[.8fr_1.2fr] lg:gap-20">
            <div>
              <p className="eyebrow mb-5 text-secondary">Worth knowing first</p>
              <h2 id="quiet-title" className="font-journal text-4xl leading-[.96] md:text-6xl">
                <Moon size={30} className="mb-5 text-secondary" strokeWidth={1.4} />
                About<br /><em>barking.</em>
              </h2>
            </div>
            <div className="max-w-[620px]">
              <p className="text-lg leading-8 md:text-xl md:leading-9">
                Raj Kuthir sits among other private bungalows, and the people who own them live here. Sound
                carries further at night than it feels like it does.
              </p>
              <p className="mt-6 text-sm leading-7 text-primary-foreground/70">
                If your dog settles when left alone, none of this will matter to you. If they bark at unfamiliar
                sounds in an unfamiliar house &mdash; and plenty of dogs do on the first night &mdash; it is worth
                planning around rather than discovering at midnight. Tell us honestly when you enquire and we will
                talk it through. We would far rather have that conversation now than ask you to leave.
              </p>
              <p className="mt-6 text-sm leading-7 text-primary-foreground/70">
                Everything else here has room for a conversation. Our neighbours are the one firm rule, and it is
                set out in full on the{' '}
                <a href={`${basePath}/house-rules`} className="underline decoration-secondary decoration-2 underline-offset-4 hover:text-secondary" data-testid="link-pet-house-rules-quiet">
                  house rules page
                </a>.
              </p>
            </div>
          </div>
        </section>

        {/* ------------------------------------- practical pet information */}
        <section className="section-shell py-20 md:py-24" aria-labelledby="practical-title">
          <p className="eyebrow mb-5 text-accent">The practical part</p>
          <h2 id="practical-title" className="max-w-[620px] font-journal text-4xl leading-[.96] text-primary md:text-6xl">
            What we ask,<br /><em>and what we cannot promise.</em>
          </h2>

          <div className="mt-12 grid gap-5 lg:grid-cols-2">
            <div className="rounded-[1.4rem] border-l-4 border-accent bg-card px-7 py-7">
              <p className="font-journal text-2xl text-primary">What we ask of you</p>
              <div className="mt-5 space-y-3 text-sm leading-6 text-muted-foreground">
                <p>Keep them off the furniture and the linen.</p>
                <p>Clean up after them &mdash; the same things you would do at home.</p>
                <p>Tell us they are coming, so the caretaker can prepare the house.</p>
                <p>
                  Pet damage or soiling is charged from ₹1,000. That figure and every other repair cost is
                  published on the{' '}
                  <a href={`${basePath}/house-rules`} className="underline decoration-accent decoration-1 underline-offset-2 hover:text-primary" data-testid="link-pet-house-rules-charges">
                    house rules page
                  </a>{' '}
                  so a deduction is never a surprise.
                </p>
              </div>
            </div>

            <div className="rounded-[1.4rem] border border-dashed border-border bg-background px-7 py-7">
              <p className="font-journal text-2xl text-primary">What we will not guess at</p>
              <div className="mt-5 space-y-3 text-sm leading-6 text-muted-foreground">
                <p>
                  Whether the garden will hold <em>your</em> dog. That depends on the dog, and a reassuring
                  sentence here helps nobody standing at a gate.
                </p>
                <p>
                  How many pets, what size, which breeds. Ask us with your dates and we will give you a straight
                  answer for your booking rather than a policy that may not fit it.
                </p>
                <p>
                  Whether a particular market, temple or sanctuary will let your dog in this season. Policies
                  change and we have not verified them. The caretaker knows what is currently true &mdash; ask
                  before you set out.
                </p>
              </div>
            </div>
          </div>

          <p className="mt-8 max-w-[640px] text-xs leading-6 text-muted-foreground">
            Check-in is from 12:00 PM and check-out by 11:00 AM. A valid photo ID is required for every adult
            staying &mdash; a legal requirement for homestays, not a formality.
          </p>
        </section>

        {/* ------------------------------------------------------- food */}
        <section className="border-y border-border bg-card py-20 md:py-24" aria-labelledby="food-title">
          <div className="section-shell grid gap-12 lg:grid-cols-[1.1fr_.9fr] lg:gap-20">
            <div>
              <p className="eyebrow mb-5 text-accent">Eating in</p>
              <h2 id="food-title" className="font-journal text-4xl leading-[.96] text-primary md:text-5xl">
                You do not have to leave them<br /><em>to get dinner.</em>
              </h2>
              <p className="mt-7 max-w-[520px] text-[15px] leading-7 text-muted-foreground">
                The most tiring part of travelling with a dog is usually mealtimes &mdash; the choice between
                leaving them alone in a strange room or eating something forgettable nearby. Here there are
                several ways round it.
              </p>
              <div className="mt-8 space-y-4 text-sm leading-6 text-muted-foreground">
                <p><strong className="text-primary">Cafe Soi is on the premises.</strong> You are not going anywhere to eat.</p>
                <p><strong className="text-primary">The villa has a kitchen for simple meals</strong> &mdash; refrigerator, microwave, water filter and basic utensils.</p>
                <p><strong className="text-primary">Home-cooked meals can be arranged</strong> with the designated caretaker. Talk to them about it when you arrive, or mention it in your enquiry.</p>
                <p><strong className="text-primary">Zomato delivers to the area</strong>, subject to the usual delivery conditions.</p>
              </div>
            </div>
            <div className="overflow-hidden rounded-[1.4rem] border border-border bg-background">
              <img
                src={asset('villa-day.jpg')}
                alt="Raj Kuthir Homestays, Sobuj Potro, seen from the garden in daylight"
                width={1536}
                height={1024}
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover"
              />
            </div>
          </div>
        </section>

        {/* --------------------------------------------------- location */}
        <section className="section-shell py-20 md:py-24" aria-labelledby="where-title">
          <div className="flex flex-col justify-between gap-8 md:flex-row md:items-end">
            <div>
              <p className="eyebrow mb-5 text-accent">Where it is</p>
              <h2 id="where-title" className="font-journal text-4xl leading-[.96] text-primary md:text-6xl">
                Bolpur,<br /><em>and the quiet side of it.</em>
              </h2>
            </div>
            <p className="max-w-[340px] text-sm leading-6 text-muted-foreground">
              Distances are by road from the villa and rounded to the nearest useful number.
            </p>
          </div>

          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { icon: Train, title: 'Prantik station', distance: '~5 km', note: 'The closer halt, and the quieter one' },
              { icon: Train, title: 'Bolpur Shantiniketan', distance: '~9 km', note: 'Where the fast trains stop' },
              { icon: Leaf, title: 'Sonajhuri Khoai Haat', distance: '~4 km', note: 'Open-air forest market, weekend afternoons' },
              { icon: Leaf, title: 'Kopai River', distance: '~4 km', note: "The 'Amader chhoto nodi' of the poem" },
            ].map(({ icon: Icon, title, distance, note }) => (
              <div key={title} className="rounded-[1.4rem] border border-border bg-card p-6">
                <Icon size={19} className="text-accent" strokeWidth={1.5} />
                <p className="mt-5 font-journal text-xl leading-tight text-primary">{title}</p>
                <p className="mt-1 font-mono-ui text-[11px] text-accent">{distance}</p>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{note}</p>
              </div>
            ))}
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href={CONFIG.mapsUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-border px-6 py-4 text-xs font-bold uppercase tracking-[.12em] text-primary transition-colors hover:border-primary"
              data-testid="link-pet-maps"
            >
              <MapPin size={15} /> Open in Google Maps
            </a>
            <a
              href={`${basePath}/#experience`}
              className="inline-flex items-center gap-2 rounded-full border border-border px-6 py-4 text-xs font-bold uppercase tracking-[.12em] text-primary transition-colors hover:border-primary"
              data-testid="link-pet-neighbourhood"
            >
              The whole neighbourhood <ArrowRight size={15} />
            </a>
          </div>
        </section>

        {/* -------------------------------------------------------- FAQ */}
        <section className="border-t border-border bg-card py-20 md:py-24" aria-labelledby="pet-faq-title" id={FAQ_ANCHOR}>
          <div className="section-shell grid gap-12 lg:grid-cols-[.7fr_1.3fr] lg:gap-20">
            <div>
              <p className="eyebrow mb-5 text-accent">Before you enquire</p>
              <h2 id="pet-faq-title" className="font-journal text-4xl leading-[.94] text-primary md:text-6xl">
                The questions<br /><em>we actually get.</em>
              </h2>
            </div>
            <div>
              {PET_FAQ.map(({ q, a }) => (
                <div key={q} className="border-t border-border py-6 first:border-t-0 first:pt-0">
                  <p className="font-journal text-xl text-primary md:text-2xl">{q}</p>
                  <p className="mt-3 max-w-[620px] text-sm leading-6 text-muted-foreground">{a}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* --------------------------------------------------- final CTA */}
        <section className="section-shell py-20 md:py-24" aria-labelledby="pet-cta-title">
          <div className="grid gap-10 rounded-[1.6rem] border border-border bg-background px-8 py-12 lg:grid-cols-[1.1fr_.9fr] lg:gap-20 lg:px-14">
            <div>
              <h2 id="pet-cta-title" className="font-journal text-4xl leading-[.96] text-primary md:text-5xl">
                Tell us about your dog.
              </h2>
              <p className="mt-6 max-w-[500px] text-[15px] leading-7 text-muted-foreground">
                Send your dates and a sentence about who is travelling with you. We will come back with what is
                available and the current rate for those nights &mdash; and an honest answer about whether this is
                the right house for your pet.
              </p>
              <div className="mt-9 flex flex-wrap gap-3">
                <a
                  href={`${basePath}/#booking`}
                  className="flex items-center gap-2 rounded-full bg-primary px-6 py-4 text-xs font-bold uppercase tracking-[.12em] text-primary-foreground transition-transform hover:-translate-y-0.5"
                  data-testid="link-pet-cta-enquire"
                >
                  <CalendarDays size={15} /> Check availability &amp; current rate
                </a>
                <a
                  href={`https://wa.me/916290399165?text=${encodeURIComponent(
                    'Hello Raj Kuthir, I would like to enquire about a stay at Sobuj Potro. I am travelling with a pet.',
                  )}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 rounded-full border border-primary/25 px-6 py-4 text-xs font-bold uppercase tracking-[.12em] text-primary transition-colors hover:bg-primary/5"
                  data-testid="link-pet-cta-whatsapp"
                >
                  <MessageCircle size={15} /> Enquire on WhatsApp
                </a>
              </div>
            </div>
            <div className="flex flex-col justify-center gap-4 border-t border-border pt-8 lg:border-l lg:border-t-0 lg:pl-14 lg:pt-0">
              <a href={phoneHref(CONFIG.hostPhone)} className="flex items-center gap-3 text-sm text-primary hover:text-accent" data-testid="link-pet-call-host">
                <Phone size={16} className="text-accent" /> Host &middot; {CONFIG.hostPhone}
              </a>
              <a href={phoneHref(CONFIG.caretakerPhone)} className="flex items-center gap-3 text-sm text-primary hover:text-accent" data-testid="link-pet-call-caretaker">
                <Phone size={16} className="text-accent" /> Caretaker &middot; {CONFIG.caretakerPhone}
              </a>
              <a href={`${basePath}/house-rules`} className="flex items-center gap-3 text-sm text-primary hover:text-accent" data-testid="link-pet-house-rules-cta">
                <PawPrint size={16} className="text-accent" /> Read the full house rules
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
            <a href={`${basePath}/house-rules`} className="hover:text-[#e4c9a4]">House rules</a>
            <a href={`${basePath}/#booking`} className="hover:text-[#e4c9a4]">Check availability</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
