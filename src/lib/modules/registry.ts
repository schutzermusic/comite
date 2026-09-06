/**
 * Módulos que podem ser desligados por configuração.
 *
 * ─── Por que existe ────────────────────────────────────────────────────────
 *
 * Um módulo pode estar inteiro no código — página, rota, item de menu — e ainda
 * assim não poder ser usado, porque falta algo fora do código: migration
 * aplicada, credencial, homologação. Sem uma chave explícita, a única forma de
 * esconder isso é apagar código ou confiar em permissão, e nenhuma das duas
 * funciona: apagar perde o trabalho, e permissão não segura administrador (ver
 * `isOwnerAdmin` na sidebar, que ignora permissão de propósito).
 *
 * ─── O padrão é DESLIGADO ──────────────────────────────────────────────────
 *
 * `envEnabled` só aceita um "sim" explícito. Variável ausente, vazia, `"false"`
 * ou qualquer lixo resolve para `false`. Um módulo pré-go-live nunca aparece
 * por acidente de configuração — ele precisa ser ligado de propósito.
 *
 * ─── Sem React, sem DOM ────────────────────────────────────────────────────
 *
 * Roda no servidor, no cliente e em teste. As variáveis são lidas por
 * referência literal a `process.env.NEXT_PUBLIC_*` porque é assim que o Next
 * as substitui em tempo de build — montar o nome dinamicamente não funcionaria
 * no bundle do cliente.
 */

export type AppModule = 'fiscal';

/** Só um "sim" explícito liga. Qualquer outra coisa é `false`. */
function envEnabled(raw: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test((raw ?? '').trim());
}

export const MODULE_ENABLED: Readonly<Record<AppModule, boolean>> = {
  /**
   * Fiscal / NFS-e — fundação ATIVA, emissão real ainda no portão de credencial.
   *
   * O que já está resolvido: a fundação (migrations 112 e 113) está aplicada em
   * produção, as sete permissões `fiscal.*` estão cadastradas e atribuídas, e o
   * caminho completo de homologação foi provado de ponta a ponta pelo adaptador
   * sandbox — rascunho, aprovação, transmissão, autorização, XML arquivado,
   * eventos, tentativas e cancelamento.
   *
   * O que ainda falta: o adaptador REAL (`nfse_nacional`) existe e transmite de
   * verdade, mas exige certificado A1, senha, `FISCAL_CERT_KEY` no ambiente e
   * endereço do ambiente nacional. Sem isso ele PARA no portão de credencial —
   * de propósito, sem simular nada.
   *
   * Por isso a chave continua exigindo um "sim" explícito por ambiente: ligar o
   * menu onde ainda não há emissão real possível levaria o usuário a uma tela
   * que só sabe dizer o que falta. Ver `docs/plan/TASK-024`.
   */
  fiscal: envEnabled(process.env.NEXT_PUBLIC_FISCAL_MODULE_ENABLED),
};

export function isModuleEnabled(module: AppModule): boolean {
  return MODULE_ENABLED[module];
}
