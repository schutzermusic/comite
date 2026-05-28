/**
 * Serviço de convites para novos membros
 * Suporta envio via Email e WhatsApp
 */

export interface InviteMemberData {
  nome: string;
  email: string;
  telefone?: string;
  cargo?: string;
  comite_id?: string;
  comite_nome?: string;
  role_id?: string;
  canais: ('email' | 'whatsapp')[];
  mensagem_personalizada?: string;
}

export interface InviteResult {
  success: boolean;
  message: string;
  errors?: {
    email?: string;
    whatsapp?: string;
  };
}

/**
 * Valida formato de email
 */
export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Valida formato de telefone E.164 (ex: +5511999999999)
 */
export function validatePhone(phone: string): boolean {
  const phoneRegex = /^\+[1-9]\d{1,14}$/;
  return phoneRegex.test(phone);
}

/**
 * Formata telefone para E.164
 */
export function formatPhoneToE164(phone: string): string {
  // Remove todos os caracteres não numéricos exceto +
  let cleaned = phone.replace(/[^\d+]/g, '');
  
  // Se não começa com +, adiciona código do Brasil (+55)
  if (!cleaned.startsWith('+')) {
    // Remove zeros à esquerda
    cleaned = cleaned.replace(/^0+/, '');
    
    // Se não começa com 55, adiciona
    if (!cleaned.startsWith('55')) {
      cleaned = '55' + cleaned;
    }
    
    cleaned = '+' + cleaned;
  }
  
  return cleaned;
}

/**
 * Envia convite por email
 */
async function sendEmailInvite(data: InviteMemberData): Promise<{ success: boolean; error?: string }> {
  try {
    // TODO: Integrar com serviço de email (SendGrid, AWS SES, etc.)
    // Por enquanto, simula o envio
    
    const emailContent = {
      to: data.email,
      subject: `Convite para participar do ${data.comite_nome || 'Comitê Insight'}`,
      body: `
        Olá ${data.nome},
        
        Você foi convidado para participar do ${data.comite_nome || 'sistema de governança'}.
        
        ${data.mensagem_personalizada || 'Aguardamos sua participação!'}
        
        Acesse o sistema para criar sua conta e começar a participar.
        
        Atenciosamente,
        Equipe Insight Apex Board
      `,
    };
    
    // Simulação de envio
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('Email enviado:', emailContent);
    
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Erro ao enviar email',
    };
  }
}

/**
 * Envia convite por WhatsApp
 */
async function sendWhatsAppInvite(data: InviteMemberData): Promise<{ success: boolean; error?: string }> {
  try {
    if (!data.telefone) {
      return { success: false, error: 'Telefone não fornecido' };
    }
    
    const phone = formatPhoneToE164(data.telefone);
    
    if (!validatePhone(phone)) {
      return { success: false, error: 'Formato de telefone inválido' };
    }
    
    // TODO: Integrar com API do WhatsApp Business (Twilio, etc.)
    // Por enquanto, simula o envio
    
    const message = `
      Olá ${data.nome}! 👋
      
      Você foi convidado para participar do ${data.comite_nome || 'Comitê Insight'}.
      
      ${data.mensagem_personalizada || 'Aguardamos sua participação!'}
      
      Acesse o sistema para criar sua conta.
      
      Equipe Insight Apex Board
    `;
    
    // Simulação de envio
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('WhatsApp enviado para:', phone, message);
    
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Erro ao enviar WhatsApp',
    };
  }
}

/**
 * Envia convites para um novo membro
 */
export async function inviteMember(data: InviteMemberData): Promise<InviteResult> {
  // Validações
  if (!data.nome || !data.email) {
    return {
      success: false,
      message: 'Nome e email são obrigatórios',
    };
  }
  
  if (!validateEmail(data.email)) {
    return {
      success: false,
      message: 'Email inválido',
    };
  }
  
  if (data.canais.includes('whatsapp') && !data.telefone) {
    return {
      success: false,
      message: 'Telefone é obrigatório para convite via WhatsApp',
    };
  }
  
  const errors: InviteResult['errors'] = {};
  let successCount = 0;
  
  // Envia por email se solicitado
  if (data.canais.includes('email')) {
    const emailResult = await sendEmailInvite(data);
    if (emailResult.success) {
      successCount++;
    } else {
      errors.email = emailResult.error;
    }
  }
  
  // Envia por WhatsApp se solicitado
  if (data.canais.includes('whatsapp')) {
    const whatsappResult = await sendWhatsAppInvite(data);
    if (whatsappResult.success) {
      successCount++;
    } else {
      errors.whatsapp = whatsappResult.error;
    }
  }
  
  // Determina resultado final
  const allSuccess = successCount === data.canais.length;
  const partialSuccess = successCount > 0 && successCount < data.canais.length;
  
  if (allSuccess) {
    return {
      success: true,
      message: `Convite enviado com sucesso via ${data.canais.join(' e ')}`,
    };
  } else if (partialSuccess) {
    return {
      success: true,
      message: `Convite enviado parcialmente. ${successCount} de ${data.canais.length} canais funcionaram.`,
      errors,
    };
  } else {
    return {
      success: false,
      message: 'Falha ao enviar convites',
      errors,
    };
  }
}

/**
 * Envia convites em lote para múltiplos membros
 */
export async function inviteMembersBatch(
  members: InviteMemberData[]
): Promise<{ success: number; failed: number; results: InviteResult[] }> {
  const results: InviteResult[] = [];
  let successCount = 0;
  let failedCount = 0;
  
  for (const member of members) {
    const result = await inviteMember(member);
    results.push(result);
    
    if (result.success) {
      successCount++;
    } else {
      failedCount++;
    }
    
    // Pequeno delay entre envios para não sobrecarregar
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  return {
    success: successCount,
    failed: failedCount,
    results,
  };
}

