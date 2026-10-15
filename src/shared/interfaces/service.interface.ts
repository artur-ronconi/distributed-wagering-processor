import { type IError, Output } from "ddd-tool-kit";

// IError is any object with { statusCode: HttpStatus; message: string; }.
// Our error constants are IDomainError (IError + `code`, the stable failureCode).
// Output<T> is an object with: { isSuccess: boolean; isFailure: boolean; result: T }.

interface Service<I, O> {
  execute(input: I): Promise<Output<O> | Output<IError>>;
}

export { type Service };
