# Playwright browser testing

ReLai's testing pyramid has three layers:

| Layer | Responsibility |
| --- | --- |
| Vitest / Node tests | Fast unit, component, route, API contract, persistence and deployment/config checks |
| Playwright | A few real-browser journeys through React → HTTP → local Worker/Hono → local D1 |
| Manual staging E2E | Final Cloudflare/staging acceptance where remote behavior needs verification |

Keep Vitest coverage. Add Playwright for browser lifecycle or user journeys that need the integrated stack; avoid duplicating every unit assertion.

## First run

Use Node.js 24. From the repository root:

```sh
npm ci
npx playwright install chromium
npm run test:e2e
```

On Linux, install browser system dependencies with `npx playwright install --with-deps chromium` (as CI does). Tests are in `e2e/*.spec.ts`; Chromium is the initial project. Other browsers can be added to `projects` in `playwright.config.ts` later.

Playwright's `webServer` starts `scripts/start-e2e.ts`, prepares the database, and serves the actual Vite/Cloudflare application on `http://127.0.0.1:4173/relaiapp/`. It terminates the server when tests finish. No second terminal is needed. Port 4173 must be free; an existing server is deliberately never reused.

```sh
npm run test:e2e:headed   # Watch Chromium run the suite
npm run test:e2e:ui       # Browse tests and rerun them interactively
npm run test:e2e:debug    # Step through with Playwright Inspector
npm run test:e2e -- e2e/cards.spec.ts  # Run one file
npm run test:e2e:report   # Open the local HTML report
npm run test:e2e:trace -- test-results/<failed-test>/trace.zip
```

UI mode starts the same managed local stack. Close the UI/Inspector or stop the command when finished. Do not launch multiple E2E commands concurrently: they intentionally share one isolated test directory and fixed port.

## Local data and safety

`scripts/setup-e2e.ts` deletes only the fixed `.wrangler/e2e` directory at server startup, applies the repository migrations with explicit `--local --persist-to`, then seeds three synthetic vocabulary/catalog cards and a dedicated `relai_e2e` user. The user represents an already activated A1 learner. Setup uses the real password credential implementation; authentication, cookie sessions, ownership checks and protected routes remain unchanged.

The public local-only password and pepper are defined in `scripts/e2e-data.ts`. The helper writes an ignored `e2e/.dev.vars` containing the test pepper. No staging secrets or real credentials are needed. Before every test (including retries/UI reruns), the fixture clears local sessions/reviews/stats and resets card review state and settings. A single worker avoids tests racing over that data. Every invocation starts from a fresh database, independent of ordinary developer data.

`e2e/wrangler.jsonc` uses a fake D1 UUID and `remote: false`; `vite.e2e.config.ts` disables remote bindings and selects only this config. Deployment configuration is separate. **Normal PR tests must never write staging or production data:** they run repeatedly, erase test state, and are executed for unreviewed changes. They must not receive Cloudflare credentials or deployment secrets. Local migration preparation is only for the E2E database; deployment migrations remain explicit/manual. GitHub Actions stays CI only; Cloudflare Workers Builds continues to own staging deployment.

## Writing a test

Use the shared `test` and `expect` from `e2e/fixtures.ts`. It resets state for every test and supplies UI login and sanitized failure traces. New tests should change data through the application or real local API, not mock the happy path. Keep any new fixture SQL synthetic and in the local helper.

```ts
import { test, expect, openCards } from './fixtures'

test('learner can flip a card', async ({ page, login }) => {
  await page.goto('login')
  await login()
  await openCards(page)
  await page.getByRole('button', { name: '翻面' }).click()
  await expect(page.getByRole('button', { name: '翻面' }))
    .toHaveAttribute('aria-pressed', 'true')
})
```

The trailing slash in `baseURL` matters: `page.goto('cards')` resolves under `/relaiapp/`; `page.goto('/cards')` would discard the basename. Prefer `getByRole`, `getByLabel`, and `getByText`. Use exact names or scope by an accessible region when labels overlap. Avoid Tailwind classes, DOM nesting and `nth-child`. Add an accessibility label when it helps users; reserve `data-testid` for controls without reasonable accessible selectors.

Use awaited actions and web-first assertions instead of fixed sleeps. For background work, register `waitForResponse` before the triggering action and assert its status. The #80 regression switches real browser tabs with `bringToFront`, observes `/auth/me`, and checks the original protected DOM remains connected as well as position, filter and flip state. The Chromium project uses full Chromium's new headless mode (`channel: 'chromium'`); the regression disables Playwright's always-focused override through CDP so real tab activation changes `document.hasFocus()`. This browser-specific helper must be adapted when adding Firefox/WebKit.

## Debugging failures

1. Read the failing assertion in the terminal or HTML report. Reproduce with the single-file command.
2. Use headed mode to watch the journey, or debug mode to step through selectors and inspect the page.
3. Open the attached screenshot and trace from the report. In Trace Viewer, select actions on the timeline, compare before/after DOM snapshots and screenshots, and inspect the failing locator. The report contains only failure diagnostics; successful traces are discarded.
4. Determine whether the issue is a selector, data setup, API error or application behavior. Use local browser DevTools for network inspection when needed. Never print credential/cookie values.
5. Fix the cause and rerun the focused test, then the full suite. CI allows only one retry; retries are evidence of instability, not a reason to ignore failures.

Trace recording begins **after UI login completes**. Before attaching a failure trace, the fixture removes all HTTP traffic/bodies, source attachments and console messages so session cookies and passwords are not exposed in artifacts. This means Trace Viewer's Network and source panels are intentionally unavailable; browser actions, snapshots and screenshots remain. Login failures have screenshots and assertion output but no trace. Screenshots render password fields masked by the browser. Do not enable raw `--trace on`, HAR recording, `storageState` exports or verbose protocol/network logging in this authenticated suite: those can capture session material. If trace sanitization fails, the raw file is deleted and no trace is published.

The separate **Playwright E2E** PR job runs on Ubuntu/Node 24, installs Chromium and dependencies, and executes this same local command. It uploads reports/screenshots/sanitized traces on failure for seven days. `playwright-report/`, `test-results/`, `.wrangler/`, and generated `.dev.vars` are ignored; E2E source specs are tracked.

References: [Playwright web servers](https://playwright.dev/docs/test-webserver), [Trace Viewer](https://playwright.dev/docs/trace-viewer), [Cloudflare Vite plugin options](https://developers.cloudflare.com/workers/vite-plugin/reference/api/).
