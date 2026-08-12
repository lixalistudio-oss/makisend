import { Inngest } from "inngest";
import { pinoLogger } from "@/core/logger";

export const inngest = new Inngest({ id: "makisend", logger: pinoLogger });