# 🚀 Dashboard Futurístico - Insight Energy Governance Hub

## 📐 Arquitetura Completa

Este documento descreve a implementação completa do dashboard executivo futurístico, inspirado em **Linear**, **VisionOS**, **Palantir Foundry** e **Diligent Boards**.

---

## 🎨 Design System

### Tokens de Cor

```typescript
// Cores Neon e Holográficas
neon: {
  blue: '#00D4FF',
  violet: '#8B5CF6',
  pink: '#EC4899',
  cyan: '#06B6D4',
}

// Glassmorphism
glass: {
  light: 'rgba(255, 255, 255, 0.08)',
  medium: 'rgba(255, 255, 255, 0.12)',
  dark: 'rgba(0, 0, 0, 0.08)',
}

// Cores Executivas
executive: {
  slate: '#0F172A',
  midnight: '#1E293B',
  charcoal: '#334155',
}
```

### Animações Personalizadas

- **breathe**: Respiração suave (3s ease-in-out)
- **glow-pulse**: Pulso luminoso neon (2s)
- **shimmer**: Efeito brilho deslizante (3s linear)
- **float**: Flutuação vertical (6s ease-in-out)

### Efeitos Visuais

- **Glassmorphism**: Blur + opacidade 8-12%
- **Bordas Neon**: Glow holográfico em hover
- **Gradientes Executivos**: Minimalistas e premium
- **Motion Suave**: Transitions de 300-500ms

---

## 📦 Estrutura de Componentes

```
src/components/
├── ui/
│   └── glass-card.tsx                 # Card base com glassmorphism
└── dashboard/
    └── futuristic/
        ├── index.ts                   # Export centralizado
        ├── FuturisticKPICard.tsx      # KPIs premium animados
        ├── BacklogPrioritario.tsx     # Backlog estilo Linear
        ├── ProjetosEmAndamento.tsx    # Projetos executivos
        ├── VotacoesAndamento.tsx      # Votações Palantir style
        ├── AtividadeRecente.tsx       # Lista moderna Linear
        ├── MetricasDesempenho.tsx     # Métricas com gráficos
        └── GovernancaAtiva.tsx        # Painel executivo
```

---

## 🔮 Componentes Principais

### 1. FuturisticKPICard

**Características:**
- Glassmorphism com blur premium
- Gradientes animados no background
- Holographic orb que responde ao hover
- Bordas neon com glow
- Animação de "respiração"
- Trends com indicadores visuais

**Props:**
```typescript
interface FuturisticKPICardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  trend?: { value: string; positive: boolean };
  subtitle?: string;
  gradient: string;
  neonColor?: 'blue' | 'violet' | 'pink' | 'cyan';
}
```

**Uso:**
```tsx
<FuturisticKPICard
  title="Total de Pautas"
  value={42}
  icon={FileText}
  trend={{ value: '+12%', positive: true }}
  subtitle="vs. mês anterior"
  gradient="bg-gradient-to-br from-orange-500 to-pink-600"
  neonColor="pink"
/>
```

---

### 2. BacklogPrioritario

**Inspiração:** Linear + Monday.com

**Características:**
- Lista limpa e moderna
- Barra lateral de prioridade (0-100%)
- Status com ícones contextuais (Crítico, Urgente, Alto, Médio)
- Heatmap de distribuição de prioridades
- Cards horizontais flutuantes
- Hover com glow radial

**Elementos:**
- **Priority Bar**: Gradiente vertical baseado em criticidade
- **Status Icons**: Flame, AlertTriangle, TrendingUp, Clock
- **Category Tags**: Pills com glassmorphism
- **Heatmap**: Barras animadas com distribuição

---

### 3. ProjetosEmAndamento

**Inspiração:** Enterprise Dashboard

**Características:**
- Grid responsivo (1-2 colunas)
- Progress bars animadas com gradientes
- Indicador de risco (pulsante)
- Status contextual por cor
- Métricas financeiras (valor executado/total)
- ROI e responsável por projeto
- Summary footer com 3 métricas agregadas

**Indicadores:**
- 🟢 **No Prazo**: progresso >= 70%
- 🟠 **Em Risco**: status = atencao_necessaria
- 💰 **Investimento Total**: soma de valores

---

### 4. VotacoesAndamento

**Inspiração:** Palantir

