> _**Observation:**_  
> _You will need to replace "Any" with the correct names when writing the files._
>
> _ORM: **MikroORM** (OLD_README §4). Prisma is out of scope._
>
> _Domain classes are **not** ORM entities. Each table is described by a MikroORM `EntitySchema` in the infrastructure layer, and a bidirectional mapper converts schema ⇄ domain (see @docs/files-patterns/bidirectional-mapper.md). The domain never imports MikroORM._
>
> _The **migrations are the canonical database schema**. Unique constraints, `CHECK`s, partial indexes and append-only triggers are part of the evaluation (OLD_README §5.9), so they are written explicitly in the migration SQL. Every migration must have a working `down()`._

## any.schema.ts
```ts
import { EntitySchema } from "@mikro-orm/core";

interface IAnySchema {
  id: string;
  name: string;
  amount: string;   // NUMERIC(19,2) is read as a string: exact, never a JS number
  currency: string; // ISO-4217
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

// Column names become snake_case through MikroORM's default UnderscoreNamingStrategy.
const AnySchema = new EntitySchema<IAnySchema>({
  name: "Any",
  tableName: "anys",
  properties: {
    id: { type: "string", length: 16, primary: true }, // IdValueObject: 16 chars, not UUID
    name: { type: "string" },
    amount: { type: "decimal", precision: 19, scale: 2 },
    currency: { type: "string", length: 3 },
    version: { type: "integer" },
    createdAt: { type: "datetime" },
    updatedAt: { type: "datetime" },
  },
});

export { AnySchema, IAnySchema };
```

## any-entry.schema.ts (append-only child table, e.g. a ledger)
```ts
import { EntitySchema } from "@mikro-orm/core";

interface IAnyEntrySchema {
  id: string;
  anyId: string;
  direction: "DEBIT" | "CREDIT";
  amount: string;
  amountBefore: string;
  amountAfter: string;
  currency: string;
  createdAt: Date;
}

const AnyEntrySchema = new EntitySchema<IAnyEntrySchema>({
  name: "AnyEntry",
  tableName: "any_entries",
  properties: {
    id: { type: "string", length: 16, primary: true }, // IdValueObject: 16 chars, not UUID
    anyId: { type: "string", length: 16 },
    direction: { type: "string" },
    amount: { type: "decimal", precision: 19, scale: 2 },
    amountBefore: { type: "decimal", precision: 19, scale: 2 },
    amountAfter: { type: "decimal", precision: 19, scale: 2 },
    currency: { type: "string", length: 3 },
    createdAt: { type: "datetime" },
  },
});

export { AnyEntrySchema, IAnyEntrySchema };
```

## migrations/Migration20261014120000CreateAnys.ts
```ts
import { Migration } from "@mikro-orm/migrations";

export class Migration20261014120000CreateAnys extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table "anys" (
        "id"         char(16)      primary key,
        "name"       text          not null,
        "amount"     numeric(19,2) not null check ("amount" >= 0),
        "currency"   char(3)       not null,
        "version"    integer       not null default 1 check ("version" >= 1),
        "created_at" timestamptz   not null,
        "updated_at" timestamptz   not null,
        constraint "anys_name_currency_unique" unique ("name", "currency")
      );
    `);

    this.addSql(`
      create table "any_entries" (
        "id"            char(16)      primary key,
        "any_id"        char(16)      not null references "anys" ("id"),
        "direction"     text          not null check ("direction" in ('DEBIT', 'CREDIT')),
        "amount"        numeric(19,2) not null check ("amount" > 0),
        "amount_before" numeric(19,2) not null check ("amount_before" >= 0),
        "amount_after"  numeric(19,2) not null check ("amount_after" >= 0),
        "currency"      char(3)       not null,
        "created_at"    timestamptz   not null,
        check (
          ("direction" = 'CREDIT' and "amount_after" = "amount_before" + "amount") or
          ("direction" = 'DEBIT'  and "amount_after" = "amount_before" - "amount")
        )
      );
    `);

    // Append-only: the database itself refuses UPDATE and DELETE (OLD_README §5.5).
    this.addSql(`
      create function "forbid_mutation"() returns trigger language plpgsql as $$
      begin
        raise exception '% is append-only', TG_TABLE_NAME;
      end;
      $$;
    `);
    this.addSql(`
      create trigger "any_entries_append_only"
      before update or delete on "any_entries"
      for each row execute function "forbid_mutation"();
    `);
  }

  async down(): Promise<void> {
    this.addSql(`drop trigger if exists "any_entries_append_only" on "any_entries";`);
    this.addSql(`drop function if exists "forbid_mutation"();`);
    this.addSql(`drop table if exists "any_entries";`);
    this.addSql(`drop table if exists "anys";`);
  }
}
```

> _**Checklist for every table**_  
> _- Our ids come from `IdValueObject` of `ddd-tool-kit` (16 chars): `char(16)`, not `uuid`. External ids (`player_id`, `provider_id`, `message_id`...) are `text`._  
> _- Money: `numeric(19,2)` + `char(3)` currency, never `real`/`double precision`._  
> _- Uniqueness the domain relies on (`player_id + currency`, `idempotency_key`, `provider_id + external_transaction_id`, `consumer_name + message_id`) is a database constraint._  
> _- Non-negativity is a `CHECK`._  
> _- Immutable tables have the append-only trigger._  
> _- Indexes for the worker queries (`outbox` pending rows, `PENDING_REFERENCE` due rows)._
