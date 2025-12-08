import { copyFileSync, existsSync, symlinkSync } from 'fs'
import { join } from 'path'

const target = join('node_modules', '@antfu', 'eslint-config', 'dist', 'index.mjs')
const link = join('node_modules', '@antfu', 'eslint-config', 'dist', 'index.js')

if (existsSync(target) && !existsSync(link)) {
  try {
    symlinkSync('index.mjs', link, 'file')
    console.log('Created symlink for @antfu/eslint-config')
  } catch (error) {
    console.error(`Failed to create symlink for @antfu/eslint-config: ${error.message}`)
    if (error.stack) {
      console.error(`Error stack: ${error.stack}`)
    }
    // Fallback: copy the file instead of creating a symlink
    try {
      copyFileSync(target, link)
      console.log('Fallback: Created file copy for @antfu/eslint-config')
    } catch (copyError) {
      console.error(`Fallback copy also failed: ${copyError.message}`)
      // Continue without crashing - postinstall will proceed
    }
  }
}
