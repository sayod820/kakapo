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

function safeError(error) {
  if (error instanceof PolicyError) return { code: error.code, message: error.message }
  return { code: 'INSPECTION_FAILED', message: redactText(error?.message || String(error)) }
}

export async function runFixed(file, args, deps = {}) {
  const execute = deps.execFile || execFile
  const result = await execute(file, args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10_000,
    maxBuffer: MAX_COMMAND_BYTES,
    shell: false,
    env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' },
  })
  return {
    stdout: redactText(result?.stdout || ''),
    stderr: redactText(result?.stderr || ''),
  }
}

export function sanitizeContainerInspect(raw, expectedName) {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (!value || typeof value !== 'object') throw new PolicyError('INVALID_DOCKER_RESPONSE')
  const actualName = String(value.Name || '').replace(/^\//, '')
  if (actualName !== expectedName) throw new PolicyError('CONTAINER_IDENTITY_MISMATCH')
  const state = value.State || {}
  const health = state.Health || {}
  return {
    id: String(value.Id || '').slice(0, 12),
    name: actualName,
    image: value.Config?.Image || null,
    created: value.Created || null,
    state: {
      status: state.Status || null,
      running: state.Running === true,
      restarting: state.Restarting === true,
      oomKilled: state.OOMKilled === true,
      dead: state.Dead === true,
      exitCode: Number.isFinite(Number(state.ExitCode)) ? Number(state.ExitCode) : null,
      startedAt: state.StartedAt || null,
      finishedAt: state.FinishedAt || null,
      errorPresent: Boolean(state.Error),
    },
    health: health.Status ? {
      status: health.Status,
      failingStreak: Number(health.FailingStreak) || 0,
      lastChecks: (Array.isArray(health.Log) ? health.Log : []).slice(-3).map(item => ({
        start: item?.Start || null,
        end: item?.End || null,
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
    image: image || null,
    state: state || null,
    status: status || null,
    runningFor: runningFor || null,
  }
}

export function extractPostgresContainerIp(raw) {
  const value = Array.isArray(raw) ? raw[0] : raw
  const actualName = String(value?.Name || '').replace(/^\//, '')
  if (actualName !== CONTAINERS.postgres) throw new PolicyError('CONTAINER_IDENTITY_MISMATCH')
  const ip = value?.NetworkSettings?.Networks?.['kakapo-net']?.IPAddress
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(String(ip || ''))) {
    throw new PolicyError('POSTGRES_CONTAINER_IP_UNAVAILABLE')
  }
  return String(ip)
}

async function postgresContainerIp(deps = {}) {
  const result = await runFixed(EXECUTABLES.docker, ['inspect', CONTAINERS.postgres], deps)
  return extractPostgresContainerIp(JSON.parse(result.stdout))
}

async function inspectContainer(alias, deps = {}) {
  const name = CONTAINERS[alias]
  if (!name) throw new PolicyError('INVALID_CONTAINER')
  const result = await runFixed(EXECUTABLES.docker, ['inspect', name], deps)
  const parsed = JSON.parse(result.stdout)
  return sanitizeContainerInspect(parsed, name)
}

async function dockerPs(deps = {}) {
  const rows = []
  for (const name of Object.values(CONTAINERS)) {
    const result = await runFixed(EXECUTABLES.docker, [
      'ps', '-a', '--filter', `name=^/${name}$`,
      '--format', '{{.Names}}\t{{.Image}}\t{{.State}}\t{{.Status}}\t{{.RunningFor}}',
    ], deps)
    const row = parseDockerPsRow(result.stdout, name)
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
    const out = await runFixed(EXECUTABLES.curl, [
      '--silent', '--show-error', '--max-time', '5',
      '--output', '/dev/null', '--write-out', '%{http_code}', url,
    ], deps)
    return { url, reachable: true, httpStatus: Number(out.stdout.trim()) || null }
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
