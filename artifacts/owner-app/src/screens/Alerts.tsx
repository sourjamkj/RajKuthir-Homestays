import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';

import { getAlerts, markAlertsRead, type OwnerAlert } from '../api';
import { ago, color, space } from '../theme';
import { Body, Button, Notice, Row, Title } from '../ui';
import { useLoad } from '../useLoad';

/** Every alert the server has sent this phone, newest first. Tap one to go to it. */
export default function Alerts({ onOpen, onChanged }: { onOpen: (alert: OwnerAlert) => void; onChanged: () => void }) {
  const list = useLoad(() => getAlerts(100));
  const [error, setError] = useState<string | null>(null);
  const alerts = [...(list.data?.alerts ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const open = async (alert: OwnerAlert) => {
    if (!alert.read) {
      try {
        await markAlertsRead([alert.id]);
        onChanged();
      } catch {
        /* still open it; it will show unread until the next refresh */
      }
    }
    onOpen(alert);
  };

  const readAll = async () => {
    try {
      await markAlertsRead();
      setError(null);
      onChanged();
      await list.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not mark them read.');
    }
  };

  return (
    <ScrollView
      contentContainerStyle={{ padding: space(4), paddingBottom: space(10) }}
      refreshControl={<RefreshControl refreshing={list.loading} onRefresh={() => void list.reload()} />}
    >
      <Row style={{ justifyContent: 'space-between', marginBottom: space(2) }}>
        <Title>Alerts</Title>
        {(list.data?.unread ?? 0) > 0 && <Button label="Mark all read" kind="secondary" onPress={() => void readAll()} />}
      </Row>
      {(list.error || error) && <Notice tone="error">{list.error ?? error}</Notice>}
      {!list.loading && alerts.length === 0 && <Body muted>No alerts yet.</Body>}
      {alerts.map((alert) => (
        <Pressable
          key={alert.id}
          onPress={() => void open(alert)}
          accessibilityRole="button"
          accessibilityLabel={`${alert.read ? '' : 'Unread. '}${alert.title}. ${alert.body}`}
          style={({ pressed }) => ({
            flexDirection: 'row',
            gap: space(3),
            backgroundColor: pressed ? color.line : color.card,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: color.line,
            padding: space(4),
            marginBottom: space(3),
          })}
        >
          <View
            style={{ width: 10, height: 10, borderRadius: 5, marginTop: 7, backgroundColor: alert.read ? 'transparent' : color.terracotta }}
          />
          <View style={{ flex: 1 }}>
            <Body style={{ fontWeight: alert.read ? '500' : '700' }}>{alert.title}</Body>
            {alert.body ? <Body muted>{alert.body}</Body> : null}
            <Body muted style={{ marginTop: space(1), fontSize: 13 }}>{ago(alert.createdAt)}</Body>
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}
