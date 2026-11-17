# Ximon System

Requisition, inventory, purchasing and delivery for Ximon Engineering Services (school capstone).
Browser pages (Bootstrap) call a Node.js + Express server, and the server talks to SQL Server Express.

## First-time setup (each member does this on their own laptop)

1. Install the same Node.js LTS version on both laptops, plus Git.
2. **SQL Server Express** (the "SQL Server (SQLEXPRESS)" service must be running):
   - Open *SQL Server Configuration Manager* > SQL Server Network Configuration > Protocols for SQLEXPRESS.
   - Enable **TCP/IP**. Open its properties > *IP Addresses* tab > scroll to **IPAll**: clear *TCP Dynamic Ports*, set *TCP Port* to `1433`.
   - In *SQL Server Management Studio* (Windows login): right-click the server > Properties > Security > choose **SQL Server and Windows Authentication mode**.
   - Restart the SQL Server (SQLEXPRESS) service.
   - In a new query window run (pick your own strong password):
     ```sql
     CREATE LOGIN ximon_app WITH PASSWORD = 'Use-A-Strong-Password-1';
     ALTER SERVER ROLE dbcreator ADD MEMBER ximon_app;
     ```
3. In this folder:
   ```
   npm install
   copy .env.example .env      (macOS/Linux: cp .env.example .env)
   ```
   Open `.env` and fill in `DB_PASSWORD` (the password from step 2) and `SESSION_SECRET` (any long random text).
4. `npm run setup-db` creates the XimonDB database, the shared tables, the starting settings, the sample project and one test user per role.
5. `npm start`, then open http://localhost:3000. Open `/api/health` to see "ok": true.
6. Phone: join the same Wi-Fi and open the address printed under "Open on a phone". Allow Node.js through the Windows firewall when it asks.

Test users (password is `SEED_PASSWORD` from `.env`, default `ximon123`): `owner1`, `foreman1`, `custodian1`, `purchaser1`, `verifier1`.

**If something fails**
- `Failed to connect to localhost:1433`: the service is stopped, TCP/IP is off, the port is not 1433, or the service was not restarted after the change.
- `Login failed for user 'ximon_app'`: mixed-mode login is not on, or `DB_PASSWORD` is wrong.

## Folders

| Folder | Holds |
| --- | --- |
| `public/` | HTML, CSS and browser JavaScript. One subfolder per module as you add screens. |
| `server/routes/` | Express routes, one file per module. Check the role first with `requireRole`. |
| `server/services/` | Business rules as plain functions (numbering, settings; later reservation, budget check, PO totals). |
| `server/db.js` | `query()` for one statement and `withTransaction()` for several. Always use parameters. |
| `db/` | SQL files run in name order by `npm run setup-db`: `01_` and `02_` are shared; add `10_requisition.sql`, `20_inventory.sql` and so on. Use `IF OBJECT_ID(...) IS NULL CREATE TABLE` and `GO` between statements so they can run again. |
| `tests/` | `npm test` (Node's built-in runner). |
| `uploads/` | Uploaded photos, kept outside `public/`. |

## Rules

- Only a module's owner writes its tables. Everyone else calls the owner's function.
- Limits and thresholds are rows in `Setting`, never numbers in the code.
- Money is whole centavos.
- Change shared files (`server/db.js`, `server/auth.js`, the page layout) only after telling the other members.

## Handoff functions (agree names and inputs, then write them here)

- `createPurchaseRequisition(rfNumber, lines)`:
- `receiveStock(itemId, quantity, sourceDocument)`:
- Allocate delivered items to the RF:

## Change log

| Date | Who asked | Module | Change |
| --- | --- | --- | --- |
