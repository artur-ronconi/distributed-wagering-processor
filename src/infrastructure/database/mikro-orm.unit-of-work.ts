import { IsolationLevel } from "@mikro-orm/core";
import { EntityManager } from "@mikro-orm/postgresql";
import { Inject, Injectable } from "@nestjs/common";

import { APP_CONFIG, AppConfig } from "../../config/app-config";
import { TransactionOptions, UnitOfWork } from "../../application/ports/unit-of-work.port";
import { translateDatabaseError } from "./database-error.translator";

const ISOLATION: Record<NonNullable<TransactionOptions["isolation"]>, IsolationLevel> = {
  "READ COMMITTED": IsolationLevel.READ_COMMITTED,
  "REPEATABLE READ": IsolationLevel.REPEATABLE_READ,
  SERIALIZABLE: IsolationLevel.SERIALIZABLE,
};

@Injectable()
class MikroOrmUnitOfWork implements UnitOfWork {
  constructor(
    private readonly em: EntityManager,
    @Inject(APP_CONFIG) private readonly config: Pick<AppConfig, "lockTimeoutMs">,
  ) {}

  // Inside the callback, MikroORM's transaction context makes the EntityManager injected
  // in every repository resolve to the same transactional fork.
  async transactional<T>(work: () => Promise<T>, options: TransactionOptions = {}): Promise<T> {
    try {
      return await this.em.transactional(
        async (em) => {
          // A hot wallet must not hold requests forever: give up and answer 503 instead.
          await em.execute(`set local lock_timeout = '${Math.trunc(this.config.lockTimeoutMs)}ms'`);
          return work();
        },
        {
          isolationLevel: options.isolation ? ISOLATION[options.isolation] : undefined,
          readOnly: options.readOnly,
        },
      );
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }
}

export { MikroOrmUnitOfWork };
