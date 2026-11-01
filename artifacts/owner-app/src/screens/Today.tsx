import { useEffect, useState } from 'react';
import { Alert, Image, Linking, RefreshControl, ScrollView, TextInput, View } from 'react-native';

import {
  AdminApiError,
  confirmPayment,
  getActivity,
  getPayments,
  markActivitySeen,
  rejectPayment,
  screenshotUrl,
  type PaymentRow,
} from '../api';
import { currentToken } from '../auth';
import { color, longDate, rupees, shortDate, space, when } from '../theme';
import { Body, Button, Card, Heading, Notice, Row, Title } from '../ui';
import { useLoad } from '../useLoad';

/**
 * The first thing the owner sees: payments waiting for a decision, then
 * what happened since the last look. Confirm here does exactly what the
 * web console's Confirm does (creates the booking, sends the confirmation).
 */
export default function Today() {
  const payments = useLoad(getPayments);
  const activity = useLoad(getActivity);
  const [token, setToken] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);

  useEffect(() => {
    void currentToken().then(setToken);
  }, []);

  const refresh = () => {
    void payments.reload();
    void activity.reload();
  };

  const open = (payments.data?.payments ?? []).filter(
    (p) => p.status === 'submitted' || (p.status === 'awaiting_payment' && new Date(p.holdExpiresAt) > new Date()),
  );
  const submitted = open.filter((p) => p.status === 'submitted');
  const holding = open.filter((p) => p.status === 'awaiting_payment');
  const items = activity.data?.items ?? [];

  return (
    <ScrollView
      contentContainerStyle={{ padding: space(4), paddingBottom: space(10) }}
      refreshControl={<RefreshControl refreshing={payments.loading || activity.loading} onRefresh={refresh} />}
    >
      <Title>Today</Title>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {payments.error && <Notice tone="error">{payments.error}</Notice>}

      <Heading>Payments to check {submitted.length ? `(${submitted.length})` : ''}</Heading>
      {submitted.length === 0 && <Body muted>No guest is waiting for you to confirm a payment.</Body>}
      {submitted.map((p) => (
        <PaymentCard key={p.id} payment={p} token={token} onDone={(text, tone) => { setMessage({ text, tone }); refresh(); }} />
      ))}

      {holding.length > 0 && (
        <View style={{ marginTop: space(4) }}>
          <Heading>Dates on hold, not paid yet</Heading>
          {holding.map((p) => (
            <Card key={p.id}>
              <Body>{p.guestName} · {shortDate(p.checkIn)} → {shortDate(p.checkOut)}</Body>
              <Body muted>Advance {rupees(p.advancePaise)} · held until {when(p.holdExpiresAt)}</Body>
            </Card>
          ))}
        </View>
      )}

      <View style={{ marginTop: space(6) }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Heading>What happened</Heading>
          {items.length > 0 && (
            <Button
              label="Mark all read"
              kind="secondary"
              onPress={() => {
                void markActivitySeen(new Date().toISOString()).then(() => activity.reload());
              }}
            />
          )}
        </Row>
        {activity.error && <Notice tone="error">{activity.error}</Notice>}
        {items.length === 0 && !activity.loading && <Body muted>Nothing new since you last looked.</Body>}
        {items.map((item) => (
          <Card key={item.id}>
            <Body style={{ fontWeight: '600' }}>{item.title}</Body>
            {item.detail ? <Body muted>{item.detail}</Body> : null}
            <Body muted>{when(item.at)}</Body>
          </Card>
        ))}
      </View>
    </ScrollView>
  );
}

