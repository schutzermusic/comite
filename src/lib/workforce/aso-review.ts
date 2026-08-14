/**
 * Curadoria humana do ASO — as duas camadas de campos e as ações de revisão.
 *
 * Camada pura, sem I/O: recebe o que a máquina leu, o que uma pessoa corrigiu e
 * a ação pedida, e devolve o próximo estado do documento. A rota só persiste.
 *
 * POR QUE DUAS CAMADAS, E NÃO UMA
 *
 * Antes, corrigir um campo mal lido sobrescrevia a leitura. O resultado era um
 * documento em que ninguém mais conseguia responder duas perguntas que importam
 * em auditoria e em produto:
 *
 *   — este valor veio do papel ou de uma pessoa que digitou?
 *   — o extrator está acertando, ou o RH está corrigindo tudo em silêncio?
 *
 * Aqui `extracted` é congelado e `reviewed` guarda SÓ o que foi tocado. O valor
 * que a tela mostra é a sobreposição dos dois, e cada campo sabe dizer de onde
 * veio.
 *
 * A OUTRA REGRA: NENHUM ASO SE APROVA SOZINHO
 *
 * `approve` é o único caminho para `approved`, ele exige um revisor
 * identificado, e nada — nem confiança de extração alta, nem conferência do
 * eSocial batendo — produz esse estado sem alguém clicar. O que está em jogo é
 * a aptidão de uma pessoa para o trabalho, atestada por um médico; um extrator
 * concordando consigo mesmo não é evidência de nada.
 *
 * CONFIRMAR NO ENVIO NÃO É AUTOAPROVAÇÃO
 *
 * O RH pode confirmar o ASO na mesma tela em que o envia. A diferença entre
 * isso e autoaprovação não é de tempo — é de AGENTE: quem decide continua sendo
 * uma pessoa autenticada, clicando, sobre um resumo do que foi lido. O que a
 * mudança elimina é a viagem até uma fila separada, que só produzia acervo
 * parado; o que ela preserva é o `reviewed_by`.
 *
 * O portão que sustenta isso é `assessApprovalReadiness`: onde a leitura não é
 * confiável, o clique não está disponível. Ver o comentário lá sobre por que as
 * ressalvas têm dois níveis.
 */

import {
  ASO_MIN_CONFIDENCE,
  inferValidityDate,
  parsePtBrDate,
  type AsoExamKind,
  type AsoExtraction,
  type AsoExtractionMethod,
  type AsoValidityBasis,
} from './aso-extractor';

/** Decisão humana sobre o documento. */
export type AsoReviewStatus = 'pending' | 'approved' | 'rejected' | 'correction_requested';

/** Projeção de leitura de `AsoReviewStatus`, usada por indicadores e telas. */
export type AsoDocumentStatus = 'pending_review' | 'approved' | 'rejected' | 'needs_correction';

export type AsoReviewAction = 'approve' | 'request_correction' | 'reject' | 'edit' | 'reopen';

/**
 * Campos do ASO, no vocabulário que atravessa extração, revisão e tela.
 *
 * `undefined` = o campo não participa desta camada (na overlay de revisão,
 * significa "ninguém tocou"). `null` = alguém tocou e apagou o valor. A
 * distinção é o que permite corrigir um campo para vazio sem que a leitura da
 * máquina volte a aparecer no lugar.
 */
export interface AsoFields {
  workerName?: string | null;
  cpf?: string | null;
  workerRegistration?: string | null;
  companyName?: string | null;
  companyCnpj?: string | null;
  clinicName?: string | null;
  examDate?: string | null;
  examKind?: AsoExamKind | null;
  result?: '1' | '2' | null;
  validityDate?: string | null;
  validityBasis?: AsoValidityBasis;
  doctorName?: string | null;
  doctorCrm?: string | null;
  occupationalRisks?: string[] | null;
}

/** O que o RH pode corrigir. `validityBasis` fica fora: é derivado, não digitado. */
export const ASO_EDITABLE_FIELDS = [
  'workerName',
  'cpf',
  'workerRegistration',
  'companyName',
  'companyCnpj',
  'clinicName',
  'examDate',
  'examKind',
  'result',
  'validityDate',
  'doctorName',
  'doctorCrm',
  'occupationalRisks',
] as const satisfies readonly (keyof AsoFields)[];

