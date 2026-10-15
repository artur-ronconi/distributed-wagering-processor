# Wallet — `WalletAggregate`

OLD_README §6.2. Convenções gerais em @docs/domain/shared.md.

## Papel

**A carteira do jogador em uma moeda.** Guarda o saldo materializado (pronto para ler, sem somar o ledger) e protege as regras de saldo. É também a **unidade de concorrência**: o lock é por `walletId`, nunca global.

O aggregate é formado pela **Wallet** (root) e pelos seus **lançamentos no extrato** (`WalletLedgerEntryEntity`, entidade filha). A invariante *"toda alteração de saldo tem um lançamento correspondente"* envolve os dois, por isso eles ficam no mesmo aggregate. `debit()` e `credit()` mudam o saldo **e** adicionam o lançamento ao aggregate. O `WalletRepository` salva os dois juntos.

## Lançamentos: só os novos ficam em memória

Uma carteira pode ter milhares de lançamentos, e carregar o extrato inteiro para debitar 25.00 não é viável. Por isso o aggregate guarda apenas os lançamentos **criados nesta operação** (`newLedgerEntries`):

- `rehydrate` sempre começa com `newLedgerEntries = []`. O histórico nunca é carregado.
- `open`, `debit` e `credit` adicionam o lançamento novo.
- `WalletRepository.save` atualiza a linha da carteira e insere os lançamentos novos (append-only). Para isso chama `pullNewLedgerEntries()`, que devolve a lista e a esvazia, para que um segundo `save` não insira de novo.
- **Ler** o extrato (`GET /wallets/:id/ledger`) e a reconciliação são consultas diretas no banco (read side). Elas não passam pelo aggregate.
- Não existe repository próprio de lançamentos para escrita.

## Regras (invariantes)

- No máximo **uma wallet por `playerId + currency`** (`UNIQUE` no banco).
- Saldo **nunca negativo** (regra aqui + `CHECK` no banco).
- A moeda da operação é igual à moeda da wallet. Se não for, devolve `CURRENCY_MISMATCH`.
- `version` começa em **1** depois de `open` (mesmo com saldo inicial) e **só sobe quando o saldo muda**.
- Toda alteração de saldo adiciona um lançamento ao aggregate. Saldo e lançamento são salvos na mesma transação.
- Débito sem saldo: `INSUFFICIENT_FUNDS` para aposta. O use case passa `REVERSAL_WOULD_OVERDRAW` quando o débito é um estorno (OLD_README §7, regra 9).

## wallet.props.ts
```ts
import { IBaseDomainAggregate, IdValueObject } from "ddd-tool-kit";

import { MoneyValueObject } from "../money/money.value-object";
import { WalletLedgerEntryEntity } from "../wallet-ledger-entry/wallet-ledger-entry.entity";

interface IWalletProps extends IBaseDomainAggregate {
  playerId: string;
  currency: string;
  balance: MoneyValueObject;
  version: number;
  /** Only the entries created in this unit of work. History is never loaded. */
  newLedgerEntries: WalletLedgerEntryEntity[];
}

/** What the mapper provides: the persisted state, without in-memory entries. */
type IRehydrateWalletProps = Omit<IWalletProps, "newLedgerEntries">;

interface IOpenWalletProps {
  id?: IdValueObject;
  playerId: string;
  initialBalance: MoneyValueObject;
  /** Id of the internal OPENING WagerTransaction created by the use case. */
  openingTransactionId: IdValueObject;
}

export { IWalletProps, IRehydrateWalletProps, IOpenWalletProps };
```

