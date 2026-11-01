import { useState } from 'react';
import { Linking, RefreshControl, ScrollView, View } from 'react-native';

import { getEnquiries, setEnquiryStatus, type Enquiry, type EnquiryStatus } from '../api';
import { followUpLink } from '../followUp';
import { color, rupees, shortDate, space, when } from '../theme';
import { Body, Button, Card, Chip, Heading, Notice, Row, Title } from '../ui';
import { useLoad } from '../useLoad';

const FILTERS: Array<{ key: 'open' | EnquiryStatus | 'all'; label: string }> = [
  { key: 'open', label: 'Open' },
  { key: 'converted', label: 'Booked' },
  { key: 'closed', label: 'Closed' },
  { key: 'all', label: 'All' },
];

const STATUS_LABEL: Record<EnquiryStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  converted: 'Booked',
  closed: 'Closed',
};

export default function Enquiries() {
  const list = useLoad(getEnquiries);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('open');
  const [error, setError] = useState<string | null>(null);

  const rows = (list.data?.enquiries ?? []).filter((e) =>
    filter === 'all' ? true : filter === 'open' ? e.status === 'new' || e.status === 'contacted' : e.status === filter,
  );

  const move = async (row: Enquiry, status: EnquiryStatus) => {
    try {
      await setEnquiryStatus(row.id, status);
      setError(null);
      await list.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update.');
    }
  };

  const followUp = async (row: Enquiry) => {
    await Linking.openURL(followUpLink(row));
    if (row.status === 'new') void move(row, 'contacted');
  };

  return (
    <ScrollView
      contentContainerStyle={{ padding: space(4), paddingBottom: space(10) }}
      refreshControl={<RefreshControl refreshing={list.loading} onRefresh={() => void list.reload()} />}
    >
      <Title>Enquiries</Title>
      <Row style={{ marginBottom: space(3) }}>
        {FILTERS.map((f) => (
          <Chip key={f.key} label={f.label} active={filter === f.key} onPress={() => setFilter(f.key)} />
        ))}
      </Row>
      {(list.error || error) && <Notice tone="error">{list.error ?? error}</Notice>}
      {!list.loading && rows.length === 0 && <Body muted>No enquiries here.</Body>}

      {rows.map((row) => {
        const guests = (row.adults ?? 0) + (row.children ?? 0);
        return (
          <Card key={row.id} tone={row.datesTaken ? 'warn' : undefined}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Heading>{row.name}</Heading>
              <Body muted>{STATUS_LABEL[row.status]}</Body>
            </Row>
            <Body>
              {row.checkIn ? `${shortDate(row.checkIn)} → ${shortDate(row.checkOut)}` : 'No dates'}
              {guests ? ` · ${guests} guest${guests === 1 ? '' : 's'}` : ''}
              {row.pets ? ` · ${row.pets} pet${row.pets === 1 ? '' : 's'}` : ''}
            </Body>
            <Body muted>Received {when(row.createdAt)}</Body>
            {row.requests ? <Body muted>“{row.requests}”</Body> : null}

            {row.datesTaken ? (
              <View style={{ marginTop: space(2) }}>
                <Body style={{ color: color.terracotta, fontWeight: '600' }}>
                  These dates are already taken ({row.datesTaken.label}, {shortDate(row.datesTaken.startDate)} → {shortDate(row.datesTaken.endDate)}).
                </Body>
              </View>
            ) : row.quote.ok ? (
              <Body style={{ marginTop: space(2), fontWeight: '600' }}>
                {rupees(row.quote.totalPaise)} total · {rupees(row.quote.advancePaise)} advance
              </Body>
            ) : (
              <Body muted style={{ marginTop: space(2) }}>No quote: {row.quote.reason}</Body>
            )}

            <Row style={{ marginTop: space(3) }}>
              <Button
                label={row.datesTaken ? 'Tell them dates are taken' : row.status === 'new' ? 'Reply on WhatsApp' : 'Follow up'}
                kind="whatsapp"
                onPress={() => void followUp(row)}
                style={{ flexGrow: 1 }}
              />
              <Button label="Call" kind="secondary" onPress={() => void Linking.openURL(`tel:${row.phone}`)} />
            </Row>
            {(row.status === 'new' || row.status === 'contacted') && (
              <Row style={{ marginTop: space(2) }}>
                {row.datesTaken && <Chip label="Mark booked" onPress={() => void move(row, 'converted')} />}
                <Chip label="Close" onPress={() => void move(row, 'closed')} />
              </Row>
            )}
          </Card>
        );
      })}
    </ScrollView>
  );
}
