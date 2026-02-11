/**
 * Sistema de Templates de Notificações
 * Suporta múltiplos idiomas e canais (Email, WhatsApp)
 * 
 * Uso:
 * const template = getTemplate('nova_pauta', 'email', 'pt-BR');
 * const rendered = renderTemplate(template, { userName: 'João', agendaTitle: 'Teste' });
 */

export const NOTIFICATION_TEMPLATES = {
  'pt-BR': {
    nova_pauta: {
      email: {
        subject: '[Comitê Insight] Nova pauta: {{agendaTitle}}',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #FF7A3D 0%, #008751 100%); padding: 30px; text-align: center;">
              <h1 style="color: white; margin: 0;">Comitê Insight</h1>
            </div>
            <div style="padding: 30px; background: #f9f9f9;">
              <h2 style="color: #333;">Olá, {{userName}}! 👋</h2>
              <p style="font-size: 16px; color: #666;">Uma nova pauta foi criada e está disponível para análise:</p>
              
              <div style="background: white; padding: 20px; border-left: 4px solid #FF7A3D; margin: 20px 0;">
                <h3 style="margin-top: 0; color: #FF7A3D;">{{agendaTitle}}</h3>
                <p style="color: #666;">{{agendaDescription}}</p>
                <p style="color: #888; font-size: 14px;">
                  <strong>Categoria:</strong> {{agendaCategory}}<br>
                  <strong>Prioridade:</strong> {{agendaPriority}}
                </p>
              </div>

              <div style="text-align: center; margin: 30px 0;">
                <a href="{{agendaLink}}" style="background: linear-gradient(135deg, #FF7A3D 0%, #E6662A 100%); color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: bold;">
                  Ver Pauta Completa
                </a>
              </div>

              <p style="color: #888; font-size: 14px; border-top: 1px solid #ddd; padding-top: 20px; margin-top: 30px;">
                Esta é uma notificação automática do sistema Comitê Insight.<br>
                <a href="{{preferencesLink}}" style="color: #FF7A3D;">Gerenciar preferências de notificação</a>
              </p>
            </div>
          </div>
        `,
        text: `
Olá, {{userName}}!

Uma nova pauta foi criada: "{{agendaTitle}}"

{{agendaDescription}}

Categoria: {{agendaCategory}}
Prioridade: {{agendaPriority}}

Acesse para ver todos os detalhes: {{agendaLink}}

---
Comitê Insight
Gerenciar preferências: {{preferencesLink}}
        `
      },
      whatsapp: {
        text: `📋 Nova pauta adicionada: "*{{agendaTitle}}*"\n\nVeja detalhes: {{agendaLink}}`
      }
    },

    votacao_aberta: {
      email: {
        subject: '[Comitê Insight] Votação aberta: {{agendaTitle}}',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #008751 0%, #006B40 100%); padding: 30px; text-align: center;">
              <h1 style="color: white; margin: 0;">🗳️ Votação Aberta</h1>
            </div>
            <div style="padding: 30px; background: #f9f9f9;">
              <h2 style="color: #333;">{{userName}}, sua participação é importante!</h2>
              <p style="font-size: 16px; color: #666;">A votação para a seguinte pauta está aberta:</p>
              
              <div style="background: white; padding: 20px; border-left: 4px solid #008751; margin: 20px 0;">
                <h3 style="margin-top: 0; color: #008751;">{{agendaTitle}}</h3>
                <p style="color: #666;">{{agendaDescription}}</p>
                <p style="color: #d32f2f; font-weight: bold; font-size: 16px;">
                  ⏰ Prazo: {{deadline}}
                </p>
              </div>

              <div style="text-align: center; margin: 30px 0;">
                <a href="{{voteLink}}" style="background: linear-gradient(135deg, #008751 0%, #006B40 100%); color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: bold;">
                  Votar Agora
                </a>
              </div>

              <p style="color: #888; font-size: 14px; border-top: 1px solid #ddd; padding-top: 20px; margin-top: 30px;">
                <a href="{{preferencesLink}}" style="color: #008751;">Gerenciar preferências de notificação</a>
              </p>
            </div>
          </div>
        `,
        text: `
{{userName}}, sua participação é importante!

A votação para "{{agendaTitle}}" está aberta.

{{agendaDescription}}

⏰ Prazo: {{deadline}}

Vote agora: {{voteLink}}

---
Comitê Insight
        `
      },
      whatsapp: {
        text: `🗳️ Votação aberta para "*{{agendaTitle}}*"\n\n⏰ Prazo: {{deadline}}\n\nVote: {{voteLink}}`
      }
    },

    lembrete_votacao: {
      email: {
        subject: '[Comitê Insight] ⏰ Lembrete: votação encerra em breve',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #FFB347 0%, #FF8C00 100%); padding: 30px; text-align: center;">
              <h1 style="color: white; margin: 0;">⏰ Lembrete Importante</h1>
            </div>
            <div style="padding: 30px; background: #f9f9f9;">
              <h2 style="color: #333;">Olá, {{userName}}!</h2>
              <p style="font-size: 16px; color: #666;">A votação da pauta abaixo está próxima do prazo final:</p>
              
              <div style="background: #fff8e1; padding: 20px; border-left: 4px solid #FFB347; margin: 20px 0;">
                <h3 style="margin-top: 0; color: #FF8C00;">{{agendaTitle}}</h3>
                <p style="color: #d32f2f; font-weight: bold; font-size: 18px;">
                  ⏰ Encerra em: {{deadline}}
                </p>
              </div>

              <div style="text-align: center; margin: 30px 0;">
                <a href="{{voteLink}}" style="background: linear-gradient(135deg, #FFB347 0%, #FF8C00 100%); color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: bold;">
                  Votar Agora
                </a>
              </div>

              <p style="color: #888; font-size: 14px;">
                Não perca o prazo! Sua opinião é fundamental para as decisões do comitê.
              </p>
            </div>
          </div>
        `,
        text: `
⏰ LEMBRETE IMPORTANTE

Olá, {{userName}}!

A votação "{{agendaTitle}}" encerra em: {{deadline}}

Não perca o prazo! Vote agora: {{voteLink}}

---
Comitê Insight
        `
      },
      whatsapp: {
        text: `⏰ *LEMBRETE*: A votação "*{{agendaTitle}}*" encerra em {{deadline}}. Vote: {{voteLink}}`
      }
    },

    votacao_encerrada: {
      email: {
        subject: '[Comitê Insight] Votação encerrada: {{agendaTitle}}',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #64748B 0%, #475569 100%); padding: 30px; text-align: center;">
              <h1 style="color: white; margin: 0;">Votação Encerrada</h1>
            </div>
            <div style="padding: 30px; background: #f9f9f9;">
              <h2 style="color: #333;">{{userName}}, a votação foi encerrada</h2>
              <p style="font-size: 16px; color: #666;">A votação da seguinte pauta foi finalizada:</p>
              
              <div style="background: white; padding: 20px; border-left: 4px solid #64748B; margin: 20px 0;">
                <h3 style="margin-top: 0; color: #64748B;">{{agendaTitle}}</h3>
                <p style="color: #666;">Total de votos registrados: <strong>{{totalVotes}}</strong></p>
              </div>

              <div style="text-align: center; margin: 30px 0;">
                <a href="{{resultLink}}" style="background: linear-gradient(135deg, #64748B 0%, #475569 100%); color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: bold;">
                  Ver Detalhes
                </a>
              </div>
            </div>
          </div>
        `,
        text: `
Votação encerrada: "{{agendaTitle}}"

Total de votos: {{totalVotes}}

Ver detalhes: {{resultLink}}

---
Comitê Insight
        `
      },
      whatsapp: {
        text: `Votação "*{{agendaTitle}}*" foi encerrada.\n\n📊 Total de votos: {{totalVotes}}\n\nVer: {{resultLink}}`
      }
    },

    resultado_publicado: {
      email: {
        subject: '[Comitê Insight] 📊 Resultado publicado: {{agendaTitle}}',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #008751 0%, #006B40 100%); padding: 30px; text-align: center;">
              <h1 style="color: white; margin: 0;">📊 Resultado Disponível</h1>
            </div>
            <div style="padding: 30px; background: #f9f9f9;">
              <h2 style="color: #333;">{{userName}}, o resultado está disponível!</h2>
              <p style="font-size: 16px; color: #666;">O resultado da votação foi publicado:</p>
              
              <div style="background: white; padding: 20px; border-left: 4px solid #008751; margin: 20px 0;">
                <h3 style="margin-top: 0; color: #008751;">{{agendaTitle}}</h3>
                <p style="font-size: 18px; font-weight: bold; color: {{resultColor}};">
                  Resultado: {{result}}
                </p>
                <p style="color: #666;">
                  ✓ A favor: {{votesFavor}}<br>
                  ✗ Contra: {{votesAgainst}}<br>
                  ○ Abstenções: {{votesAbstain}}
                </p>
              </div>

              <div style="text-align: center; margin: 30px 0;">
                <a href="{{resultLink}}" style="background: linear-gradient(135deg, #008751 0%, #006B40 100%); color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: bold;">
                  Ver Resultado Completo
                </a>
              </div>
            </div>
          </div>
        `,
        text: `
Resultado publicado: "{{agendaTitle}}"

Resultado: {{result}}

✓ A favor: {{votesFavor}}
✗ Contra: {{votesAgainst}}
○ Abstenções: {{votesAbstain}}

Ver completo: {{resultLink}}

---
Comitê Insight
        `
      },
      whatsapp: {
        text: `📊 Resultado de "*{{agendaTitle}}*" disponível\n\n{{result}}\n\nVer: {{resultLink}}`
      }
    },

    comentario_mencao: {
      email: {
        subject: '[Comitê Insight] 💬 Você foi mencionado em "{{agendaTitle}}"',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%); padding: 30px; text-align: center;">
              <h1 style="color: white; margin: 0;">💬 Nova Menção</h1>
            </div>
            <div style="padding: 30px; background: #f9f9f9;">
              <h2 style="color: #333;">{{userName}}, você foi mencionado!</h2>
              <p style="font-size: 16px; color: #666;">{{mentionAuthor}} mencionou você em:</p>
              
              <div style="background: white; padding: 20px; border-left: 4px solid #8B5CF6; margin: 20px 0;">
                <h3 style="margin-top: 0; color: #8B5CF6;">{{agendaTitle}}</h3>
                <div style="background: #f3f4f6; padding: 15px; border-radius: 8px; margin-top: 15px;">
                  <p style="color: #666; font-style: italic; margin: 0;">"{{commentSnippet}}"</p>
                </div>
              </div>

              <div style="text-align: center; margin: 30px 0;">
                <a href="{{appLink}}" style="background: linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%); color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: bold;">
                  Ver Discussão
                </a>
              </div>
            </div>
          </div>
        `,
        text: `
💬 {{mentionAuthor}} mencionou você!

Pauta: "{{agendaTitle}}"

"{{commentSnippet}}"

Ver discussão: {{appLink}}

---
Comitê Insight
        `
      },
      whatsapp: {
        text: `💬 Você foi mencionado em "*{{agendaTitle}}*"\n\n"{{commentSnippet}}"\n\nVer: {{appLink}}`
      }
    },

    decisao_atualizada: {
      email: {
        subject: '[Comitê Insight] Decisão atualizada: {{agendaTitle}}',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #FF7A3D 0%, #E6662A 100%); padding: 30px; text-align: center;">
              <h1 style="color: white; margin: 0;">📝 Decisão Atualizada</h1>
            </div>
            <div style="padding: 30px; background: #f9f9f9;">
              <h2 style="color: #333;">{{userName}}, houve uma atualização</h2>
              <p style="font-size: 16px; color: #666;">A decisão da pauta foi atualizada:</p>
              
              <div style="background: white; padding: 20px; border-left: 4px solid #FF7A3D; margin: 20px 0;">
                <h3 style="margin-top: 0; color: #FF7A3D;">{{agendaTitle}}</h3>
                <p style="color: #666;">{{updateSummary}}</p>
              </div>

              <div style="text-align: center; margin: 30px 0;">
                <a href="{{appLink}}" style="background: linear-gradient(135deg, #FF7A3D 0%, #E6662A 100%); color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: bold;">
                  Ver Atualização
                </a>
              </div>
            </div>
          </div>
        `,
        text: `
Decisão atualizada: "{{agendaTitle}}"

{{updateSummary}}

Confira: {{appLink}}

---
Comitê Insight
        `
      },
      whatsapp: {
        text: `📝 Decisão atualizada em "*{{agendaTitle}}*"\n\nConfira: {{appLink}}`
      }
    }
  }
};

/**
 * Obtém um template específico
 */
export function getTemplate(eventType: keyof typeof NOTIFICATION_TEMPLATES['pt-BR'], channel: 'email' | 'whatsapp', locale = 'pt-BR') {
  try {
    return NOTIFICATION_TEMPLATES[locale as 'pt-BR']?.[eventType]?.[channel];
  } catch (error) {
    console.error(`Template não encontrado: ${eventType}, ${channel}, ${locale}`);
    return null;
  }
}

/**
 * Renderiza um template substituindo placeholders
 */
export function renderTemplate(template: { [key: string]: string } | undefined, variables: { [key: string]: any }) {
  if (!template) return null;

  const result: { [key: string]: string } = {};
  
  for (const [key, value] of Object.entries(template)) {
    if (typeof value === 'string') {
      result[key] = value.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
        return variables[varName] !== undefined ? variables[varName] : match;
      });
    } else {
      result[key] = value;
    }
  }
  
  return result;
}

/**
 * Valida se todos os placeholders foram preenchidos
 */
export function validateRenderedTemplate(rendered: { [key: string]: string }) {
  const regex = /\{\{\w+\}\}/g;
  
  for (const value of Object.values(rendered)) {
    if (typeof value === 'string' && regex.test(value)) {
      return {
        valid: false,
        error: 'Placeholders não preenchidos encontrados'
      };
    }
  }
  
  return { valid: true };
}

export default {
  getTemplate,
  renderTemplate,
  validateRenderedTemplate,
  NOTIFICATION_TEMPLATES
};
