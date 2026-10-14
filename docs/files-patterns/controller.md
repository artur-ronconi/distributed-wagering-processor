> _**Observation:**_  
> _You will need to replace "Any" with the correct names when writing the files._
>
> _Controllers only translate HTTP ⇄ service. No business rules. The SQS consumer calls the same service._
>
> _HTTP statuses must distinguish, consistently across every endpoint (OLD_README §9): invalid payload, idempotency conflict, business rejection, accepted with pending processing, and transient infrastructure failure. Error bodies always include the `failureCode` (`code`) so the provider does not need to parse messages. The mapping is documented in `ARCHITECTURE.md`._
>
> _`/health/live` and `/health/ready` never require authentication._

## create-any.controller.ts
```ts
import { Body, Controller, Headers, HttpCode, HttpStatus, Post } from "@nestjs/common";

import { CreateAnyService } from "../../application/use-cases/create-any/create-any.service";
import { ICreateAnyServiceOutput } from "../../application/use-cases/create-any/create-any.output";
import { CreateAnyRequestDto } from "../dtos/create-any.request.dto";
import { getCorrectNestjsErrorByOutput } from "../errors/get-correct-nestjs-error-by-output";

@Controller("anys")
class CreateAnyController {
  constructor(private readonly createAnyService: CreateAnyService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async execute(
    @Body() body: CreateAnyRequestDto,
    @Headers("x-correlation-id") correlationId?: string,
  ) {
    const output = await this.createAnyService.execute({
      ...body,
      correlationId: correlationId ?? crypto.randomUUID(),
    });

    if (output.isFailure) {
      /*
        In this case output.result is an error object, for example:
        const INVALID_ANY: IDomainError = {
          code: FailureCode.InvalidPayload,     // "INVALID_PAYLOAD"
          message: "Any must contain at most 20 characters.",
          statusCode: HttpStatus.BAD_REQUEST,
        };
        The thrown Nest exception keeps statusCode and returns { code, message } in the body.
      */
      throw getCorrectNestjsErrorByOutput(output);
    }

    // In this case output.result is the service output
    return output.result as ICreateAnyServiceOutput;
  }
}

export { CreateAnyController };
```

> _**Endpoints with idempotency (`POST /wagering/transactions`)**_  
> _Read the `Idempotency-Key` with `@Headers("idempotency-key")`. Missing key is an invalid payload. The status depends on the result, not on a fixed `@HttpCode`: e.g. `201` new and processed, `200` replay (`idempotentReplay: true`), `202` `PENDING_REFERENCE`. Use `@Res({ passthrough: true })` to set it._
