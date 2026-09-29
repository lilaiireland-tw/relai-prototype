import { createInterface } from 'node:readline'
import { Writable } from 'node:stream'
import type { ReadStream, WriteStream } from 'node:tty'

/** A fresh readline interface per question keeps secret input out of shared history.
 * Suppress all readline output for secrets, including typed/pasted text and redraws.
 * Refuse pipes rather than falling back to terminal-echoed password entry.
 */
export async function promptTerminal(label: string, secret: boolean,
  input: ReadStream = process.stdin, output: WriteStream = process.stdout): Promise<string> {
  if (!input.isTTY || !output.isTTY) throw new Error('Interactive input requires a TTY.')
  const display = new Writable({
    write(chunk, encoding, callback) {
      if (secret) callback()
      else output.write(chunk, encoding, callback)
    },
  })
  const readline = createInterface({ input, output: display, terminal: true, historySize: 0 })
  try {
    output.write(label)
    return await new Promise<string>((resolve, reject) => {
      readline.once('SIGINT', () => reject(new Error('Input cancelled.')))
      readline.once('close', () => reject(new Error('Input closed.')))
      readline.question('', resolve)
    })
  } finally {
    readline.close()
    await new Promise<void>(resolve => display.end(resolve))
    if (secret) output.write('\n')
  }
}
