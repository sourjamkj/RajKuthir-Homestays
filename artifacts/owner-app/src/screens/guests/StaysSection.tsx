import { useState } from 'react';
import { Linking, Pressable, TextInput, View } from 'react-native';

import {
  createOnboarding,
  documentFilePath,
  getArrivalInfo,
  getManagementAccess,
  getStayDocuments,
  rejectDocuments,
  SOURCE_LABELS,
  updateBooking,
  verifyDocuments,
  type ArrivalInfo,
  type GuestDocument,
  type GuestStay,
  type InvoiceStatus,
} from '../../api';
import { DateField } from '../../DateField';
import { shareAdminFile } from '../../files';
import {
  buildCheckinWhatsAppMessage,
  buildGuestWhatsAppMessage,
  buildDocumentsRejectedMessage,
  buildGuestIdsRejectedMessage,
  COMMON_REJECTION_REASONS,
  groupByGuest,
  idTypeLabel,
  buildManagementMessage,
  buildReviewMessage,
  canAskForReview,
  HOUSE_RULES_PDF,
  MANAGEMENT_WHATSAPP,
  managementSubject,
  sortStays,
  STAY_SORTS,
  waUrl,
  type StaySortKey,
} from '../../guestMessages';
import { color, longDate, shortDate, space, when } from '../../theme';
import { Body, Button, Card, Chip, Field, Heading, Notice, Row } from '../../ui';
import { errorText, Pill, Placed, SmallButton, Small, type Loaded, type Say } from './shared';
import { StayInvoice } from './StayInvoice';

const VERIFIED_ON_UPLOAD = 'auto:on-upload';

type Details = { guestName: string; guestPhone: string; guests: string; pets: string; checkIn: string; checkOut: string; gross: string; received: string };

/**
 * Guest check-in readiness, as on the web: pre-arrival verification,
 * documents, the guest's WhatsApp messages and the management handoff.
 * Management messages never contain pricing or payment information.
 */
