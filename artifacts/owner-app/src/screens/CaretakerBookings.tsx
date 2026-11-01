import { useEffect, useRef, useState } from 'react';
import { Alert, AppState, Linking, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import {
  getCaretakerBookings,
  markCaretakerBooking,
  type BookingAlertKind,
  type CaretakerBookingCard,
  type CaretakerBookingMessage,
} from '../api';
import { color, shortDate, space, when } from '../theme';
import { Body, Button, Card, Chip, Notice, Row } from '../ui';
import { useLoad } from '../useLoad';

/**
 * "Inform the caretaker" for every booking that has not ended, whenever you
 * choose: the new booking itself, the day-before-arrival reminder, or the
 * day-before-departure one. The texts are the same ones the automatic alerts
 * use, written by the server, with "Paid" or "Due" and never an amount.
 * The button opens your own WhatsApp on her chat with the message typed; you
 * press send there. Nothing is sent from the app.
 */

type Opened = { bookingId: string; kind: BookingAlertKind; guest: string };

function doneLine(m: CaretakerBookingMessage): string {
  if (!m.done) return 'Not sent yet';
  const at = m.done.at ? ` ${when(m.done.at)}` : '';
  if (m.done.status === 'skipped') return `Skipped${at}`;
  return m.done.how === 'automatic' ? `Sent automatically${at}` : `Sent${at}`;
}

/** *bold* the way WhatsApp shows it. */
function Bubble({ text }: { text: string }) {
  const parts = text.split(/(\*[^*\n]+\*)/g);
  return (
    <View style={{ backgroundColor: '#e7ddd1', borderRadius: 14, padding: space(3), marginTop: space(3) }}>
      <View style={{ alignSelf: 'flex-end', maxWidth: '95%', backgroundColor: '#d9fdd3', borderRadius: 12, borderTopRightRadius: 3, paddingHorizontal: space(3), paddingVertical: space(2) }}>
        <Text style={{ fontSize: 14, lineHeight: 21, color: '#111b21' }}>
          {parts.map((part, i) =>
            /^\*[^*\n]+\*$/.test(part) ? (
              <Text key={i} style={{ fontWeight: '700' }}>
                {part.slice(1, -1)}
              </Text>
            ) : (
              part
            ),
          )}
        </Text>
      </View>
    </View>
  );
}

function BookingCard({
  card,
  busy,
  onInform,
  onMark,
}: {
  card: CaretakerBookingCard;
  busy: string | null;
  onInform: (card: CaretakerBookingCard, message: CaretakerBookingMessage) => void;
  onMark: (card: CaretakerBookingCard, kind: BookingAlertKind) => void;
}) {
  const [kind, setKind] = useState<BookingAlertKind>(card.suggested ?? card.messages[0]!.kind);
  const [showing, setShowing] = useState(false);
  const message = card.messages.find((m) => m.kind === kind) ?? card.messages[0]!;
  const told = card.messages.find((m) => m.kind === 'new_booking')?.done?.status === 'sent';
  const cancelled = card.status === 'cancelled';

  return (
    <Card tone={card.suggested ? 'warn' : undefined}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flexShrink: 1 }}>
          <Body style={{ fontWeight: '700' }}>{card.guestName ?? 'Guest name not known yet'}</Body>
          <Body muted>
            {shortDate(card.checkIn)} – {shortDate(card.checkOut)} · {card.source}
          </Body>
        </View>
        <Text
          style={{
            fontSize: 12,
            fontWeight: '700',
            color: cancelled ? color.terracotta : color.brand,
            borderWidth: 1,
            borderColor: cancelled ? color.terracotta : color.brand,
            borderRadius: 999,
            paddingHorizontal: space(2),
            paddingVertical: 2,
            overflow: 'hidden',
          }}
        >
          {card.when}
        </Text>
      </Row>

      {!cancelled && (
        <Body muted style={{ marginTop: space(2) }}>
          {told ? 'She knows about this booking.' : 'She has not been told about this booking yet.'}
        </Body>
      )}

      {card.messages.length > 1 && (
        <Row style={{ marginTop: space(3) }}>
          {card.messages.map((m) => (
            <Chip key={m.kind} label={`${m.label}${m.done?.status === 'sent' ? ' ✓' : ''}`} active={kind === m.kind} onPress={() => setKind(m.kind)} />
          ))}
        </Row>
      )}

      <Body muted style={{ marginTop: space(2) }}>
        {message.label}: {doneLine(message)}
      </Body>

      <Pressable onPress={() => setShowing((v) => !v)} accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center' }}>
        <Text style={{ color: color.brand, fontWeight: '600' }}>{showing ? 'Hide the message' : 'See the message'}</Text>
      </Pressable>
      {showing && <Bubble text={message.text} />}

      <Row style={{ marginTop: space(3) }}>
        <Button
          label={message.done?.status === 'sent' ? 'Inform her again' : 'Inform the caretaker'}
          kind="whatsapp"
          onPress={() => onInform(card, message)}
          disabled={!message.whatsappUrl}
          style={{ flexGrow: 1 }}
        />
        {!message.done && (
          <Button label="Mark sent" kind="secondary" onPress={() => onMark(card, message.kind)} busy={busy === `${card.bookingId}:${message.kind}`} />
        )}
      </Row>
    </Card>
  );
}

