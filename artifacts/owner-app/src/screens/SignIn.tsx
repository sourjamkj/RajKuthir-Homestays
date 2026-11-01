import { useState } from 'react';
import { KeyboardAvoidingView, ScrollView, Text, View } from 'react-native';

import { signIn } from '../auth';
import { color, space } from '../theme';
import { Body, Button, Field, Notice } from '../ui';

export default function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await signIn(password);
      setPassword('');
      onSignedIn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not sign in. Check your connection.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior="height" style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: space(6) }} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', marginBottom: space(8) }}>
          <Text style={{ fontSize: 28, fontWeight: '700', color: color.ink, textAlign: 'center' }}>Raj Kuthir Owner</Text>
          <Body muted style={{ textAlign: 'center', marginTop: space(2) }}>Sobuj Potro · bookings, payments and the calendar</Body>
        </View>
        {error && <Notice tone="error">{error}</Notice>}
        <Field
          label="Admin password (the one you use on the website)"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="password"
          returnKeyType="go"
          onSubmitEditing={() => password && void submit()}
        />
        <Button label="Sign in" onPress={() => void submit()} busy={busy} disabled={!password} />
        <Body muted style={{ marginTop: space(4), textAlign: 'center' }}>
          This phone stays signed in. You can sign it out any time from Settings or the web console.
        </Body>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