**Características:**
- Cards profundos com glassmorphism
- Progress bars animadas com pulso
- Contadores visuais (A favor, Contra, Abstenções)
- Tags de urgência pulsantes
- Hover shadow neon
- Estado vazio com CTA

**Layout:**
- Título + Status tag
- Barra de progresso com % a favor
- Grid de contadores (3 colunas)
- Glow line no bottom (hover)

---

### 5. AtividadeRecente

**Inspiração:** Linear

**Características:**
- Lista ultra limpa
- Index badges numerados
- Status pills contextuais
- Metadata compacta (data, comitê, categoria)
- Hover suave com scale
- Link "Ver Todas" no header

**Estados:**
- Rascunho (cinza)
- Em Andamento (amarelo)
- Encerrada (verde)
- Não Iniciada (azul)
- Cancelada (vermelho)

---

### 6. MetricasDesempenho

**Inspiração:** Apple Health + VisionOS

**Características:**
- Progress bars com gradientes
- KPIs lado a lado
- Status cards com ícones
- Cores contextuais por métrica
- Animação de pulso nas barras

**Métricas:**
- 📊 Taxa de Aprovação (green)
- 👥 Participação Média (orange)
- ✅ Aprovadas (green card)
- ❌ Reprovadas (red card)
- ⏳ Em Andamento (amber card)

---

### 7. GovernancaAtiva

**Inspiração:** Executive Panel

**Características:**
- Gradiente diagonal premium
- Grid pattern overlay
- Background blur forte
- Stats grid com hover
- CTA button com glassmorphism
- Bottom glow line

**Stats:**
- 🏢 Comitês Ativos
- 📅 Reuniões Agendadas
- 🗳️ Total de Votos
- 👥 Membros Ativos

---

## 🎯 Layout do Dashboard

### Estrutura de Grid

```
┌─────────────────────────────────────────────────┐
│  HEADER EXECUTIVO (VisionOS)                    │
│  • Título grande gradient                       │
│  • Neon divider line                            │
│  • Botões CTAs                                  │
├─────────────────────────────────────────────────┤
│  KPIs PREMIUM (Grid 4 colunas)                  │
│  [KPI 1] [KPI 2] [KPI 3] [KPI 4]               │
├─────────────────────────────────────────────────┤
│ ┌─────────────────────────┬──────────────────┐ │
│ │ COLUNA PRINCIPAL (2/3)  │ SIDEBAR (1/3)    │ │
│ │                         │                  │ │
│ │ • Backlog Prioritário   │ • Métricas       │ │
│ │ • Projetos em Andamento │ • Governança     │ │
│ │ • Votações Andamento    │                  │ │
│ │ • Atividade Recente     │                  │ │
│ └─────────────────────────┴──────────────────┘ │
└─────────────────────────────────────────────────┘
```

### Background Layers (VisionOS)

1. **Base**: Gradiente slate-950 → slate-900
2. **Radial Top**: Blue-900/20 (top-right)
3. **Radial Bottom**: Violet-900/20 (bottom-left)
4. **Grid Pattern**: Lines brancas 2% opacity

---

## 🎨 Paleta de Cores por Componente

| Componente | Cores Principais | Neon Border |
|------------|------------------|-------------|
| KPI Pautas | Orange → Pink | Pink |
| KPI Votação | Amber → Orange | Cyan |
| KPI Aprovação | Emerald → Teal | Blue |
| KPI Membros | Cyan → Blue | Violet |
| Backlog | Orange/Red gradient | Red |
| Projetos | Cyan | Cyan |
| Votações | Orange/Amber | Orange |
| Atividade | Green/Emerald | Green |
| Métricas | Violet | Violet |
| Governança | Orange/Pink | Orange |

---

## 🔧 Tecnologias Utilizadas

- **Next.js 15**: Framework React
- **TypeScript**: Type safety
- **Tailwind CSS**: Utility-first styling
- **Radix UI**: Componentes acessíveis
- **Lucide React**: Ícones modernos
- **date-fns**: Manipulação de datas

---

## 📱 Responsividade

### Breakpoints

- **Mobile**: 1 coluna (< 768px)
- **Tablet**: 2 colunas (768px - 1024px)
- **Desktop**: Grid completo (> 1024px)

### Ajustes por Tela

