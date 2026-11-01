import { type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';

import { color, space } from './theme';

export function Card({ children, style, tone }: { children: ReactNode; style?: ViewStyle; tone?: 'warn' }) {
  return <View style={[s.card, tone === 'warn' && s.warn, style]}>{children}</View>;
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={s.title}>{children}</Text>;
}

export function Heading({ children }: { children: ReactNode }) {
  return <Text style={s.heading}>{children}</Text>;
}

export function Body({ children, muted, style }: { children: ReactNode; muted?: boolean; style?: object }) {
  return <Text style={[s.body, muted && s.muted, style]}>{children}</Text>;
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'error' | 'ok' }) {
  return (
    <View style={[s.notice, tone === 'error' && s.noticeError, tone === 'ok' && s.noticeOk]}>
      <Text style={[s.body, tone === 'error' && { color: color.terracotta }]}>{children}</Text>
    </View>
  );
}

type ButtonKind = 'primary' | 'secondary' | 'danger' | 'whatsapp';

export function Button({
  label,
  onPress,
  kind = 'primary',
  busy,
  disabled,
  style,
}: {
  label: string;
  onPress: () => void;
  kind?: ButtonKind;
  busy?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const filled = kind !== 'secondary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        s.button,
        kind === 'primary' && { backgroundColor: color.brand },
        kind === 'danger' && { backgroundColor: color.terracotta },
        kind === 'whatsapp' && { backgroundColor: color.whatsapp },
        kind === 'secondary' && s.secondary,
        (disabled || busy) && { opacity: 0.5 },
        pressed && { opacity: 0.8 },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={filled ? color.white : color.brand} /> : null}
      <Text style={[s.buttonText, !filled && { color: color.brand }]}>{label}</Text>
    </Pressable>
  );
}

export function Field({ label, style, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={{ marginBottom: space(3) }}>
      <Text style={s.label}>{label}</Text>
      <TextInput placeholderTextColor={color.muted} style={[s.input, style]} {...props} />
    </View>
  );
}

export function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.chip, active && s.chipActive]} accessibilityRole="button" accessibilityState={{ selected: !!active }}>
      <Text style={[s.chipText, active && { color: color.white }]}>{label}</Text>
    </Pressable>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2), alignItems: 'center' }, style]}>{children}</View>;
}

const s = StyleSheet.create({
  card: {
    backgroundColor: color.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: color.line,
    padding: space(4),
    marginBottom: space(3),
  },
  warn: { borderColor: color.terracotta },
  title: { fontSize: 26, fontWeight: '700', color: color.ink, marginBottom: space(3) },
  heading: { fontSize: 18, fontWeight: '700', color: color.ink, marginBottom: space(1) },
  body: { fontSize: 15, lineHeight: 22, color: color.ink },
  muted: { color: color.muted, fontSize: 14 },
  notice: { backgroundColor: color.card, borderRadius: 12, padding: space(3), marginBottom: space(3), borderWidth: 1, borderColor: color.line },
  noticeError: { borderColor: color.terracotta },
  noticeOk: { borderColor: color.olive },
  button: {
    minHeight: 48,
    borderRadius: 999,
    paddingHorizontal: space(5),
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: space(2),
  },
  secondary: { borderWidth: 1, borderColor: color.brand, backgroundColor: 'transparent' },
  buttonText: { color: color.white, fontSize: 15, fontWeight: '600' },
  label: { fontSize: 13, fontWeight: '500', color: color.muted, marginBottom: space(1) },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: 12,
    paddingHorizontal: space(3),
    fontSize: 16,
    color: color.ink,
    backgroundColor: color.white,
  },
  chip: { borderWidth: 1, borderColor: color.line, borderRadius: 999, paddingHorizontal: space(3), paddingVertical: space(2), minHeight: 40, justifyContent: 'center' },
  chipActive: { backgroundColor: color.brand, borderColor: color.brand },
  chipText: { fontSize: 14, color: color.ink, fontWeight: '500' },
});