## wallet.errors.ts
```ts
import { HttpStatus } from "ddd-tool-kit";
import { IDomainError } from "../shared/domain-error";
import { FailureCode } from "../shared/failure-code";

const INVALID_WALLET: IDomainError = {
  code: FailureCode.InvalidPayload,
  message: "Invalid wallet data.",
  statusCode: HttpStatus.BAD_REQUEST,
};

const WALLET_NOT_FOUND: IDomainError = {
  code: FailureCode.WalletNotFound,
  message: "Wallet does not exist.",
  statusCode: HttpStatus.NOT_FOUND,
};

const WALLET_ALREADY_EXISTS: IDomainError = {
  code: FailureCode.WalletAlreadyExists,
  message: "The player already has a wallet in this currency.",
  statusCode: HttpStatus.CONFLICT,
};

const WALLET_CURRENCY_MISMATCH: IDomainError = {
  code: FailureCode.CurrencyMismatch,
  message: "Operation currency differs from the wallet currency.",
  statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
};

const INVALID_MOVEMENT_AMOUNT: IDomainError = {
  code: FailureCode.InvalidAmount,
  message: "Debit and credit amounts must be positive.",
  statusCode: HttpStatus.BAD_REQUEST,
};

const INSUFFICIENT_FUNDS: IDomainError = {
  code: FailureCode.InsufficientFunds,
  message: "Wallet balance is not enough for this bet.",
  statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
};

const REVERSAL_WOULD_OVERDRAW: IDomainError = {
  code: FailureCode.ReversalWouldOverdraw,
  message: "Reversal rejected: the wallet balance would become negative.",
  statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
};

export {
  INVALID_WALLET,
  WALLET_NOT_FOUND,
  WALLET_ALREADY_EXISTS,
  WALLET_CURRENCY_MISMATCH,
  INVALID_MOVEMENT_AMOUNT,
  INSUFFICIENT_FUNDS,
  REVERSAL_WOULD_OVERDRAW,
};
```