export type AsoEditableField = (typeof ASO_EDITABLE_FIELDS)[number];

/**
 * Ressalva leve que uma pessoa reconheceu para poder aprovar.
 *
 * A MENSAGEM É COPIADA, e não referenciada pelo código.
 *
 * Guardar só `code` pareceria mais limpo e destruiria a prova: o texto de uma
 * ressalva muda entre versões, e uma auditoria daqui a dois anos leria a
 * redação DE HOJE achando que foi isso que a pessoa viu. O que precisa
 * sobreviver é o que estava na tela no instante do clique.
 */
export interface AsoAcknowledgedCaution {
  code: AsoApprovalIssueCode;
  /** Campo relacionado, quando a ressalva aponta um. */
  field: AsoEditableField | null;
  /** Texto exibido ao RH, palavra por palavra. */
  message: string;
  acknowledged_by: string;
  acknowledged_at: string;
}

/**
 * Retrato do portão no instante da aprovação.
 *
 * Serve para responder, sem reconstituir nada, à pergunta que uma fiscalização
 * faz: "com base em quê esta pessoa foi considerada apta?". Recalcular o
 * readiness depois não responde — os campos podem ter mudado, o extrator pode
 * ter melhorado, e o resultado de hoje não é evidência do que se viu ontem.
 */
export interface AsoApprovalSnapshot {
  /** Como a decisão foi tomada. Lote e individual não são a mesma evidência. */
  mode: 'individual' | 'bulk';
  /** Sempre `[]` numa aprovação — o portão não deixa passar de outro jeito. */
  blockers: { code: AsoApprovalIssueCode; field: AsoEditableField | null; message: string }[];
  cautions: AsoAcknowledgedCaution[];
  eligibleForBulk: boolean;
}

/** Uma entrada da trilha de revisão. Append-only. */
export interface AsoReviewEntry {
  at: string;
  by: string | null;
  action: AsoReviewAction;
  /** Campos alterados nesta entrada, quando a ação mexeu em valores. */
  fields?: AsoEditableField[];
  note?: string | null;
  /** Presente apenas em `approve`. */
  approval?: AsoApprovalSnapshot;
}

const EXAM_KINDS: AsoExamKind[] = ['0', '1', '2', '3', '4', '9'];

/**
 * Congela a leitura da máquina no formato que vai para `extracted_fields_json`.
 *
 * Campo não lido vira `null`, e não some: um JSON que omite a chave não
 * distingue "o extrator não achou" de "esta versão do extrator nem procurava".
 * Guardar o `null` é o que permite, meses depois, medir a cobertura do
 * extrator sobre o acervo que já entrou.
 */
export function fieldsFromExtraction(extraction: AsoExtraction): AsoFields {
  return {
    workerName: extraction.workerName ?? null,
    cpf: extraction.cpf ?? null,
    workerRegistration: extraction.workerRegistration ?? null,
    companyName: extraction.companyName ?? null,
    companyCnpj: extraction.companyCnpj ?? null,
    clinicName: extraction.clinicName ?? null,
    examDate: extraction.examDate ?? null,
    examKind: extraction.examKind ?? null,
    result: extraction.result ?? null,
    validityDate: extraction.validityDate ?? null,
    validityBasis: extraction.validityBasis,
    doctorName: extraction.doctorName ?? null,
    doctorCrm: extraction.doctorCrm ?? null,
    occupationalRisks: extraction.occupationalRisks ?? null,
  };
}

/**
 * Sobrepõe a revisão à leitura.
 *
 * Só as chaves PRESENTES na overlay vencem, e `null` é um valor válido — quem
 * apagou um campo apagou de propósito.
 */
export function mergeAsoFields(extracted: AsoFields, reviewed: AsoFields): AsoFields {
  const merged: AsoFields = { ...extracted };
  for (const key of Object.keys(reviewed) as (keyof AsoFields)[]) {
    if (reviewed[key] === undefined) continue;
    // O cast é necessário porque o TS não estreita a união de valores quando a
    // chave é dinâmica; a origem e o destino têm o mesmo tipo por construção.
    (merged as Record<string, unknown>)[key] = reviewed[key];
  }
  return merged;
}

