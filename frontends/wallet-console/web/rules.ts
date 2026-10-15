/** Plain-language explanations of what the backend answered. */

const KIND_LABEL: Record<string, string> = {
  BET: "Aposta",
  WIN: "Vitória",
  LOSS: "Derrota",
  REFUND: "Reembolso",
  ROLLBACK: "Estorno",
};

const KIND_HELP: Record<string, string> = {
  BET: "Debita o valor apostado. Recusada se o saldo não cobre.",
  WIN: "Credita o prêmio. Pode apontar para a aposta da mesma rodada.",
  LOSS: "Registra que a rodada foi perdida. Não mexe no saldo (o valor já saiu na aposta).",
  REFUND: "Devolve uma aposta inteira (ex.: rodada cancelada). Mesmo valor, uma vez só.",
  ROLLBACK: "Desfaz uma aposta, vitória ou reembolso: faz o movimento contrário. Mesmo valor, uma vez só.",
};

const STATUS_LABEL: Record<string, string> = {
  PROCESSED: "Processada",
  REJECTED: "Rejeitada",
  PENDING_REFERENCE: "Aguardando referência",
  PENDING: "Pendente",
  FAILED: "Falhou",
  ERROR: "Erro",
};

const FAILURE: Record<string, string> = {
  INSUFFICIENT_FUNDS: "O saldo não cobre a aposta. A tentativa foi registrada como rejeitada e o saldo não mudou: nada fica negativo.",
  REVERSAL_WOULD_OVERDRAW:
    "Desfazer essa operação deixaria o saldo negativo (o dinheiro já foi gasto). É um código diferente de saldo insuficiente porque operacionalmente é outra situação.",
  REFERENCE_ALREADY_REVERSED: "Essa transação já foi desfeita antes. Uma aposta só pode ser revertida uma vez (reembolso e estorno somados).",
  REFERENCE_NOT_FOUND: "A transação referenciada nunca chegou. O sistema esperou e tentou de novo várias vezes antes de desistir.",
  REFERENCE_KIND_NOT_ALLOWED: "Esse tipo de operação não pode apontar para esse tipo de transação (ex.: reembolso só vale para aposta).",
  REFERENCE_MISMATCH: "A transação referenciada é de outra rodada, jogador, carteira ou moeda.",
  REFERENCE_AMOUNT_MISMATCH: "Reembolso e estorno precisam ter exatamente o mesmo valor da transação original (não existe reversão parcial).",
  REFERENCE_NOT_PROCESSED: "A transação referenciada não foi processada (foi rejeitada ou ainda está pendente), então não há o que desfazer.",
  WALLET_PLAYER_MISMATCH: "A carteira não pertence ao jogador informado.",
  CURRENCY_MISMATCH: "A moeda da operação é diferente da moeda da carteira.",
  IDEMPOTENCY_CONFLICT:
    "Essa Idempotency-Key já foi usada com outro conteúdo (ou esse id de transação já veio com outra key). O sistema recusa em vez de adivinhar qual vale.",
  INVALID_PAYLOAD: "A requisição tem formato inválido (ex.: valor sem exatamente 2 casas decimais).",
  INVALID_AMOUNT: "Valor inválido para essa operação.",
  WALLET_NOT_FOUND: "Carteira não encontrada.",
  WALLET_ALREADY_EXISTS: "Já existe uma carteira para esse jogador nessa moeda.",
  TRANSACTION_NOT_FOUND: "Transação não encontrada.",
  TRANSIENT_FAILURE: "A carteira estava ocupada demais (ou uma dependência caiu). Nada foi gravado: é seguro tentar de novo.",
  INTERNAL_ERROR: "Erro inesperado no servidor.",
  BACKEND_UNREACHABLE: "O backend não respondeu. Ele está no ar? (bun run start)",
  NETWORK: "O servidor do console não respondeu.",
};

type Tone = "ok" | "warn" | "fail" | "info";

interface Explanation {
  tone: Tone;
  title: string;
  text: string;
}

/** What a submit answer means, in words. */
const explainSubmit = (status: number, body: { status?: string; failureCode?: string | null; idempotentReplay?: boolean } | null, error: { code: string; message: string } | null): Explanation => {
  if (status === 200 && body?.idempotentReplay) {
    return {
      tone: "info",
      title: "Reenvio reconhecido (200)",
      text: "Mesma Idempotency-Key e mesmo conteúdo: o sistema devolveu o resultado original, inclusive o saldo daquele momento. Nada foi debitado ou creditado de novo.",
    };
  }
  if (status === 201) return { tone: "ok", title: "Processada (201)", text: "Aplicada agora. O saldo e o extrato já refletem a operação." };
  if (status === 202) {
    return {
      tone: "warn",
      title: "Aguardando referência (202)",
      text: "A transação aponta para outra que ainda não chegou. Ela foi guardada e um worker tenta de novo com espera crescente (1s, 2s, 4s… por ~5 min). Se a referência chegar, é aplicada sozinha.",
    };
  }
  if (status === 422) {
    const code = body?.failureCode ?? "";
    return { tone: "fail", title: `Rejeitada · ${code} (422)`, text: FAILURE[code] ?? "Violou uma regra de negócio. A tentativa fica registrada e o saldo não muda." };
  }
  const code = error?.code ?? "";
  return { tone: "fail", title: `${code || "Erro"} (${status || "sem resposta"})`, text: FAILURE[code] ?? error?.message ?? "" };
};

const failureText = (code: string | null | undefined) => (code ? FAILURE[code] ?? code : "");

export { explainSubmit, failureText, KIND_HELP, KIND_LABEL, STATUS_LABEL, type Explanation, type Tone };
