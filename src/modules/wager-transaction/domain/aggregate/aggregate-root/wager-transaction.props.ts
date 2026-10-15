import { DateValueObject, type IBaseDomainAggregate, IdValueObject } from "ddd-tool-kit";

import { FailureCode } from "../../../../../shared/domain/failure-code";
import { MoneyValueObject } from "../../../../wallet/domain/aggregate/value-objects/money/money.value-object";
import { WagerTransactionKind, WagerTransactionStatus, type WalletOperationKind } from "./wager-transaction.enums";

interface IWagerTransactionProps extends IBaseDomainAggregate {
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: IdValueObject;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: MoneyValueObject;
  /** Provider id of the referenced transaction, not our internal id. */
  referenceExternalTransactionId?: string;
  status: WagerTransactionStatus;
  /** Our internal id of the referenced transaction, filled when it is resolved. */
  referenceTransactionId?: IdValueObject;
  failureCode?: FailureCode;
  /** Wallet balance right after this transaction was decided. Returned on replay (OLD_README §7 rule 7). */
  observedBalance?: MoneyValueObject;
  processedAt?: DateValueObject;
  referenceAttempts: number;
  nextReferenceAttemptAt?: DateValueObject;
}

/** What a provider sends (HTTP body or SQS `data`), already validated into domain types. */
interface ICreateWagerTransactionProps {
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: IdValueObject;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: MoneyValueObject;
  referenceExternalTransactionId?: string;
}

interface ICreateOpeningProps {
  walletId: IdValueObject;
  playerId: string;
  money: MoneyValueObject;
  payloadHash: string;
}

/** Deposit or withdrawal requested for one wallet. The client's Idempotency-Key is scoped to the wallet. */
interface ICreateWalletOperationProps {
  kind: WalletOperationKind;
  walletId: IdValueObject;
  playerId: string;
  money: MoneyValueObject;
  /** The client's Idempotency-Key, as received. */
  clientIdempotencyKey: string;
  payloadHash: string;
}

export { type IWagerTransactionProps, type ICreateWagerTransactionProps, type ICreateOpeningProps, type ICreateWalletOperationProps };
