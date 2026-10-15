import type { LaneId } from "./types";

interface Lane {
  id: LaneId;
  label: string;
  sub: string;
}

const LANES: Lane[] = [
  { id: "client", label: "Cliente", sub: "provedor · você" },
  { id: "entry", label: "Entrada", sub: "controller · consumer" },
  { id: "usecase", label: "Use case", sub: "orquestra · UoW" },
  { id: "domain", label: "Domínio", sub: "aggregates · processor" },
  { id: "db", label: "PostgreSQL", sub: "tabelas · locks" },
  { id: "worker", label: "Workers", sub: "outbox · pendências" },
  { id: "sqs", label: "SQS", sub: "LocalStack" },
];

const laneIndex = (id: LaneId): number => LANES.findIndex((lane) => lane.id === id);

export { LANES, laneIndex, type Lane };
