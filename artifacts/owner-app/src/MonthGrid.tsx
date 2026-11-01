import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { blockDates, getCalendarMonth, type CalendarDay } from './api';
import { addDays, color, longDate, rupees, space } from './theme';
import { Body, Button, Card, Chip, Heading, Notice, Row } from './ui';
import { useLoad } from './useLoad';

/**
 * The month at a glance: one call (GET /api/admin/calendar/month) gives every
 * day's status, guest or channel, price on free nights and festival periods.
 * Tap a day for its details; a free night can be blocked from there.
 */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const SOURCE: Record<string, string> = {
  direct: 'Direct',
  bookingCom: 'Booking.com',
  airbnb: 'Airbnb',
  makeMyTrip: 'MakeMyTrip',
  manual: 'Blocked by you',
  hold: 'Website hold',
};

const STATUS: Record<CalendarDay['status'], string> = {
  booked: 'Booked',
  held: 'Held, payment pending',
  blocked: 'Closed',
  free: 'Free',
  past: 'Past',
};

const cellColors = (day: CalendarDay) => {
  switch (day.status) {
    case 'booked':
      return { bg: color.brand, fg: color.white };
    case 'held':
      return { bg: '#f1dfb8', fg: color.amber };
    case 'blocked':
      return { bg: '#ddd5c8', fg: color.muted };
    case 'past':
      return { bg: 'transparent', fg: '#b9b2a6' };
    default:
      return { bg: color.card, fg: color.ink };
  }
};

/** ₹3,200 → "3.2k" so it fits under the day number. */
const compact = (paise: number) => {
  const r = paise / 100;
  return r >= 1000 ? `${(r / 1000).toFixed(r % 1000 === 0 ? 0 : 1)}k` : String(Math.round(r));
};