**Mobile:**
- KPIs: 1 coluna
- Grid principal: Stack vertical
- Títulos reduzidos
- Padding menor

**Tablet:**
- KPIs: 2 colunas
- Grid principal: 2/3 + 1/3 mantido
- Tamanhos intermediários

**Desktop:**
- KPIs: 4 colunas
- Grid completo com sidebar
- Hover effects completos
- Animações máximas

---

## 🚀 Performance

### Otimizações Implementadas

1. **CSS-in-JS Minimalizado**: Tailwind compile-time
2. **Lazy Loading**: Componentes sob demanda
3. **Memoização**: React.memo em listas
4. **Animações GPU**: transform e opacity
5. **Debounce**: Eventos de scroll/resize

### Métricas Alvo

- **FCP**: < 1.2s
- **LCP**: < 2.5s
- **TTI**: < 3.5s
- **CLS**: < 0.1

---

## 🎯 Melhorias Futuras

### Fase 2 (Curto Prazo)

- [ ] Framer Motion para animações avançadas
- [ ] Charts interativos (Recharts customizado)
- [ ] Filtros e ordenação no Backlog
- [ ] Drag & drop para prioridades
- [ ] WebSocket para updates em tempo real

### Fase 3 (Médio Prazo)

- [ ] Dark/Light mode toggle
- [ ] Themes customizáveis
- [ ] Dashboard builder (arrastar componentes)
- [ ] Exportação PDF/PNG do dashboard
- [ ] Widgets configuráveis por usuário

### Fase 4 (Longo Prazo)

- [ ] AI insights (GPT-4 análise)
- [ ] Previsões e trends automáticos
- [ ] Alertas inteligentes
- [ ] Mobile app (React Native)
- [ ] AR/VR visualization (VisionOS)

---

## 📚 Referências de Design

### Inspirações Principais

1. **Linear** (https://linear.app)
   - Lista limpa e elegante
   - Organização moderna
   - Micro-interações sutis

2. **Apple VisionOS**
   - Glassmorphism premium
   - Profundidade e layers
   - Background dinâmico

3. **Palantir Foundry**
   - Densidade executiva
   - Dados em foco
   - Dashboard enterprise

4. **Diligent Boards**
   - Governança profissional
   - Métricas de board
   - Layout corporativo

5. **Notion**
   - Clean e refinado
   - Componentes modulares
   - UX intuitiva

---

## 🎓 Boas Práticas Implementadas

### Acessibilidade

- ✅ Contraste adequado (WCAG AA)
- ✅ Aria labels em ícones
- ✅ Navegação por teclado
- ✅ Focus visible

### Performance

- ✅ Lazy loading
- ✅ Code splitting
- ✅ Tree shaking
- ✅ Minificação

### Manutenibilidade

- ✅ Componentes reutilizáveis
- ✅ Props tipadas
- ✅ Documentação inline
- ✅ Estrutura modular

---

## 💡 Como Usar

### Importar Componentes

```tsx
import { 
  FuturisticKPICard,
  BacklogPrioritario,
  ProjetosEmAndamento,
  VotacoesAndamento,
  AtividadeRecente,
  MetricasDesempenho,
  GovernancaAtiva
} from '@/components/dashboard/futuristic';
```

### Criar Nova Página com Dashboard

```tsx
'use client';
import { FuturisticKPICard } from '@/components/dashboard/futuristic';
import { Activity } from 'lucide-react';

export default function MyDashboard() {
  return (
    <div className="min-h-screen relative">
      {/* Background layers */}
      <div className="fixed inset-0 bg-gradient-to-br from-slate-950 to-slate-900" />
      
      {/* Content */}
      <div className="relative z-10 p-8">
        <FuturisticKPICard
          title="Minha Métrica"
          value={100}
          icon={Activity}
          gradient="bg-gradient-to-br from-blue-500 to-violet-600"
          neonColor="blue"
        />
      </div>
    </div>
  );
}
```

---

## 🎬 Conclusão

Este dashboard representa o estado da arte em design de interfaces executivas, combinando estética futurista com funcionalidade enterprise-grade. Cada componente foi cuidadosamente projetado para impressionar stakeholders C-level, investidores e conselhos de administração.

**Resultado:** Um dashboard digno de produtos premium como Linear, Palantir e Apple VisionOS! 🚀✨

