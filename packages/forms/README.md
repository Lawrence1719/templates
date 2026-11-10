# Forms

Build intake forms, surveys and requests; share a link; collect and export responses. Same validation in the browser and on the server.

## Features

- **Builder** with live preview: title, description, who can respond, confirmation message, fields with help text, required, options and number limits; reorder with up/down buttons (keyboard-friendly)
- **Field types**: short text, paragraph, email, phone, number, date, dropdown, checkboxes, yes/consent
- **Status**: draft → published → closed (reopen any time)
- **Share link** with an unguessable 12-character ID; `/f/<id>` works without an account
- **Members-only forms**: require a signed-in member of the organization
- **Responses table** with one column per field, **CSV export** (formula-safe)
- **Notification** to owners and admins on each new response (`form.submitted`)
- **Audit**: create, publish, close and delete are logged

## Spam and abuse protection

| Threat              | Defense                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| Bots                | Hidden honeypot field; bot submissions get a fake "thanks" and are dropped                                 |
| Flooding            | 5 submissions per IP per form per 10 minutes                                                               |
| Tampered requests   | Answers are validated server-side against the form; unknown keys are rejected, options must be on the list |
| Privacy             | IPs are stored only as a salted hash, for rate limiting                                                    |
| Guessing links      | Random 72-bit share IDs; drafts and malformed links look identical to missing forms                        |
| Members-only leaks  | Non-members get "not found"; titles of members-only forms aren't put in link previews                      |
| Another org's forms | Every management query filters by the session's org (404 otherwise)                                        |

## Permissions

`form: ["read", "manage"]`, `response: ["read"]`. Owners and admins build forms and read responses; members can fill in members-only forms.

## Use the pieces

```ts
import { answerSchema, fieldErrors } from "@templates/forms/definitions" // browser-safe
import { submitForm, listSubmissions } from "@templates/forms" // server

const result = answerSchema(fields).safeParse(answers)
if (!result.success) showErrors(fieldErrors(result.error))
```

Render any form with `<FormRenderer fields={fields} onSubmit={…} />` from the starter.

## Setup

`pnpm --filter @templates/db db:migrate` — creates `form` and `form_submission`.
