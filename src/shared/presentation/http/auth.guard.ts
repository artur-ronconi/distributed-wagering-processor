import { type CanActivate, type ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { IS_PUBLIC } from "./public.decorator";

/**
 * Authentication extension point (OLD_README §2). Intentionally a no-op: authentication is out of
 * the scored scope and the decision is documented in ARCHITECTURE.md.
 *
 * To enable it: validate the `Authorization: Bearer` JWT against an external IdP's JWKS
 * (Keycloak/Zitadel), check the provider identity claim against the request's providerId,
 * and keep routes marked with @Public() open.
 */
@Injectable()
class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;
    return true; // no-op: every non-public route would be authenticated here
  }
}

export { AuthGuard };
