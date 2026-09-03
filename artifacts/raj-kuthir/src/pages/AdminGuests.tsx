import { useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import {
  ArrowUpRight,
  BellOff,
  Inbox,
  Loader2,
  LogOut,
  MessageCircle,
  Phone,
  Trash2,
  Users,
} from 'lucide-react';
import { adminFetch, useAdminSession, useLogout } from '@/lib/admin-api';
import { formatRupees } from '@/lib/ledger-api';

const ENQUIRIES_KEY = ['/api/enquiries'];
const CONTACTS_KEY = ['/api/contacts'];

type EnquiryStatus = 'new' | 'contacted' | 'converted' | 'closed';

type Enquiry = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  checkIn: string | null;
  checkOut: string | null;
  adults: number | null;
  children: number | null;
  pets: number | null;
  requests: string | null;
  status: EnquiryStatus;
  createdAt: string;
};

type Contact = {
  phone: string;
  name: string | null;
  email: string | null;
  stays: number;
  enquiryCount: number;
  lastStay: string | null;
  lastEnquiry: string | null;
  totalSpentPaise: number;
  marketingOptOut: boolean;
  note: string | null;
  tags: string | null;
};

const STATUS_STYLE: Record<EnquiryStatus, string> = {
  new: 'bg-primary/10 text-primary border-primary/30',
  contacted: 'bg-[#d8a24a]/15 text-[#8a6320] border-[#d8a24a]/40',
  converted: 'bg-[#7A8065]/15 text-[#4b5340] border-[#7A8065]/40',
  closed: 'bg-muted text-muted-foreground border-border',
};

const STATUSES: EnquiryStatus[] = ['new', 'contacted', 'converted', 'closed'];

const waLink = (phone: string, name: string | null) =>
  `https://wa.me/${phone.replace(/\D/g, '').replace(/^0+/, '')}?text=${encodeURIComponent(
    `Hello ${name ?? ''}, this is Raj Kuthir Homestays – Sobuj Potro.`.replace(
      /\s+/g,
      ' ',
    ),
  )}`;

