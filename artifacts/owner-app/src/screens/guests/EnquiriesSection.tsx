import { useState } from 'react';
import { Alert, Linking, View } from 'react-native';

import {
  convertEnquiry,
  createEnquiry,
  deleteEnquiry,
  sendQuote,
  setAdvanceReceived,
  setEnquiryStatus,
  updateEnquiry,
  withdrawQuote,
  type Enquiry,
  type EnquiryStatus,
  type HoldState,
} from '../../api';
import { followUpLink } from '../../followUp';
import { helloText, waUrl } from '../../guestMessages';
import { color, longDate, rupees, shortDate, space, when } from '../../theme';
import { Body, Button, Card, Field, Heading, Notice, Row } from '../../ui';
import { BookForm } from './BookForm';
import { DetailsForm, detailsOf, EMPTY_DETAILS } from './DetailsForm';
import { errorText, Pill, Placed, SmallButton, Small, type Loaded, type Say } from './shared';

const STATUSES: EnquiryStatus[] = ['new', 'contacted', 'converted', 'closed'];
const STATUS_TONE: Record<EnquiryStatus, 'brand' | 'warn' | 'ok' | 'plain'> = {
  new: 'brand',
  contacted: 'warn',
  converted: 'ok',
  closed: 'plain',
};

/** Per card: what the last quote send did, for the "Didn't send it? Undo" line. */
type QuoteOutcome = { delivery: 'api' | 'manual_whatsapp'; opened: boolean; whatsappUrl: string | null };

