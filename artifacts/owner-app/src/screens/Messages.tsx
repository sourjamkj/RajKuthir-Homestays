import { useState } from 'react';
import { Linking, RefreshControl, ScrollView } from 'react-native';

import { approveMessage, cancelMessage, getOutbox, manualWhatsappLink, markMessageSentManually, type OutboxMessage } from '../api';
import { space, when } from '../theme';
import { Body, Button, Card, Heading, Notice, Row, Title } from '../ui';
import { useLoad } from '../useLoad';

const KIND: Record<OutboxMessage['kind'], string> = {
  booking_confirmed: 'Booking confirmed',
  checkin_reminder: 'Check-in reminder',
  checkout_today: 'Check-out today',
  review_request: 'Review request',
};

/**
 * WhatsApp messages waiting for you. Manual mode: open your own WhatsApp
 * with the text typed, then "I sent it". Business API mode: approve and the
 * server sends it.
 */
export default function Messages() {
  const outbox = useLoad(getOutbox);
  const [message, setMessage] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const manual = outbox.data?.mode !== 'api';
  const waiting = (outbox.data?.messages ?? []).filter((m) => m.status === 'draft' || m.status === 'pending' || m.status === 'failed');

  const run = async (id: string, action: () => Promise<unknown>, done: string) => {
    setBusy(id);
    try {
      await action();
      setMessage({ text: done, tone: 'ok' });
      await outbox.reload();
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : 'That did not work.', tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={{ padding: space(4), paddingBottom: space(10) }}
      refreshControl={<RefreshControl refreshing={outbox.loading} onRefresh={() => void outbox.reload()} />}
    >
      <Title>WhatsApp messages</Title>
      <Body muted style={{ marginBottom: space(3) }}>
        {manual ? 'Manual mode: each one opens in your own WhatsApp.' : 'Business API mode: approved messages are sent by the server.'}
      </Body>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {outbox.error && <Notice tone="error">{outbox.error}</Notice>}
      {!outbox.loading && waiting.length === 0 && <Body muted>Nothing waiting to be sent.</Body>}
      {waiting.map((m) => (
        <Card key={m.id} tone={m.status === 'failed' ? 'warn' : undefined}>
          <Heading>{KIND[m.kind] ?? m.kind}</Heading>
          <Body muted>To {m.toPhone} · {m.status === 'failed' ? `failed: ${m.error ?? 'unknown error'}` : `due ${when(m.sendAfter)}`}</Body>
          <Body style={{ marginTop: space(2) }}>{m.preview}</Body>
          <Row style={{ marginTop: space(3) }}>
            {manual ? (
              <>
                <Button label="Open in WhatsApp" kind="whatsapp" onPress={() => void Linking.openURL(manualWhatsappLink(m.toPhone, m.preview))} />
                <Button label="I sent it" kind="secondary" busy={busy === m.id} onPress={() => void run(m.id, () => markMessageSentManually(m.id), 'Marked as sent.')} />
              </>
            ) : (
              <Button label="Approve and send" busy={busy === m.id} onPress={() => void run(m.id, () => approveMessage(m.id), 'Approved.')} />
            )}
            <Button label="Cancel" kind="secondary" onPress={() => void run(`${m.id}-x`, () => cancelMessage(m.id), 'Cancelled.')} />
          </Row>
        </Card>
      ))}
    </ScrollView>
  );
}
