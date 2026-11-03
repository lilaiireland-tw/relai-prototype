import process from 'node:process'
import { error, log } from 'node:console'

const credentials = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_API_KEY', 'CF_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID',
  'GOOGLE_API_KEY', 'GOOGLE_APPLICATION_CREDENTIALS', 'GEMINI_API_KEY']
const present = credentials.filter((name) => process.env[name])
if (present.length) {
  error(`Remote service credentials must be absent in CI: ${present.join(', ')}`)
  process.exitCode = 1
} else {
  log('Remote Cloudflare and Google credentials are absent.')
}
