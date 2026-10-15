import { SetMetadata } from "@nestjs/common";

const IS_PUBLIC = "isPublic";

/** Routes that never require authentication (health checks, docs, metrics). */
const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);

export { Public, IS_PUBLIC };
