import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { bookEnquiry, type Enquiry } from '../../api';
import { DateField } from '../../DateField';
import { color, space } from '../../theme';
import { Button, Field, Row } from '../../ui';
import { errorText, SmallButton, Small } from './shared';

const rupeesText = (paise: number | null | undefined) => (paise ? String(Math.round(paise / 100)) : '');

/**
 * "Book with my details" on an enquiry, as on the web: fill in what the
 * enquiry lacks (dates, party, the price agreed, the advance received) and
 * it becomes a booking in one step, with the same duplicate checks.
 */
export function BookForm({ row, onBooked }: { row: Enquiry; onBooked: (reference: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(() => ({
    checkIn: row.checkIn ?? '',
    checkOut: row.checkOut ?? '',
    adults: String(row.adults ?? 2),
    children: String(row.children ?? 0),
    pets: String(row.pets ?? 0),
    total: rupeesText(row.quotedTotalPaise ?? (row.quote.ok ? row.quote.totalPaise : null)),
    advance: rupeesText(row.quotedAdvancePaise),
    noAdvance: false,
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <View style={{ marginTop: space(3) }}>
        <SmallButton label="Book with my details" onPress={() => setOpen(true)} />
      </View>
    );
  }

  const nights =
    form.checkIn && form.checkOut && form.checkOut > form.checkIn
      ? Math.round((Date.parse(form.checkOut) - Date.parse(form.checkIn)) / 86_400_000)
      : 0;
  const advance = Number(form.advance || 0);
  const valid = Boolean(form.checkIn && form.checkOut && nights > 0 && Number(form.adults) >= 1 && Number(form.total) >= 1);
  const digits = (v: string) => v.replace(/[^\d]/g, '');

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await bookEnquiry(row.id, {
        checkIn: form.checkIn,
        checkOut: form.checkOut,
        adults: Number(form.adults),
        children: Number(form.children || 0),
        pets: Number(form.pets || 0),
        totalRupees: Number(form.total),
        advanceRupees: advance,
        confirmWithoutAdvance: form.noAdvance,
      });
      setOpen(false);
      onBooked(result.booking.reference);
    } catch (e) {
      setError(errorText(e, 'Could not book.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ marginTop: space(3), borderWidth: 1, borderColor: '#b7cfc7', borderRadius: 14, padding: space(3), backgroundColor: color.bg }}>
      <Row style={{ justifyContent: 'space-between', marginBottom: space(2) }}>
        <Text style={{ fontSize: 13, fontWeight: '700', color: color.brand, letterSpacing: 0.6 }}>BOOK WITH MY DETAILS</Text>
        <Pressable onPress={() => setOpen(false)} accessibilityRole="button" accessibilityLabel="Close" style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 16, color: color.muted }}>✕</Text>
        </Pressable>
      </Row>
      <DateField label="Check-in" value={form.checkIn} onChange={(checkIn) => setForm({ ...form, checkIn })} />
      <DateField label="Check-out" value={form.checkOut} onChange={(checkOut) => setForm({ ...form, checkOut })} />
      <Row style={{ alignItems: 'flex-start' }}>
        <View style={{ flex: 1, minWidth: 90 }}>
          <Field label="Adults" value={form.adults} onChangeText={(v) => setForm({ ...form, adults: digits(v) })} keyboardType="number-pad" maxLength={2} />
        </View>
        <View style={{ flex: 1, minWidth: 90 }}>
          <Field label="Children" value={form.children} onChangeText={(v) => setForm({ ...form, children: digits(v) })} keyboardType="number-pad" maxLength={2} />
        </View>
        <View style={{ flex: 1, minWidth: 90 }}>
          <Field label="Pets" value={form.pets} onChangeText={(v) => setForm({ ...form, pets: digits(v) })} keyboardType="number-pad" maxLength={2} />
        </View>
      </Row>
      <Field label="Total for the stay (₹)" value={form.total} onChangeText={(v) => setForm({ ...form, total: digits(v) })} keyboardType="number-pad" maxLength={7} />
      <Field label="Advance received (₹)" value={form.advance} onChangeText={(v) => setForm({ ...form, advance: digits(v) })} keyboardType="number-pad" maxLength={7} />
      <Small>{nights ? `${nights} night${nights === 1 ? '' : 's'}` : 'Check-out is the day they leave'}</Small>
      {!advance && (
        <Pressable
          onPress={() => setForm({ ...form, noAdvance: !form.noAdvance })}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: form.noAdvance }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: space(2), minHeight: 44, marginTop: space(2) }}
        >
          <View style={{ width: 22, height: 22, borderRadius: 5, borderWidth: 2, borderColor: color.brand, backgroundColor: form.noAdvance ? color.brand : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
            {form.noAdvance && <Text style={{ color: color.white, fontSize: 13, fontWeight: '700' }}>✓</Text>}
          </View>
          <Text style={{ flex: 1, fontSize: 14, color: color.brand }}>Confirm without an advance (it will hold the dates)</Text>
        </Pressable>
      )}
      {error && <Small tone="bad">{error}</Small>}
      <Button label="Create booking" onPress={() => void submit()} busy={busy} disabled={!valid} style={{ marginTop: space(3) }} />
    </View>
  );
}
