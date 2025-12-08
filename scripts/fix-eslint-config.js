import { existsSync, symlinkSync } from 'fs'
import { join } from 'path'

const target = join('node_modules', '@antfu', 'eslint-config', 'dist', 'index.mjs')
const link = join('node_modules', '@antfu', 'eslint-config', 'dist', 'index.js')

if (existsSync(target) && !existsSync(link)) {
  symlinkSync('index.mjs', link, 'file')
  console.log('Created symlink for @antfu/eslint-config')
}
