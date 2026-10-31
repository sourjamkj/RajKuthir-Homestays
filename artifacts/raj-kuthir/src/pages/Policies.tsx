import { useEffect } from 'react';
import { ArrowLeft, Mail, MapPin, MessageCircle, Phone } from 'lucide-react';

import { CONFIG, basePath, phoneHref } from '@/lib/site';

/**
 * Terms, privacy, cancellation & refund, and contact: the pages a payment
 * gateway (and a careful guest) looks for before trusting a booking site.
 *
 * One component, four routes, so the four pages share their look and their
 * facts. Every figure here must match what Book & Pay actually does: the
 * advance share comes from CONFIG and the refund route from Cashfree.
 */

export type PolicyKind = 'terms' | 'privacy' | 'cancellation' | 'contact';

const UPDATED = '31 October 2026';

const ADDRESS = 'Sobuj, Dopati 148, Potro Bunglow, Bandh Nabagram, Bolpur, West Bengal 731204, India';

const whatsappHref = (phone: string) => `https://wa.me/${phone.replace(/\D/g, '')}`;

const TITLES: Record<PolicyKind, string> = {
  terms: 'Terms & Conditions',
  privacy: 'Privacy Policy',
  cancellation: 'Cancellation & Refund Policy',
  contact: 'Contact Us',
};

const LINKS: Array<{ kind: PolicyKind; href: string }> = [
  { kind: 'terms', href: '/terms' },
  { kind: 'privacy', href: '/privacy-policy' },
  { kind: 'cancellation', href: '/cancellation-refund-policy' },
  { kind: 'contact', href: '/contact' },
];

type Section = { title: string; lines: string[] };

const advance = `${Math.round(CONFIG.advanceShare * 100)}%`;

const CONTENT: Record<Exclude<PolicyKind, 'contact'>, Section[]> = {
  terms: [
    {
      title: 'Who we are',
      lines: [
        `Raj Kuthir Homestays – Sobuj Potro is a private homestay at ${ADDRESS}, run by its owner. "We" and "us" on this site mean the homestay; "you" means the guest making the booking.`,
      ],
    },
    {
      title: 'Your booking',
      lines: [
        'Prices are shown in Indian rupees on the Rates page and in the booking form before you pay. The price you are quoted when you book is the price you pay.',
        `A booking is confirmed once the advance (${advance} of the stay) has been received. The balance is paid at check-in.`,
        'When you pay online, the payment is processed by Cashfree Payments, a payment gateway regulated by the Reserve Bank of India. We never see or store your card details or UPI PIN.',
        'Dates are held for a short time while you pay. If the payment is not completed in that time, the dates are released.',
      ],
    },
    {
      title: 'Your stay',
      lines: [
        'Check-in is from 12:00 PM and check-out by 11:00 AM. A valid photo ID is required for every adult, as the law requires of homestays.',
        'The number of guests and pets should match the booking. Extra guests and pets are charged as shown on the Rates page.',
        'Our house rules form part of these terms. Please read them before you book.',
      ],
    },
    {
      title: 'Changes and cancellations',
      lines: ['Cancellations, changes of date and refunds follow our Cancellation & Refund Policy.'],
    },
    {
      title: 'Responsibility',
      lines: [
        'Please take care of the house and its contents. Damage beyond normal wear may be charged at the cost of repair or replacement.',
        'We are not responsible for loss of personal belongings, or for delays and cancellations caused by events outside our control such as severe weather, strikes or government orders. If we cannot host you because of such an event, we refund what you paid us in full or move your dates, as you prefer.',
      ],
    },
    {
      title: 'Law',
      lines: ['These terms are governed by the laws of India. Any dispute is subject to the courts of Birbhum district, West Bengal.'],
    },
  ],
  privacy: [
    {
      title: 'What we collect',
      lines: [
        'When you book or enquire: your name, mobile number, email address (if you give one), the dates and party size, and any requests you write to us.',
        'Before arrival: the guest details and photo ID that homestays are required by law to record, and for foreign nationals the details needed for the Form C registration.',
        'When you pay online, your payment is handled by Cashfree Payments. We receive only the result, the amount and the payment method (for example "UPI"), never your card number, bank login or UPI PIN.',
      ],
    },
    {
      title: 'How we use it',
      lines: [
        'To manage your booking, confirm it, send you pre-arrival information and a receipt, and contact you about your stay by phone, WhatsApp or email.',
        'To keep the guest register and records the law requires of us.',
        'After your stay, we may ask once whether you would leave a review. You can ignore it.',
        'We do not sell or rent your information, and we do not use it for advertising.',
      ],
    },
    {
      title: 'Who else sees it',
      lines: [
        'Only those who need it to deliver your stay: Cashfree Payments for online payments, WhatsApp (Meta) and our email provider for messages, and our hosting and database providers. Each handles it under its own privacy terms.',
        'Government authorities, where the law requires it (for example the guest register or Form C).',
      ],
    },
    {
      title: 'How long we keep it',
      lines: [
        'Booking and payment records are kept for as long as tax and accounting law requires. Identity documents are kept only as long as the law requires for guest registration, then deleted.',
      ],
    },
    {
      title: 'Your choices',
      lines: [
        'You can ask to see, correct or delete the information we hold about you, except what we must keep by law. Contact us using the details below.',
        'This site uses basic analytics to understand which pages are read. It does not collect your name or contact details.',
      ],
    },
  ],
  cancellation: [
    {
      title: 'Cancelling a direct booking',
      lines: [
        '7 days or more before check-in: full refund of the advance.',
        '3 to 6 days before check-in: 50% of the advance is refunded.',
        'Less than 3 days before check-in, or not arriving: the advance is not refunded.',
        'Festival dates (Poush Mela, Basanta Utsav and other peak dates marked on the Rates page): cancellations 15 days or more before check-in get a full refund of the advance; after that the advance is not refunded, as these nights cannot be resold at short notice.',
      ],
    },
    {
      title: 'Changing your dates',
      lines: [
        'You can move your booking once, free of charge, if you ask 7 days or more before check-in and the new dates are available. Any difference in price is settled at check-in.',
      ],
    },
    {
      title: 'If we have to cancel',
      lines: ['If we ever cannot host you, you get a full refund of everything you paid us, or new dates if you prefer.'],
    },
    {
      title: 'How refunds are paid',
      lines: [
        'Refunds go back to the original payment method. Online payments (UPI, card or net banking through Cashfree) are refunded through Cashfree and usually reach you within 5 to 7 working days, depending on your bank.',
        'Payments made directly to our UPI ID are refunded to the same UPI ID or bank account within 5 to 7 working days.',
        'To cancel, message or call us with your booking reference. We confirm the cancellation and the refund amount in writing.',
      ],
    },
    {
      title: 'Bookings made through Booking.com, MakeMyTrip or other sites',
      lines: ['These follow the cancellation policy shown on that site when you booked, and refunds are made by that site.'],
    },
  ],
};

