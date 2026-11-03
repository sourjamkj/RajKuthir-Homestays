import { useState } from 'react';
import { Alert, RefreshControl, ScrollView, Switch, View } from 'react-native';

import { disconnectConnector, getConnectorStatus, getSettings, listDevices, patchSettings, revokeDevice, type WhatsappMode } from '../api';
import Notifications from './NotificationSettings';
import { unlock } from '../auth';
import { color, space, when } from '../theme';
import { Body, Button, Card, Chip, Heading, Notice, Row, Title } from '../ui';
import { useLoad } from '../useLoad';

export default function Settings({ onSignOut }: { onSignOut: () => void }) {
  const settings = useLoad(getSettings);
  const devices = useLoad(listDevices);
  const connector = useLoad(getConnectorStatus);
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

          <Notifications
            alerts={s.alerts}
            busy={busy}
            save={(key, patch) => void save(key, patch, false)}
          />
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

      <Card>
        <Heading>Claude</Heading>
        <Body muted style={{ marginBottom: space(2) }}>
          With the Raj Kuthir connector, Claude can add and edit enquiries, send quotes, mark advances and create bookings for you. It cannot touch settings, rates or money records.
        </Body>
        {connector.data?.connected ? (
          <>
            <Body>Connected{connector.data.lastUsed ? ` · last used ${when(connector.data.lastUsed)}` : ''}</Body>
            <Button
              label="Disconnect Claude"
              kind="secondary"
              busy={busy === 'claude'}
              style={{ marginTop: space(2) }}
              onPress={() =>
                Alert.alert('Disconnect Claude?', 'Claude will stop working with your console until you connect it again.', [
                  { text: 'Keep', style: 'cancel' },
                  {
                    text: 'Disconnect',
                    style: 'destructive',
                    onPress: async () => {
                      setBusy('claude');
                      try {
                        await disconnectConnector();
                        setMessage({ text: 'Claude disconnected.', tone: 'ok' });
                        await connector.reload();
                      } catch (e) {
                        setMessage({ text: e instanceof Error ? e.message : 'Could not disconnect.', tone: 'error' });
                      } finally {
                        setBusy(null);
                      }
                    },
                  },
                ])
              }
            />
          </>
        ) : (
          <Body>Not connected. In Claude: Settings → Connectors → Add custom connector → {connector.data?.url ?? 'https://rajkuthirhomestays.casa/mcp'}</Body>
        )}
      </Card>

      <Button label="Sign out of this phone" kind="danger" onPress={() => signOutPhone('', '', true)} busy={busy === 'signout'} />
      <Body muted style={{ marginTop: space(4), textAlign: 'center' }}>Raj Kuthir Owner · version 1.5.0</Body>
    </ScrollView>
  );
}
