import { useState } from 'react';
import { Linking, View } from 'react-native';

import { createOnboarding, getArrivalInfo, setMarketingOptOut, type ArrivalInfo, type Contact, type GuestStay } from '../../api';
import { buildCheckinWhatsAppMessage, buildGuestWhatsAppMessage, helloText, waUrl } from '../../guestMessages';
import { longDate, rupees, shortDate, space } from '../../theme';
import { Body, Card, Heading, Notice, Row } from '../../ui';
import { errorText, SmallButton, Small, type Loaded, type Say } from './shared';

/**
 * The guest list, as on the web: built from bookings and enquiries, matched
 * on phone number, with who has opted out of offers. WhatsApp sends the
 * booking confirmation with the verification link (or the check-in details
 * once verified) when the guest has a stay, and a plain hello otherwise.
 */
export function ContactsSection({
  load,
  stays,
  staysFailed,
  say,
}: {
  load: Loaded<{ contacts: Contact[] }>;
  stays: GuestStay[] | null;
  staysFailed: boolean;
  say: Say;
}) {
  const list = load.data?.contacts ?? [];
  const reachable = list.filter((c) => !c.marketingOptOut).length;
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<void>, fallback: string) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      say(errorText(e, fallback), 'error');
    } finally {
      setBusy(null);
    }
  };

  const message = async (stay: GuestStay, ready: boolean) => {
    if (!stay.guestPhone) return;
    if (ready) {
      let info: ArrivalInfo | null = null;
      try {
        info = await getArrivalInfo();
      } catch {
        info = null;
      }
      await Linking.openURL(waUrl(stay.guestPhone, buildCheckinWhatsAppMessage(stay, info)));
      say('Check-in message opened. Attach the house rules PDF from Bookings before sending.');
    } else {
      const result = await createOnboarding(stay.bookingId);
      await Linking.openURL(waUrl(stay.guestPhone, buildGuestWhatsAppMessage(stay, result.url)));
    }
  };

  return (
    <>
      <Heading>Guest list · {reachable} reachable</Heading>
      <Body muted style={{ marginBottom: space(3) }}>
        Built automatically from bookings and enquiries, matched on phone number. Use it for follow-ups and offers.
      </Body>
      <Card>
        <Small>
          🔕 Mark anyone who asks as opted out and they'll be excluded from the reachable count. Worth honouring properly — unsolicited marketing messages are
          regulated in India, and one complaint is more expensive than a hundred sends are worth.
        </Small>
      </Card>

      {load.error && <Notice tone="error">{load.error}</Notice>}
      {load.loading && !load.data && <Body muted>Loading…</Body>}
      {!load.loading && !load.error && list.length === 0 && <Body muted>No contacts yet. They build up as bookings and enquiries arrive.</Body>}

      {list.map((contact) => {
        const digits = contact.phone.replace(/\D/g, '');
        const matching = (stays ?? []).filter((s) => s.guestPhone?.replace(/\D/g, '') === digits);
        const stay = matching.find((s) => s.status !== 'cancelled') ?? matching[0];
        const ready = Boolean(stay && stay.onboardingStatus === 'verified' && stay.documents.rejected === 0);
        return (
          <Card key={contact.phone}>
            <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Heading>{contact.name ?? '—'}</Heading>
                <Small>{contact.phone}</Small>
              </View>
              <SmallButton
                label={contact.marketingOptOut ? 'Opted out' : 'Reachable'}
                tone={contact.marketingOptOut ? 'danger' : 'plain'}
                disabled={busy === `optout:${contact.phone}`}
                onPress={() =>
                  void run(`optout:${contact.phone}`, async () => {
                    await setMarketingOptOut(contact.phone, !contact.marketingOptOut);
                    await load.reload();
                  }, 'Could not update.')
                }
              />
            </Row>
            <Small>
              {contact.stays} stay{contact.stays === 1 ? '' : 's'}
              {contact.enquiryCount > 0 ? ` (+${contact.enquiryCount} enq)` : ''} · spent {rupees(contact.totalSpentPaise)} · last seen{' '}
              {contact.lastStay ? longDate(contact.lastStay) : contact.lastEnquiry ? `enq ${shortDate(contact.lastEnquiry)}` : '—'}
            </Small>
            <Row style={{ marginTop: space(2) }}>
              {stay ? (
                <SmallButton
                  label={ready ? 'Check-in WhatsApp' : 'WhatsApp'}
                  tone="whatsapp"
                  disabled={busy === `wa:${contact.phone}` || !stay.guestPhone}
                  onPress={() => void run(`wa:${contact.phone}`, () => message(stay, ready), 'Could not prepare WhatsApp.')}
                />
              ) : staysFailed ? (
                // Without the stays we cannot tell whether this guest has a
                // booking, and the generic hello would leave out the
                // mandatory verification link. Refuse instead.
                <SmallButton label="Unavailable" tone="danger" disabled onPress={() => undefined} />
              ) : (
                <SmallButton label="WhatsApp" onPress={() => void Linking.openURL(waUrl(contact.phone, helloText(contact.name)))} />
              )}
              <SmallButton label="Call" onPress={() => void Linking.openURL(`tel:${contact.phone}`)} />
            </Row>
            {stay === undefined && staysFailed && <Small tone="bad">Bookings could not be loaded, so the verification link cannot be attached.</Small>}
            {contact.tags ? <Small>Tags: {contact.tags}</Small> : null}
            {contact.note ? <Small>Note: {contact.note}</Small> : null}
          </Card>
        );
      })}
    </>
  );
}
