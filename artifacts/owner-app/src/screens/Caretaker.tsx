import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, Linking, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import {
  AdminApiError,
  createCaretakerMessage,
  getCaretakerConsole,
  markCaretakerMessageSent,
  patchSettings,
  previewCaretakerMessage,
  type CaretakerFieldSpec,
  type CaretakerMessageKind,
  type CaretakerTemplate,
} from '../api';
import { color, longDate, space, when } from '../theme';
import { Body, Button, Card, Chip, Field, Heading, Notice, Row, Title } from '../ui';
import { useLoad } from '../useLoad';

/**
 * Messages to the caretaker: salary credited, a festival bonus, a day off, or
 * a notice about the house. The server writes every one the same professional
 * way (property name in bold, greeting, the facts in bold, signed), and the
 * preview here is that exact text. "Open in WhatsApp" opens your own WhatsApp
 * on her chat with it typed; you press send there, then "I sent it".
 * Nothing sends by itself, and no amounts are ever written in.
 */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const monthLabel = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${y}`;
};

function shiftMonth(ym: string, by: number): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1 + by, 1)).toISOString().slice(0, 7);
}

const toDate = (iso: string) => new Date(`${iso}T12:00:00`);
const toIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function defaultsFor(template: CaretakerTemplate, today: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const spec of template.fields) {
    if (spec.type === 'date') fields[spec.key] = today;
    // Salary is usually paid early in a month, for the month before.
    else if (spec.type === 'month') fields[spec.key] = Number(today.slice(8, 10)) <= 10 ? shiftMonth(today.slice(0, 7), -1) : today.slice(0, 7);
    else if (spec.type === 'choice') fields[spec.key] = spec.options?.[0] ?? '';
    else fields[spec.key] = '';
  }
  return fields;
}

/** *bold* the way WhatsApp shows it. */
function WhatsappText({ text }: { text: string }) {
  const parts = text.split(/(\*[^*\n]+\*)/g);
  return (
    <Text style={{ fontSize: 15, lineHeight: 22, color: '#111b21' }}>
      {parts.map((part, i) =>
        /^\*[^*\n]+\*$/.test(part) ? (
          <Text key={i} style={{ fontWeight: '700' }}>
            {part.slice(1, -1)}
          </Text>
        ) : (
          part
        ),
      )}
    </Text>
  );
}

export default function Caretaker() {
  const data = useLoad(getCaretakerConsole);
  const [kind, setKind] = useState<CaretakerMessageKind>('salary_credited');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [people, setPeople] = useState({ name: '', signature: '' });

  const template = useMemo(() => data.data?.templates.find((t) => t.kind === kind) ?? null, [data.data, kind]);
  const today = data.data?.today;

  useEffect(() => {
    if (template && today) setFields(defaultsFor(template, today));
  }, [template, today]);

  useEffect(() => {
    if (data.data) setPeople({ name: data.data.caretaker.name ?? '', signature: data.data.signature });
  }, [data.data]);

  // The server writes the preview, so it is exactly what she will receive.
  useEffect(() => {
    if (!template) return;
    const timer = setTimeout(() => {
      previewCaretakerMessage({ kind, fields })
        .then((r) => {
          setPreview(r.body);
          setProblem(null);
        })
        .catch((e: unknown) => setProblem(e instanceof Error ? e.message : 'Could not write the preview.'));
    }, 250);
    return () => clearTimeout(timer);
  }, [kind, fields, template, data.data?.caretaker.name, data.data?.signature]);

  const markSent = async (id: string) => {
    setBusy(`sent-${id}`);
    try {
      await markCaretakerMessageSent(id);
      setOpened(null);
      setNotice({ text: 'Marked as sent.', tone: 'ok' });
      await data.reload();
    } catch (e) {
      setNotice({ text: e instanceof Error ? e.message : 'Could not mark it sent.', tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  // Back from WhatsApp: ask once whether it went.
  const openedRef = useRef<string | null>(null);
  openedRef.current = opened;
  useEffect(() => {
    let left = false;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' && openedRef.current) left = true;
      if (state === 'active' && left && openedRef.current) {
        left = false;
        const id = openedRef.current;
        Alert.alert('Did you send it?', 'Mark the message as sent to her.', [
          { text: 'Not yet', style: 'cancel' },
          { text: 'Yes, sent', onPress: () => void markSent(id) },
        ]);
      }
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = async () => {
    setBusy('send');
    setNotice(null);
    try {
      const result = await createCaretakerMessage({ kind, fields });
      setOpened(result.message.id);
      await data.reload();
      await Linking.openURL(result.whatsappUrl);
    } catch (e) {
      setNotice({ text: e instanceof AdminApiError || e instanceof Error ? e.message : 'Could not open WhatsApp.', tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const savePeople = async () => {
    setBusy('people');
    try {
      await patchSettings({ caretakerName: people.name.trim() || null, ownerSignature: people.signature.trim() || null });
      setEditing(false);
      setNotice({ text: 'Saved.', tone: 'ok' });
      await data.reload();
    } catch (e) {
      setNotice({ text: e instanceof Error ? e.message : 'Could not save.', tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const set = (key: string, value: string) => setFields((f) => ({ ...f, [key]: value }));

  const onPick = (key: string) => (event: DateTimePickerEvent, date?: Date) => {
    setPicking(null);
    if (event.type === 'set' && date) set(key, toIso(date));
  };

  const renderField = (spec: CaretakerFieldSpec) => {
    const value = fields[spec.key] ?? '';
    const label = `${spec.label}${spec.required ? ' *' : ''}`;
    if (spec.type === 'choice') {
      return (
        <View key={spec.key} style={{ marginBottom: space(3) }}>
          <Body muted style={{ marginBottom: space(1) }}>{label}</Body>
          <Row>
            {spec.options?.map((o) => <Chip key={o} label={o} active={value === o} onPress={() => set(spec.key, o)} />)}
          </Row>
        </View>
      );
    }
    if (spec.type === 'month') {
      return (
        <View key={spec.key} style={{ marginBottom: space(3) }}>
          <Body muted style={{ marginBottom: space(1) }}>{label}</Body>
          <Row>
            <Button label="‹" kind="secondary" onPress={() => value && set(spec.key, shiftMonth(value, -1))} style={{ paddingHorizontal: space(4) }} />
            <Text style={{ fontSize: 16, fontWeight: '600', color: color.ink, minWidth: 150, textAlign: 'center' }}>{value ? monthLabel(value) : '—'}</Text>
            <Button label="›" kind="secondary" onPress={() => value && set(spec.key, shiftMonth(value, 1))} style={{ paddingHorizontal: space(4) }} />
          </Row>
        </View>
      );
    }
    if (spec.type === 'date') {
      return (
        <View key={spec.key} style={{ marginBottom: space(3) }}>
          <Body muted style={{ marginBottom: space(1) }}>{label}</Body>
          <Row>
            <Button label={value ? longDate(value) : 'Choose a date'} kind="secondary" onPress={() => setPicking(spec.key)} />
            {today && value !== today && <Chip label="Today" onPress={() => set(spec.key, today)} />}
          </Row>
          {picking === spec.key && <DateTimePicker value={value ? toDate(value) : new Date()} mode="date" display="default" onChange={onPick(spec.key)} />}
        </View>
      );
    }
    return (
      <Field
        key={spec.key}
        label={label}
        value={value}
        onChangeText={(v) => set(spec.key, v)}
        placeholder={spec.hint}
        maxLength={spec.max}
        multiline={spec.type === 'longtext'}
        style={spec.type === 'longtext' ? { minHeight: 120, textAlignVertical: 'top', paddingTop: space(3) } : undefined}
      />
    );
  };

  return (
    <ScrollView
      contentContainerStyle={{ padding: space(4), paddingBottom: space(12) }}
      refreshControl={<RefreshControl refreshing={data.loading} onRefresh={() => void data.reload()} />}
      keyboardShouldPersistTaps="handled"
    >
      <Title>Caretaker</Title>
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {data.error && <Notice tone="error">{data.error}</Notice>}

      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flexShrink: 1 }}>
            <Body muted>Sending to</Body>
            <Body style={{ fontWeight: '600' }}>
              {data.data?.caretaker.name ?? 'Caretaker (add her name)'} · {data.data?.caretaker.phone ?? '…'}
            </Body>
            <Body muted>Signed: {data.data?.signature ?? '…'}</Body>
          </View>
          <Button label={editing ? 'Close' : 'Edit'} kind="secondary" onPress={() => setEditing((v) => !v)} />
        </Row>
        {editing && (
          <View style={{ marginTop: space(3) }}>
            <Field label="Her name" value={people.name} onChangeText={(v) => setPeople((p) => ({ ...p, name: v }))} placeholder="e.g. Rina" maxLength={60} />
            <Field label="Sign messages as" value={people.signature} onChangeText={(v) => setPeople((p) => ({ ...p, signature: v }))} maxLength={60} />
            <Body muted style={{ marginBottom: space(3) }}>Her WhatsApp number is changed in Settings.</Body>
            <Button label="Save" onPress={() => void savePeople()} busy={busy === 'people'} />
          </View>
        )}
      </Card>

      <Heading>New message</Heading>
      <Row style={{ marginTop: space(2), marginBottom: space(2) }}>
        {data.data?.templates.map((t) => <Chip key={t.kind} label={t.title} active={kind === t.kind} onPress={() => setKind(t.kind)} />)}
      </Row>
      {template && <Body muted style={{ marginBottom: space(3) }}>{template.description}</Body>}

      {template && <Card>{template.fields.map(renderField)}</Card>}

      <Body muted style={{ marginBottom: space(2) }}>What she will see</Body>
      <View style={{ backgroundColor: '#e7ddd1', borderRadius: 16, padding: space(3), marginBottom: space(3) }}>
        <View style={{ alignSelf: 'flex-end', maxWidth: '92%', backgroundColor: '#d9fdd3', borderRadius: 12, borderTopRightRadius: 3, paddingHorizontal: space(3), paddingVertical: space(2) }}>
          <WhatsappText text={preview || '…'} />
        </View>
      </View>
      {problem && <Notice tone="error">{problem}</Notice>}

      <Button label="Open in WhatsApp" kind="whatsapp" onPress={() => void send()} busy={busy === 'send'} disabled={Boolean(problem) || !preview} />
      {opened && (
        <Button label="I sent it" kind="secondary" onPress={() => void markSent(opened)} busy={busy === `sent-${opened}`} style={{ marginTop: space(2) }} />
      )}

      <View style={{ marginTop: space(6) }}>
        <Heading>Sent before</Heading>
        {!data.loading && (data.data?.history.length ?? 0) === 0 && <Body muted>Nothing yet.</Body>}
        {data.data?.history.map((m) => (
          <Card key={m.id}>
            <Pressable onPress={() => setExpanded(expanded === m.id ? null : m.id)} accessibilityRole="button" accessibilityLabel="Show the message">
              <Row style={{ justifyContent: 'space-between' }}>
                <View style={{ flexShrink: 1 }}>
                  <Body style={{ fontWeight: '600' }}>{data.data?.templates.find((t) => t.kind === m.kind)?.title ?? m.kind}</Body>
                  <Body muted>
                    {when(m.createdAt)} · {m.sentAt ? 'sent' : 'not marked sent'}
                  </Body>
                </View>
                {!m.sentAt && <Button label="Mark sent" kind="secondary" onPress={() => void markSent(m.id)} busy={busy === `sent-${m.id}`} />}
              </Row>
            </Pressable>
            {expanded === m.id && (
              <View style={{ marginTop: space(3) }}>
                <WhatsappText text={m.body} />
              </View>
            )}
          </Card>
        ))}
      </View>
    </ScrollView>
  );
}