function PaymentCard({
  payment: p,
  token,
  onDone,
}: {
  payment: PaymentRow;
  token: string | null;
  onDone: (text: string, tone: 'ok' | 'error') => void;
}) {
  const [busy, setBusy] = useState<'confirm' | 'reject' | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [showShot, setShowShot] = useState(false);

  const finishConfirm = async (force: boolean) => {
    const result = await confirmPayment(p.id, force);
    onDone(
      `Confirmed ${result.booking.reference}.${result.emailed ? ' Confirmation emailed to the guest.' : ''}`,
      'ok',
    );
    if (result.whatsappUrl) {
      Alert.alert('Send the confirmation', 'Open WhatsApp with the confirmation message for the guest?', [
        { text: 'Later', style: 'cancel' },
        { text: 'Open WhatsApp', onPress: () => void Linking.openURL(result.whatsappUrl!) },
      ]);
    }
  };

  const confirm = () =>
    Alert.alert('Confirm this payment?', `${p.guestName} · ${rupees(p.advancePaise)}\nUTR ${p.utr ?? '—'}\n\nOnly confirm once you have seen the money in your bank app.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Confirm',
        onPress: async () => {
          setBusy('confirm');
          try {
            await finishConfirm(false);
          } catch (e) {
            if (e instanceof AdminApiError && e.status === 409 && /double booking|calendar/i.test(e.message)) {
              Alert.alert('Check the calendar', `${e.message}\n\nIf that is this same guest, confirm anyway.`, [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Confirm anyway',
                  style: 'destructive',
                  onPress: () => void finishConfirm(true).catch((err) => onDone(err instanceof Error ? err.message : 'Could not confirm.', 'error')),
                },
              ]);
            } else {
              onDone(e instanceof Error ? e.message : 'Could not confirm.', 'error');
            }
          } finally {
            setBusy(null);
          }
        },
      },
    ]);

  const reject = async () => {
    setBusy('reject');
    try {
      await rejectPayment(p.id, reason.trim());
      onDone(`Rejected ${p.reference}. The dates are free again.`, 'ok');
    } catch (e) {
      onDone(e instanceof Error ? e.message : 'Could not reject.', 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card tone={p.overdue ? 'warn' : undefined}>
      <Heading>{p.guestName}</Heading>
      <Body>{longDate(p.checkIn)} → {longDate(p.checkOut)} · {p.guests} guest{p.guests === 1 ? '' : 's'}{p.pets ? ` · ${p.pets} pet${p.pets === 1 ? '' : 's'}` : ''}</Body>
      <Body style={{ marginTop: space(2), fontWeight: '600' }}>Advance {rupees(p.advancePaise)} of {rupees(p.totalPaise)}</Body>
      <Body muted>UTR {p.utr ?? '—'}{p.utrSubmittedAt ? ` · sent ${when(p.utrSubmittedAt)}` : ''}</Body>
      {p.overdue && <Body style={{ color: color.terracotta }}>Waiting past the hold. Decide soon.</Body>}

      {p.hasScreenshot && (
        <View style={{ marginTop: space(3) }}>
          {showShot && token ? (
            <Image
              source={{ uri: screenshotUrl(p.id), headers: { Authorization: `Bearer ${token}` } }}
              style={{ width: '100%', height: 420, borderRadius: 12, backgroundColor: color.line }}
              resizeMode="contain"
              accessibilityLabel="Payment screenshot from the guest"
            />
          ) : (
            <Button label="Show payment screenshot" kind="secondary" onPress={() => setShowShot(true)} />
          )}
        </View>
      )}

      <Row style={{ marginTop: space(3) }}>
        <Button label="Confirm" onPress={confirm} busy={busy === 'confirm'} style={{ flexGrow: 1 }} />
        <Button label="Reject" kind="secondary" onPress={() => setRejecting(!rejecting)} style={{ flexGrow: 1 }} />
        <Button label="Call" kind="secondary" onPress={() => void Linking.openURL(`tel:${p.guestPhone}`)} />
      </Row>

      {rejecting && (
        <View style={{ marginTop: space(3) }}>
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder="Reason, e.g. no payment received (kept with the record)"
            placeholderTextColor={color.muted}
            style={{ borderWidth: 1, borderColor: color.line, borderRadius: 12, padding: space(3), minHeight: 48, backgroundColor: color.white, color: color.ink }}
          />
          <Button label="Reject and free the dates" kind="danger" onPress={() => void reject()} busy={busy === 'reject'} disabled={!reason.trim()} style={{ marginTop: space(2) }} />
        </View>
      )}
    </Card>
  );
}
