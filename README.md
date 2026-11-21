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
- Remaining budget: `Project.MaterialBudgetCentavos` minus what it is already promised to, which is every PO made for the project (delivered or not) and every approved PR that has no PO yet. A budget of 0 means none is set, so nothing is checked. A PR is over budget when what is promised plus the PR's total is above the budget. The check only needs to be live while the owner still has to decide (pending or on hold). Stock issued from the warehouse is not counted, because items have no cost.
- Approving an over-budget PR: the owner can still approve it, but only with a note saying why (up to 300 characters). The server refuses the approval without one, and the screen asks for it before sending. The check is made at the moment of approval. The PR then keeps `OverBudget = 1` and the note in `OwnerNote`; both show on its page and in the History, the purchaser is told it was approved over the project budget, and the PR list keeps the red "Over budget" badge. Within budget, no note is needed, and one the owner writes anyway is kept.
- Purchase orders for the delivery verifier: `GET /api/purchasing/pos` and `GET /api/purchasing/pos/:id` also work for the verifier, but without any money (no unit prices, discount, subtotal, shipping or total; the list has no total). The PO page and the list hide the same columns, the PR number is plain text, and the print view and the PR pages stay closed to this role. Receiving can read `Quantity` and `QtyReceived` per line from the PO detail.
- Cancelling a requisition: the foreman can cancel his own RF while it is pending (nothing is reserved yet) or returned (`POST /api/requisitions/:id/cancel`). The owner can cancel an approved RF, with a reason of up to 300 characters (`POST /api/requisitions/:id/cancel-approved`). That gives the reserved units back (`Item.Reserved` goes down, and `QtyReserved` and `QtyShort` on its lines go to 0) and cancels a slip that is only prepared. It is refused once a slip was released to the requestor, or once anything was issued (partly fulfilled or fulfilled): those goods already left the warehouse. A purchase requisition or purchase order made for the RF is not touched; the purchaser is told. The PR list and the PR page show an "RF cancelled" badge next to the RF number (`RfStatus` on both PR endpoints), and the PR page adds a short note while the PR is not yet cancelled. Freed units are not handed to other RFs that are short; they stay free stock.
- Projects: only the owner adds and edits projects (Projects page, `/projects.html`; `GET /api/projects/all`, `POST /api/projects`, `PUT /api/projects/:id`, `DELETE /api/projects/:id`). The code is set when the project is added and never changes. The material budget is typed in pesos and stored in centavos; 0 or empty means none is set. A closed project no longer shows in the project pick list, so no new or revised RF can be filed for it, and it can be reopened. Delete removes a project for good, but only while nothing points at it: the database refuses when a requisition, purchase requisition, purchase order or stock record uses it (and any table added later with a foreign key to `Project`), and the owner is told to set it to Closed instead. Changing a budget only moves the budget check on PRs the owner has not decided yet; a decided PR keeps what was stored when it was decided. `GET /api/projects` (the pick list, any logged-in user) still gives only the id, code and name of active projects, with no money.
- Change shared files (`server/db.js`, `server/auth.js`, the page layout) only after telling the other members.

## Handoff functions (agree names and inputs, then write them here)

- `createPurchaseRequisition(input)` in `server/services/handoff.js`: called by Inventory when an approved RF has a shortage. It belongs to Purchasing. Input: `{ requisitionId, rfNumber, projectId, lines: [{ itemId, shortQty }], userId }`. It runs inside the approval transaction, so use `db.run(...)` directly.
- `receiveStock({ itemId, quantity, sourceDocument: { type, id, number }, projectId, userId })` in `server/services/receipts.js`: called by Delivery for each received line. Adds the units to Item.OnHand and logs a receipt.
- `allocateToRequisition({ requisitionId, lines: [{ itemId, quantity }], userId })` in `server/services/receipts.js`: called by Delivery once per receiving report when the PR behind the PO has an RF. Sets the units aside for the RF, prepares an issuance slip and notifies the requestor and the custodian. Returns { allocated, slip }. If the RF is no longer approved (for example the owner cancelled it), it sets nothing aside and returns `{ allocated: [], slip: null }`; the received units stay on the shelf as free stock, so Delivery needs no special case.

## Change log

| Date | Who asked | Module | Change |
| --- | --- | --- | --- |
| 2026-11-18 | Member A | Purchasing (shared file `server/db.js`) | Tidy only: `clean()` rewritten as a plain loop. Same result: true and false become 1 and 0, undefined becomes null |
| 2026-11-18 | Member A | Purchasing (shared file `public/js/common.js`) | Tidy only: the `bellBadge` variable is declared above `startPage`, and comments added. No change in behavior |
| 2026-11-19 | Member A | Purchasing (shared file `server/index.js`) | Added the line that mounts the purchasing routes at `/api/purchasing` |
| 2026-11-19 | Member A | Purchasing (shared file `public/js/app.js`) | Menu links that were empty now open pages: owner "Approve purchase requisitions" opens `/prs.html`; purchaser "Suppliers" opens `/suppliers.html` and "Purchase requisitions" opens `/prs.html` |
| 2026-11-20 | Member A | Purchasing (shared file `public/js/app.js`) | Purchaser menu: "Purchase orders" opens `/pos.html` |
| 2026-11-21 | Member A | Purchasing (shared file `public/js/app.js`) | Verifier menu: "Open purchase orders" opens `/pos.html` |
| 2026-11-21 | Member A | Purchasing (shared file `public/js/app.js`) | Owner menu: new row "Purchase orders" opens `/pos.html` |
| 2026-11-21 | Member A | Purchasing (shared file `public/js/app.js`) | Owner menu: new row "Projects" opens `/projects.html` |
| 2026-11-21 | Member A | Purchasing (file `server/routes/projects.js`) | Added owner-only `GET /api/projects/all`, `POST /api/projects` and `PUT /api/projects/:id`. `GET /api/projects` (the pick list) is unchanged. The rules and queries are in the new `server/services/projects.js` and `server/services/projectRules.js` |
| 2026-11-21 | Member A | Purchasing (file `server/routes/projects.js`) | Added owner-only `DELETE /api/projects/:id`. It refuses with a plain message when documents still use the project |