const label = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${y}`;
};

export function MonthGrid({ onChanged }: { onChanged?: () => void }) {
  const [month, setMonth] = useState<string | undefined>(undefined);
  const cal = useLoad(() => getCalendarMonth(month));
  const [selected, setSelected] = useState<CalendarDay | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);

  useEffect(() => {
    setSelected(null);
    void cal.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const data = cal.data;
  const lead = data?.days[0]?.weekday ?? 0;
  const cells: Array<CalendarDay | null> = [...Array(lead).fill(null), ...(data?.days ?? [])];
  while (cells.length % 7) cells.push(null);

  const block = async (day: CalendarDay) => {
    setBusy(true);
    try {
      await blockDates(day.date, addDays(day.date, 1));
      setNotice({ text: `${longDate(day.date)} is closed on every channel.`, tone: 'ok' });
      await cal.reload();
      setSelected(null);
      onChanged?.();
    } catch (e) {
      setNotice({ text: e instanceof Error ? e.message : 'Could not block that night.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Row style={{ justifyContent: 'space-between' }}>
        <Pressable onPress={() => data && setMonth(data.previous)} accessibilityRole="button" accessibilityLabel="Previous month" style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}>
          <Text style={{ fontSize: 24, color: color.brand }}>‹</Text>
        </Pressable>
        <View style={{ alignItems: 'center' }}>
          <Heading>{data ? label(data.month) : '…'}</Heading>
          {data && data.month !== data.today.slice(0, 7) && <Chip label="Today" onPress={() => setMonth(undefined)} />}
        </View>
        <Pressable onPress={() => data && setMonth(data.next)} accessibilityRole="button" accessibilityLabel="Next month" style={{ minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'flex-end' }}>
          <Text style={{ fontSize: 24, color: color.brand }}>›</Text>
        </Pressable>
      </Row>

      {data && (
        <Body muted style={{ marginBottom: space(2) }}>
          {data.summary.bookedNights} booked · {data.summary.heldNights} held · {data.summary.freeNights} free
          {data.summary.occupancyAheadPercent !== null ? ` · ${data.summary.occupancyAheadPercent}% of the rest taken` : ''}
        </Body>
      )}
      {cal.error && <Notice tone="error">{cal.error}</Notice>}
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      <View style={{ flexDirection: 'row' }}>
        {WEEKDAYS.map((w, i) => (
          <Text key={i} style={{ width: `${100 / 7}%`, textAlign: 'center', fontSize: 12, fontWeight: '600', color: color.muted, paddingVertical: 4 }}>
            {w}
          </Text>
        ))}
      </View>
      {cal.loading && !data ? (
        <ActivityIndicator style={{ marginVertical: space(8) }} color={color.brand} />
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', opacity: cal.loading ? 0.6 : 1 }}>
          {cells.map((day, i) => {
            if (!day) return <View key={`b${i}`} style={{ width: `${100 / 7}%`, aspectRatio: 0.8 }} />;
            const c = cellColors(day);
            const isToday = data?.today === day.date;
            const isSelected = selected?.date === day.date;
            return (
              <Pressable
                key={day.date}
                onPress={() => setSelected(isSelected ? null : day)}
                accessibilityRole="button"
                accessibilityLabel={`${longDate(day.date)}, ${STATUS[day.status]}${day.label ? `, ${day.label}` : ''}`}
                style={{ width: `${100 / 7}%`, aspectRatio: 0.8, padding: 2 }}
              >
                <View
                  style={{
                    flex: 1,
                    borderRadius: 8,
                    backgroundColor: c.bg,
                    borderWidth: isSelected ? 2 : isToday ? 1.5 : day.status === 'free' ? 1 : 0,
                    borderColor: isSelected ? color.terracotta : isToday ? color.brand : color.line,
                    borderLeftWidth: day.checkIn ? 4 : undefined,
                    borderLeftColor: day.checkIn ? (day.status === 'held' ? color.amber : '#1d3a2f') : undefined,
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                  }}
                >
                  {day.peak && <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, backgroundColor: color.amber }} />}
                  <Text style={{ fontSize: 14, fontWeight: isToday ? '700' : '600', color: c.fg }}>{Number(day.date.slice(8))}</Text>
                  {day.pricePaise !== null && <Text style={{ fontSize: 10, color: color.muted }}>{compact(day.pricePaise)}</Text>}
                  {day.checkOut && day.status !== 'booked' && (
                    <View style={{ position: 'absolute', bottom: 3, width: 6, height: 6, borderRadius: 3, backgroundColor: color.terracotta }} />
                  )}
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

      <Row style={{ marginTop: space(3), columnGap: space(3) }}>
        <Legend swatch={color.brand} text="Booked" />
        <Legend swatch="#f1dfb8" text="Held" />
        <Legend swatch="#ddd5c8" text="Closed" />
        <Legend swatch={color.amber} text="Festival" thin />
        <Legend swatch={color.terracotta} text="Check-out" dot />
      </Row>

      {selected && (
        <View style={{ marginTop: space(4), paddingTop: space(3), borderTopWidth: 1, borderTopColor: color.line }}>
          <Heading>{longDate(selected.date)}</Heading>
          <Body>
            {STATUS[selected.status]}
            {selected.label ? ` · ${selected.label}` : ''}
            {selected.source ? ` · ${SOURCE[selected.source] ?? selected.source}` : ''}
          </Body>
          {selected.checkIn && <Body muted>Check-in day.</Body>}
          {selected.checkOut && <Body muted>A stay checks out this morning.</Body>}
          {selected.pricePaise !== null && <Body muted>{rupees(selected.pricePaise)} a night for 2 guests.</Body>}
          {selected.peak && <Body muted>{selected.peak}{selected.minNights ? ` · ${selected.minNights}-night minimum` : ''}</Body>}
          {selected.status === 'free' && (
            <Button label="Block this night" kind="secondary" onPress={() => void block(selected)} busy={busy} style={{ marginTop: space(3) }} />
          )}
        </View>
      )}
    </Card>
  );
}

function Legend({ swatch, text, thin, dot }: { swatch: string; text: string; thin?: boolean; dot?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: dot ? 8 : 14, height: thin ? 3 : dot ? 8 : 14, borderRadius: dot ? 4 : 3, backgroundColor: swatch }} />
      <Text style={{ fontSize: 12, color: color.muted }}>{text}</Text>
    </View>
  );
}
