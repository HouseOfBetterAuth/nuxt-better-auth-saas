import type { ContentFrontmatter, ContentSection } from './types'

export const normalizeStringArray = (value?: unknown): string[] => {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .map(entry => typeof entry === 'string' ? entry.trim() : '')
    .filter((entry): entry is string => Boolean(entry))
}

export const normalizeListItems = (text: string | null | undefined) => {
  if (!text) {
    return []
  }
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line
      .replace(/^[*-]\s+/, '')
      .replace(/^\d+[.)]\s+/, '')
      .trim())
    .filter(Boolean)
}

export const resolvePlanType = (section: ContentSection) => {
  const metaType = typeof section.meta?.planType === 'string'
    ? section.meta.planType
    : ''
  return (metaType || section.type || '').toLowerCase()
}

export const matchesPlanType = (section: ContentSection, keywords: string[]) => {
  const planType = resolvePlanType(section)
  const title = (section.title || '').toLowerCase()
  return keywords.some(keyword => planType.includes(keyword) || title.includes(keyword))
}

export const collectListItemsFromSections = (
  sections: ContentSection[] | null | undefined,
  keywords: string[]
) => {
  if (!sections?.length) {
    return []
  }
  const items = sections.flatMap((section) => {
    if (!matchesPlanType(section, keywords)) {
      return []
    }
    return normalizeListItems(section.body)
  })
  return Array.from(new Set(items)).filter(Boolean)
}

export const buildStepEntries = (
  sections: ContentSection[] | null | undefined,
  fallback = false
) => {
  const stepSections = (sections || []).filter(section => matchesPlanType(section, ['step', 'instruction', 'procedure', 'direction']))

  const resolvedSections = stepSections.length > 0
    ? stepSections
    : (fallback ? (sections || []) : [])

  return resolvedSections
    .map((section, index) => {
      const text = (section.summary || section.body || '').trim()
      if (!text) {
        return null
      }
      return {
        '@type': 'HowToStep',
        'position': index + 1,
        'name': section.title || `Step ${index + 1}`,
        'text': text
      }
    })
    .filter((step): step is { '@type': string, 'position': number, 'name': string, 'text': string } => Boolean(step))
}

export const buildFaqEntriesFromSections = (sections?: ContentSection[] | null) => {
  if (!sections?.length) {
    return []
  }
  return sections
    .filter(section => matchesPlanType(section, ['faq', 'question', 'qa']) || (section.title || '').trim().endsWith('?'))
    .map((section) => {
      const answerText = (section.body || section.summary || '').trim()
      const questionText = (section.title || '').trim()
      if (!questionText || !answerText) {
        return null
      }
      return {
        '@type': 'Question',
        'name': questionText,
        'acceptedAnswer': {
          '@type': 'Answer',
          'text': answerText
        }
      }
    })
    .filter((entry): entry is { '@type': 'Question', 'name': string, 'acceptedAnswer': { '@type': 'Answer', 'text': string } } => Boolean(entry))
}

export const buildCourseInstancesFromSections = (sections?: ContentSection[] | null) => {
  if (!sections?.length) {
    return []
  }
  return sections
    .filter(section => matchesPlanType(section, ['module', 'lesson', 'unit', 'chapter']))
    .map((section, index) => {
      const description = (section.summary || section.body || '').trim()
      return {
        '@type': 'CourseInstance',
        'name': section.title || `Module ${index + 1}`,
        'description': description
      }
    })
    .filter(instance => Boolean(instance.description || instance.name))
}

export const buildManualSteps = (entries: string[]) => {
  return entries
    .map((text, index) => {
      const trimmed = text.trim()
      if (!trimmed) {
        return null
      }
      return {
        '@type': 'HowToStep',
        'position': index + 1,
        'name': `Step ${index + 1}`,
        'text': trimmed
      }
    })
    .filter((entry): entry is { '@type': string, 'position': number, 'name': string, 'text': string } => Boolean(entry))
}

export const buildFaqEntriesFromMetadata = (entries?: unknown) => {
  if (!Array.isArray(entries)) {
    return []
  }
  return entries
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null
      }
      const question = 'question' in entry && typeof (entry as any).question === 'string'
        ? (entry as any).question.trim()
        : ''
      const answer = 'answer' in entry && typeof (entry as any).answer === 'string'
        ? (entry as any).answer.trim()
        : ''
      if (!question || !answer) {
        return null
      }
      return {
        '@type': 'Question',
        'name': question,
        'acceptedAnswer': {
          '@type': 'Answer',
          'text': answer
        }
      }
    })
    .filter((entry): entry is { '@type': 'Question', 'name': string, 'acceptedAnswer': { '@type': 'Answer', 'text': string } } => Boolean(entry))
}

export const buildCourseInstancesFromMetadata = (modules?: unknown) => {
  if (!Array.isArray(modules)) {
    return []
  }
  return modules
    .map((module, index) => {
      if (!module || typeof module !== 'object') {
        return null
      }
      const title = 'title' in module && typeof (module as any).title === 'string'
        ? (module as any).title.trim()
        : ''
      const description = 'description' in module && typeof (module as any).description === 'string'
        ? (module as any).description.trim()
        : ''
      const mode = 'mode' in module && typeof (module as any).mode === 'string'
        ? (module as any).mode.trim()
        : ''
      return {
        '@type': 'CourseInstance',
        'name': title || `Module ${index + 1}`,
        'description': description || undefined,
        'courseMode': mode || undefined
      }
    })
    .filter(instance => Boolean(instance && (instance.name || instance.description))) as Array<{
    '@type': string
    'name'?: string
    'description'?: string
    'courseMode'?: string
  }>
}

