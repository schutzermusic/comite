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
   * Fiscal / NFS-e — pré-go-live.
   *
   * A migration `090_fiscal_nfse.sql` NÃO está aplicada em produção (as tabelas
   * `fiscal_*` não existem), não há permissões `fiscal.*` cadastradas e o único
   * provedor registrado é o sandbox, que não transmite em produção.
   *
   * Ligar isto antes de resolver esses pontos deixa cinco links de menu levando
   * a telas que consultam tabelas inexistentes. Ver `docs/plan/TASK-024`.
   */
  fiscal: envEnabled(process.env.NEXT_PUBLIC_FISCAL_MODULE_ENABLED),
};

export function isModuleEnabled(module: AppModule): boolean {
  return MODULE_ENABLED[module];
}
