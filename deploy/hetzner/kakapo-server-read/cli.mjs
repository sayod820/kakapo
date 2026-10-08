#!/usr/bin/env node
import { execFile as execFileCallback } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import {
  CONTAINERS,
  EXECUTABLES,
  MAX_COMMAND_BYTES,
  PolicyError,
  PRODUCTION_REPO,
  VERSION,
  parseCommand,
  redactLogOutput,
  redactText,
  safeJson,
} from './policy.mjs'

const execFile = promisify(execFileCallback)

const FIXED_EXEC_OPTIONS = Object.freeze({
  encoding: 'utf8',
  windowsHide: true,
  timeout: 10_000,
  maxBuffer: MAX_COMMAND_BYTES,
  shell: false,
  env: Object.freeze({ PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' }),
})

const CONTAINER_INSPECT_FORMAT = [
  '{"id":{{json .Id}}',
  ',"name":{{json .Name}}',
  ',"image":{{json .Config.Image}}',
  ',"created":{{json .Created}}',
  ',"state":{{json .State}}}',
].join('')

const POSTGRES_IP_INSPECT_FORMAT = [
  '{{with index .NetworkSettings.Networks "kakapo-net"}}',
  '{"name":{{json $.Name}},"network":"kakapo-net","ip":{{json .IPAddress}}}',
  '{{end}}',
].join('')

function safeError(error) {
  if (error instanceof PolicyError) return { code: error.code, message: error.message }
  return { code: 'INSPECTION_FAILED', message: redactText(error?.message || String(error)) }
}

export async function runFixed(file, args, deps = {}) {
  const execute = deps.execFile || execFile
  const result = await execute(file, args, FIXED_EXEC_OPTIONS)
  return {
    stdout: redactText(result?.stdout || ''),
    stderr: redactText(result?.stderr || ''),
  }
}

async function runFixedRaw(file, args, deps = {}) {
  const execute = deps.execFile || execFile
  let result
  try {
    result = await execute(file, args, FIXED_EXEC_OPTIONS)
  } catch {
    throw new PolicyError('STRUCTURED_COMMAND_FAILED')
  }

  const stdout = String(result?.stdout ?? '')
  if (Buffer.byteLength(stdout, 'utf8') > MAX_COMMAND_BYTES) {
    throw new PolicyError('STRUCTURED_OUTPUT_TOO_LARGE')
  }
  return stdout
}

async function runFixedStructured(file, args, deps = {}) {
  const stdout = await runFixedRaw(file, args, deps)
  try {
    return JSON.parse(stdout)
  } catch {
    throw new PolicyError('INVALID_DOCKER_RESPONSE')
  }
}

export function sanitizeContainerInspect(raw, expectedName) {
  const value = raw
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PolicyError('INVALID_DOCKER_RESPONSE')
  }
  const actualName = String(value.name || '').replace(/^\//, '')
  if (actualName !== expectedName) throw new PolicyError('CONTAINER_IDENTITY_MISMATCH')
  const id = typeof value.id === 'string' && /^[0-9a-f]{12,64}$/.test(value.id) ? value.id : null
  if (!id || !value.state || typeof value.state !== 'object' || Array.isArray(value.state)) {
    throw new PolicyError('INVALID_DOCKER_RESPONSE')
  }
  const state = value.state
  const health = state.Health || {}
  return {
    id: id.slice(0, 12),
    name: actualName,
    image: typeof value.image === 'string' ? redactText(value.image).slice(0, 512) : null,
    created: typeof value.created === 'string' ? redactText(value.created).slice(0, 128) : null,
    state: {
      status: typeof state.Status === 'string' ? redactText(state.Status).slice(0, 64) : null,
      running: state.Running === true,
      restarting: state.Restarting === true,
      oomKilled: state.OOMKilled === true,
      dead: state.Dead === true,
      exitCode: Number.isFinite(Number(state.ExitCode)) ? Number(state.ExitCode) : null,
      startedAt: typeof state.StartedAt === 'string' ? redactText(state.StartedAt).slice(0, 128) : null,
      finishedAt: typeof state.FinishedAt === 'string' ? redactText(state.FinishedAt).slice(0, 128) : null,
      errorPresent: Boolean(state.Error),
    },
    health: typeof health.Status === 'string' ? {
      status: redactText(health.Status).slice(0, 64),
      failingStreak: Number(health.FailingStreak) || 0,
      lastChecks: (Array.isArray(health.Log) ? health.Log : []).slice(-3).map(item => ({
        start: typeof item?.Start === 'string' ? redactText(item.Start).slice(0, 128) : null,
        end: typeof item?.End === 'string' ? redactText(item.End).slice(0, 128) : null,
        exitCode: Number(item?.ExitCode) || 0,
        output: redactLogOutput(String(item?.Output || ''), 5, 1024),
      })),
    } : null,
  }
}

export function parseDockerPsRow(text, expectedName) {
  const output = String(text || '').trim()
  if (!output) return null
  const lines = output.split(/\r?\n/)
  if (lines.length !== 1) throw new PolicyError('INVALID_DOCKER_RESPONSE')
  const [name, image, state, status, runningFor, ...extra] = lines[0].split('\t')
  if (extra.length || name !== expectedName) {
    throw new PolicyError('CONTAINER_IDENTITY_MISMATCH')
  }
  return {
    name,
    image: image ? redactText(image).slice(0, 512) : null,
    state: state ? redactText(state).slice(0, 64) : null,
    status: status ? redactText(status).slice(0, 1024) : null,
    runningFor: runningFor ? redactText(runningFor).slice(0, 256) : null,
  }
}

export function extractPostgresContainerIp(raw) {
  const value = raw
  const actualName = String(value?.name || '').replace(/^\//, '')
  if (actualName !== CONTAINERS.postgres) throw new PolicyError('CONTAINER_IDENTITY_MISMATCH')
  if (value?.network !== 'kakapo-net') throw new PolicyError('INVALID_DOCKER_RESPONSE')
  const ip = String(value?.ip || '')
  const octets = ip.split('.')
  if (octets.length !== 4 || octets.some(part => !/^\d{1,3}$/.test(part) || Number(part) > 255)) {
    throw new PolicyError('POSTGRES_CONTAINER_IP_UNAVAILABLE')
  }
  return ip
}

async function postgresContainerIp(deps = {}) {
  const parsed = await runFixedStructured(EXECUTABLES.docker, [
    'inspect', '--type', 'container', '--format', POSTGRES_IP_INSPECT_FORMAT, CONTAINERS.postgres,
  ], deps)
  return extractPostgresContainerIp(parsed)
}

async function inspectContainer(alias, deps = {}) {
  const name = CONTAINERS[alias]
  if (!name) throw new PolicyError('INVALID_CONTAINER')
  const parsed = await runFixedStructured(EXECUTABLES.docker, [
    'inspect', '--type', 'container', '--format', CONTAINER_INSPECT_FORMAT, name,
  ], deps)
  return sanitizeContainerInspect(parsed, name)
}

async function dockerPs(deps = {}) {
  const rows = []
  for (const name of Object.values(CONTAINERS)) {
    const stdout = await runFixedRaw(EXECUTABLES.docker, [
      'ps', '-a', '--filter', `name=^/${name}$`,
      '--format', '{{.Names}}\t{{.Image}}\t{{.State}}\t{{.Status}}\t{{.RunningFor}}',
    ], deps)
    const row = parseDockerPsRow(stdout, name)
    if (row) {
      rows.push({ found: true, ...row })
    } else {
      rows.push({ name, found: false })
    }
  }
  return rows
}

async function runGit(spec, deps = {}) {
  const base = ['-C', PRODUCTION_REPO]
  if (spec.command === 'git-status') {
    const out = await runFixed(EXECUTABLES.git, [...base, 'status', '--short', '--branch'], deps)
    return { output: redactLogOutput(out.stdout, 200).trim() }
  }
  if (spec.command === 'git-head') {
    const [head, branch] = await Promise.all([
      runFixed(EXECUTABLES.git, [...base, 'rev-parse', 'HEAD'], deps),
      runFixed(EXECUTABLES.git, [...base, 'branch', '--show-current'], deps),
    ])
    return { head: head.stdout.trim(), branch: branch.stdout.trim() }
  }
  if (spec.command === 'git-tag') {
    try {
      const out = await runFixed(EXECUTABLES.git, [...base, 'describe', '--tags', '--exact-match', 'HEAD'], deps)
      return { exactTag: out.stdout.trim() || null }
    } catch {
      return { exactTag: null }
    }
  }
  const out = await runFixed(EXECUTABLES.git, [
    ...base, 'log', `-${spec.limit}`, '--date=iso-strict',
    '--pretty=format:%H%x09%ad%x09%an%x09%s',
  ], deps)
  return { limit: spec.limit, output: redactLogOutput(out.stdout, spec.limit).trim() }
}

async function serverStatus(deps = {}) {
  const [hostname, uname, uptime] = await Promise.all([
    runFixed(EXECUTABLES.hostname, [], deps),
    runFixed(EXECUTABLES.uname, ['-a'], deps),
    runFixed(EXECUTABLES.uptime, [], deps),
  ])
  return {
    hostname: hostname.stdout.trim(),
    kernel: uname.stdout.trim(),
    uptime: uptime.stdout.trim(),
  }
}

async function checkUrl(url, deps = {}) {
  try {
    const stdout = await runFixedRaw(EXECUTABLES.curl, [
      '--silent', '--show-error', '--max-time', '5',
      '--output', '/dev/null', '--write-out', '%{http_code}', url,
    ], deps)
    const status = stdout.trim()
    if (!/^[0-9]{3}$/.test(status)) throw new PolicyError('INVALID_HTTP_RESPONSE')
    return { url, reachable: true, httpStatus: Number(status) }
  } catch (error) {
    return { url, reachable: false, error: safeError(error).message }
  }
}

async function serverCommand(spec, deps = {}) {
  if (spec.command === 'status') return serverStatus(deps)
  if (spec.command === 'disk') {
    const out = await runFixed(EXECUTABLES.df, ['-P', '/'], deps)
    return { disk: out.stdout.trim() }
  }
  if (spec.command === 'memory') {
    const out = await runFixed(EXECUTABLES.free, ['-b'], deps)
    return { memory: out.stdout.trim() }
  }
  const out = await runFixed(EXECUTABLES.uptime, [], deps)
  return { load: out.stdout.trim() }
}

export async function executeCommand(spec, deps = {}) {
  if (spec.kind === 'server') return serverCommand(spec, deps)
  if (spec.kind === 'git') return runGit(spec, deps)
  if (spec.kind === 'docker') {
    if (spec.command === 'containers') return { containers: await dockerPs(deps) }
    return { container: await inspectContainer(spec.target, deps) }
  }
  if (spec.kind === 'logs') {
    const result = await runFixed(EXECUTABLES.docker, [
      'logs', '--tail', String(spec.lines), '--since', '30m', CONTAINERS[spec.target],
    ], deps)
    return {
      container: CONTAINERS[spec.target],
      linesRequested: spec.lines,
      bounded: true,
      output: redactLogOutput(`${result.stdout}\n${result.stderr}`, spec.lines),
    }
  }
  if (spec.kind === 'nginx') {
    const container = await inspectContainer('nginx', deps)
    if (spec.command === 'nginx-status') return { container }
    return {
      container,
      expectedTopology: {
        publicPorts: [80, 443],
        routes: ['/', '/health', '/ready', '/api/kakapo', '/ws'],
        upstreams: ['kakapo-web', 'kakapo-api'],
      },
      checks: await Promise.all([
        checkUrl('http://127.0.0.1/health', deps),
        checkUrl('http://127.0.0.1/ready', deps),
        checkUrl('https://kakappo.shop/', deps),
      ]),
    }
  }
  if (spec.kind === 'http') {
    const urls = {
      health: 'http://127.0.0.1/health',
      ready: 'http://127.0.0.1/ready',
      web: 'https://kakappo.shop/',
    }
    return checkUrl(urls[spec.command], deps)
  }
  if (spec.kind === 'db') {
    const { runDatabaseCommand } = await import('./db.mjs')
    return runDatabaseCommand(spec, {
      ...(deps.db || {}),
      resolveDatabaseHost: () => postgresContainerIp(deps),
    })
  }
  throw new PolicyError('COMMAND_NOT_ALLOWED')
}

export async function main(argv = process.argv.slice(2), deps = {}) {
  try {
    const spec = parseCommand(argv)
    const result = await executeCommand(spec, deps)
    const output = safeJson({ ok: true, inspectorVersion: VERSION, readOnly: true, command: argv[0], result })
    deps.stdout ? deps.stdout(output) : process.stdout.write(`${output}\n`)
    return 0
  } catch (error) {
    const safe = safeError(error)
    const output = safeJson({ ok: false, inspectorVersion: VERSION, readOnly: true, error: safe })
    deps.stderr ? deps.stderr(output) : process.stderr.write(`${output}\n`)
    return error instanceof PolicyError ? 2 : 1
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) process.exitCode = await main()
