import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminFetch } from '@/lib/admin-api';

/**
 * Bookings, expenses and the earnings summary.
 *
 * The API stores money in paise; this module converts at the boundary so every
 * component above it deals in plain rupees.
 */

export const BOOKINGS_KEY = ['/api/bookings'];
export const EXPENSES_KEY = ['/api/expenses'];
export const SUMMARY_KEY = ['/api/ledger/summary'];

export type BookingSource =
  | 'manual'
  | 'direct'
  | 'bookingCom'
  | 'airbnb'
  | 'makeMyTrip';

export type BookingStatus = 'pending' | 'confirmed' | 'cancelled';

export type ExpenseCategory =
  | 'staff'
  | 'utilities'
  | 'maintenance'
  | 'supplies'
  | 'food'
  | 'marketing'
  | 'commission'
  | 'other';

export const SOURCE_LABELS: Record<BookingSource, string> = {
  manual: 'Offline / walk-in',
  direct: 'Direct booking',
  bookingCom: 'Booking.com',
  airbnb: 'Airbnb',
  makeMyTrip: 'MakeMyTrip',
};

export const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  staff: 'Staff',
  utilities: 'Utilities',
  maintenance: 'Maintenance',
  supplies: 'Supplies',
  food: 'Food',
  marketing: 'Marketing',
  commission: 'Commission',
  other: 'Other',
};

export type Booking = {
  id: string;
  source: BookingSource;
  externalRef: string | null;
  guestName: string | null;
  guestPhone: string | null;
  checkIn: string;
  checkOut: string;
  guests: number | null;
  pets: number | null;
  status: BookingStatus;
  grossPaise: number | null;
  commissionPaise: number | null;
  taxPaise: number | null;
  receivedPaise: number | null;
  note: string | null;
};

export type Expense = {
  id: string;
  spentOn: string;
  amountPaise: number;
  category: ExpenseCategory;
  note: string | null;
};

export type MonthlySummary = {
  month: string;
  grossPaise: number;
  commissionPaise: number;
  taxPaise: number;
  receivedPaise: number;
  expensePaise: number;
  netPaise: number;
  nights: number;
  bookingCount: number;
};

export type LedgerSummary = {
  months: MonthlySummary[];
  bySource: Array<{
    source: BookingSource;
    grossPaise: number;
    bookingCount: number;
    nights: number;
  }>;
  totals: {
    grossPaise: number;
    commissionPaise: number;
    taxPaise: number;
    expensePaise: number;
    netPaise: number;
    bookingCount: number;
    awaitingAmount: number;
  };
};

export const toRupees = (paise: number | null | undefined): number =>
  (paise ?? 0) / 100;

export const formatRupees = (paise: number | null | undefined): string =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(toRupees(paise));

export const formatMonth = (month: string): string => {
  const [year, monthPart] = month.split('-');
  const date = new Date(Number(year), Number(monthPart) - 1, 1);
  return new Intl.DateTimeFormat('en-IN', {
    month: 'long',
    year: 'numeric',
  }).format(date);
};

export function useLedgerSummary(enabled: boolean) {
  return useQuery({
    queryKey: SUMMARY_KEY,
    queryFn: () => adminFetch<LedgerSummary>('/api/ledger/summary'),
    enabled,
    retry: false,
    staleTime: 30_000,
  });
}

export function useBookings(enabled: boolean) {
  return useQuery({
    queryKey: BOOKINGS_KEY,
    queryFn: () => adminFetch<{ bookings: Booking[] }>('/api/bookings'),
    enabled,
    retry: false,
    staleTime: 30_000,
  });
}

export function useExpenses(enabled: boolean) {
  return useQuery({
    queryKey: EXPENSES_KEY,
    queryFn: () => adminFetch<{ expenses: Expense[] }>('/api/expenses'),
    enabled,
    retry: false,
    staleTime: 30_000,
  });
}

function useLedgerMutation<TArgs>(
  request: (args: TArgs) => Promise<unknown>,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: request,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: BOOKINGS_KEY });
      queryClient.invalidateQueries({ queryKey: EXPENSES_KEY });
      queryClient.invalidateQueries({ queryKey: SUMMARY_KEY });
    },
  });
}

export type BookingDraft = {
  source: BookingSource;
  guestName: string;
  guestPhone: string;
  checkIn: string;
  checkOut: string;
  guests: string;
  gross: string;
  commission: string;
  received: string;
  status: BookingStatus;
  note: string;
};

export function useCreateBooking() {
  return useLedgerMutation((draft: BookingDraft) =>
    adminFetch('/api/bookings', {
      method: 'POST',
      body: JSON.stringify({
        source: draft.source,
        guestName: draft.guestName || null,
        guestPhone: draft.guestPhone || null,
        checkIn: draft.checkIn,
        checkOut: draft.checkOut,
        guests: draft.guests || null,
        gross: draft.gross || null,
        commission: draft.commission || null,
        received: draft.received || null,
        status: draft.status,
        note: draft.note || null,
      }),
    }),
  );
}

export function useUpdateBooking() {
  return useLedgerMutation(
    ({ id, patch }: { id: string; patch: Record<string, unknown> }) =>
      adminFetch(`/api/bookings/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
  );
}

export function useDeleteBooking() {
  return useLedgerMutation((id: string) =>
    adminFetch(`/api/bookings/${id}`, { method: 'DELETE' }),
  );
}

export function useCreateExpense() {
  return useLedgerMutation(
    (draft: {
      spentOn: string;
      amount: string;
      category: ExpenseCategory;
      note: string;
    }) =>
      adminFetch('/api/expenses', {
        method: 'POST',
        body: JSON.stringify({
          spentOn: draft.spentOn,
          amount: draft.amount,
          category: draft.category,
          note: draft.note || null,
        }),
      }),
  );
}

export function useDeleteExpense() {
  return useLedgerMutation((id: string) =>
    adminFetch(`/api/expenses/${id}`, { method: 'DELETE' }),
  );
}
