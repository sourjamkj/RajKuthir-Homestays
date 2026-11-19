import { asset, basePath } from "@/lib/site";
import { formatRupees, type RatePlan } from "@/lib/rates";

/**
 * Release 4: the homepage sections from the "Stay till the lights come on"
 * preview, in the site's own type and colours. Facts only from the owner:
 * kitchen to use, caretaker on site, Cafe Soi in the complex, Sonajhuri Haat 3 km.
 */

const ROOMS = [
  { src: asset("living-room.jpg"), w: 1536, h: 864, pos: "30% 50%", label: "The living room", title: "Room for everyone.", body: "A living room and dining space for the whole group, all under one roof that is yours for the stay.", alt: "The living room at Sobuj Potro with framed art, a dining table and the staircase" },
  { src: asset("bedroom-crop.jpg"), w: 896, h: 520, pos: "50% 50%", label: "The bedrooms", title: "Two of them, both cool.", body: "Two air-conditioned bedrooms, so the grown-ups and the kids each get a door to close.", alt: "An air-conditioned bedroom at Sobuj Potro with a lattice window and bedside lamp" },
  { src: asset("dining-crop.jpg"), w: 1024, h: 776, pos: "50% 50%", label: "Kitchen and dining", title: "Cook if you like.", body: "A kitchen you are welcome to use, and a table to eat at together. Or walk over to Cafe Soi inside the complex.", alt: "The dining space at Sobuj Potro with a glass table and four chairs" },
  { src: asset("stairwell.jpg"), w: 864, h: 1536, pos: "50% 35%", label: "Outside and around", title: "Garden, lawn, parking.", body: "All on the premises, with a caretaker on site. Visva-Bharati is close, and Sonajhuri Haat is 3 km away.", alt: "The stairwell at Sobuj Potro with framed art and fairy lights" },
];

/** "The whole villa. Just your people." — room cards that stack as you scroll (desktop), then one line on privacy. */
export function VillaStack() {
  return (
    <section id="the-house" className="scroll-mt-24 py-24 md:py-32" aria-labelledby="house-title">
      <div className="section-shell">
        <p className="font-mono-ui text-xs font-medium uppercase tracking-[.2em] text-muted-foreground">The house</p>
        <h2 id="house-title" className="mt-4 font-journal text-5xl leading-[.95] text-primary md:text-7xl">
          The whole villa. <em className="text-accent">Just your people.</em>
        </h2>
      </div>
      <div className="section-shell mt-12 grid gap-6 md:mt-16 md:block">
        {ROOMS.map((room, i) => (
          <article
            key={room.label}
            className="villa-card grid overflow-hidden rounded-[2rem] border border-border bg-card shadow-sm md:mb-[18vh] md:h-[min(520px,68vh)] md:grid-cols-[1.4fr_1fr] md:last:mb-0"
            style={{ ["--i" as string]: i }}
          >
            <img src={room.src} alt={room.alt} width={room.w} height={room.h} loading="lazy" decoding="async" className="aspect-[4/3] h-full w-full object-cover md:aspect-auto" style={{ objectPosition: room.pos }} />
            <div className="flex flex-col justify-end gap-3 p-7 md:p-10">
              <span className="font-mono-ui text-[11px] font-medium uppercase tracking-[.18em] text-muted-foreground">{room.label}</span>
              <h3 className="font-journal text-3xl leading-tight text-primary md:text-4xl">{room.title}</h3>
              <p className="max-w-[34ch] text-[15px] leading-7 text-primary/75">{room.body}</p>
            </div>
          </article>
        ))}
      </div>
      <p className="section-shell mt-20 max-w-[30ch] font-journal text-[clamp(1.8rem,4.2vw,3.4rem)] leading-[1.1] text-primary md:mt-28 md:max-w-[26ch]">
        The whole house is yours. No front desk, no shared corridors, no strangers at breakfast.{" "}
        <span className="text-primary/55">Enquiries go straight to the owner, and a caretaker is on site when you need one.</span>
      </p>
    </section>
  );
}