export default function Policies({ kind }: { kind: PolicyKind }) {
  const title = TITLES[kind];

  useEffect(() => {
    const previous = document.title;
    // Must match the title the server sends (api-server/src/lib/seo.ts).
    document.title = kind === 'cancellation' ? `${title} | Raj Kuthir Homestays` : `${title} | Raj Kuthir Homestays, Shantiniketan`;
    window.scrollTo(0, 0);
    return () => {
      document.title = previous;
    };
  }, [title, kind]);

  return (
    <div className="min-h-[100dvh] bg-background px-4 py-10 text-foreground">
      <main className="mx-auto max-w-[720px]">
        <a href={`${basePath}/`} className="inline-flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-[.1em] text-accent" data-testid="link-policy-home">
          <ArrowLeft size={14} /> Raj Kuthir Homestays – Sobuj Potro
        </a>
        <h1 className="mt-4 font-journal text-4xl leading-tight text-primary sm:text-5xl">{title}</h1>
        {kind !== 'contact' && <p className="mt-2 text-xs text-muted-foreground">Last updated {UPDATED}</p>}

        <nav className="mt-6 flex flex-wrap gap-2" aria-label="Policies">
          {LINKS.map((link) => (
            <a
              key={link.kind}
              href={`${basePath}${link.href}`}
              aria-current={link.kind === kind ? 'page' : undefined}
              className={`rounded-full border px-3 py-1.5 text-[11px] font-bold uppercase tracking-[.08em] ${link.kind === kind ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-primary hover:bg-primary/5'}`}
            >
              {TITLES[link.kind]}
            </a>
          ))}
        </nav>

        {kind === 'contact' ? (
          <section className="mt-8 space-y-4 rounded-2xl border border-border bg-card p-6 text-sm text-primary" data-testid="section-contact">
            <p>We are a small, owner-run homestay. The quickest way to reach us is WhatsApp or a call.</p>
            <p className="flex items-start gap-2"><Phone size={16} className="mt-0.5 shrink-0 text-accent" /> <span>Host: <a href={phoneHref(CONFIG.hostPhone)} className="underline">{CONFIG.hostPhone}</a> (9 AM – 9 PM)</span></p>
            <p className="flex items-start gap-2"><MessageCircle size={16} className="mt-0.5 shrink-0 text-accent" /> <span>WhatsApp: <a href={whatsappHref(CONFIG.hostPhone)} target="_blank" rel="noreferrer" className="underline">{CONFIG.hostPhone}</a></span></p>
            <p className="flex items-start gap-2"><Phone size={16} className="mt-0.5 shrink-0 text-accent" /> <span>Caretaker at the house: <a href={phoneHref(CONFIG.caretakerPhone)} className="underline">{CONFIG.caretakerPhone}</a></span></p>
            <p className="flex items-start gap-2"><MapPin size={16} className="mt-0.5 shrink-0 text-accent" /> <span>{ADDRESS} · <a href={CONFIG.mapsUrl} target="_blank" rel="noreferrer" className="underline">Open in Google Maps</a></span></p>
            <p className="flex items-start gap-2"><Mail size={16} className="mt-0.5 shrink-0 text-accent" /> <span>Booking questions, cancellations and refunds: message us with your booking reference and we reply the same day.</span></p>
          </section>
        ) : (
          <div className="mt-8 space-y-8">
            {CONTENT[kind].map((section) => (
              <section key={section.title}>
                <h2 className="font-journal text-2xl text-primary">{section.title}</h2>
                <ul className="mt-3 space-y-2 text-sm leading-7 text-primary/85">
                  {section.lines.map((line) => (
                    <li key={line} className="flex gap-2"><span className="mt-[11px] h-1 w-1 shrink-0 rounded-full bg-accent" aria-hidden="true" />{line}</li>
                  ))}
                </ul>
              </section>
            ))}
            <p className="border-t border-border pt-6 text-sm text-primary/85">
              Questions? Call or WhatsApp <a href={phoneHref(CONFIG.hostPhone)} className="underline">{CONFIG.hostPhone}</a>, or see <a href={`${basePath}/contact`} className="underline">Contact Us</a>.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
