import { createInterface, emitKeypressEvents } from 'node:readline'
import type { ReadStream, WriteStream } from 'node:tty'

/** Use the real terminal for ordinary questions. A substitute Writable prevents
 * readline from rendering prompts reliably in Windows PowerShell.
 */
export async function promptTerminal(label: string, secret: boolean,
  input: ReadStream = process.stdin, output: WriteStream = process.stdout): Promise<string> {
  if (!input.isTTY || !output.isTTY) throw new Error('Interactive input requires a TTY.')

  if (!secret) {
    const readline = createInterface({ input, output, terminal: true, historySize: 0 })
    try {
      return await new Promise<string>((resolve, reject) => {
        readline.once('SIGINT', () => reject(new Error('Input cancelled.')))
        readline.once('close', () => reject(new Error('Input closed.')))
        readline.question(label, resolve)
      })
    } finally {
      readline.close()
    }
  }

  if (typeof input.setRawMode !== 'function') throw new Error('Interactive input requires a TTY.')
  const wasRaw = input.isRaw === true
  let password = ''
  output.write(label)
  emitKeypressEvents(input)
  try {
    input.setRawMode(true)
    return await new Promise<string>((resolve, reject) => {
      const cleanup = () => {
        input.off('keypress', onKeypress)
        input.off('end', onClose)
        input.off('close', onClose)
        input.off('error', onError)
      }
      const finish = (error?: Error) => {
        cleanup()
        if (error) reject(error)
        else resolve(password)
      }
      const onClose = () => finish(new Error('Input closed.'))
      const onError = () => finish(new Error('Input closed.'))
      const onKeypress = (character: string, key: { name?: string; ctrl?: boolean; meta?: boolean }) => {
        if (key.ctrl && key.name === 'c') return finish(new Error('Input cancelled.'))
        if (key.ctrl && key.name === 'd') return finish(new Error('Input closed.'))
        if (key.name === 'return' || key.name === 'enter') return finish()
        if (key.name === 'backspace' || key.name === 'delete') {
          password = Array.from(password).slice(0, -1).join('')
          return
        }
        if (!key.ctrl && !key.meta && key.name !== 'escape' && character) password += character
      }
      input.on('keypress', onKeypress)
      input.once('end', onClose)
      input.once('close', onClose)
      input.once('error', onError)
      input.resume()
    })
  } finally {
    input.setRawMode(wasRaw)
    input.pause()
    output.write('\n')
  }
}
