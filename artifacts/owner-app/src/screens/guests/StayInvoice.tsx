import { useState } from 'react';
import { Linking, Text, View } from 'react-native';

import { emailInvoice, markPaidInFull, whatsappInvoice, type InvoiceStatus } from '../../api';
import { shareAdminFile } from '../../files';
import { color, space } from '../../theme';
import { Field, Row } from '../../ui';
import { errorText, SmallButton, Small } from './shared';

const KIND_LABEL: Record<string, string> = { voucher: 'OTA voucher', cancellation: 'Cancellation', statement: 'Statement', other: 'OTA document' };

/**
 * The invoice line on a stay, as on the web: its number and what the
 * automatic check-out email is doing, the booking confirmation, any OTA
 * documents, and Our invoice / WhatsApp / Email / Paid in full. PDFs open in
 * the share sheet, from where they can be viewed or sent on.
 */
export function StayInvoice({ bookingId, status, onChanged }: { bookingId: string; status: InvoiceStatus | undefined; onChanged: () => void }) {
  const [message, setMessage] = useState<{ text: string; bad?: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [to, setTo] = useState('');

  if (!status) return null;

  const run = async (key: string, fn: () => Promise<string | null>, fallback: string) => {
    setBusy(key);
    try {
      const text = await fn();
      setMessage(text ? { text } : null);
      onChanged();
    } catch (e) {
      setMessage({ text: errorText(e, fallback), bad: true });
    } finally {
      setBusy(null);
    }
  };

  const pdf = (key: string, path: string, filename: string) =>
    run(key, async () => {
      await shareAdminFile(path, filename);
      return null;
    }, 'Could not open the PDF.');

  const sendEmail = () =>
    run('email', async () => {
      const result = await emailInvoice(bookingId, to.trim() || undefined);
      setAsking(false);
      return `Invoice emailed to ${result.to}.`;
    }, 'Could not email the invoice.');

  return (
    <View style={{ marginTop: space(2) }}>
      <Text style={{ fontSize: 13, lineHeight: 19, color: status.needsAction ? color.amber : color.muted }}>
        <Text style={{ fontWeight: '700', color: color.brand }}>Invoice</Text>
        {status.number ? ` ${status.number}` : ''} · {status.canInvoice ? status.autoStatus : status.problem}
      </Text>
      {status.canInvoice && (
        <Row style={{ marginTop: space(2) }}>
          <SmallButton label="Confirmation" disabled={busy !== null} onPress={() => void pdf('conf', `/api/admin/bookings/${bookingId}/confirmation.pdf`, 'Booking-Confirmation.pdf')} />
        </Row>
      )}
      {status.otaDocuments.length > 0 && (
        <Row style={{ marginTop: space(2) }}>
          {status.otaDocuments.map((doc) => (
            <SmallButton
              key={doc.id}
              label={KIND_LABEL[doc.kind] ?? 'OTA document'}
              disabled={busy !== null}
              onPress={() => void pdf(`ota:${doc.id}`, `/api/admin/ota-documents/${doc.id}`, doc.filename)}
            />
          ))}
        </Row>
      )}
      {status.canInvoice && (
        <Row style={{ marginTop: space(2) }}>
          <SmallButton
            label="Our invoice"
            disabled={busy !== null}
            onPress={() => void pdf('invoice', `/api/admin/bookings/${bookingId}/invoice.pdf`, `Invoice-${(status.number ?? 'Raj-Kuthir').replace(/\//g, '-')}.pdf`)}
          />
          <SmallButton
            label="WhatsApp"
            disabled={busy !== null}
            onPress={() =>
              void run('wa', async () => {
                const result = await whatsappInvoice(bookingId);
                if (result.sent) return `Invoice sent on WhatsApp to +${result.to}.`;
                if (result.whatsappUrl) {
                  await Linking.openURL(result.whatsappUrl);
                  return 'WhatsApp opened with the invoice link — press send.';
                }
                return `No WhatsApp number on this booking. Copy the message: ${result.text ?? ''}`;
              }, 'Could not prepare the WhatsApp message.')
            }
          />
          <SmallButton
            label={`Email${status.emailedAt ? ' again' : ''}`}
            disabled={busy !== null}
            onPress={() => (status.email && !asking ? void sendEmail() : setAsking(!asking))}
          />
          {status.autoStatus.startsWith('Balance not recorded') && (
            <SmallButton
              label="Paid in full"
              disabled={busy !== null}
              onPress={() =>
                void run('paid', async () => {
                  const data = await markPaidInFull(bookingId);
                  return data.emailed ? `Marked paid in full and invoice emailed to ${data.emailed}.` : `Marked paid in full. ${data.note ?? ''}`;
                }, 'Could not update.')
              }
            />
          )}
        </Row>
      )}
      {asking && (
        <View style={{ marginTop: space(2) }}>
          <Field label="Email the invoice to" value={to} onChangeText={setTo} keyboardType="email-address" autoCapitalize="none" placeholder={status.email ?? 'guest@email.com'} />
          <SmallButton label="Send" tone="primary" disabled={busy !== null || (!to.trim() && !status.email)} onPress={() => void sendEmail()} />
        </View>
      )}
      {message && <Small tone={message.bad ? 'bad' : 'ok'}>{message.text}</Small>}
    </View>
  );
}