const extractStepTexts = (sections: ContentSection[] | null | undefined) => {
  return buildStepEntries(sections, true).map(entry => entry.text)
}

const ensureArray = (value?: string[] | null) => Array.isArray(value) ? value : []

export const deriveSchemaMetadata = (
  frontmatter: ContentFrontmatter,
  sections: ContentSection[]
): ContentFrontmatter => {
  const next: ContentFrontmatter = {
    ...frontmatter,
    schemaTypes: Array.isArray(frontmatter.schemaTypes) ? frontmatter.schemaTypes : []
  }
  const hasType = (type: string) => Array.isArray(next.schemaTypes) && next.schemaTypes.includes(type)

  if (hasType('Recipe')) {
    const existingRecipe = next.recipe || {}
    const ingredients = ensureArray(existingRecipe.ingredients).length
      ? ensureArray(existingRecipe.ingredients)
      : collectListItemsFromSections(sections, ['ingredient'])
    const instructions = ensureArray(existingRecipe.instructions).length
      ? ensureArray(existingRecipe.instructions)
      : extractStepTexts(sections)

    next.recipe = {
      ...existingRecipe,
      cuisine: existingRecipe.cuisine || next.targetLocale || undefined,
      ingredients: ingredients.length ? ingredients : existingRecipe.ingredients,
      instructions: instructions.length ? instructions : existingRecipe.instructions
    }
  }

  if (hasType('HowTo')) {
    const existingHowTo = next.howTo || {}
    const supplies = ensureArray(existingHowTo.supplies).length
      ? ensureArray(existingHowTo.supplies)
      : collectListItemsFromSections(sections, ['supply', 'material'])
    const tools = ensureArray(existingHowTo.tools).length
      ? ensureArray(existingHowTo.tools)
      : collectListItemsFromSections(sections, ['tool', 'equipment'])
    const steps = ensureArray(existingHowTo.steps).length
      ? ensureArray(existingHowTo.steps)
      : extractStepTexts(sections)

    next.howTo = {
      ...existingHowTo,
      supplies: supplies.length ? supplies : existingHowTo.supplies,
      tools: tools.length ? tools : existingHowTo.tools,
      steps: steps.length ? steps : existingHowTo.steps
    }
  }

  if (hasType('FAQPage')) {
    const existingFaq = next.faq || {}
    if (!existingFaq.entries || existingFaq.entries.length === 0) {
      const derivedEntries = buildFaqEntriesFromSections(sections).map(entry => ({
        question: entry.name,
        answer: entry.acceptedAnswer.text
      }))
      if (derivedEntries.length) {
        existingFaq.entries = derivedEntries
      }
    }
    next.faq = existingFaq
  }

  if (hasType('Course')) {
    const existingCourse = next.course || {}
    if (!existingCourse.modules || existingCourse.modules.length === 0) {
      const derivedModules = buildCourseInstancesFromSections(sections).map(instance => ({
        title: instance.name,
        description: instance.description || null
      }))
      if (derivedModules.length) {
        existingCourse.modules = derivedModules
      }
    }
    next.course = existingCourse
  }

  return next
}

export const validateSchemaMetadata = (frontmatter: ContentFrontmatter) => {
  const errors: string[] = []
  const warnings: string[] = []
  const hasType = (type: string) => Array.isArray(frontmatter.schemaTypes) && frontmatter.schemaTypes.includes(type)

  if (hasType('Recipe')) {
    if (!frontmatter.recipe?.ingredients || frontmatter.recipe.ingredients.length === 0) {
      errors.push('Recipe schema requires at least one ingredient.')
    }
    if (!frontmatter.recipe?.instructions || frontmatter.recipe.instructions.length === 0) {
      errors.push('Recipe schema requires step-by-step instructions.')
    }
    if (!frontmatter.recipe?.totalTime) {
      warnings.push('Recipe schema is missing totalTime (ISO 8601 duration).')
    }
    if (!frontmatter.recipe?.yield) {
      warnings.push('Recipe schema is missing recipeYield.')
    }
  }

  if (hasType('HowTo')) {
    if (!frontmatter.howTo?.steps || frontmatter.howTo.steps.length === 0) {
      errors.push('HowTo schema requires step-by-step instructions.')
    }
    if (!frontmatter.howTo?.supplies || frontmatter.howTo.supplies.length === 0) {
      warnings.push('HowTo schema is missing supplies list.')
    }
    if (!frontmatter.howTo?.tools || frontmatter.howTo.tools.length === 0) {
      warnings.push('HowTo schema is missing tools list.')
    }
  }

  if (hasType('FAQPage')) {
    if (!frontmatter.faq?.entries || frontmatter.faq.entries.length === 0) {
      errors.push('FAQ schema requires at least one question and answer.')
    }
  }

  if (hasType('Course')) {
    if (!frontmatter.course?.modules || frontmatter.course.modules.length === 0) {
      errors.push('Course schema requires modules or lessons.')
    }
    if (!frontmatter.course?.providerName) {
      warnings.push('Course schema is missing provider.name.')
    }
  }

  return {
    errors,
    warnings
  }
}
