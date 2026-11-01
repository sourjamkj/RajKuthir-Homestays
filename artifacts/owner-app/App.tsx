import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Pressable, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { getAlerts, setupApi, SITE } from './src/api';
import { currentToken, forgetToken, loadToken, signOut, unlock } from './src/auth';
import { destinationFor, registerForPush, setupChannels, unregisterPush } from './src/push';
import Alerts from './src/screens/Alerts';
import Calendar from './src/screens/Calendar';
import Enquiries from './src/screens/Enquiries';
import Messages from './src/screens/Messages';
import Settings from './src/screens/Settings';
import SignIn from './src/screens/SignIn';
import Today from './src/screens/Today';
import { color, space } from './src/theme';
import { Body, Button } from './src/ui';

type Tab = 'today' | 'enquiries' | 'calendar' | 'settings';
const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: 'enquiries', label: 'Enquiries' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'settings', label: 'Settings' },
];

/** A screen shown over the tabs, with a Back button. */
type Overlay = 'alerts' | 'messages' | null;

/** Ask for the fingerprint again after this long in the background. */
const RELOCK_MS = 5 * 60 * 1000;

type Phase = 'starting' | 'signedOut' | 'locked' | 'ready';

export default function App() {
  const [phase, setPhase] = useState<Phase>('starting');
  const [tab, setTab] = useState<Tab>('today');
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [unread, setUnread] = useState(0);
  // Bumped to remount the tab screens so they reload after an alert is opened.
  const [generation, setGeneration] = useState(0);
  const backgroundAt = useRef<number | null>(null);
  const pendingHref = useRef<string | null>(null);

  const go = useCallback((href: string | null | undefined) => {
    const where = destinationFor(href);
    if ('tab' in where) {
      setTab(where.tab);
      setOverlay(null);
      setGeneration((g) => g + 1);
    } else if ('screen' in where) {
      setOverlay(where.screen);
    } else {
      void Linking.openURL(`${SITE}${where.web}`);
    }
  }, []);

  const refreshUnread = useCallback(() => {
    void getAlerts(1)
      .then((r) => setUnread(r.unread))
      .catch(() => undefined);
  }, []);

  const becameReady = useCallback(() => {
    setPhase('ready');
    refreshUnread();
    void registerForPush(false);
    if (pendingHref.current !== null) {
      go(pendingHref.current);
      pendingHref.current = null;
    }
  }, [go, refreshUnread]);

  const tryUnlock = useCallback(async () => {
    if (await unlock('Unlock Raj Kuthir Owner')) becameReady();
    else setPhase('locked');
  }, [becameReady]);

  useEffect(() => {
    void setupChannels();
    // A 401 means this phone was signed out (from Settings or the web): back to sign-in.
    setupApi(currentToken, () => {
      void forgetToken().then(() => setPhase('signedOut'));
    });
    // Opened by tapping an alert while the app was closed.
    const launched = Notifications.getLastNotificationResponse();
    const href = (launched?.notification.request.content.data as { href?: string } | undefined)?.href;
    if (href) pendingHref.current = href;
    void loadToken().then((token) => {
      if (!token) setPhase('signedOut');
      else void tryUnlock();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Alerts tapped while the app is running (or in the background).
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const href = (response.notification.request.content.data as { href?: string } | undefined)?.href ?? '/admin';
      setPhase((p) => {
        if (p === 'ready') go(href);
        else pendingHref.current = href;
        return p;
      });
    });
    const received = Notifications.addNotificationReceivedListener(() => refreshUnread());
    return () => {
      sub.remove();
      received.remove();
    };
  }, [go, refreshUnread]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') backgroundAt.current = Date.now();
      if (state === 'active') {
        if (backgroundAt.current && Date.now() - backgroundAt.current > RELOCK_MS) {
          backgroundAt.current = null;
          setPhase((p) => {
            if (p !== 'ready') return p;
            void tryUnlock();
            return 'locked';
          });
        } else {
          refreshUnread();
        }
      }
    });
    return () => sub.remove();
  }, [tryUnlock, refreshUnread]);

  const doSignOut = () => {
    void unregisterPush()
      .then(() => signOut())
      .then(() => {
        setUnread(0);
        setPhase('signedOut');
      });
  };

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1, backgroundColor: color.bg }} edges={['top', 'bottom']}>
        {phase === 'starting' && <View style={{ flex: 1 }} />}
        {phase === 'signedOut' && (
          <SignIn
            onSignedIn={() => {
              becameReady();
              // First sign-in on this phone: ask for notification permission.
              void registerForPush(true);
            }}
          />
        )}
        {phase === 'locked' && (
          <View style={{ flex: 1, justifyContent: 'center', padding: space(6) }}>
            <Body style={{ textAlign: 'center', marginBottom: space(4) }}>Locked. Use your fingerprint or screen lock to open.</Body>
            <Button label="Unlock" onPress={() => void tryUnlock()} />
          </View>
        )}
        {phase === 'ready' && (
          <View style={{ flex: 1 }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingHorizontal: space(4),
                minHeight: 52,
                borderBottomWidth: 1,
                borderBottomColor: color.line,
              }}
            >
              {overlay ? (
                <Pressable onPress={() => setOverlay(null)} accessibilityRole="button" accessibilityLabel="Back" style={{ minHeight: 48, justifyContent: 'center' }}>
                  <Text style={{ fontSize: 16, color: color.brand, fontWeight: '600' }}>‹ Back</Text>
                </Pressable>
              ) : (
                <Text style={{ fontSize: 16, fontWeight: '700', color: color.ink }}>Sobuj Potro</Text>
              )}
              <Pressable
                onPress={() => setOverlay(overlay === 'alerts' ? null : 'alerts')}
                accessibilityRole="button"
                accessibilityLabel={unread ? `Alerts, ${unread} unread` : 'Alerts'}
                style={{ minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text style={{ fontSize: 22 }}>🔔</Text>
                {unread > 0 && (
                  <View
                    style={{
                      position: 'absolute',
                      top: 4,
                      right: 2,
                      minWidth: 20,
                      height: 20,
                      borderRadius: 10,
                      paddingHorizontal: 5,
                      backgroundColor: color.terracotta,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={{ color: color.white, fontSize: 12, fontWeight: '700' }}>{unread > 99 ? '99+' : unread}</Text>
                  </View>
                )}
              </Pressable>
            </View>

            <View style={{ flex: 1 }}>
              {overlay === 'alerts' && <Alerts onOpen={(alert) => go(alert.href)} onChanged={refreshUnread} />}
              {overlay === 'messages' && <Messages />}
              {overlay === null && (
                <View style={{ flex: 1 }} key={generation}>
                  {tab === 'today' && <Today />}
                  {tab === 'enquiries' && <Enquiries />}
                  {tab === 'calendar' && <Calendar />}
                  {tab === 'settings' && <Settings onSignOut={doSignOut} />}
                </View>
              )}
            </View>

            <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: color.line, backgroundColor: color.card }}>
              {TABS.map((t) => {
                const selected = overlay === null && tab === t.key;
                return (
                  <Pressable
                    key={t.key}
                    onPress={() => {
                      setTab(t.key);
                      setOverlay(null);
                    }}
                    accessibilityRole="tab"
                    accessibilityState={{ selected }}
                    style={{ flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Text style={{ fontSize: 14, fontWeight: selected ? '700' : '500', color: selected ? color.brand : color.muted }}>{t.label}</Text>
                    {selected && <View style={{ marginTop: 4, height: 3, width: 24, borderRadius: 2, backgroundColor: color.brand }} />}
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
