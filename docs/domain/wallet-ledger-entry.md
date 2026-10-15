# WalletLedgerEntry — `WalletLedgerEntryEntity`

OLD_README §6.4. Convenções gerais em @docs/domain/shared.md.

## Papel

**Uma linha do extrato.** Registra uma mudança de saldo: direção, valor, saldo antes e saldo depois. É a prova auditável de cada movimentação. Somando o ledger inteiro, você reconstrói o saldo da carteira (reconciliação).

Não confunda com a `WagerTransaction`: ela é o **pedido** do provedor (existe mesmo se for rejeitada ou se não mexer no saldo). O lançamento só existe quando o dinheiro **de fato** se moveu.

## Lugar no modelo: entidade filha da Wallet

O lançamento **não é um aggregate**. Ele é uma entidade **dentro do aggregate `Wallet`** (@docs/domain/wallet.md), porque a invariante *"toda alteração de saldo tem um lançamento correspondente"* envolve o saldo e o lançamento ao mesmo tempo.

- **Escrita:** só pela `WalletAggregate` (`open`, `debit`, `credit`), que guarda os lançamentos novos em `newLedgerEntries`. O `WalletRepository.save` insere esses lançamentos junto com a atualização da carteira. **Não existe repository próprio de escrita.**
- **Leitura:** o extrato paginado (`GET /wallets/:id/ledger`) e a reconciliação são consultas diretas (read side) que devolvem DTOs ou somas. O histórico nunca é carregado dentro do aggregate.

## Regras

- **Imutável por estrutura:** sem setters, sem métodos de transição e `props` congelado com `Object.freeze`. O banco também bloqueia `UPDATE` e `DELETE` (trigger append-only).
- `create` valida a aritmética: `balanceBefore ± money === balanceAfter`.
- `money` sempre positivo. A direção (`DEBIT`/`CREDIT`) diz se soma ou subtrai.
- `balanceAfter` nunca negativo.
- As três quantias têm a mesma moeda.
- No máximo **um lançamento por transação por wallet** (`UNIQUE (transaction_id, wallet_id)` no banco).
- `LOSS` e transações `REJECTED` **não** geram lançamento.
- Quem cria lançamentos é a `WalletAggregate` (`open`, `debit`, `credit`). Nem o use case nem repositories chamam `create` direto.

## wallet-ledger-entry.props.ts
```ts
import { DateValueObject, IBaseDomainEntity, IdValueObject } from "ddd-tool-kit";
import { MoneyValueObject } from "../money/money.value-object";

enum LedgerDirection {
  Debit = "DEBIT",
  Credit = "CREDIT",
}

interface IWalletLedgerEntryProps extends IBaseDomainEntity {
  walletId: IdValueObject;
  transactionId: IdValueObject;
  direction: LedgerDirection;
  money: MoneyValueObject;
  balanceBefore: MoneyValueObject;
  balanceAfter: MoneyValueObject;
  createdAt?: DateValueObject;
}

export { LedgerDirection, IWalletLedgerEntryProps };
```

## wallet-ledger-entry.errors.ts
```ts
import { HttpStatus } from "ddd-tool-kit";
import { IDomainError } from "../shared/domain-error";
import { FailureCode } from "../shared/failure-code";

// Should never reach the provider: the Wallet only builds balanced entries.
// If it happens, it is a bug, so it is reported as 500 by the use case.
const UNBALANCED_LEDGER_ENTRY: IDomainError = {
  code: FailureCode.InvalidAmount,
  message: "Ledger entry is not balanced: balanceBefore ± money must equal balanceAfter.",
  statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
};

export { UNBALANCED_LEDGER_ENTRY };
```