## wallet.aggregate-root.ts
```ts
import {
  Aggregate,
  DateValueObject,
  IdValueObject,
  Output,
  throwFailOutput,
  verifyAllPropsExists,
  verifyAreEntities,
  verifyAreValueObjects,
} from "ddd-tool-kit";

import { IDomainError } from "../shared/domain-error";
import { MoneyValueObject } from "../money/money.value-object";
import { LedgerDirection } from "../wallet-ledger-entry/wallet-ledger-entry.props";
import { WalletLedgerEntryEntity } from "../wallet-ledger-entry/wallet-ledger-entry.entity";
import { IOpenWalletProps, IRehydrateWalletProps, IWalletProps } from "./wallet.props";
import {
  INSUFFICIENT_FUNDS,
  INVALID_MOVEMENT_AMOUNT,
  INVALID_WALLET,
  WALLET_CURRENCY_MISMATCH,
} from "./wallet.errors";

class WalletAggregate extends Aggregate<IWalletProps> {
  private constructor(props: IWalletProps) {
    super(props);
  }

  get playerId() {
    return this.props.playerId;
  }

  get currency() {
    return this.props.currency;
  }

  get balance() {
    return this.props.balance;
  }

  get version() {
    return this.props.version;
  }

  /** Entries created in this unit of work and not saved yet. */
  get newLedgerEntries(): readonly WalletLedgerEntryEntity[] {
    return this.props.newLedgerEntries;
  }

  /** Called by WalletRepository.save: returns the new entries and empties the list. */
  pullNewLedgerEntries(): WalletLedgerEntryEntity[] {
    const entries = this.props.newLedgerEntries;
    this.props.newLedgerEntries = [];
    return entries;
  }

  /**
   * Debits the wallet and adds the ledger entry that records it to the aggregate.
   * Returns the entry so the use case can build WalletBalanceChanged.
   * `insufficientFundsError` lets a ROLLBACK report REVERSAL_WOULD_OVERDRAW instead of INSUFFICIENT_FUNDS.
   */
  debit(
    money: MoneyValueObject,
    transactionId: IdValueObject,
    insufficientFundsError: IDomainError = INSUFFICIENT_FUNDS,
  ) {
    const invalidMovement = this.validateMovement(money);
    if (invalidMovement) return Output.fail(invalidMovement);

    if (this.props.balance.isLessThan(money)) return Output.fail(insufficientFundsError);

    return this.apply(LedgerDirection.Debit, money, transactionId);
  }

  /** Credits the wallet and adds the ledger entry that records it to the aggregate. */
  credit(money: MoneyValueObject, transactionId: IdValueObject) {
    const invalidMovement = this.validateMovement(money);
    if (invalidMovement) return Output.fail(invalidMovement);

    return this.apply(LedgerDirection.Credit, money, transactionId);
  }

  private validateMovement(money: MoneyValueObject): IDomainError | null {
    if (money.currency !== this.props.currency) return WALLET_CURRENCY_MISMATCH;
    if (!money.isPositive()) return INVALID_MOVEMENT_AMOUNT;
    return null;
  }

  /** Builds the entry first; the wallet only changes if the entry is valid. */
  private apply(direction: LedgerDirection, money: MoneyValueObject, transactionId: IdValueObject) {
    const balanceBefore = this.props.balance;
    const balanceAfter =
      direction === LedgerDirection.Debit ? balanceBefore.subtract(money) : balanceBefore.add(money);

    const createEntry = WalletLedgerEntryEntity.create({
      walletId: this.id,
      transactionId,
      direction,
      money,
      balanceBefore,
      balanceAfter,
    });
    if (createEntry.isFailure) return throwFailOutput(createEntry);

    const entry = createEntry.result as WalletLedgerEntryEntity;

    this.props.balance = balanceAfter;
    this.props.version += 1;
    this.props.updatedAt = DateValueObject.getDefault();
    this.props.newLedgerEntries.push(entry);

    return Output.success(entry);
  }

  protected sanitizeProps(): void {
    this.props.playerId = this.props.playerId?.trim();
  }

  protected isValidProps(): boolean {
    const valueObjects = ["balance", ...this.defaultValueObjects];
    const entities = ["newLedgerEntries"];
    const requiredProps = [...valueObjects, ...entities, "playerId", "currency", "version"];

    const allPropsExists = verifyAllPropsExists(requiredProps, this);
    const areValueObjects = verifyAreValueObjects(valueObjects, this);
    const areEntities = verifyAreEntities(entities, this);
    if (!allPropsExists || !areValueObjects || !areEntities) return false;

    return (
      this.props.balance.currency === this.props.currency &&
      !this.props.balance.isNegative() &&
      Number.isInteger(this.props.version) &&
      this.props.version >= 1
    );
  }

  /** OLD_README `Wallet.open`: version 1, plus the OPENING ledger entry when the initial balance > 0. */
  static open(props: IOpenWalletProps) {
    const { initialBalance } = props;

    const wallet = new WalletAggregate({
      id: props.id,
      playerId: props.playerId,
      currency: initialBalance.currency,
      balance: initialBalance,
      version: 1,
      newLedgerEntries: [],
    });

    const isInvalidProps = !wallet.isValidProps();
    if (isInvalidProps) return Output.fail(INVALID_WALLET);

    if (initialBalance.isZero()) return Output.success(wallet);

    const createEntry = WalletLedgerEntryEntity.create({
      walletId: wallet.id,
      transactionId: props.openingTransactionId,
      direction: LedgerDirection.Credit,
      money: initialBalance,
      balanceBefore: MoneyValueObject.zero(initialBalance.currency),
      balanceAfter: initialBalance,
    });
    if (createEntry.isFailure) return throwFailOutput(createEntry);

    wallet.props.newLedgerEntries.push(createEntry.result as WalletLedgerEntryEntity);

    return Output.success(wallet);
  }

  /** Rebuilds persisted state. Does not revalidate. History is never loaded. */
  static rehydrate(props: IRehydrateWalletProps): WalletAggregate {
    return new WalletAggregate({ ...props, newLedgerEntries: [] });
  }
}

export { WalletAggregate };
```

## wallet.repository.ts (porta, application)
```ts
import { IdValueObject } from "ddd-tool-kit";
import { WalletAggregate } from "../../domain/wallet/wallet.aggregate-root";

interface WalletRepository {
  findById(id: IdValueObject): Promise<WalletAggregate | null>;
  /** Must run inside uow.transactional. Locks only this wallet's row until commit. */
  findByIdForUpdate(id: IdValueObject): Promise<WalletAggregate | null>;
  /** Inserts the wallet and its new ledger entries. UNIQUE (player_id, currency) → WALLET_ALREADY_EXISTS. */
  insert(wallet: WalletAggregate): Promise<void>;
  /** Updates the wallet (conditioned on expectedVersion) and appends its new ledger entries. */
  save(wallet: WalletAggregate, expectedVersion: number): Promise<void>;
}

export { WalletRepository };
```

