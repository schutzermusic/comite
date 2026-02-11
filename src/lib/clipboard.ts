/**
 * Utilitário seguro para operações de clipboard
 * Trata erros de permissão e falta de suporte
 */

export interface ClipboardResult {
  success: boolean;
  error?: string;
}

/**
 * Copia texto para o clipboard de forma segura
 */
export async function copyToClipboard(text: string): Promise<ClipboardResult> {
  // Verificar se está no navegador
  if (typeof window === 'undefined' || !navigator.clipboard) {
    return {
      success: false,
      error: 'Clipboard API não está disponível neste ambiente',
    };
  }

  try {
    await navigator.clipboard.writeText(text);
    return { success: true };
  } catch (error) {
    // Fallback para navegadores mais antigos ou sem permissão
    try {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      
      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);
      
      if (successful) {
        return { success: true };
      } else {
        return {
          success: false,
          error: 'Falha ao copiar texto. Verifique as permissões do navegador.',
        };
      }
    } catch (fallbackError) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Erro ao copiar texto',
      };
    }
  }
}

/**
 * Lê texto do clipboard de forma segura
 */
export async function readFromClipboard(): Promise<ClipboardResult & { text?: string }> {
  if (typeof window === 'undefined' || !navigator.clipboard) {
    return {
      success: false,
      error: 'Clipboard API não está disponível neste ambiente',
    };
  }

  try {
    const text = await navigator.clipboard.readText();
    return { success: true, text };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Erro ao ler do clipboard',
    };
  }
}

/**
 * Verifica se o clipboard está disponível
 */
export function isClipboardAvailable(): boolean {
  return typeof window !== 'undefined' && !!navigator.clipboard;
}

