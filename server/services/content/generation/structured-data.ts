import type { ContentFrontmatter, ContentSection } from './types'
import {
  buildCourseInstancesFromMetadata,
  buildCourseInstancesFromSections,
  buildFaqEntriesFromMetadata,
  buildFaqEntriesFromSections,
  buildManualSteps,
  buildStepEntries,
  collectListItemsFromSections,
  normalizeStringArray
} from './schemaMetadata'

const buildRecipeStructuredData = (params: {
  frontmatter: ContentFrontmatter
  sections?: ContentSection[] | null
}) => {
  const recipeMeta = params.frontmatter.recipe
  const manualIngredients = normalizeStringArray(recipeMeta?.ingredients)
  const manualInstructions = normalizeStringArray(recipeMeta?.instructions)
  const ingredients = manualIngredients.length
    ? manualIngredients
    : collectListItemsFromSections(params.sections ?? null, ['ingredient'])
  const instructions = manualInstructions.length
    ? buildManualSteps(manualInstructions)
    : buildStepEntries(params.sections ?? null, true)

  const data: Record<string, any> = {}
  if (ingredients.length) {
    data.recipeIngredient = ingredients
  }
  if (instructions.length) {
    data.recipeInstructions = instructions
  }
  if (recipeMeta?.yield) {
    data.recipeYield = recipeMeta.yield
  }
  if (recipeMeta?.prepTime) {
    data.prepTime = recipeMeta.prepTime
  }
  if (recipeMeta?.cookTime) {
    data.cookTime = recipeMeta.cookTime
  }
  if (recipeMeta?.totalTime) {
    data.totalTime = recipeMeta.totalTime
  }
  if (recipeMeta?.calories) {
    data.nutrition = {
      '@type': 'NutritionInformation',
      'calories': recipeMeta.calories
    }
  }
  if (recipeMeta?.cuisine) {
    data.recipeCuisine = recipeMeta.cuisine
  } else if (params.frontmatter.targetLocale) {
    data.recipeCuisine = params.frontmatter.targetLocale
  }
  if (!data.recipeCategory) {
    if (params.frontmatter.primaryKeyword) {
      data.recipeCategory = params.frontmatter.primaryKeyword
    } else if (Array.isArray(params.frontmatter.tags) && params.frontmatter.tags.length) {
      data.recipeCategory = params.frontmatter.tags[0]
    }
  }
  return data
}

const buildHowToStructuredData = (params: {
  frontmatter: ContentFrontmatter
  sections?: ContentSection[] | null
}) => {
  const howToMeta = params.frontmatter.howTo
  const manualSteps = normalizeStringArray(howToMeta?.steps)
  const manualSupplies = normalizeStringArray(howToMeta?.supplies)
  const manualTools = normalizeStringArray(howToMeta?.tools)
  const steps = manualSteps.length
    ? buildManualSteps(manualSteps)
    : buildStepEntries(params.sections ?? null, true)
  const supplies = manualSupplies.length
    ? manualSupplies
    : collectListItemsFromSections(params.sections ?? null, ['supply', 'material'])
  const tools = manualTools.length
    ? manualTools
    : collectListItemsFromSections(params.sections ?? null, ['tool', 'equipment'])

  const data: Record<string, any> = {}
  if (steps.length) {
    data.step = steps
  }
  if (supplies.length) {
    data.supply = supplies
  }
  if (tools.length) {
    data.tool = tools
  }
  if (howToMeta?.estimatedCost) {
    data.estimatedCost = {
      '@type': 'MonetaryAmount',
      'value': howToMeta.estimatedCost
    }
  }
  if (howToMeta?.totalTime) {
    data.totalTime = howToMeta.totalTime
  }
  if (howToMeta?.difficulty) {
    data.difficulty = howToMeta.difficulty
  }
  return data
}

