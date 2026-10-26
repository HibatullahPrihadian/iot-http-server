#!/usr/bin/env node
// Pembuat tag versi untuk rilis.
//
// Dipakai oleh .github/workflows/release.yml, tapi bisa dijalankan lokal:
//
//   node scripts/release-tag.mjs --prepare [--dry-run]
//     -> validasi sinkronisasi versi, pastikan tag v<versi> belum ada,
//        lalu buat annotated tag di HEAD. Cetak "tag=v<versi>".
//
//   node scripts/release-tag.mjs --ensure v1.0.1 [--dry-run]
//     -> verifikasi tag sudah ada di origin (untuk backfill Release).
//
// Script ini TIDAK mem-push tag; push dilakukan workflow agar --dry-run aman.
import { appendFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readVersion } from './version.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TAG_PATTERN = /^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/

function git(args, { allowFailure = false } = {}) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch (err) {
    if (allowFailure) return ''
    throw new Error(`git ${args.join(' ')} gagal: ${(err.stderr || err.message).toString().trim()}`)
  }
}

function tagExistsOnOrigin(tag) {
  return git(['ls-remote', '--tags', 'origin', `refs/tags/${tag}`]) !== ''
}

function tagExistsLocally(tag) {
  return git(['tag', '--list', tag]) !== ''
}

function assertTagFormat(tag) {
  if (!TAG_PATTERN.test(tag)) {
    throw new Error(`Tag tidak valid: "${tag}" (harus v<semver>, mis. v1.0.1)`)
  }
}

function emitTag(tag) {
  console.log(`tag=${tag}`)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `tag=${tag}\n`)
}

function prepare({ dryRun }) {
  execFileSync(process.execPath, [join(ROOT, 'scripts', 'check-version.mjs')], { cwd: ROOT, stdio: 'inherit' })

  const version = readVersion()
  const tag = `v${version}`
  assertTagFormat(tag)

  if (tagExistsLocally(tag)) {
    throw new Error(`Tag ${tag} sudah ada secara lokal. Naikkan versi bila ini rilis baru.`)
  }
  if (tagExistsOnOrigin(tag)) {
    throw new Error(`Tag ${tag} sudah ada di origin. Naikkan versi (npm run version:bump) sebelum rilis.`)
  }

  const subject = git(['log', '-1', '--pretty=%s', 'HEAD'])
  const message = `${tag}: ${subject}`

  if (dryRun) {
    console.log(`[dry-run] git tag -a ${tag} -m "${message}"`)
    emitTag(tag)
    return
  }

  git(['tag', '-a', tag, '-m', message, 'HEAD'])
  console.log(`Tag ${tag} dibuat di ${git(['rev-parse', '--short', 'HEAD'])}.`)
  emitTag(tag)
}

function ensure(rawTag, { dryRun }) {
  const tag = rawTag || `v${readVersion()}`
  assertTagFormat(tag)

  if (!tagExistsOnOrigin(tag)) {
    throw new Error(`Tag ${tag} tidak ditemukan di origin. Buat tag dulu sebelum Release.`)
  }

  if (dryRun) console.log(`[dry-run] tag ${tag} ada di origin.`)
  else console.log(`Tag ${tag} ada di origin.`)
  emitTag(tag)
}

function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const ensureIndex = args.indexOf('--ensure')

  try {
    if (ensureIndex !== -1) {
      const value = args[ensureIndex + 1]
      ensure(value && !value.startsWith('--') ? value : '', { dryRun })
      return
    }
    if (args.includes('--prepare')) {
      prepare({ dryRun })
      return
    }
    console.error('Pakai: node scripts/release-tag.mjs --prepare [--dry-run]')
    console.error('   atau node scripts/release-tag.mjs --ensure <tag> [--dry-run]')
    process.exit(1)
  } catch (err) {
    console.error(`Error: ${err.message}`)
    process.exit(1)
  }
}

main()
