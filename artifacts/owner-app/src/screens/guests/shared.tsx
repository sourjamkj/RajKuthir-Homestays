import { type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { color, space } from '../../theme';

export type Loaded<T> = { data: T | null; error: string | null; loading: boolean; reload: () => Promise<void> };
export type Say = (text: string, tone?: 'ok' | 'error') => void;

export const errorText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

/** A small rounded label, like the web's status badges. */
export function Pill({ label, tone = 'plain' }: { label: string; tone?: 'plain' | 'brand' | 'ok' | 'warn' | 'bad' }) {
  const palette = {
    plain: { bg: 'transparent', fg: color.muted, border: color.line },
    brand: { bg: '#dde8e4', fg: color.brand, border: '#b7cfc7' },
    ok: { bg: '#e7e9df', fg: '#4b5340', border: '#c9ccbb' },
    warn: { bg: '#f5ead3', fg: color.amber, border: '#e6cf9f' },
    bad: { bg: '#f3e3dd', fg: color.terracotta, border: '#dcb3a5' },
  }[tone];
  return (
    <View style={{ borderWidth: 1, borderColor: palette.border, backgroundColor: palette.bg, borderRadius: 999, paddingHorizontal: space(2.5), paddingVertical: 3, alignSelf: 'flex-start' }}>
      <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 0.6, color: palette.fg }}>{label.toUpperCase()}</Text>
    </View>
  );
}

/** A compact secondary action, for rows with many buttons. */
export function SmallButton({
  label,
  onPress,
  disabled,
  tone = 'plain',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'plain' | 'primary' | 'danger' | 'whatsapp';
}) {
  const filled = tone === 'primary' || tone === 'whatsapp';
  const bg = tone === 'primary' ? color.brand : tone === 'whatsapp' ? color.whatsapp : 'transparent';
  const fg = filled ? color.white : tone === 'danger' ? color.terracotta : color.brand;
  const border = filled ? bg : tone === 'danger' ? '#dcb3a5' : color.line;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        minHeight: 40,
        paddingHorizontal: space(3),
        borderRadius: 10,
        borderWidth: 1,
        borderColor: border,
        backgroundColor: bg,
        justifyContent: 'center',
        opacity: disabled ? 0.4 : pressed ? 0.75 : 1,
      })}
    >
      <Text style={{ fontSize: 13, fontWeight: '700', color: fg }}>{label}</Text>
    </Pressable>
  );
}

/** Highlights the card an alert or the bell pointed at. */
export function Placed({ id, onPlaced, focused, children }: { id: string; onPlaced: (id: string, y: number) => void; focused: boolean; children: ReactNode }) {
  return (
    <View
      onLayout={(e) => onPlaced(id, e.nativeEvent.layout.y)}
      style={focused ? { borderRadius: 18, borderWidth: 2, borderColor: color.brand, marginBottom: space(3), padding: 2 } : undefined}
    >
      {children}
    </View>
  );
}

export function Small({ children, tone }: { children: ReactNode; tone?: 'muted' | 'bad' | 'warn' | 'ok' }) {
  const c = tone === 'bad' ? color.terracotta : tone === 'warn' ? color.amber : tone === 'ok' ? '#4b5340' : color.muted;
  return <Text style={{ fontSize: 13, lineHeight: 19, color: c, marginTop: space(1) }}>{children}</Text>;
}