/**
 * Diz, campo a campo, de onde veio o valor exibido.
 *
 * `extracted` — a máquina leu e ninguém encostou.
 * `confirmed` — uma pessoa olhou e aceitou o que a máquina leu.
 * `corrected` — uma pessoa trocou o valor.
 *
 * Os três precisam ser distinguíveis DEPOIS da confirmação, que copia o
 * conjunto inteiro para a overlay. Por isso a comparação é com `extracted`, e
 * não a mera presença da chave em `reviewed`: sem isso, confirmar um lote
 * faria todo campo parecer digitado à mão e apagaria a medida de acerto do
 * extrator.
 */
export function fieldOrigin(
  field: AsoEditableField,
  extracted: AsoFields,
  reviewed: AsoFields,
): 'extracted' | 'confirmed' | 'corrected' {
  if (reviewed[field] === undefined) return 'extracted';
  return sameFieldValue(extracted[field], reviewed[field]) ? 'confirmed' : 'corrected';
}

function sameFieldValue(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => (v === undefined ? null : v);
  const x = norm(a);
  const y = norm(b);
  if (Array.isArray(x) && Array.isArray(y)) {
    return x.length === y.length && x.every((v, i) => v === y[i]);
  }
  return x === y;
}

export interface AsoEditResult {
  reviewed: AsoFields;
  effective: AsoFields;
  changed: AsoEditableField[];
  /** Edições recusadas, com o motivo. Nada é aplicado pela metade. */
  errors: { field: AsoEditableField; reason: string }[];
}

/**
 * Aplica uma correção manual.
 *
 * A validade é o único campo com regra própria, e ela é a razão de este módulo
 * existir separado da rota:
 *
 *   — data digitada por uma pessoa é `declared_document`. Ela está lendo o papel
 *     que o sistema não conseguiu ler; é a mesma natureza da data impressa.
 *   — data APAGADA volta à inferência determinística (periódico → 12 meses) ou,
 *     se o tipo não permite deduzir, a `undetermined`. Nunca ao valor anterior.
 *   — corrigir a DATA DO EXAME de um documento cuja validade era inferida
 *     recalcula a inferência. Deixá-la parada guardaria uma data derivada de um
 *     exame que já não existe mais.
 */
export function applyAsoEdits(
  extracted: AsoFields,
  currentReviewed: AsoFields,
  edits: Partial<Record<AsoEditableField, unknown>>,
): AsoEditResult {
  const reviewed: AsoFields = { ...currentReviewed };
  const changed: AsoEditableField[] = [];
  const errors: AsoEditResult['errors'] = [];

  for (const field of ASO_EDITABLE_FIELDS) {
    if (!(field in edits)) continue;
    const raw = edits[field];
    const parsed = parseEditableValue(field, raw);
    if ('error' in parsed) {
      errors.push({ field, reason: parsed.error });
      continue;
    }
    (reviewed as Record<string, unknown>)[field] = parsed.value;
    changed.push(field);
  }

  const effective = resolveValidity(mergeAsoFields(extracted, reviewed), {
    validityWasReviewed: reviewed.validityDate !== undefined,
  });

  if (
    effective.validityDate &&
    effective.examDate &&
    effective.validityDate < effective.examDate
  ) {
    errors.push({
      field: 'validityDate',
      reason: 'A validade não pode ser anterior à data do exame.',
    });
  }

  // Tudo ou nada. Aplicar a parte válida de uma correção deixaria o documento
  // num estado que ninguém pediu, e que o revisor só descobriria relendo a tela.
  if (errors.length > 0) {
    return {
      reviewed: currentReviewed,
      effective: resolveValidity(mergeAsoFields(extracted, currentReviewed), {
        validityWasReviewed: currentReviewed.validityDate !== undefined,
      }),
      changed: [],
      errors,
    };
  }

  // A base da validade é consequência, não escolha: guardá-la na overlay junto
  // do valor mantém a tela e a coluna plana contando a mesma história.
  reviewed.validityBasis = effective.validityBasis;

  return { reviewed, effective, changed, errors };
}

/**
 * Resolve validade e sua procedência sobre um conjunto de campos já mesclado.
 *
 * Determinística e exportada: é a mesma função que a rota chama depois de uma
 * edição e que o teste exercita sem tocar em banco.
 */
