import { pino } from "pino";

const edgeDestination = {
  write: (message: string) => {
    console.log(message);
  },
};

export const pinoLogger = pino(
  {
    level: "info",
  },
  edgeDestination,
);
