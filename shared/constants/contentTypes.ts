export const CONTENT_TYPES = [
  'blog_post',
  'landing_page',
  'docs_article',
  'social_thread',
  'recipe',
  'faq_page',
  'course',
  'how_to'
] as const

export type ContentType = typeof CONTENT_TYPES[number]

export const DEFAULT_CONTENT_TYPE: ContentType = 'blog_post'

export interface ContentTypeOption {
  value: ContentType
  label: string
  description: string
  icon: string
}

export const CONTENT_TYPE_OPTIONS: ContentTypeOption[] = [
  {
    value: 'blog_post',
    label: 'Standard blog',
    description: 'General blog article with SEO-ready structure.',
    icon: 'i-lucide-file-text'
  },
  {
    value: 'landing_page',
    label: 'Landing page',
    description: 'Conversion-focused copy for signups or launches.',
    icon: 'i-lucide-globe'
  },
  {
    value: 'docs_article',
    label: 'Docs article',
    description: 'Reference documentation or knowledge base entries.',
    icon: 'i-lucide-book-open'
  },
  {
    value: 'social_thread',
    label: 'Social thread',
    description: 'Multi-post thread for LinkedIn, X, or similar.',
    icon: 'i-lucide-message-square'
  },
  {
    value: 'recipe',
    label: 'Recipe schema',
    description: 'Include ingredients, steps, cook times, and tips.',
    icon: 'i-lucide-cookie'
  },
  {
    value: 'faq_page',
    label: 'FAQ schema',
    description: 'Question-and-answer blocks for top customer asks.',
    icon: 'i-lucide-help-circle'
  },
  {
    value: 'course',
    label: 'Course schema',
    description: 'Module and lesson structure for educational content.',
    icon: 'i-lucide-graduation-cap'
  },
  {
    value: 'how_to',
    label: 'How-to schema',
    description: 'Step-by-step walkthroughs with required materials.',
    icon: 'i-lucide-list-checks'
  }
]