export function EnquiriesSection({
  load,
  focused,
  onPlaced,
  say,
  onBooked,
}: {
  load: Loaded<{ enquiries: Enquiry[]; quotingReady?: boolean }>;
  focused: string | null;
  onPlaced: (id: string, y: number) => void;
  say: Say;
  onBooked: () => void;
}) {
  const rows = load.data?.enquiries ?? [];
  const quotingReady = load.data?.quotingReady ?? false;
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [quoted, setQuoted] = useState<Record<string, QuoteOutcome>>({});
  const [booked, setBooked] = useState<Record<string, string>>({});

  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addedClash, setAddedClash] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  /** Runs one card's action, keeping its error on that card. */
  const act = async (id: string, key: string, fn: () => Promise<void>, fallback: string) => {
    setBusy(`${key}:${id}`);
    setErrors((e) => ({ ...e, [id]: '' }));
    try {
      await fn();
      await load.reload();
    } catch (e) {
      setErrors((current) => ({ ...current, [id]: errorText(e, fallback) }));
    } finally {
      setBusy(null);
    }
  };

  const add = async (values: typeof EMPTY_DETAILS) => {
    setBusy('add');
    setAddError(null);
    try {
      const result = await createEnquiry(values);
      const taken = result?.datesTaken;
      setAddedClash(
        taken
          ? `Saved — but ${shortDate(taken.startDate)} → ${longDate(taken.endDate)} is already taken (${taken.label}). If this is the guest who booked, mark the enquiry Converted.`
          : null,
      );
      setAdding(false);
      if (!taken) say('Enquiry added.');
      await load.reload();
    } catch (e) {
      setAddError(errorText(e, 'Could not add the enquiry.'));
    } finally {
      setBusy(null);
    }
  };

  const quote = (row: Enquiry) =>
    act(
      row.id,
      'quote',
      async () => {
        const result = await sendQuote(row.id);
        let opened = true;
        if (result.delivery === 'manual_whatsapp' && result.whatsappUrl) {
          opened = await Linking.openURL(result.whatsappUrl).then(
            () => true,
            () => false,
          );
        }
        setQuoted((q) => ({ ...q, [row.id]: { delivery: result.delivery, opened, whatsappUrl: result.whatsappUrl } }));
      },
      'The quote could not be sent.',
    );

  const remove = (row: Enquiry) =>
    Alert.alert('Delete this enquiry?', `${row.name} · ${row.phone}`, [
      { text: 'Keep', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void act(row.id, 'delete', () => deleteEnquiry(row.id), 'Could not delete.') },
    ]);

  const followUp = async (row: Enquiry) => {
    await Linking.openURL(followUpLink(row));
    // Sending the first follow-up is what "contacted" means.
    if (row.status === 'new') void act(row.id, 'status', async () => void (await setEnquiryStatus(row.id, 'contacted')), 'Could not update.');
  };

  return (
    <>
      <Row style={{ justifyContent: 'space-between', marginBottom: space(3) }}>
        <Heading>Enquiries</Heading>
        <Button label={adding ? 'Cancel' : 'Add enquiry'} kind="secondary" onPress={() => setAdding(!adding)} />
      </Row>

      {adding && (
        <Card>
          <DetailsForm initial={EMPTY_DETAILS} submitLabel="Save" busy={busy === 'add'} error={addError} onSubmit={(values) => void add(values)} />
        </Card>
      )}

      {addedClash && <Notice tone="error">{addedClash}</Notice>}
      {load.error && <Notice tone="error">{load.error}</Notice>}
      {!load.loading && !load.error && rows.length === 0 && (
        <Card>
          <Body muted>No enquiries yet. They'll appear here the moment someone uses the form.</Body>
        </Card>
      )}

      {rows.map((row) => (
        <Placed key={row.id} id={row.id} onPlaced={onPlaced} focused={focused === row.id}>
          <Card tone={row.datesTaken ? 'warn' : undefined}>
            <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Row>
                  <Heading>{row.name}</Heading>
                  <Pill label={row.status} tone={STATUS_TONE[row.status]} />
                  {row.returningGuest && <Pill label="Returning" tone="ok" />}
                </Row>
                <Small>
                  {row.checkIn && row.checkOut ? `${shortDate(row.checkIn)} → ${longDate(row.checkOut)}` : 'No dates given'}
                  {row.adults !== null
                    ? ` · ${row.adults} adult${row.adults === 1 ? '' : 's'}${row.children ? `, ${row.children} children` : ''}${row.pets ? `, ${row.pets} pets` : ''}`
                    : ''}
                  {` · received ${when(row.createdAt)}`}
                </Small>
                {row.requests ? <Body style={{ marginTop: space(2) }}>“{row.requests}”</Body> : null}
                {row.childrenAges ? <Small>Children's ages: {row.childrenAges}</Small> : null}
                {row.ownerNote ? <Small>Note: {row.ownerNote}</Small> : null}
              </View>
            </Row>
            <Row style={{ marginTop: space(2) }}>
              <SmallButton label="Call" onPress={() => void Linking.openURL(`tel:${row.phone}`)} />
              <SmallButton label="WhatsApp" onPress={() => void Linking.openURL(waUrl(row.phone, helloText(row.name)))} />
              <SmallButton label={editing === row.id ? 'Close' : 'Edit details & price'} onPress={() => setEditing(editing === row.id ? null : row.id)} />
              <SmallButton label="Delete" tone="danger" onPress={() => remove(row)} disabled={busy === `delete:${row.id}`} />
            </Row>
            {editing === row.id && (
              <View style={{ marginTop: space(3), paddingTop: space(3), borderTopWidth: 1, borderTopColor: color.line }}>
                <DetailsForm
                  initial={detailsOf(row)}
                  submitLabel="Save changes"
                  busy={busy === `edit:${row.id}`}
                  error={errors[row.id] || null}
                  onSubmit={(values) =>
                    void act(
                      row.id,
                      'edit',
                      async () => {
                        await updateEnquiry(row.id, values);
                        setEditing(null);
                        say(`${values.name}'s enquiry saved.`);
                      },
                      'Could not save the changes.',
                    )
                  }
                />
              </View>
            )}

            {/* The price, and the button that sends it. */}
            <View style={{ marginTop: space(3), paddingTop: space(3), borderTopWidth: 1, borderTopColor: color.line }}>
              {row.datesTaken ? (
                <View style={{ borderWidth: 1, borderColor: '#dcb3a5', backgroundColor: '#f8ece7', borderRadius: 12, padding: space(3) }}>
                  <Body style={{ color: '#7a3f2c', fontWeight: '600' }}>
                    These dates are already taken ({row.datesTaken.label}, {shortDate(row.datesTaken.startDate)} → {longDate(row.datesTaken.endDate)}).
                  </Body>
                  <Body style={{ color: '#7a3f2c', marginTop: space(1) }}>
                    No quote or booking is offered for them. If this is the guest who already booked, mark it Converted. Otherwise, offer other dates or mark it Closed.
                  </Body>
                </View>
              ) : row.quote.ok ? (
                <View>
                  <Small>
                    {row.quote.nights} night{row.quote.nights === 1 ? '' : 's'}
                    {row.quote.guests ? ` · ${row.quote.guests} guest${row.quote.guests === 1 ? '' : 's'}` : ''}
                    {row.quote.agreed ? ' · your agreed price' : ''}
                  </Small>
                  {row.quote.agreed && row.quote.priceNote ? <Small>{row.quote.priceNote}</Small> : null}
                  <Body style={{ marginTop: space(1) }}>
                    <Body style={{ fontWeight: '700' }}>{rupees(row.quote.totalPaise)}</Body> total
                    <Body muted> · {rupees(row.quote.advancePaise)} advance</Body>
                  </Body>
                  {row.quoteSentAt ? (
                    <View style={{ marginTop: space(2) }}>
                      {row.hold && <HoldBadge hold={row.hold} />}
                      <Row style={{ marginTop: space(2) }}>
                        <SmallButton label="Re-send quote" onPress={() => void quote(row)} disabled={busy === `quote:${row.id}` || !quotingReady} />
                        <SmallButton
                          label={row.hold?.state === 'paid' ? 'Not received after all' : 'Advance received'}
                          tone={row.hold?.state === 'paid' ? 'plain' : 'primary'}
                          disabled={busy === `advance:${row.id}`}
                          onPress={() =>
                            void act(row.id, 'advance', async () => void (await setAdvanceReceived(row.id, row.hold?.state !== 'paid')), 'Could not update.')
                          }
                        />
                        {row.convertedBookingId ? (
                          <Pill label="✓ Booked" tone="ok" />
                        ) : (
                          <SmallButton
                            label="Create booking"
                            disabled={busy === `convert:${row.id}`}
                            onPress={() =>
                              void act(
                                row.id,
                                'convert',
                                async () => {
                                  const result = await convertEnquiry(row.id);
                                  setBooked((b) => ({
                                    ...b,
                                    [row.id]: `Booking created${result.booking.reference ? ` · ${result.booking.reference}` : ''}${result.booking.status === 'pending' ? ' · pending, so it is not holding the dates yet' : ''}. It is now in Bookings, ready for the verification WhatsApp.`,
                                  }));
                                  onBooked();
                                },
                                'The booking could not be created.',
                              )
                            }
                          />
                        )}
                      </Row>
                    </View>
                  ) : (
                    <View style={{ marginTop: space(2) }}>
                      <Button label="Send quote" onPress={() => void quote(row)} busy={busy === `quote:${row.id}`} disabled={!quotingReady} />
                      {!quotingReady && (
                        <Small>The UPI ID and name are not set on the server, so there are no payment details to put in the quote.</Small>
                      )}
                    </View>
                  )}
                </View>
              ) : (
                <Small>No quote — {row.quote.reason}</Small>
              )}

              {errors[row.id] ? <Small tone="bad">{errors[row.id]}</Small> : null}
              {booked[row.id] ? <Small tone="ok">{booked[row.id]}</Small> : null}

              {quoted[row.id]?.delivery === 'manual_whatsapp' && !quoted[row.id]!.opened && (
                <View style={{ marginTop: space(2) }}>
                  <Small tone="bad">WhatsApp did not open, so nothing was sent.</Small>
                  {quoted[row.id]!.whatsappUrl && (
                    <SmallButton label="Open WhatsApp with the quote" tone="whatsapp" onPress={() => void Linking.openURL(quoted[row.id]!.whatsappUrl!)} />
                  )}
                </View>
              )}
              {quoted[row.id]?.delivery === 'manual_whatsapp' && quoted[row.id]!.opened && (
                <View style={{ marginTop: space(2) }}>
                  <Small>WhatsApp opened with the quote. Send it there — the hold on these dates started just now.</Small>
                  <SmallButton
                    label="Didn't send it? Undo"
                    disabled={busy === `withdraw:${row.id}`}
                    onPress={() =>
                      void act(
                        row.id,
                        'withdraw',
                        async () => {
                          await withdrawQuote(row.id);
                          setQuoted((q) => {
                            const next = { ...q };
                            delete next[row.id];
                            return next;
                          });
                        },
                        'Could not undo.',
                      )
                    }
                  />
                </View>
              )}

              {!row.convertedBookingId && !row.datesTaken && (
                <BookForm
                  row={row}
                  onBooked={(reference) => {
                    say(`Booking created${reference ? ` · ${reference}` : ''}. It is now in Bookings.`);
                    onBooked();
                  }}
                />
              )}
            </View>

            <View style={{ marginTop: space(3), paddingTop: space(3), borderTopWidth: 1, borderTopColor: color.line }}>
              <Small>{row.phone}</Small>
              {(row.status === 'new' || row.status === 'contacted') && (
                <Button
                  label={row.datesTaken ? 'Tell them dates are taken' : row.status === 'new' ? 'Reply on WhatsApp' : 'Follow up'}
                  kind="whatsapp"
                  onPress={() => void followUp(row)}
                  style={{ marginTop: space(2) }}
                />
              )}
              <Row style={{ marginTop: space(2) }}>
                {STATUSES.map((status) => (
                  <SmallButton
                    key={status}
                    label={status[0]!.toUpperCase() + status.slice(1)}
                    tone={row.status === status ? 'primary' : 'plain'}
                    disabled={busy === `status:${row.id}`}
                    onPress={() => {
                      if (row.status !== status) void act(row.id, 'status', async () => void (await setEnquiryStatus(row.id, status)), 'Could not update.');
                    }}
                  />
                ))}
              </Row>
            </View>
          </Card>
        </Placed>
      ))}
    </>
  );
}

function HoldBadge({ hold }: { hold: HoldState }) {
  if (hold.state === 'paid') return <Small tone="ok">⏱ Advance received {shortDate(hold.paidAt.slice(0, 10))}</Small>;
  if (hold.state === 'held') return <Small>⏱ Held · {hold.hoursLeft}h left (releases {when(hold.expiresAt)})</Small>;
  if (hold.state === 'released') return <Small tone="bad">⏱ Released — dates back on sale</Small>;
  return null;
}
