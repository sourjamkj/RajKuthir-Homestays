import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { getActivity, markActivitySeen, type ActivityItem } from './api';
import { ago, color, space } from './theme';

/**
 * The bell in the header, the same as the web console's: what has happened
 * since you last marked it read — new bookings from any channel,
 * cancellations, OTA calendar blocks, enquiries, guest ID uploads and
 * payments. There is no separate notifications screen.
 *
 * The "last read" marker lives on the server, so Mark all read here clears
 * the bell on the laptop too, and the other way round. The panel opens by
 * itself once per app session when something is unread; after that it waits
 * behind the bell.
 */

const ICON: Record<string, string> = {
  booking_new: '📅',
  booking_cancelled: '✕',
  ota_block: '🗓',
  enquiry_new: '📥',
  documents_uploaded: '📄',
  payment: '₹',
  feedback: '✎',
};

/** Cancellations are the one thing that may need undoing elsewhere. */
const TONE: Record<string, { bg: string; fg: string }> = {
  booking_new: { bg: '#e7e9df', fg: '#4b5340' },
  booking_cancelled: { bg: '#f3e3dd', fg: color.terracotta },
  ota_block: { bg: '#f5ead3', fg: color.amber },
  enquiry_new: { bg: '#dde8e4', fg: color.brand },
  documents_uploaded: { bg: '#e7e9df', fg: '#4b5340' },
  payment: { bg: '#f5ead3', fg: color.amber },
  feedback: { bg: '#f3e3dd', fg: color.terracotta },
};

let autoOpenedThisSession = false;

export function ActivityBell({ onOpen, refreshKey }: { onOpen: (href: string) => void; refreshKey: number }) {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [marking, setMarking] = useState(false);
  const [markError, setMarkError] = useState(false);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    try {
      const result = await getActivity();
      if (!mounted.current) return;
      setItems(result.items);
      setError(null);
      if (result.items.length > 0 && !autoOpenedThisSession) {
        autoOpenedThisSession = true;
        setOpen(true);
      }
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : 'Could not load recent activity.');
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Every minute while the app is open, on coming back to it, and whenever
  // the app asks (an alert arrived).
  useEffect(() => {
    void load();
  }, [load, refreshKey]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void load();
    }, 60_000);
    const sub = AppState.addEventListener('change', (state) => state === 'active' && void load());
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [load]);

  const markAllRead = async () => {
    // The newest item shown, not "now": anything arriving in between stays unread.
    const upTo = items[0]?.at;
    if (!upTo) return;
    setMarking(true);
    setMarkError(false);
    try {
      await markActivitySeen(upTo);
      setOpen(false);
      await load();
    } catch {
      setMarkError(true);
    } finally {
      setMarking(false);
    }
  };

  const count = items.length;

  return (
    <>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={count ? `${count} new since you last looked` : 'Activity, nothing new'}
        style={{ minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}
      >
        <View style={{ width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: color.line, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 17 }}>🔔</Text>
        </View>
        {count > 0 && (
          <View
            style={{
              position: 'absolute',
              top: 2,
              right: 0,
              minWidth: 20,
              height: 20,
              borderRadius: 10,
              paddingHorizontal: 5,
              backgroundColor: color.terracotta,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: color.white, fontSize: 11, fontWeight: '700' }}>{count > 49 ? '50+' : count}</Text>
          </View>
        )}
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)} statusBarTranslucent>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(29,58,47,0.18)' }} onPress={() => setOpen(false)} accessibilityLabel="Close recent activity">
          <Pressable
            onPress={() => undefined}
            accessibilityRole="none"
            style={{
              position: 'absolute',
              top: 96,
              right: space(3),
              left: space(3),
              maxHeight: '75%',
              backgroundColor: color.card,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: color.line,
              overflow: 'hidden',
              elevation: 8,
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingHorizontal: space(4),
                paddingVertical: space(3),
                borderBottomWidth: 1,
                borderBottomColor: color.line,
              }}
            >
              <View>
                <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 1.2, color: color.amber }}>SINCE YOU LAST LOOKED</Text>
                <Text style={{ fontSize: 15, fontWeight: '600', color: color.brand, marginTop: 2 }}>
                  {count === 0 ? 'Nothing new' : `${count} new ${count === 1 ? 'update' : 'updates'}`}
                </Text>
              </View>
              <Pressable onPress={() => setOpen(false)} accessibilityRole="button" accessibilityLabel="Close" style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 18, color: color.muted }}>✕</Text>
              </Pressable>
            </View>

            <ScrollView style={{ flexGrow: 0 }}>
              {loading && <Text style={{ padding: space(4), color: color.muted }}>Loading…</Text>}
              {!loading && error && <Text style={{ padding: space(4), color: color.terracotta }}>{error}</Text>}
              {!loading && !error && count === 0 && (
                <Text style={{ padding: space(4), color: color.muted, lineHeight: 21 }}>
                  You are up to date. New bookings, enquiries and uploads will show here.
                </Text>
              )}
              {items.map((item) => {
                const tone = TONE[item.kind] ?? { bg: '#dde8e4', fg: color.brand };
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => {
                      setOpen(false);
                      onOpen(item.href);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.title}. ${item.detail}. ${ago(item.at)}`}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      gap: space(3),
                      paddingHorizontal: space(4),
                      paddingVertical: space(3),
                      borderBottomWidth: 1,
                      borderBottomColor: color.line,
                      backgroundColor: pressed ? color.bg : 'transparent',
                    })}
                  >
                    <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: tone.bg, alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
                      <Text style={{ color: tone.fg, fontSize: 14, fontWeight: '700' }}>{ICON[item.kind] ?? '🔔'}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space(2) }}>
                        <Text style={{ flex: 1, fontSize: 15, fontWeight: '600', color: color.ink }}>{item.title}</Text>
                        <Text style={{ fontSize: 11, color: color.muted }}>{ago(item.at)}</Text>
                      </View>
                      {item.detail ? <Text style={{ fontSize: 13, color: color.muted, marginTop: 2, lineHeight: 18 }}>{item.detail}</Text> : null}
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>

            {count > 0 && (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: space(3),
                  paddingHorizontal: space(4),
                  paddingVertical: space(3),
                  borderTopWidth: 1,
                  borderTopColor: color.line,
                }}
              >
                <Text style={{ flex: 1, fontSize: 12, color: markError ? color.terracotta : color.muted }}>
                  {markError ? 'Could not mark as read.' : 'Stays here until you mark it read.'}
                </Text>
                <Pressable
                  onPress={() => void markAllRead()}
                  disabled={marking}
                  accessibilityRole="button"
                  style={{
                    flexDirection: 'row',
                    gap: space(2),
                    alignItems: 'center',
                    minHeight: 44,
                    paddingHorizontal: space(4),
                    borderRadius: 999,
                    backgroundColor: color.brand,
                    opacity: marking ? 0.6 : 1,
                  }}
                >
                  {marking && <ActivityIndicator color={color.white} size="small" />}
                  <Text style={{ color: color.white, fontWeight: '700', fontSize: 13 }}>Mark all read</Text>
                </Pressable>
              </View>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