export const generateStructuredDataJsonLd = (params: {
  frontmatter: ContentFrontmatter
  seoSnapshot: Record<string, any> | null
  baseUrl?: string
  sections?: ContentSection[] | null
}): string => {
  const { frontmatter, seoSnapshot, baseUrl, sections } = params
  const schemaTypes = Array.isArray(frontmatter.schemaTypes) ? frontmatter.schemaTypes : []
  const normalizedSchemaTypes = schemaTypes
    .map(type => (typeof type === 'string' ? type.trim() : ''))
    .filter((type): type is string => Boolean(type))

  if (!normalizedSchemaTypes.length) {
    return ''
  }

  const structuredData: Record<string, any> = {
    '@context': 'https://schema.org',
    '@type': normalizedSchemaTypes.length === 1 ? normalizedSchemaTypes[0] : normalizedSchemaTypes
  }

  // Basic article properties
  if (frontmatter.title) {
    structuredData.headline = frontmatter.title
  }
  if (frontmatter.description) {
    structuredData.description = frontmatter.description
  }
  if (frontmatter.primaryKeyword) {
    structuredData.keywords = frontmatter.primaryKeyword
  }
  if (Array.isArray(frontmatter.keywords) && frontmatter.keywords.length > 0) {
    const keywordEntries = frontmatter.keywords
      .map(keyword => typeof keyword === 'string' ? keyword.trim() : '')
      .filter((keyword): keyword is string => Boolean(keyword))
    const normalizedPrimary = typeof frontmatter.primaryKeyword === 'string'
      ? frontmatter.primaryKeyword.trim()
      : ''
    const hasPrimary = normalizedPrimary
      ? keywordEntries.includes(normalizedPrimary)
      : false
    const keywordsList = normalizedPrimary && !hasPrimary
      ? [normalizedPrimary, ...keywordEntries]
      : keywordEntries
    if (keywordsList.length) {
      structuredData.keywords = keywordsList.join(', ')
    }
  }

  // Add datePublished if available
  const seoPlan = seoSnapshot && typeof seoSnapshot === 'object' ? seoSnapshot.plan : null
  if (seoPlan && typeof seoPlan === 'object' && seoPlan.datePublished) {
    structuredData.datePublished = seoPlan.datePublished
  }

  // Add URL if baseUrl is provided
  if (baseUrl && frontmatter.slug) {
    const normalizedBase = baseUrl.replace(/\/+$/, '')
    const normalizedSlug = frontmatter.slug.replace(/^\/+/, '')
    structuredData.url = `${normalizedBase}/${normalizedSlug}`
  }

  const hasType = (typeName: string) => normalizedSchemaTypes.includes(typeName)

  if (hasType('Recipe')) {
    Object.assign(structuredData, buildRecipeStructuredData({ frontmatter, sections }))
  }

  if (hasType('HowTo')) {
    Object.assign(structuredData, buildHowToStructuredData({ frontmatter, sections }))
  }

  if (hasType('FAQPage')) {
    const manualFaqEntries = buildFaqEntriesFromMetadata(frontmatter.faq?.entries)
    const fallbackFaqEntries = buildFaqEntriesFromSections(sections)
    const faqEntries = manualFaqEntries.length ? manualFaqEntries : fallbackFaqEntries
    if (faqEntries.length) {
      structuredData.mainEntity = faqEntries
      if (frontmatter.faq?.description && !structuredData.description) {
        structuredData.description = frontmatter.faq.description
      }
    }
  }

  if (hasType('Course')) {
    const manualInstances = buildCourseInstancesFromMetadata(frontmatter.course?.modules)
    const fallbackInstances = buildCourseInstancesFromSections(sections)
    const courseInstances = manualInstances.length ? manualInstances : fallbackInstances
    if (courseInstances.length) {
      structuredData.hasCourseInstance = courseInstances
    }
    if (frontmatter.course?.courseCode) {
      structuredData.courseCode = frontmatter.course.courseCode
    }
    if (frontmatter.course?.providerName) {
      structuredData.provider = {
        '@type': 'Organization',
        'name': frontmatter.course.providerName,
        ...(frontmatter.course.providerUrl ? { sameAs: frontmatter.course.providerUrl } : {})
      }
    }
  }

  const jsonLd = JSON.stringify(structuredData, null, 2)
  const escapedJsonLd = jsonLd.replace(/<\/script/gi, '<\\/script')
  return `<script type="application/ld+json">\n${escapedJsonLd}\n</script>`
}
