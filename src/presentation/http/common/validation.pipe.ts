import { BadRequestException, type ValidationError, ValidationPipe } from "@nestjs/common";

import { FailureCode } from "../../../domain/shared/failure-code";

const flatten = (errors: ValidationError[], parent = ""): string[] =>
  errors.flatMap((error) => {
    const path = parent ? `${parent}.${error.property}` : error.property;
    const own = Object.values(error.constraints ?? {}).map((text) => text.replace(error.property, path));
    return [...own, ...flatten(error.children ?? [], path)];
  });

/** DTOs check the request shape; the domain checks the content. Errors use INVALID_PAYLOAD. */
const createValidationPipe = (): ValidationPipe =>
  new ValidationPipe({
    transform: true,
    whitelist: true,
    exceptionFactory: (errors) =>
      new BadRequestException({ code: FailureCode.InvalidPayload, message: flatten(errors).join("; ") }),
  });

export { createValidationPipe };