export function resolveValidity(
  fields: AsoFields,
  opts: { validityWasReviewed?: boolean } = {},
): AsoFields {
  const examKind = fields.examKind ?? undefined;
  const examDate = fields.examDate ?? undefined;

  if (fields.validityDate) {
    // Data presente e vinda de gente → é leitura do papel, não premissa nossa.
    return {
      ...fields,
      validityBasis: opts.validityWasReviewed
        ? 'declared_document'
        : (fields.validityBasis ?? 'declared_document'),
    };
  }

  const inferred = inferValidityDate(examDate, examKind);
  if (inferred) {
    return { ...fields, validityDate: inferred, validityBasis: 'inferred_periodicity' };
  }

  // Sem data e sem regra que a produza. O documento fica sem vencimento
  // apurável — que é um estado legítimo, e nunca deve ser lido como "em dia".
  return { ...fields, validityDate: null, validityBasis: 'undetermined' };
}

type ParsedEdit = { value: unknown } | { error: string };

function parseEditableValue(field: AsoEditableField, raw: unknown): ParsedEdit {
  if (raw === null || raw === '') return { value: null };

  switch (field) {
    case 'examDate':
    case 'validityDate': {
      if (typeof raw !== 'string') return { error: 'Data inválida.' };
      const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : parsePtBrDate(raw);
      // Aceita ISO e dd/mm/aaaa porque o RH digita nos dois; o que não pode é
      // uma data impossível virar outra data em silêncio.
      return iso ? { value: iso } : { error: 'Data inválida (use dd/mm/aaaa).' };
    }
    case 'examKind': {
      if (typeof raw !== 'string' || !EXAM_KINDS.includes(raw as AsoExamKind)) {
        return { error: 'Tipo de exame fora do domínio do eSocial.' };
      }
      return { value: raw };
    }
    case 'result': {
      if (raw !== '1' && raw !== '2') return { error: 'Resultado deve ser apto (1) ou inapto (2).' };
      return { value: raw };
    }
    case 'cpf': {
      if (typeof raw !== 'string') return { error: 'CPF inválido.' };
      const digits = raw.replace(/\D/g, '');
      return digits.length === 11 ? { value: digits } : { error: 'CPF deve ter 11 dígitos.' };
    }
    case 'companyCnpj': {
      if (typeof raw !== 'string') return { error: 'CNPJ inválido.' };
      const digits = raw.replace(/\D/g, '');
      return digits.length === 14 ? { value: digits } : { error: 'CNPJ deve ter 14 dígitos.' };
    }
    case 'occupationalRisks': {
      const list = Array.isArray(raw)
        ? raw
        : typeof raw === 'string'
          ? raw.split(/[;,\n]/)
          : null;
      if (!list) return { error: 'Riscos devem vir como lista ou texto separado por ";".' };
      const cleaned = list
        .map((r) => (typeof r === 'string' ? r.trim() : ''))
        .filter((r) => r.length > 0 && r.length <= 80);
      return { value: cleaned.length > 0 ? cleaned : null };
    }
    default: {
      if (typeof raw !== 'string') return { error: 'Valor inválido.' };
      const text = raw.trim();
      return { value: text.length > 0 ? text.slice(0, 200) : null };
    }
  }
}

// ── Portão de aprovação ─────────────────────────────────────────────────────

export type AsoApprovalIssueCode =
  | 'unmatched_employee'
  | 'low_confidence'
  | 'missing_exam_date'
  | 'missing_result'
  | 'unclear_exam_kind'
  | 'inconsistent_dates'
  | 'conflicting_document'
  | 'missing_validity';

export interface AsoApprovalIssue {
  code: AsoApprovalIssueCode;
  /**
   * `blocker` — a LEITURA não é confiável. Confirmar seria assinar embaixo de
   *   algo que ninguém sabe se está certo. O clique não existe.
   * `caution`  — a leitura está boa; o PAPEL é que não traz o dado. Confirmar é
   *   legítimo, mas exige ciência explícita e nunca entra em lote.
   */
  severity: 'blocker' | 'caution';
  label: string;
  detail: string;
  /** Campo que, corrigido, faz a ressalva desaparecer. */
  field?: AsoEditableField;
}

