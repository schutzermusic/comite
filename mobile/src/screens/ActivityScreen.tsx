import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { mobileApi, type BootstrapState } from '../api/mobileApi';
import { getEnrolledDeviceId } from '../lib/device';

/**
 * Atividade (spec §12): iniciar / trocar de projeto / encerrar. "Trocar"
 * = iniciar em outro projeto, que encerra a sessão anterior no backend
 * (uma sessão running por pessoa, garantido pelo índice do banco).
 */
export function ActivityScreen() {
  const [state, setState] = useState<BootstrapState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState('00:00:00');

  const load = useCallback(async () => {
    try {
      setState(await mobileApi.bootstrap());
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Erro ao carregar');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // cronômetro da sessão em andamento
  useEffect(() => {
    const startedAt = state?.runningSession?.started_at;
    if (!startedAt) {
      setElapsed('00:00:00');
      return;
    }
    const tick = () => {
      const secs = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
      const h = String(Math.floor(secs / 3600)).padStart(2, '0');
      const m = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
      const s = String(secs % 60).padStart(2, '0');
      setElapsed(`${h}:${m}:${s}`);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [state?.runningSession?.started_at]);

  async function start(projectId: string) {
    setBusy(true);
    setMessage(null);
    try {
      const deviceId = (await getEnrolledDeviceId()) ?? undefined;
      await mobileApi.activity({ action: 'start', projectId, deviceId });
      await load();
      setMessage('Atividade iniciada.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Erro ao iniciar');
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setBusy(true);
    try {
      await mobileApi.activity({ action: 'stop' });
      await load();
      setMessage('Atividade encerrada.');
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

  const running = state?.runningSession;
  const runningProject = running
    ? state?.allocations.find((a) => a.project_id === running.project_id)
    : null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 24, paddingTop: 56 }}>
      <Text style={styles.title}>Atividade</Text>

      {running ? (
        <View style={styles.activeCard}>
          <Text style={styles.cardLabel}>Em andamento</Text>
          <Text style={styles.project}>
            {runningProject?.role_title ?? 'Projeto'} · {running.project_id}
          </Text>
          <Text style={styles.timer}>{elapsed}</Text>
          <TouchableOpacity style={[styles.button, styles.stop]} onPress={stop} disabled={busy}>
            <Text style={styles.buttonText}>Encerrar atividade</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <Text style={styles.empty}>Nenhuma atividade em andamento. Escolha um projeto abaixo.</Text>
      )}

      {message ? <Text style={styles.message}>{message}</Text> : null}

      <Text style={styles.section}>{running ? 'Trocar de projeto' : 'Iniciar em'}</Text>
      {(state?.allocations ?? []).length === 0 ? (
        <Text style={styles.empty}>Você não tem alocações ativas.</Text>
      ) : (
        state?.allocations.map((a) => (
          <TouchableOpacity
            key={a.project_id}
            style={[styles.projectRow, a.project_id === running?.project_id && styles.projectRowActive]}
            onPress={() => start(a.project_id)}
            disabled={busy || a.project_id === running?.project_id}
          >
            <View>
              <Text style={styles.projectName}>{a.role_title ?? 'Colaborador'}</Text>
              <Text style={styles.projectMeta}>
                {a.project_id} · {a.planned_percentage}%
              </Text>
            </View>
            <Text style={styles.projectAction}>
              {a.project_id === running?.project_id ? 'Atual' : 'Iniciar'}
            </Text>
          </TouchableOpacity>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0C1116' },
  center: { justifyContent: 'center', alignItems: 'center' },
  title: { color: '#E8EEF2', fontSize: 26, fontWeight: '800', marginBottom: 16 },
  activeCard: {
    backgroundColor: '#121A22',
    borderColor: 'rgba(34,192,141,0.4)',
    borderWidth: 1,
    borderRadius: 14,
    padding: 18,
    marginBottom: 16,
  },
  cardLabel: { color: '#22C08D', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 },
  project: { color: '#E8EEF2', fontSize: 16, fontWeight: '600', marginTop: 6 },
  timer: { color: '#E8EEF2', fontSize: 40, fontWeight: '800', fontVariant: ['tabular-nums'], marginVertical: 10 },
  section: { color: '#8DA2B5', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, marginTop: 20, marginBottom: 10 },
  empty: { color: '#5C7186', fontSize: 14, marginVertical: 8 },
  message: { color: '#22C08D', fontSize: 13, marginTop: 12 },
  projectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#121A22',
    borderColor: 'rgba(141,162,181,0.16)',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  projectRowActive: { borderColor: 'rgba(34,192,141,0.4)' },
  projectName: { color: '#E8EEF2', fontSize: 15, fontWeight: '600' },
  projectMeta: { color: '#8DA2B5', fontSize: 12, marginTop: 2 },
  projectAction: { color: '#22C08D', fontSize: 14, fontWeight: '700' },
  button: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  stop: { backgroundColor: '#22C08D' },
  buttonText: { color: '#0C1116', fontSize: 16, fontWeight: '700' },
});