## wallet-ledger-entry.entity.ts
```ts
import {
  DateValueObject,
  Entity,
  Output,
  verifyAllPropsExists,
  verifyAreValueObjects,
} from "ddd-tool-kit";

import { IWalletLedgerEntryProps, LedgerDirection } from "./wallet-ledger-entry.props";
import { UNBALANCED_LEDGER_ENTRY } from "./wallet-ledger-entry.errors";

class WalletLedgerEntryEntity extends Entity<IWalletLedgerEntryProps> {
  private constructor(props: IWalletLedgerEntryProps) {
    super(props);
    this.props.createdAt = props.createdAt ?? DateValueObject.getDefault();
    Object.freeze(this.props); // structural immutability: no field can change after this line
  }

  get walletId() {
    return this.props.walletId;
  }

  get transactionId() {
    return this.props.transactionId;
  }

  get direction() {
    return this.props.direction;
  }

  get money() {
    return this.props.money;
  }

  get balanceBefore() {
    return this.props.balanceBefore;
  }

  get balanceAfter() {
    return this.props.balanceAfter;
  }

  get createdAt() {
    return this.props.createdAt as DateValueObject;
  }

  /** balanceBefore ± money === balanceAfter */
  isBalanced(): boolean {
    const { money, balanceBefore, balanceAfter, direction } = this.props;

    const sameCurrency =
      money.currency === balanceBefore.currency && money.currency === balanceAfter.currency;
    if (!sameCurrency) return false;

    const expected =
      direction === LedgerDirection.Credit ? balanceBefore.add(money) : balanceBefore.subtract(money);

    return expected.equals(balanceAfter);
  }

  protected sanitizeProps(): void {}

  protected isValidProps(): boolean {
    const valueObjects = [
      "walletId",
      "transactionId",
      "money",
      "balanceBefore",
      "balanceAfter",
      "createdAt",
      ...this.defaultValueObjects,
    ];
    const requiredProps = [...valueObjects, "direction"];

    const allPropsExists = verifyAllPropsExists(requiredProps, this);
    const areValueObjects = verifyAreValueObjects(valueObjects, this);
    if (!allPropsExists || !areValueObjects) return false;

    const isKnownDirection = Object.values(LedgerDirection).includes(this.props.direction);

    return (
      isKnownDirection &&
      this.props.money.isPositive() &&
      !this.props.balanceAfter.isNegative() &&
      this.isBalanced()
    );
  }

  static create(props: IWalletLedgerEntryProps) {
    const entry = new WalletLedgerEntryEntity(props);

    const isInvalidProps = !entry.isValidProps();
    if (isInvalidProps) return Output.fail(UNBALANCED_LEDGER_ENTRY);

    return Output.success(entry);
  }

  /** Rebuilds persisted state. Does not revalidate. */
  static rehydrate(props: IWalletLedgerEntryProps): WalletLedgerEntryEntity {
    return new WalletLedgerEntryEntity(props);
  }
}

export { WalletLedgerEntryEntity };
```

## Persistência

```sql
create table "wallet_ledger_entries" (
  "id"                    char(16)      primary key,
  "wallet_id"             char(16)      not null references "wallets" ("id"),
  "transaction_id"        char(16)      not null references "wager_transactions" ("id") deferrable initially deferred,
  "direction"             text          not null check ("direction" in ('DEBIT', 'CREDIT')),
  "amount"                numeric(19,2) not null check ("amount" > 0),
  "balance_before_amount" numeric(19,2) not null check ("balance_before_amount" >= 0),
  "balance_after_amount"  numeric(19,2) not null check ("balance_after_amount" >= 0),
  "currency"              char(3)       not null,
  "created_at"            timestamptz   not null,
  constraint "ledger_one_entry_per_transaction" unique ("transaction_id", "wallet_id"),
  check (
    ("direction" = 'CREDIT' and "balance_after_amount" = "balance_before_amount" + "amount") or
    ("direction" = 'DEBIT'  and "balance_after_amount" = "balance_before_amount" - "amount")
  )
);
-- + trigger append-only (ver @docs/files-patterns/schema.md)
-- FK to wager_transactions is DEFERRABLE: checked at COMMIT, so the order of the INSERTs inside the
-- transaction does not matter (WalletRepository inserts the entry together with the wallet, and the
-- WagerTransaction may be inserted after it).
-- + índice para paginação do extrato: (wallet_id, created_at, id)
```

Uma moeda só por linha: as três quantias compartilham `currency`. Quem grava é o `WalletRepository.save` (só `insert`). Nunca `update` nem `delete`.

`rehydrate` existe para quem precisar reconstruir um lançamento lido do banco (ex.: testes de integração que comparam o extrato). O extrato da API pode ir direto do banco para o DTO.

## Testes unitários obrigatórios

- `create` aceita CREDIT `100.00 + 25.00 = 125.00` e DEBIT `100.00 - 25.00 = 75.00`.
- `create` rejeita conta errada, `money` zero ou negativo, `balanceAfter` negativo e moedas diferentes.
- Depois de criado, tentar alterar `props` lança `TypeError` (objeto congelado + strict mode) e o valor continua o mesmo.
