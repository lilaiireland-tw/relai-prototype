import { pathToFileURL } from 'node:url'
import { promptTerminal } from './manage-user-prompt'
import { createPasswordCredential } from '../src/worker/auth/crypto'
import { createRepositories, type PersistenceDatabase } from '../src/worker/persistence'

type Command = 'create' | 'reset-password' | 'disable' | 'list'
export interface Arguments {
  command: Command
  environment: 'staging' | 'production'
  username?: string
  displayName?: string
  cohortSource?: string
  interactive?: boolean
}

class UsageError extends Error {}

export function parseArguments(argv: string[]): Arguments {
  const [command, ...flags] = argv
  if (!['create', 'reset-password', 'disable', 'list'].includes(command)) {
    throw new UsageError('Use create, reset-password, disable, or list.')
  }
  const allowed = ['--env', '--confirm-production',
    ...(command !== 'list' ? ['--username'] : []),
    ...(command === 'create' ? ['--display-name', '--cohort-source', '--interactive'] : [])]
  const values = new Map<string, string>()
  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i]
    if (flag === '--interactive' && allowed.includes(flag) && !values.has(flag)) {
      values.set(flag, 'true')
      continue
    }
    const value = flags[i + 1]
    if (!allowed.includes(flag) || values.has(flag) || value === undefined || value.startsWith('--')) {
      throw new UsageError('Invalid, duplicate, or missing command argument.')
    }
    values.set(flag, value)
    i++
  }
  const environment = values.get('--env') ?? 'staging'
  if (environment !== 'staging' && environment !== 'production') {
    throw new UsageError('Environment must be staging or production.')
  }
  if (environment === 'production' && values.get('--confirm-production') !== 'relai-prod-db') {
    throw new UsageError('Production requires --env production --confirm-production relai-prod-db.')
  }
  if (environment !== 'production' && values.has('--confirm-production')) {
    throw new UsageError('Production confirmation requires --env production.')
  }
  const username = values.get('--username')
  const displayName = values.get('--display-name')
  const interactive = values.has('--interactive')
  if (interactive && ['--username', '--display-name', '--cohort-source'].some(flag => values.has(flag))) {
    throw new UsageError('Interactive create collects username, display name and cohort source through prompts.')
  }
  if (!interactive) validateAccountFields(command as Command, username, displayName)
  return { command: command as Command, environment, username, displayName, interactive,
    cohortSource: values.get('--cohort-source') }
}

function validateAccountFields(command: Command, username?: string, displayName?: string): void {
  if (command !== 'list' && (!username || username.trim() !== username)) {
    throw new UsageError('Username is required and must have no leading or trailing whitespace.')
  }
  if (command === 'create' && !displayName?.trim()) throw new UsageError('Display name is required.')
}

export function generatePassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export interface AdminPlatform {
  env: { DB: PersistenceDatabase }
  dispose(): Promise<void>
}

export interface Dependencies {
  openPlatform(environment: Arguments['environment']): Promise<AdminPlatform>
  output(text: string): void
  error(text: string): void
  prompt?(label: string, secret: boolean): Promise<string>
}

// Output is returned only after the repository confirms the mutation. Raw D1/crypto
// errors never reach the operator: transports may include bound credential values.
async function execute(args: Arguments, db: PersistenceDatabase, pepper: string,
  temporaryCredential?: Awaited<ReturnType<typeof createPasswordCredential>>): Promise<string> {
  const { users, sessions } = createRepositories(db)
  if (args.command === 'list') return JSON.stringify(await users.listAccounts(), null, 2)
  const username = args.username!
  const existing = await users.findByUsername(username)
  if (args.command === 'create') {
    if (existing) throw new UsageError('Username already exists.')
    const password = temporaryCredential ? undefined : generatePassword()
    const credential = temporaryCredential ?? await createPasswordCredential(password!, pepper)
    const at = new Date().toISOString()
    await users.create({ id: crypto.randomUUID(), username, display_name: args.displayName!,
      ...credential, is_active: 1, must_change_password: true, cohort_source: args.cohortSource,
      created_at: at, updated_at: at })
    return temporaryCredential ? 'Account created; password change required.' : `Account created. Password: ${password}`
  }
  if (!existing) throw new UsageError('Account not found.')
  if (args.command === 'reset-password') {
    const password = generatePassword()
    const credential = await createPasswordCredential(password, pepper)
    const result = await users.replaceCredential(existing.id, {
      ...credential, updated_at: new Date().toISOString(),
    })
    if (result.changes !== 1) throw new Error('Credential update was not confirmed.')
    return `Password reset. Password: ${password}`
  }
  await sessions.revokeForUser(existing.id)
  const result = await users.setActive(existing.id, 0, new Date().toISOString())
  if (result.changes !== 1) throw new Error('Disable was not confirmed.')
  return 'Account disabled; sessions revoked.'
}

export async function runManageUser(argv: string[], dependencies: Dependencies): Promise<number> {
  let platform: AdminPlatform | undefined
  let status = 1
  try {
    const args = parseArguments(argv)
    // Only process.env is authoritative, even when the proxy has secret bindings.
    const pepper = process.env.AUTH_PEPPER
    if (!pepper) throw new UsageError('AUTH_PEPPER is required in the process environment.')
    let temporaryCredential: Awaited<ReturnType<typeof createPasswordCredential>> | undefined
    if (args.interactive) {
      if (!dependencies.prompt) throw new UsageError('Interactive create requires a terminal prompt.')
      args.username = await dependencies.prompt('Username: ', false)
      args.displayName = await dependencies.prompt('Display name: ', false)
      args.cohortSource = await dependencies.prompt('Cohort source (optional): ', false) || undefined
      validateAccountFields(args.command, args.username, args.displayName)
      const password = await dependencies.prompt('Temporary password: ', true)
      const confirmation = await dependencies.prompt('Confirm temporary password: ', true)
      if (Array.from(password).length < 8) throw new UsageError('Temporary password must contain at least 8 characters.')
      if (password !== confirmation) throw new UsageError('Temporary password confirmation does not match.')
      temporaryCredential = await createPasswordCredential(password, pepper)
    }
    platform = await dependencies.openPlatform(args.environment)
    const message = await execute(args, platform.env.DB, pepper, temporaryCredential)
    dependencies.output(message)
    status = 0
  } catch (error) {
    dependencies.error(error instanceof UsageError ? error.message : 'Account operation failed; no credential output.')
  } finally {
    if (platform) {
      try { await platform.dispose() } catch {
        dependencies.error('Platform cleanup failed.')
        status = 1
      }
    }
  }
  return status
}

// Direct execution only; importing this module never imports Wrangler or connects.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runManageUser(process.argv.slice(2), {
    openPlatform: async (environment) => {
      const { openAdminPlatform } = await import('./manage-user-platform')
      return openAdminPlatform(environment)
    },
    output: (text) => process.stdout.write(`${text}\n`),
    error: (text) => process.stderr.write(`${text}\n`),
    prompt: promptTerminal,
  })
}