export default function AdminGuests() {
  const [, navigate] = useLocation();
  const session = useAdminSession();
  const logout = useLogout();
  const queryClient = useQueryClient();
  const signedIn = session.data?.signedIn === true;

  useEffect(() => {
    if (session.isSuccess && !signedIn) {
      navigate('/admin/login', { replace: true });
    }
  }, [session.isSuccess, signedIn, navigate]);

  const enquiries = useQuery({
    queryKey: ENQUIRIES_KEY,
    queryFn: () => adminFetch<{ enquiries: Enquiry[] }>('/api/enquiries'),
    enabled: signedIn,
    retry: false,
  });

  const contacts = useQuery({
    queryKey: CONTACTS_KEY,
    queryFn: () => adminFetch<{ contacts: Contact[] }>('/api/contacts'),
    enabled: signedIn,
    retry: false,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ENQUIRIES_KEY });
    queryClient.invalidateQueries({ queryKey: CONTACTS_KEY });
  };

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: EnquiryStatus }) =>
      adminFetch(`/api/enquiries/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),
    onSuccess: refresh,
  });

  const removeEnquiry = useMutation({
    mutationFn: (id: string) =>
      adminFetch(`/api/enquiries/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });

  const setOptOut = useMutation({
    mutationFn: ({ phone, optOut }: { phone: string; optOut: boolean }) =>
      adminFetch(`/api/contacts/${phone}`, {
        method: 'PATCH',
        body: JSON.stringify({ marketingOptOut: optOut }),
      }),
    onSuccess: refresh,
  });

  if (session.isLoading || (session.isSuccess && !signedIn)) {
    return (
      <div className="grid min-h-[100dvh] place-items-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const rows = enquiries.data?.enquiries ?? [];
  const list = contacts.data?.contacts ?? [];
  const newCount = rows.filter((row) => row.status === 'new').length;
  const reachable = list.filter((c) => !c.marketingOptOut).length;

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-4 px-5 py-5 md:px-8">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[.14em] text-accent">
              Guests
            </p>
            <h1 className="mt-1 font-journal text-2xl text-primary md:text-3xl">
              Enquiries &amp; contacts
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <a
              href="/admin"
              className="flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-[11px] font-bold uppercase tracking-[.09em] text-primary transition-colors hover:border-primary"
            >
              Calendar <ArrowUpRight size={13} />
            </a>
            <button
              type="button"
              onClick={() =>
                logout.mutate(undefined, {
                  onSuccess: () => navigate('/admin/login', { replace: true }),
                })
              }
              className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-[11px] font-bold uppercase tracking-[.09em] text-primary-foreground transition-transform hover:-translate-y-0.5"
            >
              <LogOut size={13} /> Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1180px] px-5 py-8 md:px-8 md:py-10">
        <section aria-label="Enquiries">
          <Heading
            icon={<Inbox size={15} />}
            title={`Enquiries${newCount ? ` · ${newCount} new` : ''}`}
            description="Everyone who filled the form on your site. These used to vanish unless the guest also clicked through to WhatsApp."
          />

          <div className="mt-4 space-y-3">
            {enquiries.isLoading && (
              <p className="text-sm text-muted-foreground">Loading…</p>
            )}

            {!enquiries.isLoading && rows.length === 0 && (
              <div className="rounded-2xl border border-border bg-card p-5">
                <p className="text-sm text-muted-foreground">
                  No enquiries yet. They'll appear here the moment someone uses
                  the form.
                </p>
              </div>
            )}

            {rows.map((row) => (
              <div
                key={row.id}
                className="rounded-2xl border border-border bg-card p-5"
                data-testid={`row-enquiry-${row.id}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-journal text-xl text-primary">
                        {row.name}
                      </p>
                      <span
                        className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[.07em] ${STATUS_STYLE[row.status]}`}
                      >
                        {row.status}
                      </span>
                    </div>

                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {row.checkIn && row.checkOut ? (
                        <>
                          {format(parseISO(row.checkIn), 'd MMM')} →{' '}
                          {format(parseISO(row.checkOut), 'd MMM yyyy')}
                        </>
                      ) : (
                        'No dates given'
                      )}
                      {row.adults !== null && (
                        <>
                          {' · '}
                          {row.adults} adult{row.adults === 1 ? '' : 's'}
                          {row.children ? `, ${row.children} children` : ''}
                          {row.pets ? `, ${row.pets} pets` : ''}
                        </>
                      )}
                      {' · '}
                      received{' '}
                      {format(parseISO(row.createdAt), 'd MMM, h:mm a')}
                    </p>

                    {row.requests && (
                      <p className="mt-2 max-w-[560px] text-sm leading-6 text-foreground">
                        “{row.requests}”
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <a
                      href={`tel:${row.phone}`}
                      className="grid h-9 w-9 place-items-center rounded-full border border-border text-primary transition-colors hover:border-primary"
                      aria-label={`Call ${row.name}`}
                    >
                      <Phone size={14} />
                    </a>
                    <a
                      href={waLink(row.phone, row.name)}
                      target="_blank"
                      rel="noreferrer"
                      className="grid h-9 w-9 place-items-center rounded-full border border-border text-primary transition-colors hover:border-primary"
                      aria-label={`WhatsApp ${row.name}`}
                    >
                      <MessageCircle size={14} />
                    </a>
                    <button
                      type="button"
                      onClick={() => removeEnquiry.mutate(row.id)}
                      className="grid h-9 w-9 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:border-[#A65E45] hover:text-[#A65E45]"
                      aria-label="Delete enquiry"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
                  <span className="text-[10px] font-bold uppercase tracking-[.07em] text-muted-foreground">
                    {row.phone}
                  </span>
                  <span className="ml-auto flex flex-wrap gap-1.5">
                    {STATUSES.map((status) => (
                      <button
                        key={status}
                        type="button"
                        onClick={() => setStatus.mutate({ id: row.id, status })}
                        disabled={row.status === status}
                        className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[.07em] transition-colors ${row.status === status ? 'cursor-default border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:border-primary hover:text-primary'}`}
                        data-testid={`button-enquiry-${status}-${row.id}`}
                      >
                        {status}
                      </button>
                    ))}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-10 pb-6" aria-label="Guest contacts">
          <Heading
            icon={<Users size={15} />}
            title={`Guest list · ${reachable} reachable`}
            description="Built automatically from bookings and enquiries, matched on phone number. Use it for follow-ups and offers."
          />

          <div className="mt-3 flex items-start gap-2 rounded-xl border border-border bg-card p-4">
            <BellOff size={15} className="mt-0.5 shrink-0 text-muted-foreground" />
            <p className="text-xs leading-5 text-muted-foreground">
              Mark anyone who asks as opted out and they'll be excluded from the
              reachable count. Worth honouring properly — unsolicited marketing
              messages are regulated in India, and one complaint is more
              expensive than a hundred sends are worth.
            </p>
          </div>

          <div className="mt-4 overflow-x-auto rounded-2xl border border-border bg-card">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[10px] uppercase tracking-[.08em] text-muted-foreground">
                  <th className="px-5 py-3 font-bold">Guest</th>
                  <th className="px-5 py-3 font-bold">Phone</th>
                  <th className="px-5 py-3 text-right font-bold">Stays</th>
                  <th className="px-5 py-3 text-right font-bold">Spent</th>
                  <th className="px-5 py-3 font-bold">Last seen</th>
                  <th className="px-5 py-3 font-bold">Marketing</th>
                </tr>
              </thead>
              <tbody>
                {contacts.isLoading && (
                  <tr>
                    <td colSpan={6} className="px-5 py-6 text-muted-foreground">
                      Loading…
                    </td>
                  </tr>
                )}

                {!contacts.isLoading && list.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-6 text-muted-foreground">
                      No contacts yet. They build up as bookings and enquiries
                      arrive.
                    </td>
                  </tr>
                )}

                {list.map((contact) => (
                  <tr
                    key={contact.phone}
                    className="border-b border-border last:border-0"
                    data-testid={`row-contact-${contact.phone}`}
                  >
                    <td className="px-5 py-3 font-medium text-foreground">
                      {contact.name ?? '—'}
                    </td>
                    <td className="px-5 py-3 font-mono-ui text-[11px] text-muted-foreground">
                      {contact.phone}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                      {contact.stays}
                      {contact.enquiryCount > 0 && (
                        <span className="ml-1 text-[10px]">
                          (+{contact.enquiryCount} enq)
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-foreground">
                      {formatRupees(contact.totalSpentPaise)}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">
                      {contact.lastStay
                        ? format(parseISO(contact.lastStay), 'd MMM yyyy')
                        : contact.lastEnquiry
                          ? `enq ${format(parseISO(contact.lastEnquiry), 'd MMM')}`
                          : '—'}
                    </td>
                    <td className="px-5 py-3">
                      <button
                        type="button"
                        onClick={() =>
                          setOptOut.mutate({
                            phone: contact.phone,
                            optOut: !contact.marketingOptOut,
                          })
                        }
                        className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[.07em] transition-colors ${contact.marketingOptOut ? 'border-[#A65E45]/40 bg-[#A65E45]/10 text-[#A65E45]' : 'border-border text-muted-foreground hover:border-primary hover:text-primary'}`}
                        data-testid={`button-optout-${contact.phone}`}
                      >
                        {contact.marketingOptOut ? 'Opted out' : 'Reachable'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}

function Heading({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div>
      <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.12em] text-accent">
        {icon}
        {title}
      </p>
      <p className="mt-2 max-w-[600px] text-sm leading-6 text-muted-foreground">
        {description}
      </p>
    </div>
  );
}
