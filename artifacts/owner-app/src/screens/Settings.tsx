import { useState } from 'react';
import { Alert, RefreshControl, ScrollView, Switch, View } from 'react-native';

import { getSettings, listDevices, patchSettings, revokeDevice, type OwnerEvent, type WhatsappMode } from '../api';
import { unlock } from '../auth';
import { color, space, when } from '../theme';
import { Body, Button, Card, Chip, Heading, Notice, Row, Title } from '../ui';
import { useLoad } from '../useLoad';

const EVENT_LABEL: Record<OwnerEvent, string> = {
  booking_hold: 'A guest holds dates',
  payment_submitted: 'A guest says they paid',
  enquiry: 'New enquiry',
  ota_booking: 'Booking.com / Airbnb / MMT booking',
  ota_cancellation: 'OTA cancellation',
  checkin_tomorrow: 'Check-in tomorrow',
  message_draft: 'WhatsApp message waiting',
  message_failed: 'WhatsApp message failed',
  documents_uploaded: 'Guest uploaded ID',
  invoice_check_failed: 'Invoice check failed',
};

export default function Settings({ onSignOut }: { onSignOut: () => void }) {
  const settings = useLoad(getSettings);
  const devices = useLoad(listDevices);
  const [message, setMessage] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const s = settings.data;

  const save = async (key: string, patch: Parameters<typeof patchSettings>[0], sensitive: boolean) => {
    if (sensitive && !(await unlock('Confirm it is you'))) return;
    setBusy(key);
    try {
      await patchSettings(patch);
      setMessage({ text: 'Saved.', tone: 'ok' });
      await settings.reload();
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : 'Could not save.', tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const setMode = (mode: WhatsappMode) => {
    if (!s || s.whatsapp.mode.value === mode) return;
    if (mode === 'api' && !s.whatsapp.readiness.ready) {
      Alert.alert('WhatsApp Business API is not ready', s.whatsapp.readiness.missing.join('\n') || 'Finish the API setup on Railway first.');
      return;
    }
    void save('mode', { whatsappMode: mode }, true);
  };

  const signOutPhone = (id: string, name: string, thisDevice: boolean) =>
    Alert.alert(thisDevice ? 'Sign this phone out?' : `Sign out ${name}?`, thisDevice ? 'You will need your admin password to sign in again.' : 'Use this for a lost or old phone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          if (thisDevice) {
            onSignOut();
            return;
          }
          if (!(await unlock('Confirm it is you'))) return;
          try {
            await revokeDevice(id);
            await devices.reload();
          } catch (e) {
            setMessage({ text: e instanceof Error ? e.message : 'Could not sign that phone out.', tone: 'error' });
          }
        },
      },
    ]);

  return (
    <ScrollView
      contentContainerStyle={{ padding: space(4), paddingBottom: space(10) }}
      refreshControl={<RefreshControl refreshing={settings.loading} onRefresh={() => { void settings.reload(); void devices.reload(); }} />}
    >
      <Title>Settings</Title>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {settings.error && <Notice tone="error">{settings.error}</Notice>}

      {s && (
        <>
          <Card>
            <Heading>Guest WhatsApp messages</Heading>
            <Body muted style={{ marginBottom: space(3) }}>
              Manual: messages open in your own WhatsApp and you press send. Business API: the server sends them for you.
            </Body>
            <Row>
              <Chip label="Manual (my WhatsApp)" active={s.whatsapp.mode.value === 'manual'} onPress={() => setMode('manual')} />
              <Chip label="Business API" active={s.whatsapp.mode.value === 'api'} onPress={() => setMode('api')} />
            </Row>
            {!s.whatsapp.readiness.ready && (
              <Body muted style={{ marginTop: space(2) }}>Business API not set up yet: {s.whatsapp.readiness.missing.join(', ')}.</Body>
            )}
          </Card>

          <Card>
            <Heading>Where alerts go</Heading>
            <Body>Email: {s.contacts.alertEmail.value ?? 'not set'}</Body>
            <Body>Your WhatsApp: {s.contacts.ownerWhatsapp.value}</Body>
            <Body>Caretaker: {s.contacts.caretakerWhatsapp.value}</Body>
            <Body muted style={{ marginTop: space(2) }}>Change these in the web console (they need your password).</Body>
          </Card>

          <Card>
            <Heading>Email me when…</Heading>
            {(Object.keys(EVENT_LABEL) as OwnerEvent[]).map((event) => (
              <Row key={event} style={{ justifyContent: 'space-between', paddingVertical: space(1) }}>
                <Body style={{ flexShrink: 1 }}>{EVENT_LABEL[event]}</Body>
                <Switch
                  value={s.alerts.email[event] ?? false}
                  disabled={busy !== null}
                  trackColor={{ true: color.brand, false: color.line }}
                  onValueChange={(on) => void save(`email-${event}`, { emailEvents: { [event]: on } }, false)}
                  accessibilityLabel={`Email when: ${EVENT_LABEL[event]}`}
                />
              </Row>
            ))}
          </Card>
        </>
      )}

      <Card>
        <Heading>Signed-in phones</Heading>
        {(devices.data?.devices ?? [])
          .filter((d) => !d.signedOut)
          .map((d) => (
            <Row key={d.id} style={{ justifyContent: 'space-between', paddingVertical: space(1) }}>
              <View style={{ flexShrink: 1 }}>
                <Body>{d.name}{d.thisDevice ? ' (this phone)' : ''}</Body>
                <Body muted>Last used {when(d.lastSeenAt)}</Body>
              </View>
              <Button label="Sign out" kind="secondary" onPress={() => signOutPhone(d.id, d.name, d.thisDevice)} />
            </Row>
          ))}
      </Card>

      <Button label="Sign out of this phone" kind="danger" onPress={() => signOutPhone('', '', true)} busy={busy === 'signout'} />
      <Body muted style={{ marginTop: space(4), textAlign: 'center' }}>Raj Kuthir Owner · version 1.0.0</Body>
    </ScrollView>
  );
}
