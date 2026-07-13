/*
  Warnings:

  - You are about to drop the column `errorDetails` on the `Logs` table. All the data in the column will be lost.
  - You are about to drop the column `errorMessage` on the `Logs` table. All the data in the column will be lost.
  - Added the required column `message` to the `Logs` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Logs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "endpoint" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "details" TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Logs" ("endpoint", "id", "timestamp") SELECT "endpoint", "id", "timestamp" FROM "Logs";
DROP TABLE "Logs";
ALTER TABLE "new_Logs" RENAME TO "Logs";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
