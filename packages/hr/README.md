# Staff & HR

Employee records, a time clock with weekly timesheets, and leave with allowances, holidays and approvals. Everyone gets a staff directory and their own time and leave page; pay and personal details stay with HR.

## Features

- **Employee records**: job title, department, manager, type (full-time, part-time, contractor, intern), start and end dates, and a link to their app account
- **Private details**, visible only with `hr: manage`: pay (hourly or salary), birthday, home address, emergency contact, notes
- **Staff directory** for everyone: name, role, department, work email and phone
- **Time clock**: clock in and out with a note; HR can add, correct or delete entries, and every correction is logged with the times before and after
- **Timesheets**: a week per page in your time zone, daily totals, overtime past the weekly hours you set, and CSV export for payroll
- **Leave types** with days per year (or no limit), paid or unpaid
- **Holidays and work days**: leave only counts working days, so a week off with a holiday in it takes four days
- **Requests and approvals**: people ask, their manager (or owners and admins) approve or decline with a note, and everyone hears about it. HR can record leave directly, and adjust a balance for carry-over or corrections
- **Who's off**: today and the next 30 days, showing names and dates only, never the reason or kind of leave
- **People who left** stay on record (marked as left); only records added by mistake can be deleted

## Integrity and security

| Risk                             | Defense                                                                                                                                                                 |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pay and personal details leaking | Stripped on the server unless the caller has `hr: manage`; the directory returns six public fields only. The audit log records which fields changed, never their values |
| Double clock-ins                 | One open entry per person (unique index). Tests press clock-in 5 times at once: one entry                                                                               |
| Overlapping or padded time       | A Postgres exclusion constraint refuses overlapping entries for the same person, even with direct SQL. Entries can't start in the future or run over 24 hours           |
| Overdrawn leave                  | Requests count pending leave against the balance; checks run under a row lock on the person, so three requests at once can't overspend. Approval checks again           |
| Overlapping leave                | An exclusion constraint refuses overlapping pending or approved leave for the same person                                                                               |
| Approving your own leave         | Refused for everyone, owners included                                                                                                                                   |
| Rewriting decisions              | A trigger makes declined and cancelled leave final, and lets approved leave only be cancelled. Balance adjustments are append-only                                      |
| Reporting loops                  | Nobody can manage themselves or anyone above them in the reporting line                                                                                                 |
| Other organizations' data        | Every query filters by the session's org; employees, departments, managers, time and leave use composite `(…, org_id)` foreign keys; accounts must be org members       |
| CSV formula injection            | Exported cells starting with `=`, `+`, `-` or `@` are neutralized                                                                                                       |

## Permissions

`hr: ["self", "read", "approve", "manage"]`. Members get `self`: the directory, their own clock and their own leave. Admins and owners get everything.

## Use the pieces

```ts
import { countLeave, formatDays } from "@templates/hr/definitions" // browser-safe
import { clockIn, requestLeave, timesheet } from "@templates/hr" // server

await clockIn(ctx, "Opening")
await requestLeave(ctx, { leaveTypeId, startDay: "2027-01-04", endDay: "2027-01-08" })
const week = await timesheet(ctx, { week: "2027-01-04" })
```

## Make it yours

- **Payroll**: multiply timesheet hours by each person's hourly rate, or export the CSV to your payroll tool.
- **Breaks**: add a "break" kind to time entries and subtract them from totals.
- **Geofenced clock-in**: check the browser's location before calling `clockIn`.
- **Accrual**: instead of a fixed yearly allowance, add an adjustment each month with a scheduled job.
- **Documents**: attach contracts and IDs with the Files module, readable only with `hr: manage`.

## Setup

`pnpm --filter @templates/db db:migrate` creates the tables, the `btree_gist` extension and the overlap constraints. It needs the Auth, Audit log and Notifications modules.
