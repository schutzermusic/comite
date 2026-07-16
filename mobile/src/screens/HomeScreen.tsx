import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { mobileApi, type BootstrapState, type PunchType } from '../api/mobileApi';
import { captureLocation, confirmBiometric, uuid } from '../lib/capture';
import { enqueuePunch, flushQueue, pendingCount } from '../lib/offlineQueue';

const PUNCH_LABEL: Record<PunchType, string> = {
  clock_in: 'Registrar entrada',
  break_start: 'Iniciar intervalo',
  break_end: 'Retornar do intervalo',
  clock_out: 'Registrar saída',
};

function nextPunchOptions(last: PunchType | null): PunchType[] {
  switch (last) {
    case null:
    case 'clock_out':
      return ['clock_in'];
    case 'clock_in':
    case 'break_end':
      return ['break_start', 'clock_out'];
    case 'break_start':
      return ['break_end'];
    default:
      return ['clock_in'];
  }
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function HomeScreen() {
  const [state, setState] = useState<BootstrapState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [boot] = await Promise.all([mobileApi.bootstrap(), flushQueue()]);
      setState(boot);
      setPending(await pendingCount());
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Erro ao carregar');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const last = state?.punches.length ? state.punches[state.punches.length - 1].type : null;
  const options = nextPunchOptions(last);
  const deviceId = state?.devices.find((d) => d.status !== 'revoked')?.id;

  async function handlePunch(type: PunchType) {
    setBusy(true);
    setMessage(null);
    try {
      const ok = await confirmBiometric('Confirme sua identidade para registrar o ponto');
      if (!ok) {
        setMessage('Autenticação biométrica cancelada.');
        return;
      }
      const location = await captureLocation();
      const punch = {
        type,
        clientEventId: uuid(),
        deviceId,
        occurredAt: new Date().toISOString(),
        location: location ?? undefined,
        auth: { method: 'device_biometric' as const, result: 'success' as const },
      };
      try {
        const res = await mobileApi.punch(punch);
        setMessage(res.needsReview ? 'Ponto registrado — em revisão (fora da área ou sem biometria).' : 'Ponto registrado.');
      } catch {
        await enqueuePunch(punch);
        setMessage('Sem conexão — ponto salvo e será sincronizado.');
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color="#22C08D" size="large" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 24, paddingTop: 64 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor="#22C08D" />}
    >
      <Text style={styles.hello}>Olá, {state?.person?.full_name?.split(' ')[0] ?? 'colaborador'}</Text>
      <Text style={styles.date}>
        {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
      </Text>

      {pending > 0 && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{pending} registro(s) aguardando sincronização</Text>
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Jornada de hoje</Text>
        {state?.punches.length ? (
          state.punches.map((p) => (
            <View key={p.id} style={styles.punchRow}>
              <Text style={styles.punchTime}>{fmtTime(p.occurred_at)}</Text>
              <Text style={styles.punchType}>{PUNCH_LABEL[p.type]}</Text>
              {p.status === 'under_review' && <Text style={styles.review}>em revisão</Text>}
            </View>
          ))
        ) : (
          <Text style={styles.empty}>Nenhuma marcação ainda.</Text>
        )}
      </View>

      {message ? <Text style={styles.message}>{message}</Text> : null}

      {options.map((type) => (
        <TouchableOpacity
          key={type}
          style={[styles.button, type === 'clock_out' || type === 'break_start' ? styles.buttonSecondary : null]}
          onPress={() => handlePunch(type)}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color="#0C1116" />
          ) : (
            <Text style={[styles.buttonText, (type === 'clock_out' || type === 'break_start') && styles.buttonTextSecondary]}>
              {PUNCH_LABEL[type]}
            </Text>
          )}
        </TouchableOpacity>
      ))}

      <TouchableOpacity style={styles.signOut} onPress={() => supabase.auth.signOut()}>
        <Text style={styles.signOutText}>Sair</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0C1116' },
  center: { justifyContent: 'center', alignItems: 'center' },
  hello: { color: '#E8EEF2', fontSize: 26, fontWeight: '800' },
  date: { color: '#8DA2B5', fontSize: 14, textTransform: 'capitalize', marginBottom: 20 },
  banner: { backgroundColor: 'rgba(217,161,59,0.14)', borderRadius: 10, padding: 12, marginBottom: 16 },
  bannerText: { color: '#D9A13B', fontSize: 13 },
  card: {
    backgroundColor: '#121A22',
    borderColor: 'rgba(141,162,181,0.16)',
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
  },
  cardLabel: { color: '#8DA2B5', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 },
  punchRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  punchTime: { color: '#E8EEF2', fontSize: 16, fontWeight: '700', width: 64 },
  punchType: { color: '#8DA2B5', fontSize: 15, flex: 1 },
  review: { color: '#D9A13B', fontSize: 12 },
  empty: { color: '#5C7186', fontSize: 14 },
  message: { color: '#22C08D', fontSize: 13, marginBottom: 12 },
  button: { backgroundColor: '#22C08D', borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginBottom: 12 },
  buttonSecondary: { backgroundColor: '#121A22', borderColor: 'rgba(141,162,181,0.3)', borderWidth: 1 },
  buttonText: { color: '#0C1116', fontSize: 16, fontWeight: '700' },
  buttonTextSecondary: { color: '#E8EEF2' },
  signOut: { alignItems: 'center', paddingVertical: 16, marginTop: 8 },
  signOutText: { color: '#5C7186', fontSize: 14 },
});
