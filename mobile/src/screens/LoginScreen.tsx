import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { supabase } from '../lib/supabase';

export function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setError(error.message);
    setBusy(false);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.brand}>Insight Apex</Text>
      <Text style={styles.subtitle}>App do Colaborador</Text>

      <TextInput
        style={styles.input}
        placeholder="E-mail"
        placeholderTextColor="#6B7B8C"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="Senha"
        placeholderTextColor="#6B7B8C"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity style={styles.button} onPress={handleLogin} disabled={busy}>
        {busy ? <ActivityIndicator color="#0C1116" /> : <Text style={styles.buttonText}>Entrar</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0C1116', padding: 24, justifyContent: 'center' },
  brand: { color: '#E8EEF2', fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { color: '#8DA2B5', fontSize: 15, marginBottom: 32 },
  input: {
    backgroundColor: '#121A22',
    borderColor: 'rgba(141,162,181,0.2)',
    borderWidth: 1,
    borderRadius: 12,
    color: '#E8EEF2',
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    marginBottom: 12,
  },
  error: { color: '#DB5C6E', marginBottom: 12 },
  button: {
    backgroundColor: '#22C08D',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: { color: '#0C1116', fontSize: 16, fontWeight: '700' },
});
