import { type WagerTransactionResultView } from "../../views/wager-transaction.view";

type ISubmitWagerTransactionServiceOutput = WagerTransactionResultView;

/** The consumer also needs to know when the inbox already had the message. */
type ISubmitWagerMessageOutput =
  | { duplicateMessage: true }
  | { duplicateMessage: false; result: WagerTransactionResultView };

export { type ISubmitWagerTransactionServiceOutput, type ISubmitWagerMessageOutput };
