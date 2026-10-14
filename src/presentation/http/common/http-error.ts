import { HttpException } from "@nestjs/common";
import { type IError, Output } from "ddd-tool-kit";

import { type IDomainError } from "../../../domain/shared/domain-error";
import { FailureCode } from "../../../domain/shared/failure-code";

/** Turns a failed service Output into the HTTP exception with the standard error body. */
const httpErrorFrom = (output: Output<IError> | Output<unknown>): HttpException => {
  const error = output.result as IDomainError;
  return new HttpException(
    { code: error.code ?? FailureCode.InternalError, message: error.message },
    error.statusCode ?? 500,
  );
};

export { httpErrorFrom };
