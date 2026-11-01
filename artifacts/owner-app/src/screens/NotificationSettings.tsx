import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useEffect, useState } from 'react';
import { Linking, Switch, View } from 'react-native';

import { sendTestAlert, type OwnerEvent, type SettingsPatch, type SettingsView } from '../api';
import { pushStatus, registerForPush, type PushStatus } from '../push';
import { color, space } from '../theme';
import { Body, Button, Card, Heading, Row } from '../ui';

type Alerts = SettingsView['alerts'];

const DEFAULT_QUIET = { start: '22:00', end: '07:00' };

const toDate = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return d;
};
const toHhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const pretty = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return `${(h ?? 0) % 12 || 12}:${String(m ?? 0).padStart(2, '0')} ${(h ?? 0) < 12 ? 'AM' : 'PM'}`;
};

/**
 * Settings → Notifications: per-event push / email, quiet hours, a test
 * alert, and whether this phone can receive alerts at all. Nothing here is
 * sensitive, so no fingerprint is asked.
 */
export default function NotificationSettings({
  alerts,
  busy,
  save,
}: {
  alerts: Alerts;
  busy: string | null;
  save: (key: string, patch: SettingsPatch) => void;
}) {
  const [phone, setPhone] = useState<PushStatus>(pushStatus());
  const [picking, setPicking] = useState<'start' | 'end' | null>(null);
  const [test, setTest] = useState<{ text: string; ok: boolean } | null>(null);
  const [testing, setTesting] = useState(false);
  const quiet = alerts.quietHours;

  useEffect(() => {
    void registerForPush(false).then(setPhone);
  }, []);

  const pick = (which: 'start' | 'end') => (event: DateTimePickerEvent, date?: Date) => {
    setPicking(null);
    if (event.type !== 'set' || !date || !quiet) return;
    save('quiet', { quietHours: { ...quiet, [which]: toHhmm(date) } });
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      const result = await sendTestAlert();
      setTest({
        text: result.sent > 0 ? `Sent${result.quiet ? ' (quiet hours: it arrives without sound)' : ''}.` : 'Sent to the alert list, but no phone is registered for push yet.',
        ok: result.sent > 0,
      });
    } catch (e) {
      setTest({ text: e instanceof Error ? e.message : 'Could not send a test.', ok: false });
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      <Card>
        <Heading>Notifications</Heading>
        <Body muted style={{ marginBottom: space(2) }}>Choose what reaches this phone and what also goes to email.</Body>
        <Row style={{ justifyContent: 'flex-end', gap: space(6), paddingRight: space(1) }}>
          <Body muted>Push</Body>
          <Body muted>Email</Body>
        </Row>
        {alerts.events.map(({ event, label, description }) => (
          <Row key={event} style={{ justifyContent: 'space-between', paddingVertical: space(2), flexWrap: 'nowrap' }}>
            <View style={{ flex: 1, paddingRight: space(2) }}>
              <Body style={{ fontWeight: '600' }}>{label}</Body>
              <Body muted style={{ fontSize: 13 }}>{description}</Body>
            </View>
            <Switch
              value={alerts.push[event as OwnerEvent] ?? false}
              disabled={busy !== null}
              trackColor={{ true: color.brand, false: color.line }}
              onValueChange={(on) => save(`push-${event}`, { pushEvents: { [event]: on } })}
              accessibilityLabel={`Push: ${label}`}
            />
            <Switch
              value={alerts.email[event as OwnerEvent] ?? false}
              disabled={busy !== null}
              trackColor={{ true: color.brand, false: color.line }}
              onValueChange={(on) => save(`email-${event}`, { emailEvents: { [event]: on } })}
              accessibilityLabel={`Email: ${label}`}
            />
          </Row>
        ))}
      </Card>

      <Card>
        <Row style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
          <View style={{ flex: 1 }}>
            <Heading>Quiet hours</Heading>
            <Body muted>Alerts still arrive, without sound.</Body>
          </View>
          <Switch
            value={quiet !== null}
            disabled={busy !== null}
            trackColor={{ true: color.brand, false: color.line }}
            onValueChange={(on) => save('quiet', { quietHours: on ? DEFAULT_QUIET : null })}
            accessibilityLabel="Quiet hours"
          />
        </Row>
        {quiet && (
          <Row style={{ marginTop: space(3) }}>
            <Button label={`From ${pretty(quiet.start)}`} kind="secondary" onPress={() => setPicking('start')} />
            <Button label={`Until ${pretty(quiet.end)}`} kind="secondary" onPress={() => setPicking('end')} />
          </Row>
        )}
        {picking && quiet && (
          <DateTimePicker value={toDate(quiet[picking])} mode="time" display="default" onChange={pick(picking)} />
        )}
      </Card>

      <Card>
        <Heading>This phone</Heading>
        <Body>
          Notifications: {phone.permission === 'granted' ? 'allowed' : phone.permission === 'denied' ? 'turned off' : 'not asked yet'}
        </Body>
        <Body>Registered for alerts: {phone.registered ? 'yes' : 'no'}</Body>
        {phone.problem && <Body muted>{phone.problem}</Body>}
        <Row style={{ marginTop: space(3) }}>
          {!phone.registered && phone.permission !== 'denied' && (
            <Button label="Turn on alerts" onPress={() => void registerForPush(true).then(setPhone)} />
          )}
          {phone.permission === 'denied' && <Button label="Open Android settings" kind="secondary" onPress={() => void Linking.openSettings()} />}
          <Button label="Send a test notification" kind="secondary" busy={testing} onPress={() => void sendTest()} />
        </Row>
        {test && <Body style={{ marginTop: space(2), color: test.ok ? color.olive : color.terracotta }}>{test.text}</Body>}
      </Card>
    </>
  );
}
