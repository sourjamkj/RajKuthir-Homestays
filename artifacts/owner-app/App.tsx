import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Pressable, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { setupApi, SITE } from './src/api';
import { ActivityBell } from './src/ActivityBell';
import { confirmSignedOut, currentToken, forgetToken, loadToken, signOut, unlock } from './src/auth';
import { destinationFor, registerForPush, setupChannels, unregisterPush, type GuestsSection } from './src/push';
import Calendar from './src/screens/Calendar';
import Caretaker from './src/screens/Caretaker';
import Guests from './src/screens/Guests';
import Messages from './src/screens/Messages';
import Settings from './src/screens/Settings';
import SignIn from './src/screens/SignIn';
import Today from './src/screens/Today';
import { color, space } from './src/theme';
import { Body, Button } from './src/ui';

type Tab = 'today' | 'guests' | 'calendar' | 'caretaker' | 'settings';
const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: 'guests', label: 'Guests' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'caretaker', label: 'Caretaker' },
  { key: 'settings', label: 'Settings' },
];

/** A screen shown over the tabs, with a Back button. */
type Overlay = 'messages' | null;

/** Ask for the fingerprint again after this long in the background. */
const RELOCK_MS = 5 * 60 * 1000;

type Phase = 'starting' | 'signedOut' | 'locked' | 'ready';

export default function App() {
  const [phase, setPhase] = useState<Phase>('starting');
  const [tab, setTab] = useState<Tab>('today');
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [guestsSection, setGuestsSection] = useState<GuestsSection>('enquiries');
  const [guestsFocus, setGuestsFocus] = useState<string | null>(null);
  // Bumped so the bell reloads when an alert arrives.
  const [activityKey, setActivityKey] = useState(0);
  // Bumped to remount the tab screens so they reload after an alert is opened.
  const [generation, setGeneration] = useState(0);
  const backgroundAt = useRef<number | null>(null);
  const pendingHref = useRef<string | null>(null);

  const go = useCallback((href: string | null | undefined) => {
    const where = destinationFor(href);
    if ('tab' in where) {
      if (where.tab === 'guests') {
        setGuestsSection(where.section);
        setGuestsFocus(where.focus);
      }
      setTab(where.tab);
      setOverlay(null);
      setGeneration((g) => g + 1);
    } else if ('screen' in where) {
      setOverlay(where.screen);
    } else {
      void Linking.openURL(`${SITE}${where.web}`);
    }
  }, []);

  const refreshActivity = useCallback(() => setActivityKey((k) => k + 1), []);

  const becameReady = useCallback(() => {
    setPhase('ready');
    refreshActivity();
    void registerForPush(false);
    if (pendingHref.current !== null) {
      go(pendingHref.current);
      pendingHref.current = null;
    }
  }, [go, refreshActivity]);

  const tryUnlock = useCallback(async () => {
    if (await unlock('Unlock Raj Kuthir Owner')) becameReady();
    else setPhase('locked');
  }, [becameReady]);

  useEffect(() => {
    void setupChannels();
    // A 401 may mean this phone was signed out (from Settings or the web). Ask
    // the server once more before forgetting the token: a restart or a bad
    // signal must never send you back to the password.
    let checking = false;
    setupApi(currentToken, () => {
      if (checking) return;
      checking = true;
      void confirmSignedOut()
        .then(async (gone) => {
          if (!gone) return;
          await forgetToken();
          setPhase('signedOut');
        })
        .finally(() => {
          checking = false;
        });
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
    const received = Notifications.addNotificationReceivedListener(() => refreshActivity());
    return () => {
      sub.remove();
      received.remove();
    };
  }, [go, refreshActivity]);

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
          refreshActivity();
        }
      }
    });
    return () => sub.remove();
  }, [tryUnlock, refreshActivity]);

  const doSignOut = () => {
    void unregisterPush()
      .then(() => signOut())
      .then(() => {
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
              <ActivityBell onOpen={go} refreshKey={activityKey} />
            </View>

            <View style={{ flex: 1 }}>
              {overlay === 'messages' && <Messages />}
              {overlay === null && (
                <View style={{ flex: 1 }} key={generation}>
                  {tab === 'today' && <Today />}
                  {tab === 'guests' && (
                    <Guests
                      section={guestsSection}
                      focus={guestsFocus}
                      onSection={(section) => {
                        setGuestsSection(section);
                        setGuestsFocus(null);
                      }}
                    />
                  )}
                  {tab === 'calendar' && <Calendar />}
                  {tab === 'caretaker' && <Caretaker />}
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
                      setGuestsFocus(null);
                    }}
                    accessibilityRole="tab"
                    accessibilityState={{ selected }}
                    style={{ flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: selected ? '700' : '500', color: selected ? color.brand : color.muted }}>{t.label}</Text>
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
