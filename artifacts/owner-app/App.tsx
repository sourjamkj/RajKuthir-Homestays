import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { setupApi } from './src/api';
import { currentToken, forgetToken, loadToken, signOut, unlock } from './src/auth';
import Calendar from './src/screens/Calendar';
import Enquiries from './src/screens/Enquiries';
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

/** Ask for the fingerprint again after this long in the background. */
const RELOCK_MS = 5 * 60 * 1000;

type Phase = 'starting' | 'signedOut' | 'locked' | 'ready';

export default function App() {
  const [phase, setPhase] = useState<Phase>('starting');
  const [tab, setTab] = useState<Tab>('today');
  const backgroundAt = useRef<number | null>(null);

  const tryUnlock = useCallback(async () => {
    setPhase((await unlock('Unlock Raj Kuthir Owner')) ? 'ready' : 'locked');
  }, []);

  useEffect(() => {
    // A 401 means this phone was signed out (from Settings or the web): back to sign-in.
    setupApi(currentToken, () => {
      void forgetToken().then(() => setPhase('signedOut'));
    });
    void loadToken().then((token) => {
      if (!token) setPhase('signedOut');
      else void tryUnlock();
    });
  }, [tryUnlock]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') backgroundAt.current = Date.now();
      if (state === 'active' && backgroundAt.current && Date.now() - backgroundAt.current > RELOCK_MS) {
        backgroundAt.current = null;
        setPhase((p) => {
          if (p !== 'ready') return p;
          void tryUnlock();
          return 'locked';
        });
      }
    });
    return () => sub.remove();
  }, [tryUnlock]);

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1, backgroundColor: color.bg }} edges={['top', 'bottom']}>
        {phase === 'starting' && <View style={{ flex: 1 }} />}
        {phase === 'signedOut' && <SignIn onSignedIn={() => setPhase('ready')} />}
        {phase === 'locked' && (
          <View style={{ flex: 1, justifyContent: 'center', padding: space(6) }}>
            <Body style={{ textAlign: 'center', marginBottom: space(4) }}>Locked. Use your fingerprint or screen lock to open.</Body>
            <Button label="Unlock" onPress={() => void tryUnlock()} />
          </View>
        )}
        {phase === 'ready' && (
          <View style={{ flex: 1 }}>
            <View style={{ flex: 1 }}>
              {tab === 'today' && <Today />}
              {tab === 'enquiries' && <Enquiries />}
              {tab === 'calendar' && <Calendar />}
              {tab === 'settings' && (
                <Settings
                  onSignOut={() => {
                    void signOut().then(() => setPhase('signedOut'));
                  }}
                />
              )}
            </View>
            <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: color.line, backgroundColor: color.card }}>
              {TABS.map((t) => (
                <Pressable
                  key={t.key}
                  onPress={() => setTab(t.key)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: tab === t.key }}
                  style={{ flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Text style={{ fontSize: 14, fontWeight: tab === t.key ? '700' : '500', color: tab === t.key ? color.brand : color.muted }}>
                    {t.label}
                  </Text>
                  {tab === t.key && <View style={{ marginTop: 4, height: 3, width: 24, borderRadius: 2, backgroundColor: color.brand }} />}
                </Pressable>
              ))}
            </View>
          </View>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
