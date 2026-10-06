import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

/** Keep browser actions/DOM/screenshots, discard HTTP traffic and source attachments.
 * Network traces include Cookie/Set-Cookie even for local-only authentication.
 */
export function sanitizeTrace(input: Uint8Array): Uint8Array {
  const entries = unzipSync(input)
  for (const name of Object.keys(entries)) {
    if (name.endsWith('.network')) entries[name] = strToU8('')
    else if (name.startsWith('resources/') && !/\.(jpeg|png)$/.test(name)) delete entries[name]
    else if (name.endsWith('.trace')) {
      // Tracing starts after login. Do not retain console messages in artifacts.
      entries[name] = strToU8(strFromU8(entries[name]).split('\n')
        .filter(line => !line || JSON.parse(line).type !== 'console').join('\n'))
    }
  }
  return zipSync(entries)
}
