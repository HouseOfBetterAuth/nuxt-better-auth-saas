// @vitest-environment node
import type { ContentFrontmatter, ContentSection } from '../../server/services/content/generation/types'
import { describe, expect, it } from 'vitest'
import { deriveSchemaMetadata, validateSchemaMetadata } from '../../server/services/content/generation/schemaMetadata'
import { generateStructuredDataJsonLd } from '../../server/services/content/generation/structured-data'

const baseFrontmatter: ContentFrontmatter = {
  title: 'Test Content',
  slug: 'test-content',
  slugSuggestion: 'test-content',
  status: 'draft',
  contentType: 'recipe',
  schemaTypes: ['BlogPosting', 'Recipe', 'HowTo', 'FAQPage', 'Course'],
  tags: [],
  keywords: [],
  primaryKeyword: 'test',
  targetLocale: 'en-US'
}

const sampleSections: ContentSection[] = [
  {
    id: 'ingredients',
    index: 0,
    type: 'ingredient_list',
    title: 'Ingredients',
    level: 2,
    anchor: 'ingredients',
    summary: null,
    body: '- 2 cups flour\n- 1 tsp salt',
    wordCount: 6,
    meta: { planType: 'ingredient_list' }
  },
  {
    id: 'steps',
    index: 1,
    type: 'howto_steps',
    title: 'Steps',
    level: 2,
    anchor: 'steps',
    summary: null,
    body: '1. Mix ingredients\n2. Bake for 20 minutes',
    wordCount: 7,
    meta: { planType: 'howto_step' }
  },
  {
    id: 'faq',
    index: 2,
    type: 'faq',
    title: 'How long does it keep?',
    level: 2,
    anchor: 'faq',
    summary: 'About 3 days in the fridge.',
    body: 'About 3 days in the fridge.',
    wordCount: 7,
    meta: { planType: 'faq' }
  },
  {
    id: 'module',
    index: 3,
    type: 'module',
    title: 'Module 1',
    level: 2,
    anchor: 'module-1',
    summary: 'An introductory lesson.',
    body: 'Lesson content',
    wordCount: 4,
    meta: { planType: 'module' }
  }
]

describe('schema metadata helpers', () => {
  it('derives ingredients, steps, faq entries, and course modules from sections', () => {
    const result = deriveSchemaMetadata(baseFrontmatter, sampleSections)
    expect(result.recipe?.ingredients).toEqual(['2 cups flour', '1 tsp salt'])
    expect(result.howTo?.steps?.length).toBeGreaterThan(0)
    expect(result.faq?.entries?.length).toBe(1)
    expect(result.course?.modules?.length).toBe(1)
  })

  it('validates schema requirements and reports missing fields', () => {
    const minimalFrontmatter: ContentFrontmatter = {
      ...baseFrontmatter,
      recipe: undefined,
      howTo: undefined,
      faq: { description: null, entries: [] },
      course: { providerName: null, providerUrl: null, courseCode: null, modules: [] }
    }
    const result = validateSchemaMetadata(minimalFrontmatter)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('generates JSON-LD with enriched recipe metadata', () => {
    const enrichedFrontmatter = deriveSchemaMetadata(baseFrontmatter, sampleSections)
    const jsonLd = generateStructuredDataJsonLd({
      frontmatter: enrichedFrontmatter,
      seoSnapshot: null,
      sections: sampleSections
    })
    expect(jsonLd).toContain('recipeIngredient')
    expect(jsonLd).toContain('HowToStep')
    expect(jsonLd).toContain('mainEntity')
  })
})