export default function CaretakerBookings() {
  const data = useLoad(getCaretakerBookings);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const opened = useRef<Opened | null>(null);

  const mark = async (bookingId: string, kind: BookingAlertKind) => {
    setBusy(`${bookingId}:${kind}`);
    try {
      await markCaretakerBooking(bookingId, kind, 'sent');
      setNotice({ text: 'Marked as sent.', tone: 'ok' });
      await data.reload();
    } catch (e) {
      setNotice({ text: e instanceof Error ? e.message : 'Could not mark it sent.', tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  // Back from WhatsApp: ask once whether it went, then record it.
  useEffect(() => {
    let left = false;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' && opened.current) left = true;
      if (state === 'active' && left && opened.current) {
        left = false;
        const o = opened.current;
        opened.current = null;
        Alert.alert('Did you send it?', `Your message to the caretaker about ${o.guest}.`, [
          { text: 'Not yet', style: 'cancel' },
          { text: 'Yes, sent', onPress: () => void mark(o.bookingId, o.kind) },
        ]);
      }
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const inform = (card: CaretakerBookingCard, message: CaretakerBookingMessage) => {
    if (!message.whatsappUrl) return;
    setNotice(null);
    opened.current = { bookingId: card.bookingId, kind: message.kind, guest: card.guestName ?? 'this booking' };
    Linking.openURL(message.whatsappUrl).catch(() => {
      opened.current = null;
      setNotice({ text: 'Could not open WhatsApp on this phone.', tone: 'error' });
    });
  };

  const cards = data.data?.cards ?? [];
  const waiting = cards.filter((c) => c.suggested).length;

  return (
    <ScrollView
      contentContainerStyle={{ padding: space(4), paddingBottom: space(12) }}
      refreshControl={<RefreshControl refreshing={data.loading} onRefresh={() => void data.reload()} />}
    >
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {data.error && <Notice tone="error">{data.error}</Notice>}
      {data.data && !data.data.caretaker && <Notice tone="error">Add her WhatsApp number in Settings to inform her from here.</Notice>}

      {data.data && (
        <Body muted style={{ marginBottom: space(3) }}>
          {cards.length === 0
            ? 'No upcoming bookings.'
            : waiting > 0
              ? `${waiting} booking${waiting === 1 ? '' : 's'} to tell her about. Highlighted below.`
              : 'She is up to date on every upcoming booking.'}
        </Body>
      )}

      {cards.map((card) => (
        <BookingCard key={card.bookingId} card={card} busy={busy} onInform={inform} onMark={(c, kind) => void mark(c.bookingId, kind)} />
      ))}
    </ScrollView>
  );
}
