import { useEffect } from 'react';
import {
  ArrowLeft,
  CalendarClock,
  Download,
  Flame,
  Leaf,
  MessageCircle,
  PawPrint,
  Phone,
  Music,
  Users,
} from 'lucide-react';

import { CONFIG, asset, basePath, phoneHref } from '@/lib/site';

/**
 * The house rules, published before a guest books rather than discovered on a
 * wall after they arrive.
 *
 * Two reasons this page exists in the site's own voice instead of as a link to
 * the printed poster:
 *
 *  - Rules a guest could read before booking are far easier to stand behind in
 *    an OTA dispute than rules first seen at check-in.
 *  - The printed poster is written for someone already standing in the house.
 *    The same content in red penalty boxes, on a page whose job is to persuade
 *    somebody to come, reads as a warning notice. Same substance, calmer voice.
 *
 * The PDF is still linked at the bottom for anyone who wants the printed sheet.
 */

const HOUSE_RULES_PDF = 'raj-kuthir-house-rules.pdf';

const sections = [
  {
    icon: CalendarClock,
    title: 'Arriving and leaving',
    lines: [
      'Check-in from 12:00 PM, check-out by 11:00 AM.',
      'A valid photo ID is required for every adult staying — this is a legal requirement for homestays, not a formality.',
      'Need to arrive early or leave late? Just ask beforehand and we will accommodate it where we can.',
    ],
  },
  {
    icon: Users,
    title: 'Who is staying',
    lines: [
      'The number of guests should match what you booked, so the caretaker can prepare the house properly.',
      'Bringing someone extra is usually fine — please clear it with us first rather than at the door.',
    ],
  },
  {
    icon: PawPrint,
    title: 'Your pets',
    lines: [
      'Pets are genuinely welcome here, not tolerated. Tell us who is coming so we can get the house ready.',
      'We only ask that they stay off the furniture and linen, and that you clean up after them — the same things you would do at home.',
    ],
  },
  {
    icon: Flame,
    title: 'Smoking',
    lines: [
      'Smoking is allowed. Ashtrays are provided in the patio and garden.',
      'Please use them rather than the floor, furniture, railings or the grass mat — burn marks are the one thing that does not come out.',
    ],
  },
  {
    icon: Music,
    title: 'Music and celebrations',
    lines: [
      'Celebrate. The speakers, the lights and the garden are yours for the stay.',
      'Please bring the volume down after 10 PM. The bungalows here sit close together and sound carries further at night than it feels like it does.',
    ],
  },
  {
    icon: Leaf,
    title: 'Leaving it as you found it',
    lines: [
      'Switch off fans, lights, AC and the all-outs when you head out for the day.',
      'Leave the patio, kitchen and common areas reasonably tidy. Nobody expects spotless — just not a clean-up job.',
    ],
  },
];

/**
 * The printed poster's penalty grid, kept complete and unrounded. It reads as a
 * warning on the wall; here it is framed as what it actually is — the cost of
 * repair or replacement, published so nobody is surprised by a deduction.
 */
const charges = [
  { item: 'Extra guest without prior approval', amount: '₹1,000 per person, per night' },
  { item: 'Late check-out without prior approval', amount: '₹500 per hour' },
  { item: 'Cigarette burns — floor, furniture, railings, grass mat', amount: '₹500 – ₹2,000' },
  { item: 'Damage during a celebration', amount: 'Repair cost, minimum ₹1,000' },
  { item: 'Pet damage or soiling', amount: 'From ₹1,000' },
  { item: 'Hammock or swing, misused or overloaded', amount: '₹1,500 – ₹3,000' },
  { item: 'Patio grass mat — tears, stains, burns', amount: '₹1,000 – ₹2,000' },
  { item: 'Decorative lights pulled down or relocated', amount: '₹500 – ₹1,500' },
  { item: 'Sofa and upholstery — stains or damage', amount: '₹1,000 – ₹3,000' },
  { item: 'TV or remotes — loss or damage', amount: '₹500 – ₹5,000' },
  { item: 'All-outs, wiring and sockets', amount: 'From ₹500' },
  { item: 'Bathroom fixtures or blockage', amount: '₹1,000 – ₹3,000' },
  { item: 'Excess mess left behind', amount: '₹500' },
  { item: 'Lost key or access card', amount: '₹500 each' },
];

