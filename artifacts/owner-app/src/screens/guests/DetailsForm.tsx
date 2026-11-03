import { useState } from 'react';
import { View } from 'react-native';

import type { Enquiry, EnquiryDetails } from '../../api';
import { DateField } from '../../DateField';
import { space } from '../../theme';
import { Button, Field, Row } from '../../ui';
import { Small } from './shared';

/**
 * Add or edit an enquiry, the same fields as the web console: dates, who is
 * coming (adults, children and their ages, pets), what they asked for, a
 * private note, and the price agreed with the guest. The agreed price, when
 * set, is what the quote, the WhatsApp reply and "Book with my details" use.
 */

export const EMPTY_DETAILS: EnquiryDetails = {
  name: '',
  phone: '',
  checkIn: '',
  checkOut: '',
  adults: '',
  children: '',
  childrenAges: '',
  pets: '',
  requests: '',
  ownerNote: '',
  agreedTotalRupees: '',
  agreedAdvanceRupees: '',
  priceNote: '',
};

const n = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));
const r = (paise: number | null | undefined) => (paise ? String(Math.round(paise / 100)) : '');

export function detailsOf(row: Enquiry): EnquiryDetails {
  return {
    name: row.name,
    phone: row.phone,
    checkIn: row.checkIn ?? '',
    checkOut: row.checkOut ?? '',
    adults: n(row.adults),
    children: n(row.children),
    childrenAges: row.childrenAges ?? '',
    pets: n(row.pets),
    requests: row.requests ?? '',
    ownerNote: row.ownerNote ?? '',
    agreedTotalRupees: r(row.agreedTotalPaise),
    agreedAdvanceRupees: r(row.agreedAdvancePaise),
    priceNote: row.priceNote ?? '',
  };
}

export function DetailsForm({
  initial,
  submitLabel,
  busy,
  error,
  onSubmit,
}: {
  initial: EnquiryDetails;
  submitLabel: string;
  busy: boolean;
  error: string | null;
  onSubmit: (values: EnquiryDetails) => void;
}) {
  const [v, setV] = useState(initial);
  const set = (key: keyof EnquiryDetails) => (value: string) => setV({ ...v, [key]: value });
  const digits = (key: keyof EnquiryDetails) => (value: string) => setV({ ...v, [key]: value.replace(/\D/g, '') });
  const nights = v.checkIn && v.checkOut && v.checkOut > v.checkIn ? Math.round((Date.parse(v.checkOut) - Date.parse(v.checkIn)) / 86_400_000) : 0;
  const heads = (Number(v.adults) || 0) + (Number(v.children) || 0);

  return (
    <View>
      <Field label="Name" value={v.name} onChangeText={set('name')} maxLength={200} />
      <Field label="Phone" value={v.phone} onChangeText={set('phone')} keyboardType="phone-pad" maxLength={20} placeholder="+91 98765 43210" />
      <DateField label="Check-in" value={v.checkIn} onChange={set('checkIn')} optional />
      <DateField label="Check-out (day they leave)" value={v.checkOut} onChange={set('checkOut')} optional />
      <Row style={{ alignItems: 'flex-start' }}>
        <View style={{ flex: 1, minWidth: 90 }}>
          <Field label="Adults" value={v.adults} onChangeText={digits('adults')} keyboardType="number-pad" maxLength={2} />
        </View>
        <View style={{ flex: 1, minWidth: 90 }}>
          <Field label="Children" value={v.children} onChangeText={digits('children')} keyboardType="number-pad" maxLength={2} />
        </View>
        <View style={{ flex: 1, minWidth: 90 }}>
          <Field label="Pets" value={v.pets} onChangeText={digits('pets')} keyboardType="number-pad" maxLength={2} />
        </View>
      </Row>
      <Field label="Children's ages" value={v.childrenAges} onChangeText={set('childrenAges')} maxLength={100} placeholder="e.g. 6 and 9" />
      <Field label="What they asked for" value={v.requests} onChangeText={set('requests')} maxLength={1000} />
      <Field label="Private note (never sent to the guest)" value={v.ownerNote} onChangeText={set('ownerNote')} maxLength={1000} multiline />
      <Row style={{ alignItems: 'flex-start' }}>
        <View style={{ flex: 1, minWidth: 140 }}>
          <Field label="Agreed total (₹)" value={v.agreedTotalRupees} onChangeText={digits('agreedTotalRupees')} keyboardType="number-pad" maxLength={8} placeholder="Rate card" />
        </View>
        <View style={{ flex: 1, minWidth: 140 }}>
          <Field label="Advance to confirm (₹)" value={v.agreedAdvanceRupees} onChangeText={digits('agreedAdvanceRupees')} keyboardType="number-pad" maxLength={8} placeholder="Usual share" />
        </View>
      </Row>
      <Field
        label="How the price is made up (shown to the guest)"
        value={v.priceNote}
        onChangeText={set('priceNote')}
        maxLength={300}
        placeholder="₹3,500 a night for 5 + ₹750 per extra guest"
      />
      <Small>
        {nights ? `${nights} night${nights === 1 ? '' : 's'}` : 'Dates optional'}
        {heads ? ` · ${heads} guest${heads === 1 ? '' : 's'}` : ''}
        {v.agreedTotalRupees ? ' · the agreed price replaces the rate card' : ''}
      </Small>
      {error && <Small tone="bad">{error}</Small>}
      <Button
        label={submitLabel}
        onPress={() => onSubmit({ ...v, name: v.name.trim(), phone: v.phone.trim() })}
        busy={busy}
        disabled={!v.name.trim() || !v.phone.trim()}
        style={{ marginTop: space(3) }}
      />
    </View>
  );
}
