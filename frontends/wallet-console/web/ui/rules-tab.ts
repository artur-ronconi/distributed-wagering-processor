import { h, rich } from "./dom";

const RULES: Array<{ icon: string; title: string; text: string }> = [
  {
    icon: "💰",
    title: "Dinheiro é exato",
    text: "Valores trafegam como texto com **exatamente 2 casas** (`25.00`) e são guardados em centavos inteiros. Nada é arredondado: `1.234` é recusado.",
  },
  {
    icon: "🧱",
    title: "O saldo nunca fica negativo",
    text: "Uma aposta maior que o saldo é **rejeitada e registrada**. Desfazer algo cujo dinheiro já foi gasto tem um código próprio (`REVERSAL_WOULD_OVERDRAW`).",
  },
  {
    icon: "🔁",
    title: "Reenviar é seguro",
    text: "Toda transação vai com uma `Idempotency-Key`. A mesma key com o mesmo conteúdo devolve **o resultado original** (até o saldo daquele momento). A mesma key com outro conteúdo é `409`.",
  },
  {
    icon: "🆔",
    title: "Uma transação, uma identidade",
    text: "O `externalTransactionId` é o id da transação no sistema do provedor. Ele fica amarrado à sua key: o mesmo id com outra key é recusado.",
  },
  {
    icon: "🎯",
    title: "Tipos de transação",
    text: "**Aposta** debita. **Vitória** credita (pode apontar para a aposta). **Derrota** só registra. **Reembolso** devolve uma aposta. **Estorno** faz o contrário do que a transação original fez.",
  },
  {
    icon: "↩️",
    title: "Reverter, só uma vez e por inteiro",
    text: "Reembolso e estorno precisam do **mesmo valor** da original, da mesma rodada e carteira. Uma aposta só pode ser revertida **uma vez** (reembolso e estorno contam juntos).",
  },
  {
    icon: "⏳",
    title: "Fora de ordem não é erro",
    text: "Se um estorno chega antes da aposta, ele fica **aguardando referência** (`202`). Um worker tenta de novo com espera crescente e aplica sozinho quando a aposta chega. Depois de ~5 min, desiste com `REFERENCE_NOT_FOUND`.",
  },
  {
    icon: "🔒",
    title: "Uma carteira por vez",
    text: "Operações na **mesma** carteira entram em fila (lock da linha no banco). Carteiras diferentes andam em paralelo. Duas apostas simultâneas nunca gastam o mesmo dinheiro.",
  },
  {
    icon: "📒",
    title: "Extrato imutável",
    text: "Todo movimento gera um lançamento com saldo antes e depois. O extrato só cresce: o próprio banco recusa alterar ou apagar. O saldo pode sempre ser conferido somando o extrato.",
  },
  {
    icon: "📣",
    title: "Eventos só depois do commit",
    text: "Cada resultado gera eventos (`WagerTransactionProcessed`, `WalletBalanceChanged`…) gravados **na mesma transação** do dinheiro e publicados na fila depois. Nunca sai evento de algo que não foi gravado.",
  },
];

const rulesTab = () =>
  h(
    "div",
    { class: "tab-rules" },
    h("p", { class: "muted small" }, "Resumo das regras que o backend garante. Use o Laboratório para ver cada uma acontecer."),
    h(
      "div",
      { class: "rules-grid" },
      ...RULES.map((rule) => h("div", { class: "card rule" }, h("span", { class: "rule-icon" }, rule.icon), h("h4", {}, rule.title), h("p", {}, rich(rule.text)))),
    ),
  );

export { rulesTab };
