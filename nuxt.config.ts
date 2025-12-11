// https://nuxt.com/docs/api/configuration/nuxt-config
import type { NuxtPage } from 'nuxt/schema'
import { resolve } from 'node:path'
import { generateRuntimeConfig } from './server/utils/runtimeConfig'
import { getAppUrl } from './shared/utils/app-url'

const hyperdriveId = process.env.NUXT_CF_HYPERDRIVE_ID
const hyperdriveBindings = hyperdriveId && process.env.NODE_ENV === 'production'
  ? [{
      binding: 'HYPERDRIVE',
      id: hyperdriveId
    }]
  : undefined

if (process.env.NODE_ENV === 'production' && process.env.NUXT_NITRO_PRESET !== 'node-server' && !hyperdriveBindings) {
  console.warn('[nuxt.config] NUXT_CF_HYPERDRIVE_ID is not set; Hyperdrive binding will be skipped.')
}

const resolveMdcHighlighterPlugin = {
  name: 'resolve-mdc-highlighter',
  resolveId(id: string) {
    if (id && id.includes('mdc-highlighter.mjs') && id.includes('.cache')) {
      return id.replace(/node_modules\/\.cache\/nuxt\/\.nuxt/, resolve('.nuxt'))
    }
    return null
  }
}

export default defineNuxtConfig({
  compatibilityDate: '2025-12-11',
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],
  modules: [
    '@nuxt/ui',
    '@nuxtjs/mdc',
    '@nuxt/eslint',
    '@nuxtjs/i18n',
    '@nuxtjs/seo',
    ...(process.env.NODE_ENV === 'test' ? ['@nuxt/test-utils/module'] : []),
    ...(process.env.NUXT_NITRO_PRESET !== 'node-server' ? ['@nuxthub/core'] : [])
  ],
  mdc: {
    highlight: {
      server: false
    }
  },
  ...(process.env.NUXT_NITRO_PRESET !== 'node-server'
    ? {
        hub: {
          // Enable db for Cloudflare Workers (production builds), but not in local dev
          // In local dev, use DATABASE_URL directly via server/utils/db.ts
          ...(process.env.NUXT_NITRO_PRESET === 'cloudflare-module' && process.env.NODE_ENV === 'production'
            ? { db: 'postgresql' }
            : {}),
          workers: true,
          kv: process.env.NODE_ENV === 'production'
            ? true
            : {
                driver: 'fs-lite',
                base: '.data/kv'
              },
          blob: true,
          ...(hyperdriveBindings
            ? {
                bindings: {
                  hyperdrive: hyperdriveBindings
                }
              }
            : {})
        }
      }
    : {}),
  i18n: {
    vueI18n: '~/i18n/i18n.config.ts',
    baseUrl: getAppUrl(),
    locales: [
      { code: 'en', language: 'en-US', name: 'English' },
      { code: 'zh-CN', language: 'zh-CN', name: '简体中文' },
      { code: 'ja', language: 'ja-JP', name: '日本語' },
      { code: 'fr', language: 'fr-FR', name: 'Français' }
    ],
    defaultLocale: 'en',
    bundle: {
      optimizeTranslationDirective: false
    }
  },
  sitemap: {
    exclude: [
      '/admin/**',
      '/403',
      '/profile'
    ]
  },
  seo: {
    canonicalLowercase: false
  },
  robots: {
    disallow: [
      '/admin',
      '/profile'
    ]
  },
  eslint: {
    config: {
      standalone: false
    }
  },
  // Fonts are now self-hosted locally for GDPR compliance, performance, and offline support
  // See app/assets/css/main.css for @font-face declarations
  ogImage: {
    enabled: false
  },
  icon: {
    serverBundle: false,
    clientBundle: {
      scan: {
        globInclude: ['**\/*.{vue,jsx,tsx,md,mdc,mdx}', 'app/**/*.ts']
      }
    },
    customCollections: [
      {
        prefix: 'custom',
        dir: './app/assets/icons'
      }
    ]
  },
  hooks: {
    'pages:extend': function (pages) {
      const pagesToRemove: NuxtPage[] = []
      pages.forEach((page) => {
        if (page.path.includes('component') || page.path.includes('/api')) {
          pagesToRemove.push(page)
        }
      })

      pagesToRemove.forEach((page: NuxtPage) => {
        pages.splice(pages.indexOf(page), 1)
      })
    }
  },
  runtimeConfig: generateRuntimeConfig(),
  app: {
    head: {
      charset: 'utf-8',
      viewport: 'width=device-width, initial-scale=1, maximum-scale=5.0, minimum-scale=1.0',
      link: [
        { rel: 'icon', type: 'image/png', href: '/favicons/favicon-96x96.png', sizes: '96x96' },
        { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' },
        { rel: 'shortcut icon', href: '/favicon.ico' },
        { rel: 'apple-touch-icon', sizes: '180x180', href: '/favicons/apple-touch-icon.png' },
        { rel: 'manifest', href: '/favicons/site.webmanifest' }
      ],
      meta: [
        { name: 'apple-mobile-web-app-title', content: process.env.NUXT_APP_NAME }
      ]
    }
  },
  nitro: {
    preset: process.env.NUXT_NITRO_PRESET,
    experimental: {
      openAPI: true
    },
    ...(process.env.NUXT_NITRO_PRESET === 'cloudflare-module'
      ? {
          cloudflare: {
            deployConfig: true,
            nodeCompat: true
          }
        }
      : {}),
    rollupConfig: {
      external: process.env.NUXT_NITRO_PRESET != 'node-server' ? ['pg-native'] : undefined,
      plugins: process.env.NUXT_NITRO_PRESET === 'cloudflare-module'
        ? [resolveMdcHighlighterPlugin]
        : undefined
    },
    esbuild: {
      options: {
        jsx: 'automatic',
        jsxImportSource: 'react'
      }
    },
    publicAssets: process.env.NUXT_APP_STORAGE === 'local'
      ? [{
          dir: resolve(process.env.NUXT_LOCAL_UPLOAD_DIR || './uploads'),
          baseURL: process.env.NUXT_LOCAL_PUBLIC_PATH || '/uploads'
        }]
      : undefined
  },
  sourcemap: {
    server: false,
    client: false
  },
  $production: {
    build: {
      transpile: ['zod']
    }
  }
})