export default function HouseRules() {
  useEffect(() => {
    const previous = document.title;
    document.title = 'House rules | Raj Kuthir Homestays';
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-foreground/10 bg-background/90 backdrop-blur-md">
        <div className="section-shell flex h-[74px] items-center justify-between gap-6">
          <a href={`${basePath}/`} className="flex shrink-0 items-center gap-3" data-testid="link-house-rules-brand">
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
            data-testid="link-house-rules-back"
          >
            <ArrowLeft size={15} /> Back to the stay
          </a>
        </div>
      </header>

      <main>
        <section className="section-shell pb-16 pt-16 md:pb-20 md:pt-24">
          <p className="eyebrow mb-6 text-accent">Before you book</p>
          <h1 className="max-w-[760px] font-journal text-[clamp(2.9rem,7vw,5.5rem)] leading-[.92] tracking-[-.03em] text-primary">
            House rules,<br /><em className="text-accent">plainly put.</em>
          </h1>
          <p className="mt-8 max-w-[600px] text-[15px] leading-7 text-muted-foreground md:text-[17px]">
            Raj Kuthir is a home, not a hotel — which is what makes it good, and also why a few things are worth
            saying out loud before you arrive. None of this is meant to sound stern. Read it once and you will
            know exactly where you stand.
          </p>

          <div className="mt-10 max-w-[680px] rounded-[1.4rem] border-l-4 border-accent bg-card px-7 py-6">
            <p className="text-[15px] leading-7 text-primary">
              We keep things <strong>relaxed and welcoming</strong> — smoke, celebrate, bring your pets. In
              return we only ask that you treat the house and its things with care.
            </p>
          </div>
        </section>

        <section className="section-shell pb-20">
          <div className="grid gap-4 md:grid-cols-2 md:gap-5">
            {sections.map(({ icon: Icon, title, lines }) => (
              <div
                key={title}
                className="rounded-[1.4rem] border border-border bg-card p-7"
                data-testid={`rule-${title.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '')}`}
              >
                <Icon size={23} className="text-accent" strokeWidth={1.4} />
                <p className="mt-6 font-journal text-3xl text-primary">{title}</p>
                <div className="mt-4 space-y-3">
                  {lines.map((line) => (
                    <p key={line} className="text-sm leading-6 text-muted-foreground">{line}</p>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-primary py-20 text-primary-foreground md:py-24" aria-labelledby="neighbours-title">
          <div className="section-shell grid gap-10 lg:grid-cols-[.8fr_1.2fr] lg:gap-20">
            <div>
              <p className="eyebrow mb-5 text-secondary">The one firm rule</p>
              <h2 id="neighbours-title" className="font-journal text-4xl leading-[.96] md:text-6xl">
                Our<br /><em>neighbours.</em>
              </h2>
            </div>
            <div className="max-w-[620px]">
              <p className="text-lg leading-8 md:text-xl md:leading-9">
                Raj Kuthir sits among other private bungalows whose owners live here. Everything else on this page
                has room for a conversation. This one does not.
              </p>
              <p className="mt-6 text-sm leading-7 text-primary-foreground/70">
                A complaint from a neighbouring owner can end a stay — a penalty, immediate eviction, or both,
                without a refund. It has never had to happen, and keeping the noise down after 10 PM is very nearly
                the whole of it.
              </p>
            </div>
          </div>
        </section>

        <section className="section-shell py-20 md:py-24" aria-labelledby="charges-title">
          <div className="flex flex-col justify-between gap-8 md:flex-row md:items-end">
            <div>
              <p className="eyebrow mb-5 text-accent">No surprises</p>
              <h2 id="charges-title" className="font-journal text-4xl leading-[.96] text-primary md:text-6xl">
                If something<br /><em>gets damaged.</em>
              </h2>
            </div>
            <p className="max-w-[330px] text-sm leading-6 text-muted-foreground">
              The house is checked before check-out. These are the repair and replacement costs — published so a
              deduction is never a shock, not because we expect to use them.
            </p>
          </div>

          {/* The table scrolls inside its own box on a phone rather than pushing
              the page sideways. */}
          <div className="mt-12 overflow-x-auto rounded-[1.4rem] border border-border bg-card">
            <table className="w-full min-w-[520px] border-collapse text-left">
              <caption className="sr-only">Repair and replacement charges at Raj Kuthir Homestays</caption>
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className="px-7 py-5 font-mono-ui text-[10px] uppercase tracking-[.14em] text-muted-foreground">What</th>
                  <th scope="col" className="px-7 py-5 text-right font-mono-ui text-[10px] uppercase tracking-[.14em] text-muted-foreground">Charge</th>
                </tr>
              </thead>
              <tbody>
                {charges.map(({ item, amount }) => (
                  <tr key={item} className="border-b border-border last:border-b-0">
                    <td className="px-7 py-5 text-sm leading-6 text-primary">{item}</td>
                    <td className="whitespace-nowrap px-7 py-5 text-right text-sm font-bold text-accent">{amount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-6 max-w-[640px] text-xs leading-6 text-muted-foreground">
            Ranges reflect the difference between something that can be cleaned or repaired and something that has
            to be replaced. Where a repair costs less than the figure shown, we charge the repair.
          </p>
        </section>

        <section className="border-t border-border bg-card py-20 md:py-24">
          <div className="section-shell grid gap-10 lg:grid-cols-[1.1fr_.9fr] lg:gap-20">
            <div>
              <h2 className="font-journal text-4xl leading-[.96] text-primary md:text-5xl">
                Questions about any of this?
              </h2>
              <p className="mt-6 max-w-[500px] text-[15px] leading-7 text-muted-foreground">
                Ask before you book rather than wonder. Staying with us means these rules apply, so it is worth a
                two-minute call if anything here would be awkward for your group.
              </p>
              <div className="mt-9 flex flex-wrap gap-3">
                <a
                  href={phoneHref(CONFIG.hostPhone)}
                  className="flex items-center gap-2 rounded-full bg-primary px-6 py-4 text-xs font-bold uppercase tracking-[.12em] text-primary-foreground transition-transform hover:-translate-y-0.5"
                  data-testid="link-house-rules-call"
                >
                  <Phone size={15} /> Call the host
                </a>
                <a
                  href={`${basePath}/#booking`}
                  className="flex items-center gap-2 rounded-full border border-border px-6 py-4 text-xs font-bold uppercase tracking-[.12em] text-primary transition-colors hover:border-primary"
                  data-testid="link-house-rules-enquire"
                >
                  <MessageCircle size={15} /> Send an enquiry
                </a>
              </div>
            </div>

            <div className="rounded-[1.4rem] border border-border bg-background p-8">
              <p className="eyebrow text-accent">For the fridge door</p>
              <p className="mt-4 font-journal text-3xl leading-tight text-primary">The printed sheet.</p>
              <p className="mt-4 text-sm leading-6 text-muted-foreground">
                The same rules as a one-page PDF — the copy that hangs in the house.
              </p>
              <a
                href={asset(HOUSE_RULES_PDF)}
                download
                className="mt-7 inline-flex items-center gap-2 rounded-full bg-secondary px-6 py-4 text-xs font-bold uppercase tracking-[.12em] text-primary transition-transform hover:-translate-y-0.5"
                data-testid="link-house-rules-pdf"
              >
                <Download size={15} /> Download the PDF
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-[#172d25] py-14 text-[#f5eadb]">
        <div className="section-shell flex flex-col justify-between gap-6 sm:flex-row sm:items-center">
          <div>
            <p className="font-journal text-2xl">Raj Kuthir Homestays</p>
            <p className="mt-2 text-sm text-[#f5eadb]/60">
              By staying with us, you agree to these house rules. Thank you for caring for our home.
            </p>
          </div>
          <div className="flex flex-col gap-2 text-sm text-[#f5eadb]/70 sm:text-right">
            <a href={phoneHref(CONFIG.hostPhone)} className="hover:text-[#e4c9a4]">Host · {CONFIG.hostPhone}</a>
            <a href={phoneHref(CONFIG.caretakerPhone)} className="hover:text-[#e4c9a4]">Caretaker · {CONFIG.caretakerPhone}</a>
            <a href={`${basePath}/`} className="hover:text-[#e4c9a4]">Back to the stay</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
