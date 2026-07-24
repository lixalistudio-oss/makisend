import {pino} from "pino"

const isProduction = typeof process !== "undefined" && process.env?.NODE_ENV === "production";
//Line so set up logging environment and knowing whether we're are working of Cloudfare servers or in local
//

export const pinoLogger =  pino({
  level: 'info',
  transport: !isProduction  ? undefined :
  //Used to decide how the logs will be display in local environment based on the value of the isProduction variable
    {
        // Pretty logs for your Fedora terminal during local Hono dev
        target: 'pino-pretty',
        options: {
          colorize: true,
          ignore: 'pid,hostname',
          translateTime: 'SYS:standard',
        },
    },
});