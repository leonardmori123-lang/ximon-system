# Ximon System

Requisition, inventory, purchasing and delivery for Ximon Engineering Services (school capstone).
Browser pages (Bootstrap) call a Node.js + Express server, and the server reads and writes one SQLite database file.

## First-time setup (each member, on their own laptop)

1. Install **Node.js 22.13 or newer** (the current LTS) and Git. Nothing else: SQLite is built into Node.
2. In this folder:
   ```
   npm install
   copy .env.example .env      (macOS/Linux: cp .env.example .env)
   ```
   Open `.env` and set `SESSION_SECRET` to any long random text. The other lines can stay as they are.
3. `npm run setup-db` creates the database file `data/ximon.db`, the tables, the starting settings, the sample project and items, and one test user per role.
4. `npm start`, then open http://localhost:3000. Open `/api/health` to see `"ok": true`.

Test users (password is `SEED_PASSWORD` from `.env`, default `ximon123`): `owner1`, `foreman1`, `custodian1`, `purchaser1`, `verifier1`.

`npm test` runs all the tests. They use a throw-away database in memory, so your real data is never touched.

## The database

- It is one file: `data/ximon.db` (plus `ximon.db-wal` and `-shm` while the server runs). It is **not** in Git, so every member has their own test data.
- To start again from nothing: stop the server, delete the `data` folder, run `npm run setup-db`.
- To look inside, install the free "DB Browser for SQLite" and open `data/ximon.db`.
- To back up: stop the server and copy `data/ximon.db`.

## Folders

| Folder | Holds |
| --- | --- |
| `public/` | HTML, CSS and browser JavaScript. |
| `server/routes/` | Express routes, one file per module. Check the role first with `requireRole`. |
| `server/services/` | The business rules as plain functions (reservation, issuing, numbering ...). |
| `server/db.js` | `all`, `get`, `run` and `transaction`. The only file that talks to SQLite. |
| `db/` | SQL files run in name order by `npm run setup-db`. Add `40_purchasing.sql`, `50_delivery.sql` ... Use `CREATE TABLE IF NOT EXISTS` and `INSERT OR IGNORE` so they can run again. |
| `tests/` | `npm test` (Node's built-in test runner). |
| `uploads/` | Uploaded photos, kept outside `public/`. |

## Rules

- Only a module's owner writes its tables. Everyone else calls the owner's function.
- Limits and thresholds are rows in `Setting`, never numbers in the code.
- Money is whole centavos. Quantities are numbers with at most 2 decimals.
- Always pass values as named parameters: `db.get('SELECT * FROM Item WHERE Code = @code', { code })`. Never join values into the SQL text. Only pass the parameters the SQL uses.
- Round every update to money or quantities with `ROUND(x, 2)`, and round every `SUM(...)` too (`ROUND(SUM(Quantity), 2)`), or 0.1 + 0.2 shows up as 0.30000000000000004.
- Do several changes together inside `db.transaction(() => { ... })`. If anything throws, all of it is undone.
- Change shared files (`server/db.js`, `server/auth.js`, the page layout) only after telling the other members.

## Handoff functions (agree names and inputs, then write them here)

- `createPurchaseRequisition(input)` in `server/services/handoff.js`: called by Inventory when an approved RF has a shortage. It belongs to Purchasing. Input: `{ requisitionId, rfNumber, projectId, lines: [{ itemId, shortQty }] }`. It runs inside the approval transaction, so use `db.run(...)` directly.
- `receiveStock(itemId, quantity, sourceDocument)`:
- Allocate delivered items to the RF:

## Change log

| Date | Who asked | Module | Change |
| --- | --- | --- | --- |