export interface AsoApprovalReadiness {
  issues: AsoApprovalIssue[];
  blockers: AsoApprovalIssue[];
  cautions: AsoApprovalIssue[];
  /** Sem ressalva nenhuma: pode ir no lote. */
  eligibleForBulk: boolean;
  /** Sem impeditivo: o botão de confirmar aparece. */
  eligibleForConfirmation: boolean;
  /** Há ressalva leve — o clique precisa vir com ciência explícita. */
  requiresAcknowledgement: boolean;
}

export interface AsoApprovalSibling {
  id: string;
  examDate: string | null;
  documentStatus: AsoDocumentStatus;
}

export interface AsoApprovalInput {
  /** Campos vigentes (extração sobreposta pela revisão). */
  fields: AsoFields;
  personId: string | null;
  extractionConfidence: number | null;
  extractionMethod: AsoExtractionMethod;
  /** Outros ASOs do MESMO colaborador, para detectar conflito. */
  siblings?: AsoApprovalSibling[];
  documentId?: string;
  today?: Date;
}

/** Dias de distância dentro dos quais dois ASOs são o mesmo exame em conflito. */
const CONFLICT_WINDOW_DAYS = 2;

function daysApart(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

/**
 * Decide se este documento pode ser confirmado por um clique.
 *
 * POR QUE AS RESSALVAS TÊM DOIS NÍVEIS
 *
 * A tentação é tratar toda pendência como impeditivo. Isso quebra um caso
 * inteiramente legítimo: o ASO admissional NÃO tem data de validade, e nenhuma
 * regra a produz. Se "sem validade" bloqueasse a confirmação, todo admissional
 * ficaria eternamente pendente — e o RH aprenderia que a fila mente, que é o
 * começo de ela ser ignorada.
 *
 * Então: impeditivo é quando não se sabe se a LEITURA está certa (colaborador
 * não identificado, confiança baixa, resultado ausente, datas incoerentes,
 * outro ASO conflitante). Ressalva leve é quando a leitura está certa e o PAPEL
 * é que não diz — aí o RH confirma, mas de olhos abertos e nunca em lote.
 *
 * Um impeditivo sempre tem saída: corrigir o campo apontado o dissolve. Nenhum
 * documento fica preso; o que fica barrado é aprovar sem olhar.
 */
export function assessApprovalReadiness(input: AsoApprovalInput): AsoApprovalReadiness {
  const { fields, personId, extractionConfidence, extractionMethod } = input;
  const today = (input.today ?? new Date()).toISOString().slice(0, 10);
  const issues: AsoApprovalIssue[] = [];

  if (!personId) {
    issues.push({
      code: 'unmatched_employee',
      severity: 'blocker',
      label: 'Colaborador não identificado',
      detail:
        'O documento não está vinculado a ninguém do cadastro. Sem vínculo ele não entra em indicador nenhum, e aprová-lo arquivaria um ASO que não protege ninguém.',
      field: 'workerName',
    });
  }

  if (!fields.examDate) {
    issues.push({
      code: 'missing_exam_date',
      severity: 'blocker',
      label: 'Data do exame não lida',
      detail: 'Sem a data do exame não há como apurar vencimento nem comparar com o eSocial.',
      field: 'examDate',
    });
  }

  if (!fields.result) {
    issues.push({
      code: 'missing_result',
      severity: 'blocker',
      label: 'Resultado não lido',
      detail:
        'Apto ou inapto é a conclusão do ASO. Arquivar sem ela guarda o papel e perde o que ele decide.',
      field: 'result',
    });
  }

  if (!fields.examKind) {
    issues.push({
      code: 'unclear_exam_kind',
      severity: 'blocker',
      label: 'Tipo de exame indefinido',
      detail:
        'O tipo determina a periodicidade e a comparação com o S-2220. Sem ele, nem a validade inferida pode ser calculada.',
      field: 'examKind',
    });
  }

  // Correção manual reescreve os campos, mas não a confiança — ela continua
  // descrevendo a leitura ORIGINAL. Cobrá-la de um documento já corrigido à mão
  // puniria exatamente quem fez o trabalho de conferir.
  if (
    extractionMethod !== 'manual' &&
    extractionConfidence !== null &&
    extractionConfidence < ASO_MIN_CONFIDENCE
  ) {
    issues.push({
      code: 'low_confidence',
      severity: 'blocker',
      label: 'Leitura pouco confiável',
      detail: `A extração ficou em ${(extractionConfidence * 100).toFixed(0)}% de confiança, abaixo do piso de ${(ASO_MIN_CONFIDENCE * 100).toFixed(0)}%. Confira os campos contra o PDF antes de confirmar.`,
    });
  }

  if (fields.examDate && fields.examDate > today) {
    issues.push({
      code: 'inconsistent_dates',
      severity: 'blocker',
      label: 'Data do exame no futuro',
      detail: `O exame está datado de ${fields.examDate}, depois de hoje — quase sempre é o ano lido errado.`,
      field: 'examDate',
    });
  } else if (fields.validityDate && fields.examDate && fields.validityDate < fields.examDate) {
    issues.push({
      code: 'inconsistent_dates',
      severity: 'blocker',
      label: 'Validade anterior ao exame',
      detail: `A validade (${fields.validityDate}) é anterior à data do exame (${fields.examDate}).`,
      field: 'validityDate',
    });
  }

  const conflict = (input.siblings ?? []).find(
    (s) =>
      s.id !== input.documentId &&
      s.documentStatus !== 'rejected' &&
      s.examDate &&
      fields.examDate &&
      daysApart(s.examDate, fields.examDate) <= CONFLICT_WINDOW_DAYS,
  );
  if (conflict) {
    issues.push({
      code: 'conflicting_document',
      severity: 'blocker',
      label: 'Outro ASO para o mesmo exame',
      detail:
        'Já existe outro documento deste colaborador com data de exame praticamente igual. Confirme qual é o válido e rejeite o outro antes de arquivar — dois ASOs do mesmo exame disputando o indicador é pior que nenhum.',
    });
  }

  if (!fields.validityDate) {
    issues.push({
      code: 'missing_validity',
      severity: 'caution',
      label: 'Sem validade apurável',
      detail:
        'O documento não declara validade e o tipo de exame não permite deduzi-la. Confirmar é legítimo — o ASO fica arquivado sem controle de vencimento, que é o estado correto para admissional e demissional.',
      field: 'validityDate',
    });
  }

  const blockers = issues.filter((i) => i.severity === 'blocker');
  const cautions = issues.filter((i) => i.severity === 'caution');

  return {
    issues,
    blockers,
    cautions,
    eligibleForBulk: issues.length === 0,
    eligibleForConfirmation: blockers.length === 0,
    requiresAcknowledgement: cautions.length > 0,
  };
}

/**
 * Estado sugerido para um documento que NÃO pode ser confirmado.
 *
 * Impeditivo que uma correção resolve vira `correction_requested` — ele tem
 * dono e próxima ação. O resto fica `pending`, que é "alguém precisa olhar".
 */
export function suggestedStatusFor(readiness: AsoApprovalReadiness): AsoReviewStatus {
  if (readiness.blockers.length === 0) return 'pending';
  return readiness.blockers.some((b) => b.field) ? 'correction_requested' : 'pending';
}

/**
 * Monta o retrato de auditoria de uma aprovação.
 *
 * As ressalvas entram carimbadas com QUEM reconheceu e QUANDO — que é o par que
 * transforma "o ASO foi aprovado sem validade declarada" de anomalia em decisão
 * registrada. Sem o carimbo, os dois casos ficam indistinguíveis na base, e o
 * primeiro é um problema enquanto o segundo é o funcionamento normal.
 */
export function buildApprovalSnapshot(
  readiness: AsoApprovalReadiness,
  opts: { mode: 'individual' | 'bulk'; userId: string; at: string },
): AsoApprovalSnapshot {
  return {
    mode: opts.mode,
    blockers: readiness.blockers.map((b) => ({
      code: b.code,
      field: b.field ?? null,
      message: `${b.label}. ${b.detail}`,
    })),
    cautions: readiness.cautions.map((c) => ({
      code: c.code,
      field: c.field ?? null,
      message: `${c.label}. ${c.detail}`,
      acknowledged_by: opts.userId,
      acknowledged_at: opts.at,
    })),
    eligibleForBulk: readiness.eligibleForBulk,
  };
}

/**
 * Snapshot do que o RH assumiu ao confirmar.
 *
 * Copia TODOS os campos vigentes para a overlay de revisão: aprovar é vouching
 * pelo conjunto inteiro, e não só pelo que a pessoa digitou. A distinção entre
 * "corrigi" e "conferi e aceitei" não se perde — ela é recuperável comparando
 * com `extracted_fields_json`, que continua intocado. É para isso que
 * `fieldOrigin` recebe as duas camadas.
 */
export function confirmedFields(effective: AsoFields, currentReviewed: AsoFields): AsoFields {
  const confirmed: AsoFields = { ...currentReviewed };
  for (const field of ASO_EDITABLE_FIELDS) {
    const value = effective[field];
    (confirmed as Record<string, unknown>)[field] = value === undefined ? null : value;
  }
  confirmed.validityBasis = effective.validityBasis;
  return confirmed;
}

/** Projeção estável de `review_status`, espelhando o trigger da migration 089. */
export function documentStatusFor(review: AsoReviewStatus): AsoDocumentStatus {
  switch (review) {
    case 'approved':
      return 'approved';
    case 'rejected':
      return 'rejected';
    case 'correction_requested':
      return 'needs_correction';
    default:
      return 'pending_review';
  }
}

export interface AsoReviewOutcome {
  reviewStatus: AsoReviewStatus;
  documentStatus: AsoDocumentStatus;
  /** `null` quando a ação não é uma decisão (edição pura mantém o revisor anterior). */
  reviewedBy: string | null;
  reviewedAt: string | null;
  entry: AsoReviewEntry;
}

/**
 * Próximo estado da revisão.
 *
 * Editar campos NÃO aprova e NÃO reprova: deixa o documento onde estava (ou o
 * traz de volta para pendente, se estava aguardando correção). Quem separa as
 * duas coisas é o RH, no clique — e é essa separação que impede uma correção
 * de digitação de virar, sem querer, um atestado de aptidão validado.
 */
export function nextReviewState(
  action: AsoReviewAction,
  current: {
    reviewStatus: AsoReviewStatus;
    reviewedBy: string | null;
    reviewedAt: string | null;
  },
  actor: { userId: string; at?: string },
  detail: {
    fields?: AsoEditableField[];
    note?: string | null;
    /** Retrato do portão. Só faz sentido — e só é gravado — em `approve`. */
    approval?: AsoApprovalSnapshot;
  } = {},
): AsoReviewOutcome {
  const at = actor.at ?? new Date().toISOString();
  const entry: AsoReviewEntry = {
    at,
    by: actor.userId,
    action,
    ...(detail.fields && detail.fields.length > 0 ? { fields: detail.fields } : {}),
    ...(detail.note !== undefined ? { note: detail.note } : {}),
    // Amarrado a `approve`: um retrato de aprovação numa entrada de rejeição
    // seria uma evidência falsa esperando para ser lida errada.
    ...(action === 'approve' && detail.approval ? { approval: detail.approval } : {}),
  };

  if (action === 'edit') {
    // Correção aplicada sobre um documento devolvido reabre a revisão: alguém
    // atendeu ao pedido, e ele volta para a fila em vez de ficar preso.
    const reviewStatus: AsoReviewStatus =
      current.reviewStatus === 'correction_requested' ? 'pending' : current.reviewStatus;
    return {
      reviewStatus,
      documentStatus: documentStatusFor(reviewStatus),
      reviewedBy: reviewStatus === 'approved' ? current.reviewedBy : null,
      reviewedAt: reviewStatus === 'approved' ? current.reviewedAt : null,
      entry,
    };
  }

  const reviewStatus: AsoReviewStatus =
    action === 'approve'
      ? 'approved'
      : action === 'reject'
        ? 'rejected'
        : action === 'request_correction'
          ? 'correction_requested'
          : 'pending';

  return {
    reviewStatus,
    documentStatus: documentStatusFor(reviewStatus),
    reviewedBy: action === 'reopen' ? null : actor.userId,
    reviewedAt: action === 'reopen' ? null : at,
    entry,
  };
}
