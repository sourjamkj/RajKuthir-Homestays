import { useState } from 'react';
import { Alert, RefreshControl, ScrollView, View } from 'react-native';

import { blockDates, getCalendar, syncCalendars, unblockDates, type CalendarEvent } from '../api';
import { addDays, color, longDate, shortDate, space, todayIst } from '../theme';
import { Body, Button, Card, Field, Heading, Notice, Row, Title } from '../ui';
import { MonthGrid } from '../MonthGrid';
import { useLoad } from '../useLoad';

const SOURCE: Record<CalendarEvent['source'], string> = {
  manual: 'Blocked by you',
  direct: 'Direct booking',
  bookingCom: 'Booking.com',
  airbnb: 'Airbnb',
  makeMyTrip: 'MakeMyTrip',
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;

const nights = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/**
 * Upcoming stays and blocks from every channel, and blocking nights.
 * A block here reaches Booking.com, Airbnb and MakeMyTrip on their next
 * calendar sync, the same as one made in the web console.
 */
export default function Calendar() {
  const cal = useLoad(getCalendar);
  const today = todayIst();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(addDays(today, 1));
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);

  const upcoming = (cal.data?.events ?? [])
    .filter((e) => e.endDate > today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));

  const valid = ISO.test(from) && ISO.test(to) && to > from;

  const block = async () => {
    setBusy('block');
    try {
      await blockDates(from, to, label.trim() || undefined);
      setMessage({ text: `Blocked ${longDate(from)} → ${longDate(to)}.`, tone: 'ok' });
      setLabel('');
      await cal.reload();
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : 'Could not block those nights.', tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const free = (event: CalendarEvent) =>
    Alert.alert('Free these nights?', `${shortDate(event.startDate)} → ${shortDate(event.endDate)}`, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Free them',
        style: 'destructive',
        onPress: async () => {
          setBusy(event.id);
          try {
            await unblockDates(event.id);
            setMessage({ text: 'Nights freed.', tone: 'ok' });
            await cal.reload();
          } catch (e) {
            setMessage({ text: e instanceof Error ? e.message : 'Could not free those nights.', tone: 'error' });
          } finally {
            setBusy(null);
          }
        },
      },
    ]);

  const sync = async () => {
    setBusy('sync');
    try {
      await syncCalendars();
      setMessage({ text: 'Booking.com, Airbnb and MakeMyTrip calendars synced.', tone: 'ok' });
      await cal.reload();
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : 'Sync failed.', tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={{ padding: space(4), paddingBottom: space(10) }}
      refreshControl={<RefreshControl refreshing={cal.loading} onRefresh={() => void cal.reload()} />}
      keyboardShouldPersistTaps="handled"
    >
      <Title>Calendar</Title>
      <MonthGrid onChanged={() => void cal.reload()} />
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {cal.error && <Notice tone="error">{cal.error}</Notice>}

      <Card>
        <Heading>Block nights</Heading>
        <Body muted style={{ marginBottom: space(3) }}>Check-out is the morning after the last night.</Body>
        <Field label="First night (YYYY-MM-DD)" value={from} onChangeText={setFrom} autoCapitalize="none" keyboardType="numbers-and-punctuation" />
        <Row style={{ marginTop: -space(1), marginBottom: space(3) }}>
          <Button label="−1 day" kind="secondary" onPress={() => ISO.test(from) && setFrom(addDays(from, -1))} />
          <Button label="+1 day" kind="secondary" onPress={() => ISO.test(from) && setFrom(addDays(from, 1))} />
        </Row>
        <Field label="Check-out (YYYY-MM-DD)" value={to} onChangeText={setTo} autoCapitalize="none" keyboardType="numbers-and-punctuation" />
        <Row style={{ marginTop: -space(1), marginBottom: space(3) }}>
          <Button label="−1 day" kind="secondary" onPress={() => ISO.test(to) && setTo(addDays(to, -1))} />
          <Button label="+1 day" kind="secondary" onPress={() => ISO.test(to) && setTo(addDays(to, 1))} />
        </Row>
        <Field label="Note (optional)" value={label} onChangeText={setLabel} placeholder="e.g. Family visit, repairs" maxLength={120} />
        <Body muted style={{ marginBottom: space(3) }}>
          {valid ? `${nights(from, to)} night${nights(from, to) === 1 ? '' : 's'}: ${longDate(from)} → ${longDate(to)}` : 'Check-out must be after the first night.'}
        </Body>
        <Button label="Block these nights" onPress={() => void block()} busy={busy === 'block'} disabled={!valid} />
      </Card>

      <Row style={{ justifyContent: 'space-between', marginTop: space(2), marginBottom: space(2) }}>
        <Heading>Coming up</Heading>
        <Button label="Sync now" kind="secondary" onPress={() => void sync()} busy={busy === 'sync'} />
      </Row>
      {!cal.loading && upcoming.length === 0 && <Body muted>Nothing booked or blocked ahead.</Body>}
      {upcoming.map((event) => (
        <Card key={event.id}>
          <Row style={{ justifyContent: 'space-between' }}>
            <View style={{ flexShrink: 1 }}>
              <Body style={{ fontWeight: '600' }}>{shortDate(event.startDate)} → {shortDate(event.endDate)} · {nights(event.startDate, event.endDate)}n</Body>
              <Body muted>
                {event.title && !/^(not available|closed|blocked)$/i.test(event.title)
                  ? `${event.title} · ${SOURCE[event.source]}`
                  : SOURCE[event.source]}
              </Body>
            </View>
            {event.editable && (
              <Button label="Free" kind="secondary" onPress={() => free(event)} busy={busy === event.id} />
            )}
          </Row>
          {event.note ? <Body muted style={{ color: color.muted }}>{event.note}</Body> : null}
        </Card>
      ))}
    </ScrollView>
  );
}