export function StaysSection({
  load,
  invoices,
  reloadInvoices,
  focused,
  onPlaced,
  say,
}: {
  load: Loaded<{ stays: GuestStay[] }>;
  invoices: Record<string, InvoiceStatus>;
  reloadInvoices: () => void;
  focused: string | null;
  onPlaced: (id: string, y: number) => void;
  say: Say;
}) {
  const [order, setOrder] = useState<{ key: StaySortKey; dir: 'asc' | 'desc' }>({ key: 'stay', dir: 'asc' });
  const stays = sortStays(load.data?.stays ?? [], order.key, order.dir);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [attachHint, setAttachHint] = useState<string | null>(null);

  const [editing, setEditing] = useState<string | null>(null);
  const [details, setDetails] = useState<Details>({ guestName: '', guestPhone: '', guests: '', pets: '', checkIn: '', checkOut: '', gross: '', received: '' });

  const [openDocs, setOpenDocs] = useState<string | null>(null);
  const [docs, setDocs] = useState<{ loading: boolean; error: string | null; list: GuestDocument[] }>({ loading: false, error: null, list: [] });
  const [rejectReason, setRejectReason] = useState<Record<string, string>>({});

  const sortBy = (key: StaySortKey) =>
    setOrder((current) =>
      current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: STAY_SORTS.find((s) => s.key === key)!.first },
    );

  const act = async (id: string, key: string, fn: () => Promise<void>, fallback: string) => {
    setBusy(`${key}:${id}`);
    setErrors((e) => ({ ...e, [id]: '' }));
    try {
      await fn();
    } catch (e) {
      setErrors((current) => ({ ...current, [id]: errorText(e, fallback) }));
    } finally {
      setBusy(null);
    }
  };

  /** The booking confirmation with the document-verification link. */
  const sendVerification = async (stay: GuestStay) => {
    if (!stay.guestPhone) throw new Error('This booking has no guest mobile number.');
    const result = await createOnboarding(stay.bookingId);
    await Linking.openURL(waUrl(stay.guestPhone, buildGuestWhatsAppMessage(stay, result.url)));
    await load.reload();
  };

  /** Once verification is done: everything in the message, plus the house rules PDF to attach. */
  const sendCheckin = async (stay: GuestStay) => {
    if (!stay.guestPhone) return;
    let info: ArrivalInfo | null = null;
    try {
      info = await getArrivalInfo();
    } catch {
      info = null; // still send: it falls back to the host and caretaker numbers
    }
    await Linking.openURL(waUrl(stay.guestPhone, buildCheckinWhatsAppMessage(stay, info)));
    setAttachHint(stay.bookingId);
  };

  const management = async (stay: GuestStay, how: 'whatsapp' | 'email' | 'both') => {
    const result = await getManagementAccess(stay.bookingId);
    const text = buildManagementMessage(result.management, result.url);
    if (how !== 'email') await Linking.openURL(`https://wa.me/${MANAGEMENT_WHATSAPP}?text=${encodeURIComponent(text)}`);
    if (how !== 'whatsapp') {
      await Linking.openURL(`mailto:?subject=${encodeURIComponent(managementSubject(result.management))}&body=${encodeURIComponent(text)}`);
    }
  };

  const toggleDocs = async (stay: GuestStay) => {
    if (openDocs === stay.bookingId) {
      setOpenDocs(null);
      return;
    }
    setOpenDocs(stay.bookingId);
    setDocs({ loading: true, error: null, list: [] });
    try {
      const result = await getStayDocuments(stay.bookingId);
      setDocs({ loading: false, error: null, list: result.documents });
    } catch (e) {
      setDocs({ loading: false, error: errorText(e, 'Could not load the documents.'), list: [] });
    }
  };

  /**
   * Reject one guest's ID (or an earlier ungrouped upload), then send a fresh
   * link with a WhatsApp naming exactly who must re-upload and why. The other
   * guests stay accepted.
   */
  const rejectAndResend = async (stay: GuestStay, slot: number | null) => {
    const key = `${stay.bookingId}:${slot ?? 'all'}`;
    const reason = (rejectReason[key] ?? '').trim();
    if (!stay.guestPhone) throw new Error('This booking has no guest mobile number.');
    await rejectDocuments(stay.bookingId, reason, slot);
    setRejectReason((r) => ({ ...r, [key]: '' }));
    const link = await createOnboarding(stay.bookingId);
    const result = await getStayDocuments(stay.bookingId);
    let text: string;
    if (slot === null) {
      text = buildDocumentsRejectedMessage(stay, reason, link.url, link.verificationDeadline);
    } else {
      const groups = groupByGuest(result.documents).filter((g) => g.slot !== null);
      text = buildGuestIdsRejectedMessage(
        stay,
        groups.filter((g) => g.rejected).map((g) => ({ slot: g.slot!, name: g.name ?? `Guest ${g.slot}`, reason: g.reason ?? reason })),
        groups.filter((g) => !g.rejected).map((g) => g.name ?? `Guest ${g.slot}`),
        link.url,
        link.verificationDeadline,
      );
    }
    await Linking.openURL(waUrl(stay.guestPhone, text));
    await load.reload();
    setDocs({ loading: false, error: null, list: result.documents });
  };

  const startEditing = (stay: GuestStay) => {
    setDetails({
      guestName: stay.guestName ?? '',
      guestPhone: stay.guestPhone ?? '',
      guests: stay.guests === null ? '' : String(stay.guests),
      pets: stay.pets === null ? '' : String(stay.pets),
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      gross: stay.grossPaise === null ? '' : String(stay.grossPaise / 100),
      received: stay.receivedPaise === null ? '' : String(stay.receivedPaise / 100),
    });
    setEditing(stay.bookingId);
  };

  const saveDetails = (stay: GuestStay) =>
    act(
      stay.bookingId,
      'save',
      async () => {
        await updateBooking(stay.bookingId, {
          guestName: details.guestName,
          guestPhone: details.guestPhone,
          guests: details.guests,
          pets: details.pets,
          checkIn: details.checkIn,
          checkOut: details.checkOut,
          // An amount left empty is left as it was, never cleared.
          ...(details.gross.trim() ? { gross: details.gross } : {}),
          ...(details.received.trim() ? { received: details.received } : {}),
        });
        setEditing(null);
        say('Guest details saved.');
        await load.reload();
        reloadInvoices();
      },
      'Could not save the guest details.',
    );

  const num = (v: string) => v.replace(/[^\d.]/g, '');

  return (
    <>
      <Heading>Guest check-in readiness</Heading>
      <Body muted style={{ marginBottom: space(3) }}>
        Pre-arrival verification, document status, guest confirmation and management handoff. Management messages never contain pricing or payment information.
      </Body>
      <Row style={{ marginBottom: space(3) }}>
        {STAY_SORTS.map((s) => (
          <Chip
            key={s.key}
            label={`${s.label}${order.key === s.key ? (order.dir === 'asc' ? ' ↑' : ' ↓') : ''}`}
            active={order.key === s.key}
            onPress={() => sortBy(s.key)}
          />
        ))}
      </Row>

      {load.loading && !load.data && <Body muted>Loading guest stays…</Body>}
      {!load.loading && load.error && (
        <Card tone="warn">
          <Body style={{ color: color.terracotta, fontWeight: '600' }}>Could not load guest stays.</Body>
          <Small>{load.error}</Small>
          <Small>This is not the same as having no bookings — the readiness list is unavailable, so the WhatsApp actions cannot attach a verification link.</Small>
          <View style={{ marginTop: space(2) }}>
            <SmallButton label="Try again" onPress={() => void load.reload()} />
          </View>
        </Card>
      )}
      {!load.loading && !load.error && stays.length === 0 && <Body muted>No bookings yet.</Body>}

      {stays.map((stay) => {
        const verified = stay.onboardingStatus === 'verified';
        const submitted = stay.onboardingStatus === 'submitted';
        const deadline = stay.verificationDeadline ? new Date(stay.verificationDeadline) : null;
        const deadlinePassed = Boolean(deadline && deadline.getTime() <= Date.now() && !verified);
        const filed = stay.documents.verified + stay.documents.submitted + stay.documents.rejected + stay.documents.pending;
        const readyForCheckin = verified && stay.documents.rejected === 0;
        const id = stay.bookingId;
        const docsOpen = openDocs === id;

        return (
          <Placed key={id} id={id} onPlaced={onPlaced} focused={focused === id}>
            <Card>
              <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Heading>{stay.guestName ?? 'Unnamed guest'}</Heading>
                  <Small>{stay.reference ?? 'No Raj Kuthir reference'}</Small>
                </View>
                {stay.status === 'cancelled' && <Pill label="Cancelled" />}
              </Row>
              <Row style={{ marginTop: space(1) }}>
                {stay.guestPhone ? <Small>{stay.guestPhone}</Small> : <Pill label="No phone" tone="bad" />}
                <SmallButton label={editing === id ? 'Close' : 'Edit details'} onPress={() => (editing === id ? setEditing(null) : startEditing(stay))} />
              </Row>

              <Body style={{ marginTop: space(2) }}>
                {shortDate(stay.checkIn)} → {longDate(stay.checkOut)}
              </Body>
              <Small>
                {stay.guests ?? '—'} guests{stay.pets ? ` · ${stay.pets} pet${stay.pets === 1 ? '' : 's'}` : ''} · booked {longDate(stay.createdAt.slice(0, 10))} · {SOURCE_LABELS[stay.source] ?? stay.source}
              </Small>

              <Row style={{ marginTop: space(2) }}>
                <Pill
                  label={verified ? 'Verified' : deadlinePassed ? 'Deadline passed' : submitted ? 'Awaiting verification' : 'Not submitted'}
                  tone={verified ? 'ok' : deadlinePassed ? 'bad' : submitted ? 'warn' : 'plain'}
                />
                {deadline && !verified && <Small>Deadline {when(stay.verificationDeadline!)}</Small>}
              </Row>
              <Small>
                {stay.documents.verified} verified · {stay.documents.submitted} submitted · {stay.documents.rejected} rejected
                {stay.guestsListed != null && stay.guests != null && stay.guestsListed !== stay.guests ? ` · ${stay.guestsListed} IDs for ${stay.guests} booked` : ''}
              </Small>

              <StayInvoice bookingId={id} status={invoices[id]} onChanged={() => { reloadInvoices(); void load.reload(); }} />

              <Row style={{ marginTop: space(3) }}>
                {filed > 0 && <SmallButton label={`${docsOpen ? 'Hide' : 'View'} ${filed} file${filed === 1 ? '' : 's'}`} onPress={() => void toggleDocs(stay)} />}
                {submitted && !verified && (
                  <SmallButton
                    label="Verify"
                    disabled={busy === `verify:${id}`}
                    onPress={() =>
                      void act(id, 'verify', async () => {
                        await verifyDocuments(id, true);
                        await load.reload();
                      }, 'Could not verify.')
                    }
                  />
                )}
              </Row>
              {readyForCheckin ? (
                <Button
                  label="Check-in WhatsApp"
                  kind="whatsapp"
                  disabled={!stay.guestPhone}
                  onPress={() => void act(id, 'checkin', () => sendCheckin(stay), 'Could not prepare WhatsApp.')}
                  style={{ marginTop: space(2) }}
                />
              ) : (
                <Button
                  label="Verification WhatsApp"
                  kind="whatsapp"
                  busy={busy === `verification:${id}`}
                  disabled={!stay.guestPhone}
                  onPress={() => void act(id, 'verification', () => sendVerification(stay), 'Could not prepare WhatsApp.')}
                  style={{ marginTop: space(2) }}
                />
              )}
              <Row style={{ marginTop: space(2) }}>
                <SmallButton label="Mgmt WA" disabled={busy === `mgmt:${id}`} onPress={() => void act(id, 'mgmt', () => management(stay, 'whatsapp'), 'Could not prepare management WhatsApp.')} />
                <SmallButton label="Mgmt Email" disabled={busy === `mgmt:${id}`} onPress={() => void act(id, 'mgmt', () => management(stay, 'email'), 'Could not prepare management email.')} />
                <SmallButton label="Both" disabled={busy === `mgmt:${id}`} onPress={() => void act(id, 'mgmt', () => management(stay, 'both'), 'Could not prepare management message.')} />
                {canAskForReview(stay) && (
                  <SmallButton
                    label="★ Ask for review"
                    disabled={!stay.guestPhone}
                    onPress={() => stay.guestPhone && void Linking.openURL(waUrl(stay.guestPhone, buildReviewMessage(stay)))}
                  />
                )}
              </Row>
              {errors[id] ? <Small tone="bad">{errors[id]}</Small> : null}
              {attachHint === id && (
                <View style={{ marginTop: space(2) }}>
                  <Small>Attach the house rules PDF in the WhatsApp chat before sending: tap below and pick WhatsApp.</Small>
                  <SmallButton
                    label="Send house rules PDF"
                    onPress={() =>
                      void act(id, 'rules', () => shareAdminFile(HOUSE_RULES_PDF.replace('https://rajkuthirhomestays.casa', ''), 'raj-kuthir-house-rules.pdf'), 'Could not open the house rules PDF.')
                    }
                  />
                </View>
              )}

              {editing === id && (
                <View style={{ marginTop: space(3), paddingTop: space(3), borderTopWidth: 1, borderTopColor: color.line }}>
                  <Field label="Guest name" value={details.guestName} maxLength={200} onChangeText={(guestName) => setDetails({ ...details, guestName })} />
                  <Field
                    label="Mobile (with country code)"
                    value={details.guestPhone}
                    maxLength={20}
                    keyboardType="phone-pad"
                    placeholder="+91 98765 43210"
                    onChangeText={(guestPhone) => setDetails({ ...details, guestPhone })}
                  />
                  <Row style={{ alignItems: 'flex-start' }}>
                    <View style={{ flex: 1, minWidth: 120 }}>
                      <Field label="Guests" value={details.guests} keyboardType="number-pad" maxLength={3} onChangeText={(v) => setDetails({ ...details, guests: v.replace(/\D/g, '') })} />
                    </View>
                    <View style={{ flex: 1, minWidth: 120 }}>
                      <Field label="Pets" value={details.pets} keyboardType="number-pad" maxLength={3} onChangeText={(v) => setDetails({ ...details, pets: v.replace(/\D/g, '') })} />
                    </View>
                  </Row>
                  <DateField label="Check-in" value={details.checkIn} onChange={(checkIn) => setDetails({ ...details, checkIn })} />
                  <DateField label="Check-out (day they leave)" value={details.checkOut} onChange={(checkOut) => setDetails({ ...details, checkOut })} />
                  <Row style={{ alignItems: 'flex-start' }}>
                    <View style={{ flex: 1, minWidth: 120 }}>
                      <Field label="Total (₹)" value={details.gross} keyboardType="decimal-pad" onChangeText={(v) => setDetails({ ...details, gross: num(v) })} />
                    </View>
                    <View style={{ flex: 1, minWidth: 120 }}>
                      <Field label="Received (₹)" value={details.received} keyboardType="decimal-pad" onChangeText={(v) => setDetails({ ...details, received: num(v) })} />
                    </View>
                  </Row>
                  {stay.source !== 'direct' && stay.source !== 'manual' && (
                    <Small tone="warn">Changing dates here updates your records and your own calendar only — change them on the channel too.</Small>
                  )}
                  <Button
                    label="Save"
                    onPress={() => void saveDetails(stay)}
                    busy={busy === `save:${id}`}
                    disabled={!details.checkIn || !details.checkOut}
                    style={{ marginTop: space(2) }}
                  />
                  <Small>Changes the booking record. Dates, status and amounts are edited on the Earnings page.</Small>
                </View>
              )}

              {docsOpen && (
                <View style={{ marginTop: space(3), paddingTop: space(3), borderTopWidth: 1, borderTopColor: color.line }}>
                  {docs.loading && <Small>Opening documents…</Small>}
                  {docs.error && <Small tone="bad">{docs.error}</Small>}
                  {!docs.loading && !docs.error && docs.list.length === 0 && <Small>Nothing filed for this stay.</Small>}
                  {groupByGuest(docs.list).map((group) => {
                    const key = `${id}:${group.slot ?? 'all'}`;
                    const first = (group.name ?? '').split(' ')[0] || `Guest ${group.slot}`;
                    return (
                      <View key={key} style={{ borderWidth: 1, borderColor: group.rejected ? color.terracotta : color.line, borderRadius: 12, padding: space(3), marginBottom: space(3), backgroundColor: color.white }}>
                        <Row style={{ justifyContent: 'space-between' }}>
                          <Body style={{ fontWeight: '700', flexShrink: 1 }}>
                            {group.slot === null ? 'Earlier upload (not grouped)' : `Guest ${group.slot} · ${group.name}`}
                          </Body>
                          <Pill label={group.rejected ? 'Rejected' : 'Accepted'} tone={group.rejected ? 'bad' : 'ok'} />
                        </Row>
                        {group.slot !== null && <Small>{group.age === 'child' ? 'Child · ' : ''}{idTypeLabel(group.idType)}</Small>}
                        {group.rejected && group.reason && <Small tone="bad">Reason sent: {group.reason}</Small>}
                        {group.docs.map((doc) => (
                          <Row key={doc.id} style={{ justifyContent: 'space-between', marginTop: space(2) }}>
                            <View style={{ flexShrink: 1 }}>
                              <Body>{doc.guest ? doc.guest.side : doc.documentType}</Body>
                              <Small>
                                {doc.sizeBytes ? `${Math.round(doc.sizeBytes / 1024)} KB` : ''}
                                {doc.uploadedAt ? ` · ${when(doc.uploadedAt)}` : ''}
                                {doc.status === 'verified' && doc.verifiedBy === VERIFIED_ON_UPLOAD ? ' · not opened yet' : ''}
                              </Small>
                            </View>
                            <SmallButton
                              label="Open"
                              disabled={busy === `doc:${id}`}
                              onPress={() =>
                                void act(id, `doc`, () =>
                                  shareAdminFile(documentFilePath(id, doc.id), doc.originalFilename ?? `${doc.documentType}.pdf`, doc.mimeType ?? 'application/octet-stream'),
                                  'Could not open the document.',
                                )
                              }
                            />
                          </Row>
                        ))}
                        {!group.rejected && (
                          <View style={{ marginTop: space(3), paddingTop: space(2), borderTopWidth: 1, borderTopColor: color.line }}>
                            <Small>{group.slot === null ? 'Why is this upload being rejected?' : `Why is ${first}'s ID being rejected?`} The guest is sent this with upload instructions.</Small>
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(1), marginTop: space(1) }}>
                              {COMMON_REJECTION_REASONS.map((reason) => (
                                <Pressable
                                  key={reason}
                                  onPress={() => setRejectReason((r) => ({ ...r, [key]: reason }))}
                                  style={{ borderWidth: 1, borderColor: rejectReason[key] === reason ? color.ink : color.line, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 10, backgroundColor: color.white }}
                                >
                                  <Small>{reason}</Small>
                                </Pressable>
                              ))}
                            </View>
                            <TextInput
                              value={rejectReason[key] ?? ''}
                              onChangeText={(text) => setRejectReason((r) => ({ ...r, [key]: text }))}
                              placeholder="Pick a reason above or type one"
                              placeholderTextColor={color.muted}
                              style={{ borderWidth: 1, borderColor: color.line, borderRadius: 12, padding: space(3), minHeight: 48, backgroundColor: color.white, color: color.ink, marginTop: space(1) }}
                            />
                            <Button
                              label={group.slot === null ? 'Reject & re-send link' : `Reject ${first}'s ID & send`}
                              kind="danger"
                              busy={busy === `reject:${id}`}
                              disabled={!stay.guestPhone || (rejectReason[key] ?? '').trim().length < 5}
                              onPress={() => void act(id, 'reject', () => rejectAndResend(stay, group.slot), 'Could not reject and re-send.')}
                              style={{ marginTop: space(2) }}
                            />
                          </View>
                        )}
                      </View>
                    );
                  })}
                  {docs.list.length > 0 && !stay.guestPhone && <Small>No mobile number on this booking, so a new link cannot be sent.</Small>}
                </View>
              )}
            </Card>
          </Placed>
        );
      })}
      {load.error && load.data && <Notice tone="error">{load.error}</Notice>}
    </>
  );
}
