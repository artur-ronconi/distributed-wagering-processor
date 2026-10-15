import { type IError } from "ddd-tool-kit";
import { FailureCode } from "./failure-code";

interface IDomainError extends IError {
  code: FailureCode;
}

export { type IDomainError };
