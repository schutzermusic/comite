import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { mobileApi, type BootstrapState, type PunchType } from '../api/mobileApi';
import { pendingCount } from '../lib/offlineQueue';

const PUNCH_LABEL: Record<PunchType, string> = {
  clock_in: 'Entrada',
  break_start: 'Intervalo',
  break_end: 'Retorno',
  clock_out: 'Saída',
};

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Histórico das marcações do dia + estado de sincronização (spec §12.3). */
export function HistoryScreen() {
  const [state, setState] = useState<BootstrapState | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(0);

  const load = useCallback(async () => {
    try {
      const [boot, p] = await Promise.all([mobileApi.bootstrap(), pendingCount()]);
      setState(boot);
      setPending(p);
    } catch {
      /* mantém último estado em falha de rede */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color="#22C08D" size="large" />
      </View>
    );
  }

  const punches = [...(state?.punches ?? [])].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 24, paddingTop: 56 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor="#22C08D" />}
    >
      <Text style={styles.title}>Histórico de hoje</Text>
      <Text style={styles.sync}>
        {pending > 0 ? `${pending} registro(s) aguardando sincronização` : 'Tudo sincronizado'}
      </Text>

      {punches.length === 0 ? (
        <Text style={styles.empty}>Nenhuma marcação hoje.</Text>
      ) : (
        <View style={styles.timeline}>
          {punches.map((p) => (
            <View key={p.id} style={styles.row}>
              <Text style={styles.time}>{fmtTime(p.occurred_at)}</Text>
              <View style={styles.dot} />
              <View style={styles.body}>
                <Text style={styles.type}>{PUNCH_LABEL[p.type]}</Text>
                {p.status === 'under_review' && <Text style={styles.review}>em revisão</Text>}
              </View>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0C1116' },
  center: { justifyContent: 'center', alignItems: 'center' },
  title: { color: '#E8EEF2', fontSize: 26, fontWeight: '800' },
  sync: { color: '#8DA2B5', fontSize: 13, marginTop: 4, marginBottom: 20 },
  empty: { color: '#5C7186', fontSize: 14 },
  timeline: { borderLeftWidth: 0 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  time: { color: '#E8EEF2', fontSize: 15, fontWeight: '700', width: 56, fontVariant: ['tabular-nums'] },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#22C08D', marginHorizontal: 12 },
  body: { flex: 1 },
  type: { color: '#E8EEF2', fontSize: 15 },
  review: { color: '#D9A13B', fontSize: 12, marginTop: 2 },
});
