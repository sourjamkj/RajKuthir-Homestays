import { useEffect } from 'react';
import { BackIcon, MapPinIcon, PhoneIcon, WhatsappIcon } from '@/components/icons';

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

const UPDATED = '1 November 2026';

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
        `Raj Kuthir Homestays – Sobuj Potro is a private homestay at ${ADDRESS}, owned and run by Sourja Mukherjee. "We" and "us" on this site mean the homestay; "you" means the guest making the booking.`,
      ],
    },
    {
      title: 'Your booking',
      lines: [
        'Prices are shown in Indian rupees on the Rates page and in the booking form before you pay. The price you are quoted when you book is the price you pay.',
        `A booking is confirmed once the advance (${advance} of the stay) has been received. The balance is paid at check-in. Peak dates marked on the Rates page are paid in full at booking.`,
        'When you pay online, the payment is processed by Cashfree Payments, a payment gateway regulated by the Reserve Bank of India. We never see or store your card details or UPI PIN.',
        'Paying online by UPI is free. Paying online by card or net banking may carry a convenience fee, a percentage of the advance that covers the bank charges; when it applies, it is shown before you pay, and you can always choose UPI instead. The convenience fee is not refundable.',
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
      title: 'Complaints',
      lines: [
        `Grievance officer: Sourja Mukherjee, Owner. Phone or WhatsApp ${CONFIG.hostPhone}. We acknowledge every complaint within 48 hours and resolve it within one month.`,
      ],
    },
    {
      title: 'Law',
      lines: ['These terms are governed by the laws of India. Subject to your rights under the Consumer Protection Act, 2019 (including your right to approach the consumer commission where you live), any dispute is subject to the courts of Birbhum district, West Bengal.'],
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
        '15 days or more before check-in: the advance is refunded in full, less ₹200 for payment processing.',
        '7 to 14 days before check-in: 50% of the advance is refunded. Or, if you prefer, the full advance is kept as credit for a stay within 6 months.',
        'Less than 7 days before check-in, or not arriving: the advance is not refunded.',
        'If we manage to rebook the nights you cancelled, we refund what we recover, less ₹200.',
      ],
    },
    {
      title: 'Peak dates',
      lines: [
        'Poush Mela, Christmas and New Year, Basanta Utsav and the other peak dates marked on the Rates page are paid in full at booking, as these nights cannot be resold at short notice.',
        '30 days or more before check-in: 90% of what you paid is refunded.',
        'Less than 30 days before check-in: no refund. If we manage to rebook the nights, we refund what we recover, less ₹200.',
      ],
    },
    {
      title: 'Changing your dates',
      lines: [
        'You can move your booking once, free of charge, if you ask 7 days or more before check-in (15 days or more for peak dates) and the new dates are available. Any difference in price is settled at check-in.',
        'A second change counts as a cancellation.',
      ],
    },
    {
      title: 'If we have to cancel',
      lines: [
        'If we cancel your booking for any reason within our control, you get a full refund of everything you paid us, including any convenience fee, and we also pay you the same amount you would have been charged had you cancelled on that day. Or, if you prefer, new dates.',
        'If we cannot host you because of floods, a strike, a government order or a similar event outside our control, you get a full refund of everything you paid us, or new dates if you prefer.',
        'If a government order (for example a lockdown or a travel ban) makes your stay impossible, you choose: a full refund, or credit for new dates within 12 months.',
        'If floods or a strike stop you from travelling, you get credit for new dates within 12 months, even when the cancellation would otherwise not be refunded.',
      ],
    },
    {
      title: 'How refunds are paid',
      lines: [
        'Refunds go back to the original payment method. Online payments (UPI, card or net banking through Cashfree) are refunded through Cashfree and usually reach you within 5 to 7 working days, depending on your bank.',
        'Any convenience fee paid on a card or net banking payment is not refundable; the refund is worked out on the advance only.',
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
        <a href={`${basePath}/`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent" data-testid="link-policy-home">
          <BackIcon /> Raj Kuthir Homestays – Sobuj Potro
        </a>
        <h1 className="mt-4 font-journal text-4xl leading-tight text-primary sm:text-5xl">{title}</h1>
        {kind !== 'contact' && <p className="mt-2 text-xs text-muted-foreground">Last updated {UPDATED}</p>}

        <nav className="mt-6 flex flex-wrap gap-2" aria-label="Policies">
          {LINKS.map((link) => (
            <a
              key={link.kind}
              href={`${basePath}${link.href}`}
              aria-current={link.kind === kind ? 'page' : undefined}
              className={`rounded-full border px-3 py-1.5 text-[13px] font-medium ${link.kind === kind ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-primary hover:bg-primary/5'}`}
            >
              {TITLES[link.kind]}
            </a>
          ))}
        </nav>

        {kind === 'contact' ? (
          <section className="mt-8 space-y-4 rounded-2xl border border-border bg-card p-6 text-sm text-primary" data-testid="section-contact">
            <p>We are a small, owner-run homestay. The quickest way to reach us is WhatsApp or a call.</p>
            <p className="flex items-start gap-2"><PhoneIcon className="mt-0.5 shrink-0 text-accent" /> <span>Host: <a href={phoneHref(CONFIG.hostPhone)} className="underline">{CONFIG.hostPhone}</a> (9 AM – 9 PM)</span></p>
            <p className="flex items-start gap-2"><WhatsappIcon className="mt-0.5 shrink-0 text-accent" /> <span>WhatsApp: <a href={whatsappHref(CONFIG.hostPhone)} target="_blank" rel="noreferrer" className="underline">{CONFIG.hostPhone}</a></span></p>
            <p className="flex items-start gap-2"><PhoneIcon className="mt-0.5 shrink-0 text-accent" /> <span>Caretaker at the house: <a href={phoneHref(CONFIG.caretakerPhone)} className="underline">{CONFIG.caretakerPhone}</a></span></p>
            <p className="flex items-start gap-2"><MapPinIcon className="mt-0.5 shrink-0 text-accent" /> <span>{ADDRESS} · <a href={CONFIG.mapsUrl} target="_blank" rel="noreferrer" className="underline">Open in Google Maps</a></span></p>
            <p>Booking questions, cancellations and refunds: message us with your booking reference and we reply the same day.</p>
            <p className="border-t border-border pt-4" data-testid="text-grievance-officer">Grievance officer: Sourja Mukherjee, Owner · <a href={phoneHref(CONFIG.hostPhone)} className="underline">{CONFIG.hostPhone}</a>. Complaints are acknowledged within 48 hours and resolved within one month.</p>
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
