import { ApiHeader, ApiParam } from "@nestjs/swagger";

const ApiWalletIdParam = () =>
  ApiParam({
    name: "walletId",
    description: "Wallet id returned by POST /wallets (16 characters)",
    example: "4f1c2a9be07d3e58",
    schema: { type: "string", minLength: 16, maxLength: 16 },
  });

const ApiCorrelationIdHeader = () =>
  ApiHeader({
    name: "X-Correlation-Id",
    required: false,
    description: "Optional. Echoed back and attached to every log and event of this request. Generated when absent.",
    schema: { type: "string", maxLength: 128, example: "c0a8017e-3f2b-4c1d-9e8f-1a2b3c4d5e6f" },
  });

export { ApiWalletIdParam, ApiCorrelationIdHeader };
