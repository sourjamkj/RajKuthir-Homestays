import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';

import { getContacts, getEnquiries, getGuestStays, getInvoiceStatuses } from '../api';
import type { GuestsSection } from '../push';
import { space } from '../theme';
import { Chip, Notice, Row, Title } from '../ui';
import { useLoad } from '../useLoad';
import { ContactsSection } from './guests/ContactsSection';
import { EnquiriesSection } from './guests/EnquiriesSection';
import { StaysSection } from './guests/StaysSection';

/**
 * Guests: the web console's Guests page on the phone. Enquiries (with
 * quotes, holds, the advance and booking), Bookings (check-in readiness,
 * documents, guest messages, management handoff, invoices) and the Guest
 * list (who can be reached). Every action calls the same server routes as
 * the web page, so either can be used and both stay in step.
 */

const SECTIONS: Array<{ key: GuestsSection; label: string }> = [
  { key: 'enquiries', label: 'Enquiries' },
  { key: 'stays', label: 'Bookings' },
  { key: 'contacts', label: 'Guest list' },
];

export default function Guests({
  section,
  focus,
  onSection,
}: {
  section: GuestsSection;
  focus: string | null;
  onSection: (section: GuestsSection) => void;
}) {
  const enquiries = useLoad(getEnquiries);
  const stays = useLoad(getGuestStays);
  const contacts = useLoad(getContacts);
  const stayIds = (stays.data?.stays ?? []).map((s) => s.bookingId).join(',');
  const invoices = useLoad(useCallback(() => (stayIds ? getInvoiceStatuses(stayIds.split(',')) : Promise.resolve({ invoices: {} })), [stayIds]));
  const [message, setMessage] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);

  // Reload invoices once the stays (and so their ids) are known.
  useEffect(() => {
    if (stayIds) void invoices.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stayIds]);

  const scroller = useRef<ScrollView>(null);
  const sectionTop = useRef(0);
  const scrolledTo = useRef<string | null>(null);
  const [focused, setFocused] = useState<string | null>(focus);
  useEffect(() => {
    setFocused(focus);
    scrolledTo.current = null;
  }, [focus, section]);

  /** Cards report where they sit; the one an alert points at is scrolled to once. */
  const onPlaced = (id: string, y: number) => {
    if (focused === id && scrolledTo.current !== id) {
      scrolledTo.current = id;
      requestAnimationFrame(() => scroller.current?.scrollTo({ y: Math.max(0, sectionTop.current + y - space(3)), animated: true }));
    }
  };

  const reloadAll = () => {
    void enquiries.reload();
    void stays.reload();
    void contacts.reload();
    void invoices.reload();
  };

  const say = (text: string, tone: 'ok' | 'error' = 'ok') => setMessage({ text, tone });

  const newCount = (enquiries.data?.enquiries ?? []).filter((e) => e.status === 'new').length;
  const reachable = (contacts.data?.contacts ?? []).filter((c) => !c.marketingOptOut).length;
  const loading = enquiries.loading || stays.loading || contacts.loading;

  return (
    <ScrollView
      ref={scroller}
      contentContainerStyle={{ padding: space(4), paddingBottom: space(10) }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={reloadAll} />}
      keyboardShouldPersistTaps="handled"
    >
      <Title>Guests</Title>
      <Row style={{ marginBottom: space(3) }}>
        {SECTIONS.map((s) => (
          <Chip
            key={s.key}
            label={s.key === 'enquiries' && newCount ? `${s.label} · ${newCount} new` : s.key === 'contacts' && contacts.data ? `${s.label} · ${reachable}` : s.label}
            active={section === s.key}
            onPress={() => {
              setMessage(null);
              onSection(s.key);
            }}
          />
        ))}
      </Row>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <View onLayout={(e) => (sectionTop.current = e.nativeEvent.layout.y)}>
        {section === 'enquiries' && (
          <EnquiriesSection
            load={enquiries}
            focused={focused}
            onPlaced={onPlaced}
            say={say}
            onBooked={() => {
              void enquiries.reload();
              void stays.reload();
              void contacts.reload();
            }}
          />
        )}
        {section === 'stays' && (
          <StaysSection
            load={stays}
            invoices={invoices.data?.invoices ?? {}}
            reloadInvoices={() => void invoices.reload()}
            focused={focused}
            onPlaced={onPlaced}
            say={say}
          />
        )}
        {section === 'contacts' && (
          <ContactsSection load={contacts} stays={stays.data?.stays ?? null} staysFailed={Boolean(stays.error)} say={say} />
        )}
      </View>
    </ScrollView>
  );
}
