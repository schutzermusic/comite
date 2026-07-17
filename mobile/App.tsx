import { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './src/lib/supabase';
import { ensureDeviceEnrolled } from './src/lib/device';
import { LoginScreen } from './src/screens/LoginScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { ActivityScreen } from './src/screens/ActivityScreen';
import { HistoryScreen } from './src/screens/HistoryScreen';

type Tab = 'home' | 'activity' | 'history';

const TABS: Array<{ key: Tab; label: string; icon: string }> = [
  { key: 'home', label: 'Ponto', icon: '🕐' },
  { key: 'activity', label: 'Atividade', icon: '▶' },
  { key: 'history', label: 'Histórico', icon: '☰' },
];

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>('home');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // vincula o dispositivo após autenticar (idempotente)
  useEffect(() => {
    if (session) void ensureDeviceEnrolled();
  }, [session]);

  if (!ready) return null;

  if (!session) {
    return (
      <>
        <StatusBar style="light" />
        <LoginScreen />
      </>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <View style={styles.screen}>
        {tab === 'home' && <HomeScreen />}
        {tab === 'activity' && <ActivityScreen />}
        {tab === 'history' && <HistoryScreen />}
      </View>
      <View style={styles.tabbar}>
        {TABS.map((t) => (
          <TouchableOpacity key={t.key} style={styles.tab} onPress={() => setTab(t.key)}>
            <Text style={[styles.tabIcon, tab === t.key && styles.tabActive]}>{t.icon}</Text>
            <Text style={[styles.tabLabel, tab === t.key && styles.tabActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0C1116' },
  screen: { flex: 1 },
  tabbar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: 'rgba(141,162,181,0.16)',
    backgroundColor: '#0F161D',
    paddingBottom: 24,
    paddingTop: 8,
  },
  tab: { flex: 1, alignItems: 'center', gap: 2 },
  tabIcon: { fontSize: 18, color: '#5C7186' },
  tabLabel: { fontSize: 11, color: '#5C7186' },
  tabActive: { color: '#22C08D' },
});
