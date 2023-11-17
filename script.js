#!/usr/bin/env node
const os = require('os')
const path = require('path')
const fs = require('fs-extra')
const fg = require('fast-glob')
const { parseArgs } = require('util')
const { exec } = require('child_process')
const { nodeFileTrace } = require('@vercel/nft')

const { values } = parseArgs({
  strict: true,
  options: {
    verbose: { type: 'boolean', short: 'v', default: false },
    pattern: { type: 'string', short: 'p', default: '**/*.{js,json}' },
    input: { type: 'string', short: 'i' },
    output: { type: 'string', short: 'o' },
  }
})

if (!values.input || !values.output) {
  throw new Error(`
    Required input and output, pass an input (-i, --input) and output (-o, --output).
    Input must be the location of the package to isolate (i.e. 'packages/web').
    Output must be the location to output the isolated zip package (i.e. 'packages/web/deploy.zip').
  `)
}

function log(msg) {
  if (values.verbose) {
    console.log(`[Bulder] ${msg}`)
  }
}

function getBase(base) {
  if (base === '/')
    throw new Error('Base cannot be found.')

  if (
    fs.existsSync(path.join(base, 'yarn.lock')) ||
    fs.existsSync(path.join(base, 'package-lock.json')) ||
    fs.existsSync(path.join(base, 'pnpm-lock.yaml'))
  ) {
    return base
  }

  return getBase(path.join(base, '..'))
}

function getPath(entry, out, file) {
  if (fs.lstatSync(path.join(entry, file)).isDirectory()) {
    console.log(`${path.join(entry, file)} is dir`)
    return path.join(out, file)
  }

  console.log(`${path.join(entry, file)} is file`)
  return path.join(out, path.dirname(file))
}

function execShellCommand(cmd, cwd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd }, (error, stdout, stderr) => {
      if (error) {
        console.warn(error);
      }
      resolve(stdout? stdout : stderr);
    });
  });
}

async function copyToDir() {
  // Adquire temp dir
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-'))

  // Adquire base of monorepo
  const base = getBase(process.cwd())

  // Calculate glob pattern
  const pattern = fg.sync(values.pattern, { ignore: ['node_modules'], cwd: process.cwd() })

  // Calculate files to copy
  const { fileList } = await nodeFileTrace(pattern, {
    base,
    processCwd: path.resolve(process.cwd()),
  })

  // Copy root package.json
  if (fs.statSync(path.join(base, 'package.json')).isFile()) {
    log(`Copying Root package.json`)
    fs.copySync(path.join(base, 'package.json'), path.join(tmpdir, 'package.json'))
  }

  // Copy files
  for (const file of fileList) {
    const dirPath = getPath(base, tmpdir, file)
    fs.ensureDirSync(dirPath)
    log(`Copy from ${path.join(base, file)} to ${path.join(tmpdir, file)}`)
    fs.copySync(path.join(base, file), path.join(tmpdir, file))
  }

  // Zip folder
  const zipArgs = ['-r deploy.zip', values.verbose ? '-qq' : null].filter(Boolean).join(' ')

  log('Zip Output: ', await execShellCommand(`zip ${zipArgs} *`, tmpdir))

  // Copy Zip:
  fs.copySync(path.join(tmpdir, 'deploy.zip'), values.output)

  // Clear temp folder
  fs.removeSync(tmpdir)
}

copyToDir().then(() => process.exit(0)).catch(err => {
  console.error(err)
  process.exit(1)
})