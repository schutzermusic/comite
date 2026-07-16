# Insight Apex — App do Colaborador (Fase 4b)

App mobile de campo (React Native + Expo) para registro de ponto, apontamento
por projeto, biometria nativa, geolocalização/geofence e operação offline.
Consome os endpoints `/api/mobile/*` do backend (Fase 4a) no repositório web.

> ⚠️ **Este projeto NÃO é compilado nem testado no ambiente do assistente.**
> Ele é um scaffold funcional para você rodar na sua máquina com o toolchain
> nativo (Node + Expo + Xcode/Android Studio). Trate como ponto de partida
> revisável, não como app pronto para loja.

## Pré-requisitos
- Node 18+ e `npm`
- Expo CLI (`npm i -g expo` ou use `npx expo`)
- iOS: Xcode + simulador · Android: Android Studio + emulador
- App físico com Expo Go para testar biometria/GPS reais

## Configuração
1. `cd mobile && npm install`
2. Copie `.env.example` para `.env` e preencha:
   - `EXPO_PUBLIC_SUPABASE_URL` e `EXPO_PUBLIC_SUPABASE_ANON_KEY` (mesmos do web)
   - `EXPO_PUBLIC_API_BASE_URL` — URL do app web (ex.: `https://seu-insight.vercel.app`)
3. `npx expo start` → abra no simulador/emulador ou no Expo Go.

## Arquitetura
```
App.tsx                 navegação simples (login ↔ home)
src/config.ts           env
src/lib/supabase.ts     Supabase Auth (login/sessão, token bearer)
src/lib/offlineQueue.ts fila offline idempotente (AsyncStorage)
src/api/mobileApi.ts    cliente dos endpoints /api/mobile/* (bearer token)
src/screens/LoginScreen.tsx
src/screens/HomeScreen.tsx   home do colaborador (spec §12.2)
```

## Contrato com o backend (Fase 4a)
| Endpoint | Uso |
|---|---|
| `POST /api/mobile/enroll` | vincular dispositivo (device binding) |
| `GET  /api/mobile/bootstrap` | estado do dia (pontos, sessão, alocações, geofences) |
| `POST /api/mobile/punch` | bater ponto (idempotente por `clientEventId`, valida geofence, grava evidências) |
| `POST /api/mobile/activity` | iniciar / trocar / encerrar atividade |

Todas exigem `Authorization: Bearer <access_token>` do Supabase Auth.
Idempotência: cada ponto offline gera um `clientEventId` (UUID) reenviado na
sincronização — o backend deduplica.

## Roadmap de hardening (antes de produção)
- Biometria obrigatória na entrada/saída (`expo-local-authentication`).
- Captura de localização só nos eventos (não rastreamento contínuo) — spec §14.1.
- Fila offline com retry exponencial + resolução de conflito no servidor.
- Device binding com atestação de integridade (Play Integrity / DeviceCheck).
- Revisão jurídica/LGPD para biometria e retenção de localização (spec §22).
- Se virar ponto oficial: REP-P / Portaria 671 (Fase 9).
