import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import process from 'node:process'
import { mkdirSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { URL, fileURLToPath, pathToFileURL } from 'node:url'

const repositoryRoot = resolve(fileURLToPath(new URL('../', import.meta.url)))
const localWranglerLogs = resolve(repositoryRoot, '.wrangler/logs')
const configuredLogs = resolve(process.env.WRANGLER_LOG_PATH ?? localWranglerLogs)
const logsRelativeToRepository = relative(repositoryRoot, configuredLogs)
process.env.WRANGLER_LOG_PATH = logsRelativeToRepository === '..' ||
  logsRelativeToRepository.startsWith(`..${sep}`) || isAbsolute(logsRelativeToRepository)
  ? localWranglerLogs
  : configuredLogs
mkdirSync(process.env.WRANGLER_LOG_PATH, { recursive: true })

function isLoopback(host) {
  const normalized = String(host ?? '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  return normalized === 'localhost' || normalized.endsWith('.localhost') || normalized === '::1' ||
    normalized === '::ffff:127.0.0.1' || /^127(?:\.\d{1,3}){3}$/.test(normalized)
}

export function assertLocalNetworkTarget(host, protocol = 'http:') {
  if (!isLoopback(host)) throw new Error(`Blocked remote network access in isolated ReLai checks: ${protocol}//${host ?? '(unknown host)'}`)
}

const fetch = globalThis.fetch
globalThis.fetch = (input, init) => {
  try {
    const target = typeof input === 'object' && input !== null && 'url' in input ? input.url : input
    const url = new URL(target)
    assertLocalNetworkTarget(url.hostname, url.protocol)
  } catch (error) {
    return Promise.reject(error)
  }
  return fetch(input, init)
}

for (const client of [http, https]) {
  const request = client.request
  client.request = function (input, options, callback) {
    const url = input instanceof URL ? input : typeof input === 'string' ? new URL(input) : undefined
    const settings = url ? { ...options, hostname: url.hostname } : input
    const host = settings?.hostname ?? settings?.host ?? options?.hostname ?? options?.host ?? 'localhost'
    assertLocalNetworkTarget(host, client === https ? 'https:' : 'http:')
    return request.call(this, input, options, callback)
  }
}

const connect = net.Socket.prototype.connect
net.Socket.prototype.connect = function (...args) {
  const target = args[0]
  if (typeof target === 'object' && target !== null) {
    if (!target.path) assertLocalNetworkTarget(target.host ?? target.hostname ?? 'localhost', 'tcp:')
  } else if (args.length > 1 && typeof target === 'number' && typeof args[1] === 'string') {
    assertLocalNetworkTarget(args[1], 'tcp:')
  } else if (typeof target === 'number' || (typeof target === 'string' && /^\d+$/.test(target))) {
    assertLocalNetworkTarget('localhost', 'tcp:')
  } else if (typeof target === 'string') {
    // A string path selects a local Unix-domain socket.
  } else {
    throw new Error('Blocked a network connection with an unknown destination in isolated ReLai checks.')
  }
  return connect.apply(this, args)
}

const preload = `--import=${pathToFileURL(fileURLToPath(import.meta.url)).href}`
if (!process.env.NODE_OPTIONS?.includes(preload)) {
  process.env.NODE_OPTIONS = [process.env.NODE_OPTIONS, preload].filter(Boolean).join(' ')
}
