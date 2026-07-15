// prisma.config.mjs
export default {
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: "file:./dev.db", // Dummy local URL just to generate the SQL file
  },
}