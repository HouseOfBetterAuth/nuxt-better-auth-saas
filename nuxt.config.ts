// https://nuxt.com/docs/api/configuration/nuxt-config
import type { NuxtPage } from 'nuxt/schema'
import { resolve } from 'node:path'
import { generateRuntimeConfig } from './server/utils/runtimeConfig'

console.log(`Current NODE_ENV: ${process.env.NODE_ENV}`)

/**
 * Determines the correct app URL based on environment
 * Same logic as runtimeConfig.ts
 */
const getAppUrl = (): string => {
  const nodeEnv = process.env.NODE_ENV || 'development'

  // Test environment: use test URL
  if (nodeEnv === 'test') {
    return process.env.NUXT_TEST_APP_URL || 'http://localhost:3000'
  }

  // Production: require explicit URL and prevent localhost
  if (nodeEnv === 'production') {
    const url = process.env.NUXT_APP_URL
    if (!url) {
      throw new Error('NUXT_APP_URL must be set in production environment')
    }
    if (url.includes('localhost') || url.includes('127.0.0.1')) {
      throw new Error('NUXT_APP_URL cannot be localhost in production. Set it to your production URL.')
    }
    return url
  }

  // Development: use NUXT_APP_URL if set, otherwise default to localhost
  return process.env.NUXT_APP_URL || 'http://localhost:3000'
}

export default defineNuxtConfig({
  compatibilityDate: '2025-07-22',
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],
  modules: [
    '@nuxt/ui',
    '@nuxt/eslint',
    '@nuxtjs/i18n',
    '@nuxtjs/seo',
    'nuxt-echarts',
    ...(process.env.NODE_ENV === 'test' ? ['@nuxt/test-utils/module'] : []),
    ...(process.env.NUXT_NITRO_PRESET !== 'node-server' ? ['@nuxthub/core'] : [])
  ],
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
  echarts: {
    renderer: ['svg'],
    charts: ['LineChart', 'BarChart'],
    components: ['TitleComponent', 'TooltipComponent', 'GridComponent', 'LegendComponent']
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
  fonts: {
    provider: 'local'
  },
  ogImage: {
    enabled: false
  },
  icon: {
    serverBundle: false,
    clientBundle: {
      scan: {
        globInclude: ['**\/*.{vue,jsx,tsx,md,mdc,mdx}', 'app/**/*.ts']
      }
    }
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
      // Uncomment to show current Routes
      // console.log(`\nCurrent Routes:`)
      // console.log(pages)
      // console.log(`\n`)
    }
  },
  ...(process.env.NUXT_NITRO_PRESET !== 'node-server'
    ? {
        hub: {
          workers: true,
          kv: true,
          blob: true,
          bindings: {
            hyperdrive: {
              HYPERDRIVE: process.env.NUXT_CF_HYPERDRIVE_ID as string
            }
          }
        }
      }
    : {}),
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
    rollupConfig: {
      external: process.env.NUXT_NITRO_PRESET != 'node-server' ? ['pg-native'] : undefined
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
