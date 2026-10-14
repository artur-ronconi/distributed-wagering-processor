import { HttpStatus } from "ddd-tool-kit";
import { type IDomainError } from "../shared/domain-error";
import { FailureCode } from "../shared/failure-code";

// Should never reach the provider: the Wallet only builds balanced entries.
// If it happens, it is a bug, so it is reported as 500 by the use case.
const UNBALANCED_LEDGER_ENTRY: IDomainError = {
  code: FailureCode.InvalidAmount,
  message: "Ledger entry is not balanced: balanceBefore ± money must equal balanceAfter.",
  statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
};

export { UNBALANCED_LEDGER_ENTRY };
