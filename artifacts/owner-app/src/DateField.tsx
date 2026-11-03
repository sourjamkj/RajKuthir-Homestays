import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { color, longDate, space } from './theme';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const toDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!, 12);
};
const toIso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** A date input like the web's: tap to pick from Android's calendar. Value is YYYY-MM-DD or ''. */
export function DateField({
  label,
  value,
  onChange,
  optional,
}: {
  label: string;
  value: string;
  onChange: (iso: string) => void;
  optional?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const shown = value ? `${DAYS[toDate(value).getDay()]}, ${longDate(value)}` : optional ? 'Not set' : 'Pick a date';

  const picked = (event: DateTimePickerEvent, date?: Date) => {
    setOpen(false);
    if (event.type === 'set' && date) onChange(toIso(date));
  };

  return (
    <View style={{ marginBottom: space(3) }}>
      <Text style={{ fontSize: 13, fontWeight: '500', color: color.muted, marginBottom: space(1) }}>{label}</Text>
      <View style={{ flexDirection: 'row', gap: space(2) }}>
        <Pressable
          onPress={() => setOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${shown}. Change`}
          style={{
            flex: 1,
            minHeight: 48,
            borderWidth: 1,
            borderColor: color.line,
            borderRadius: 12,
            paddingHorizontal: space(3),
            justifyContent: 'center',
            backgroundColor: color.white,
          }}
        >
          <Text style={{ fontSize: 16, color: value ? color.ink : color.muted }}>{shown}</Text>
        </Pressable>
        {optional && value ? (
          <Pressable
            onPress={() => onChange('')}
            accessibilityRole="button"
            accessibilityLabel={`Clear ${label}`}
            style={{ minHeight: 48, minWidth: 48, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ color: color.muted, fontSize: 15 }}>Clear</Text>
          </Pressable>
        ) : null}
      </View>
      {open && <DateTimePicker value={value ? toDate(value) : new Date()} mode="date" display="default" onChange={picked} />}
    </View>
  );
}
