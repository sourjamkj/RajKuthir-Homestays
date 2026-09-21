import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import { format, parseISO } from 'date-fns';
import {
  CalendarDays,
  Loader2,
  Plus,
  Receipt,
  Trash2,
  TriangleAlert,
  Wallet,
} from 'lucide-react';
import { useAdminSession } from '@/lib/admin-api';
import { BookingImport } from '@/components/BookingImport';
import {
  formatMonth,
  formatRupees,
  useBookings,
  useCreateExpense,
  useDeleteBooking,
  useDeleteExpense,
  useExpenses,
  useLedgerSummary,
  CATEGORY_LABELS,
  SOURCE_LABELS,
  type BookingSource,
  type ExpenseCategory,
} from '@/lib/ledger-api';
import { AdminHeader } from '@/components/AdminHeader';

const today = () => new Date().toISOString().slice(0, 10);

export default function AdminEarnings() {
  const [, navigate] = useLocation();
  const session = useAdminSession();
  const signedIn = session.data?.signedIn === true;

  useEffect(() => {
    if (session.isSuccess && !signedIn) {
      navigate('/admin/login', { replace: true });
    }
  }, [session.isSuccess, signedIn, navigate]);

  const summary = useLedgerSummary(signedIn);
  const bookings = useBookings(signedIn);
  const expenses = useExpenses(signedIn);

  if (session.isLoading || (session.isSuccess && !signedIn)) {
    return (
      <div className="grid min-h-[100dvh] place-items-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const totals = summary.data?.totals;

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <AdminHeader eyebrow="Earnings & expenses" title="Raj Kuthir — the books" />

      <main className="mx-auto max-w-[1180px] px-5 py-8 md:px-8 md:py-10">
        <section
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
          aria-label="Financial summary"
        >
          <StatTile
            label="Revenue"
            value={formatRupees(totals?.grossPaise)}
            hint="Confirmed bookings, cancellations excluded"
            loading={summary.isLoading}
          />
          <StatTile
            label="Channel commission"
            value={formatRupees(totals?.commissionPaise)}
            hint="What the platforms took"
            loading={summary.isLoading}
          />
          <StatTile
            label="Expenses"
            value={formatRupees(totals?.expensePaise)}
            hint="Everything you've recorded"
            loading={summary.isLoading}
          />
          <StatTile
            label="Net"
            value={formatRupees(totals?.netPaise)}
            hint="Revenue less commission, tax and expenses"
            emphasis
            loading={summary.isLoading}
          />
        </section>

        {totals && totals.awaitingAmount > 0 && (
          <div
            className="mt-4 flex items-start gap-3 rounded-2xl border border-[#d8a24a]/40 bg-[#d8a24a]/10 p-4"
            role="status"
          >
            <TriangleAlert size={16} className="mt-0.5 shrink-0 text-[#8a6320]" />
            <p className="text-sm leading-6 text-[#6b4d18]">
              <strong>{totals.awaitingAmount}</strong>{' '}
              {totals.awaitingAmount === 1 ? 'booking has' : 'bookings have'} no
              amount yet, so {totals.awaitingAmount === 1 ? 'it is' : 'they are'}{' '}
              missing from every figure above. They're marked below.
            </p>
          </div>
        )}

        <MonthlyTable
          months={summary.data?.months ?? []}
          loading={summary.isLoading}
        />

        <ChannelTable
          rows={summary.data?.bySource ?? []}
          loading={summary.isLoading}
        />

        <BookingsSection
          bookings={bookings.data?.bookings ?? []}
          loading={bookings.isLoading}
        />

        <ExpensesSection
          expenses={expenses.data?.expenses ?? []}
          loading={expenses.isLoading}
        />
      </main>
    </div>
  );
}

function StatTile({
  label,
  value,
  hint,
  emphasis,
  loading,
}: {
  label: string;
  value: string;
  hint: string;
  emphasis?: boolean;
  loading: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-5 ${
        emphasis
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-card'
      }`}
    >
      <p
        className={`text-[10px] font-bold uppercase tracking-[.1em] ${
          emphasis ? 'text-primary-foreground/70' : 'text-muted-foreground'
        }`}
      >
        {label}
      </p>
      <p
        className={`mt-2 font-journal text-3xl ${
          emphasis ? 'text-primary-foreground' : 'text-primary'
        }`}
      >
        {loading ? '—' : value}
      </p>
      <p
        className={`mt-2 text-[11px] leading-4 ${
          emphasis ? 'text-primary-foreground/60' : 'text-muted-foreground'
        }`}
      >
        {hint}
      </p>
    </div>
  );
}

function SectionHeading({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.12em] text-accent">
          {icon}
          {title}
        </p>
        <p className="mt-2 max-w-[560px] text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
      {action}
    </div>
  );
}

function MonthlyTable({
  months,
  loading,
}: {
  months: Array<{
    month: string;
    grossPaise: number;
    commissionPaise: number;
    expensePaise: number;
    netPaise: number;
    nights: number;
    bookingCount: number;
  }>;
  loading: boolean;
}) {
  return (
    <section className="mt-8" aria-label="Month by month">
      <SectionHeading
        icon={<CalendarDays size={15} />}
        title="Month by month"
        description="Exact figures rather than a chart — for money the number is the point."
      />

      <div className="mt-4 overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[10px] uppercase tracking-[.08em] text-muted-foreground">
              <th className="px-5 py-3 font-bold">Month</th>
              <th className="px-5 py-3 text-right font-bold">Nights</th>
              <th className="px-5 py-3 text-right font-bold">Revenue</th>
              <th className="px-5 py-3 text-right font-bold">Commission</th>
              <th className="px-5 py-3 text-right font-bold">Expenses</th>
              <th className="px-5 py-3 text-right font-bold">Net</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="px-5 py-6 text-muted-foreground">
                  Loading…
                </td>
              </tr>
            )}

            {!loading && months.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-6 text-muted-foreground">
                  Nothing recorded yet. Add a booking below to start.
                </td>
              </tr>
            )}

            {months.map((month) => (
              <tr
                key={month.month}
                className="border-b border-border last:border-0"
                data-testid={`row-month-${month.month}`}
              >
                <td className="px-5 py-3 font-semibold text-primary">
                  {formatMonth(month.month)}
                  <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                    {month.bookingCount}{' '}
                    {month.bookingCount === 1 ? 'stay' : 'stays'}
                  </span>
                </td>
                <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                  {month.nights}
                </td>
                <td className="px-5 py-3 text-right tabular-nums text-foreground">
                  {formatRupees(month.grossPaise)}
                </td>
                <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                  {formatRupees(month.commissionPaise)}
                </td>
                <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                  {formatRupees(month.expensePaise)}
                </td>
                <td className="px-5 py-3 text-right font-bold tabular-nums text-primary">
                  {formatRupees(month.netPaise)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ChannelTable({
  rows,
  loading,
}: {
  rows: Array<{
    source: BookingSource;
    grossPaise: number;
    bookingCount: number;
    nights: number;
  }>;
  loading: boolean;
}) {
  const max = Math.max(1, ...rows.map((row) => row.grossPaise));

  return (
    <section className="mt-8" aria-label="By channel">
      <SectionHeading
        icon={<Wallet size={15} />}
        title="Where the money comes from"
        description="Revenue by channel. Direct and offline bookings carry no commission, so they are worth more to you than the same number on an OTA."
      />

      <div className="mt-4 rounded-2xl border border-border bg-card p-5">
        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

        {!loading && rows.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No bookings recorded yet.
          </p>
        )}

        <div className="space-y-4">
          {rows.map((row) => (
            <div key={row.source} data-testid={`row-channel-${row.source}`}>
              <div className="flex items-baseline justify-between gap-4">
                <p className="text-sm font-semibold text-primary">
                  {SOURCE_LABELS[row.source]}
                </p>
                <p className="tabular-nums text-sm text-foreground">
                  {formatRupees(row.grossPaise)}
                  <span className="ml-2 text-[11px] text-muted-foreground">
                    {row.bookingCount}{' '}
                    {row.bookingCount === 1 ? 'stay' : 'stays'} · {row.nights}{' '}
                    {row.nights === 1 ? 'night' : 'nights'}
                  </span>
                </p>
              </div>
              {/* Magnitude comparison: one hue, length carries the value. */}
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-secondary/40">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{
                    width: `${Math.max(2, (row.grossPaise / max) * 100)}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function BookingsSection({
  bookings,
  loading,
}: {
  bookings: Array<{
    id: string;
    source: BookingSource;
    guestName: string | null;
    checkIn: string;
    checkOut: string;
    status: string;
    grossPaise: number | null;
    externalRef: string | null;
  }>;
  loading: boolean;
}) {
  const remove = useDeleteBooking();

  return (
    <section className="mt-8" aria-label="Bookings">
      <SectionHeading
        icon={<CalendarDays size={15} />}
        title="Bookings"
        description="Every stay, whichever channel it came through. Bookings are created only by uploading a channel's confirmation below — not entered by hand here. To add a lead who hasn't booked yet, use Add enquiry on the Guests page."
      />

      <div className="mt-4">
        <BookingImport />
      </div>

      <div className="mt-4 overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[10px] uppercase tracking-[.08em] text-muted-foreground">
              <th className="px-5 py-3 font-bold">Dates</th>
              <th className="px-5 py-3 font-bold">Guest</th>
              <th className="px-5 py-3 font-bold">Channel</th>
              <th className="px-5 py-3 text-right font-bold">Amount</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="px-5 py-6 text-muted-foreground">
                  Loading…
                </td>
              </tr>
            )}

            {!loading && bookings.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-6 text-muted-foreground">
                  No bookings recorded yet.
                </td>
              </tr>
            )}

            {bookings.map((booking) => (
              <tr
                key={booking.id}
                className="border-b border-border last:border-0"
                data-testid={`row-booking-${booking.id}`}
              >
                <td className="px-5 py-3">
                  <span className="text-foreground">
                    {format(parseISO(booking.checkIn), 'd MMM')} →{' '}
                    {format(parseISO(booking.checkOut), 'd MMM yyyy')}
                  </span>
                  {booking.status === 'cancelled' && (
                    <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                      Cancelled
                    </span>
                  )}
                </td>
                <td className="px-5 py-3 text-muted-foreground">
                  {booking.guestName ?? '—'}
                </td>
                <td className="px-5 py-3 text-muted-foreground">
                  {SOURCE_LABELS[booking.source]}
                  {booking.externalRef && (
                    <span className="ml-2 font-mono-ui text-[10px] text-muted-foreground/70">
                      {booking.externalRef}
                    </span>
                  )}
                </td>
                <td className="px-5 py-3 text-right tabular-nums">
                  {booking.grossPaise === null ? (
                    <span className="rounded-full bg-[#d8a24a]/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-[#8a6320]">
                      Amount needed
                    </span>
                  ) : (
                    formatRupees(booking.grossPaise)
                  )}
                </td>
                <td className="px-5 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => remove.mutate(booking.id)}
                    className="rounded-full border border-border p-1.5 text-muted-foreground transition-colors hover:border-[#A65E45] hover:text-[#A65E45]"
                    aria-label="Delete booking"
                    data-testid={`button-delete-booking-${booking.id}`}
                  >
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ExpensesSection({
  expenses,
  loading,
}: {
  expenses: Array<{
    id: string;
    spentOn: string;
    amountPaise: number;
    category: ExpenseCategory;
    note: string | null;
  }>;
  loading: boolean;
}) {
  const [spentOn, setSpentOn] = useState(today);
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>('other');
  const [note, setNote] = useState('');

  const create = useCreateExpense();
  const remove = useDeleteExpense();

  const errorMessage =
    create.error instanceof Error ? create.error.message : null;

  const submit = () => {
    if (!amount) return;
    create.mutate(
      { spentOn, amount, category, note },
      {
        onSuccess: () => {
          setAmount('');
          setNote('');
        },
      },
    );
  };

  const total = useMemo(
    () => expenses.reduce((sum, expense) => sum + expense.amountPaise, 0),
    [expenses],
  );

  return (
    <section className="mt-8 pb-6" aria-label="Expenses">
      <SectionHeading
        icon={<Receipt size={15} />}
        title="Expenses"
        description="Staff, utilities, maintenance, supplies — what it costs to run the house."
      />

      <div className="mt-4 rounded-2xl border border-border bg-card p-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Date">
            <TextInput
              type="date"
              value={spentOn}
              onChange={setSpentOn}
              testId="input-expense-date"
            />
          </Field>

          <Field label="Amount (₹)">
            <TextInput
              type="number"
              value={amount}
              onChange={setAmount}
              testId="input-expense-amount"
            />
          </Field>

          <Field label="Category">
            <select
              value={category}
              onChange={(event) =>
                setCategory(event.target.value as ExpenseCategory)
              }
              className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm"
              data-testid="select-expense-category"
            >
              {(
                Object.keys(CATEGORY_LABELS) as Array<
                  keyof typeof CATEGORY_LABELS
                >
              ).map((key) => (
                <option key={key} value={key}>
                  {CATEGORY_LABELS[key]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Note">
            <TextInput
              value={note}
              onChange={setNote}
              testId="input-expense-note"
            />
          </Field>
        </div>

        {errorMessage && (
          <p className="mt-3 text-xs text-[#A65E45]" role="alert">
            {errorMessage}
          </p>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={!amount || create.isPending}
          className="mt-5 flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-[11px] font-bold uppercase tracking-[.09em] text-primary-foreground transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="button-save-expense"
        >
          {create.isPending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Plus size={14} />
          )}
          Add expense
        </button>
      </div>

      <div className="mt-4 overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[10px] uppercase tracking-[.08em] text-muted-foreground">
              <th className="px-5 py-3 font-bold">Date</th>
              <th className="px-5 py-3 font-bold">Category</th>
              <th className="px-5 py-3 font-bold">Note</th>
              <th className="px-5 py-3 text-right font-bold">Amount</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="px-5 py-6 text-muted-foreground">
                  Loading…
                </td>
              </tr>
            )}

            {!loading && expenses.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-6 text-muted-foreground">
                  Nothing recorded yet.
                </td>
              </tr>
            )}

            {expenses.map((expense) => (
              <tr
                key={expense.id}
                className="border-b border-border last:border-0"
                data-testid={`row-expense-${expense.id}`}
              >
                <td className="px-5 py-3 text-foreground">
                  {format(parseISO(expense.spentOn), 'd MMM yyyy')}
                </td>
                <td className="px-5 py-3 text-muted-foreground">
                  {CATEGORY_LABELS[expense.category]}
                </td>
                <td className="px-5 py-3 text-muted-foreground">
                  {expense.note ?? '—'}
                </td>
                <td className="px-5 py-3 text-right tabular-nums text-foreground">
                  {formatRupees(expense.amountPaise)}
                </td>
                <td className="px-5 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => remove.mutate(expense.id)}
                    className="rounded-full border border-border p-1.5 text-muted-foreground transition-colors hover:border-[#A65E45] hover:text-[#A65E45]"
                    aria-label="Delete expense"
                    data-testid={`button-delete-expense-${expense.id}`}
                  >
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}

            {expenses.length > 0 && (
              <tr className="bg-background/50">
                <td colSpan={3} className="px-5 py-3 font-bold text-primary">
                  Total
                </td>
                <td className="px-5 py-3 text-right font-bold tabular-nums text-primary">
                  {formatRupees(total)}
                </td>
                <td />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[.08em] text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function TextInput({
  value,
  onChange,
  type = 'text',
  testId,
}: {
  value: string;
  onChange: (value: string) => void;
  type?: string;
  testId?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-primary"
      data-testid={testId}
    />
  );
}