/** Full-bleed terrace at dusk. */
export function Evenings() {
  return (
    <section id="evenings" className="on-dark relative isolate flex min-h-[78svh] items-end overflow-hidden" aria-labelledby="evenings-title">
      <img src={asset("terrace-evening.jpg")} alt="The terrace lawn at dusk with string lights, a swing chair and a garden table" width={1536} height={864} loading="lazy" decoding="async" className="absolute inset-0 -z-10 h-full w-full object-cover object-[50%_55%]" />
      <div className="absolute inset-0 -z-10 bg-gradient-to-t from-night/90 via-night/30 to-transparent" aria-hidden="true" />
      <div className="section-shell w-full pb-14 md:pb-20">
        <p className="font-mono-ui text-xs font-medium uppercase tracking-[.2em] text-white/70">After sunset</p>
        <h2 id="evenings-title" className="mt-4 max-w-[16ch] font-journal text-5xl leading-[.95] text-white md:text-7xl">
          String lights, a swing chair <em className="text-secondary">and the lawn to yourselves.</em>
        </h2>
        <p className="mt-6 max-w-[42ch] text-[15px] leading-7 text-white/80 md:text-[17px]">Cafe Soi is inside the complex for the nights nobody wants to cook.</p>
      </div>
    </section>
  );
}

const FESTIVALS = [
  { href: "/poush-mela-stay-shantiniketan", name: "Poush Mela", body: "Winter in Santiniketan, with the mela a short drive away and the villa to come home to." },
  { href: "/basanta-utsav-stay-shantiniketan", name: "Basanta Utsav", body: "Spring colours in Santiniketan, then a quiet garden to wash up and rest." },
];

/** Festival cards, then the closing price line built from the live rate ladder. */
export function FestivalsAndClose({ plan }: { plan?: RatePlan }) {
  const from = plan ? Math.min(...Object.values(plan.rates)) : null;
  return (
    <section className="border-t border-border py-24 md:py-32" aria-labelledby="festivals-title">
      <div className="section-shell">
        <p className="font-mono-ui text-xs font-medium uppercase tracking-[.2em] text-muted-foreground">Festivals</p>
        <h2 id="festivals-title" className="mt-4 font-journal text-5xl leading-[.95] text-primary md:text-6xl">
          Poush Mela and Basanta Utsav <em className="text-accent">fill first.</em>
        </h2>
        <div className="mt-12 grid gap-5 md:grid-cols-2">
          {FESTIVALS.map((f) => (
            <a key={f.name} href={`${basePath}${f.href}`} className="group rounded-[1.75rem] border border-border bg-card p-7 transition-all hover:-translate-y-1 hover:border-primary/40 hover:shadow-md md:p-9">
              <h3 className="font-journal text-3xl text-primary">{f.name}</h3>
              <p className="mt-3 max-w-[40ch] text-[15px] leading-7 text-primary/75">{f.body}</p>
              <span className="mt-6 inline-block font-mono-ui text-[11px] font-medium uppercase tracking-[.18em] text-muted-foreground group-hover:text-primary">Peak dates · 2-night minimum ↗</span>
            </a>
          ))}
        </div>

        <div className="mt-24 text-center md:mt-32">
          {from !== null && (
            <p className="font-journal text-[clamp(2.6rem,7vw,6.5rem)] leading-none text-primary">
              From <em className="text-accent">{formatRupees(from)}</em> a night
            </p>
          )}
          <p className="mx-auto mt-6 max-w-[46ch] text-[15px] leading-7 text-muted-foreground">
            For one or two guests. Check-in from 12 PM, check-out by 11 AM. Enquiries go straight to the owner.
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-4">
            <a href="#availability" className="rounded-full bg-primary px-6 py-4 text-sm font-semibold text-primary-foreground transition-all hover:-translate-y-1 hover:shadow-xl" data-testid="button-close-book">Check your dates</a>
          </div>
          <p className="mt-8 font-mono-ui text-[11px] font-medium uppercase tracking-[.18em] text-muted-foreground">Close to Visva-Bharati · Sonajhuri Haat 3 km</p>
        </div>
      </div>
    </section>
  );
}