## mikro-orm.wallet.repository.ts (infrastructure, trecho)
```ts
async save(wallet: WalletAggregate, expectedVersion: number): Promise<void> {
  const { id, createdAt, ...changes } = this.walletMapper.toLeftSide(wallet);

  const affected = await this.em.nativeUpdate(WalletSchema, { id, version: expectedVersion }, changes);
  if (affected === 0) throw new ConcurrencyConflictError("Wallet", id, expectedVersion);

  // Child entities are saved through the root. Append-only: insert, never update or delete.
  for (const entry of wallet.pullNewLedgerEntries()) {
    await this.em.insert(WalletLedgerEntrySchema, this.ledgerEntryMapper.toLeftSide(entry));
  }
}
```

## Uso

### Criar wallet (`POST /wallets`)
```ts
const walletId = IdValueObject.getDefault();

// 1. OPENING transaction (internal, already PROCESSED). See @docs/domain/wager-transaction.md
const opening = WagerTransactionAggregate.createOpening({ walletId, playerId, money: initialBalance, payloadHash });

// 2. Wallet + opening ledger entry inside the aggregate
const openWallet = WalletAggregate.open({
  id: walletId,
  playerId,
  initialBalance,
  openingTransactionId: opening.id,
});
if (openWallet.isFailure) return throwFailOutput(openWallet);

const wallet = openWallet.result as WalletAggregate;
const openingEntry = wallet.newLedgerEntries[0]; // undefined when the initial balance is zero

// 3. One SQL transaction: OPENING transaction, wallet + entry (walletRepository.insert), outbox.
//    The UNIQUE (player_id, currency) violation becomes WALLET_ALREADY_EXISTS (409).
```

### Aposta (`BET`)
```ts
await uow.transactional(async () => {
  const wallet = await walletRepository.findByIdForUpdate(walletId); // locks only this wallet
  if (!wallet) return Output.fail(WALLET_NOT_FOUND);

  const expectedVersion = wallet.version;
  const debit = wallet.debit(tx.money, tx.id);

  if (debit.isFailure) {
    tx.reject((debit.result as IDomainError).code, DateValueObject.getDefault(), wallet.balance);
    // save tx (REJECTED) + outbox WagerTransactionRejected. Wallet untouched.
  } else {
    const entry = debit.result as WalletLedgerEntryEntity;
    tx.markProcessed(undefined, DateValueObject.getDefault(), wallet.balance);
    await walletRepository.save(wallet, expectedVersion); // wallet row + new ledger entry
    // save tx + outbox WagerTransactionProcessed + WalletBalanceChanged.from(wallet, entry, ctx)
  }
});
```

## Trade-off: dois aggregates na mesma transação

A recomendação do DDD é modificar **um** aggregate por transação. Aqui uma transação SQL salva a `Wallet` e a `WagerTransaction` (mais inbox e outbox). É uma escolha consciente: o OLD_README (§6.5 e §11) exige que tudo isso seja atômico. Documentar no `ARCHITECTURE.md`.

## Persistência

```sql
create table "wallets" (
  "id"             char(16)      primary key,
  "player_id"      text          not null,
  "currency"       char(3)       not null,
  "balance_amount" numeric(19,2) not null check ("balance_amount" >= 0),
  "version"        integer       not null check ("version" >= 1),
  "created_at"     timestamptz   not null,
  "updated_at"     timestamptz   not null,
  constraint "wallets_player_currency_unique" unique ("player_id", "currency")
);
```

A tabela dos lançamentos está em @docs/domain/wallet-ledger-entry.md.

## Testes unitários obrigatórios

- `open` com saldo inicial > 0: `version = 1` e um lançamento novo CREDIT `0.00 → inicial`.
- `open` com saldo zero: nenhum lançamento novo.
- `rehydrate` começa sem lançamentos novos.
- `debit` com saldo suficiente: saldo cai, `version` sobe 1, um lançamento DEBIT balanceado em `newLedgerEntries`.
- `debit` sem saldo: `INSUFFICIENT_FUNDS`, saldo, `version` e `newLedgerEntries` inalterados.
- `debit` com `REVERSAL_WOULD_OVERDRAW`: devolve esse código.
- `credit` soma, `version` sobe 1.
- Moeda diferente: `CURRENCY_MISMATCH`, nada muda.
- Valor zero: `INVALID_AMOUNT`, nada muda.
- `pullNewLedgerEntries` devolve os lançamentos e esvazia a lista.
