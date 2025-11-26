# LLM Codex Pipeline Plan (Nuxt + Python)

This document describes a **reusable, staged pipeline** for long-form sources (e.g. 30‑minute YouTube cooking videos) that turns transcripts into SEO‑ready MDX blogs with section‑level editing.

It is the source of truth for the Nuxt implementation and is grounded in what already exists in the current Python backend.

---

## 1. Goals

- **Codex‑style flow** for long videos:
  - Transcribing → reading → planning → writing sections → assembling → SEO → ready to publish.
- **Section‑first architecture**:
  - Outline + sections are first‑class, not an afterthought.
- **Reusability**:
  - Same pipeline works for any long `source_content` (YouTube today, Docs later).
- **Org‑scoped, Nuxt‑native**:
  - Reuse existing `organization` / better‑auth patterns and Drizzle ORM.

We intentionally avoid job/queue plumbing and extra SEO UI in v1; those can be layered on later.

---

## 2. Core Data Model (Summary)

We keep the existing entities from the prior plan but focus on how they support the pipeline.

- **`source_content`**
  - Where material comes from.
  - Fields (conceptual):
    - `id`, `organization_id`, `created_by_user_id`.
    - `source_type` (`"youtube" | "raw_text" | "google_doc" | ...`).
    - `external_id` (e.g. YouTube video ID).
    - `title`.
    - `source_text` (full transcript / body the LLM reads).
    - `metadata` JSON (provider‑specific).
    - `ingest_status` (`pending | ingested | failed`).

- **`chunk`** (required v1)
  - Transcript segments used for RAG.
  - Per‑chunk: `id`, `organization_id`, `source_content_id`, `chunk_index`, `start_char`, `end_char`, `text_preview`, timestamps, etc.
  - Embeddings stored in vector store keyed by `organization_id + source_content_id + chunk_index`.

- **`content`**
  - The logical article/post.
  - Fields: `id`, `organization_id`, `source_content_id`, `slug`, `title`, `status`, `content_type`, `primary_keyword`, `target_locale`, `current_version_id`, timestamps.

  - **`content_version`**
  - Immutable snapshot of a draft or edit.
  - Fields: `id`, `content_id`, `version`, `created_by_user_id`, timestamps.
    - `version: number` — monotonically incrementing integer starting at 1 (e.g. 1, 2, 3…).
  - Content fields:
    - `frontmatter` JSON (SEO+metadata).
    - `body_mdx` (full MDX).
    - `body_html` (rendered for preview/publish).
    - `sections` JSON (see section 4).
    - `assets` JSON (including `{ generator: { source, model } }`).
    - `seo_snapshot` JSON (optional v1).

- **`publication`**
  - Links `content_version` → external systems via `integration`.
  - Used later for WordPress / Docs publishing.

All new tables are **org‑scoped** and follow existing Nuxt SaaS conventions.

---

## 3. End‑to‑End Pipeline Stages

For a YouTube video, the **target** pipeline is:

1. **Ingest + transcript + chunks**
2. **Plan / outline (content plan)**
3. **Frontmatter generation**
4. **Section generation (per‑section writing, RAG‑aware)**
5. **Assemble full version from sections**
6. **SEO analysis**
7. **Section patching (chat‑driven editing)**

Each stage has a conceptual API and a brief note on **what exists today vs what to build**.

### 3.0 Current implementation (COMPLETED ✅)

~~Today, `POST /api/content/generate` calls `generateContentDraft`, which:~~

**REBUILT**: `generateContentDraft` has been transformed into a **staged pipeline** (`server/services/content/generation.ts`):

1. **Chunking/Fetching Stage** (lines 62-215):
   - Resolves `inputText` from either `text` or `sourceContent.sourceText`
   - Fetches and chunks transcript data for RAG context
   - Prepares source material for AI planning

2. **AI-Planned Brief Stage** (lines 300-406):
   - LLM generates structured outline and frontmatter
   - Derives SEO metadata and content plan
   - Creates stable foundation before section generation

3. **RAG-Contextualized Section Generation** (lines 409-640):
   - Per-section content generation with transcript chunk context
   - JSON parsing safeguards for reliable structured output
   - Individual section writing with RAG-aware prompts

4. **MDX Assembly Stage**:
   - Stitches sections into complete MDX document
   - Captures section offsets, metadata, and assets
   - Persists new `content_version` with structured sections

**UI Integration COMPLETED**:
- Chat landing page (`app/pages/[slug]/chat.vue`) displays real draft data in cards
- Content detail route (`app/pages/[slug]/content/[id].vue`) renders staged pipeline data
- Section-level display with summaries, metadata, and editing capabilities

This provides `/api/content/generate` and `/api/chat` with **deterministic plan → sections → assemble behavior** while maintaining backward compatibility.

---

## 3.1 Ingest + Transcript + Chunks ✅ COMPLETED

**Implemented endpoint**

- `POST /api/source-content/youtube` (`server/api/source-content/youtube.post.ts`)

- **Request**
  - `youtubeUrl: string`
  - `titleHint?: string`

- **Response**
  - `sourceContentId: string`
  - `status: "transcribing" | "ready"`
  - `metadata: { videoId, durationSeconds?, channel?, thumbnailUrl? }`

**Implemented Behaviour** ✅

- Parse YouTube URL → video ID ✅
- Upsert `source_content` for the org ✅
- Fetch transcript → normalize to `source_text` ✅
- Update `ingest_status = 'ingested'` ✅
- Chunk `source_text` into overlapping segments and write `chunk` rows ✅
- Compute embeddings and index them in vector store ✅

**Implementation Details**

- **Database Schema**: `chunk` table created (`server/database/schema/chunk.ts`) ✅
- **Chunking Service**: `chunkSourceContent` helper (`server/services/sourceContent/chunkSourceContent.ts`) ✅
- **YouTube Ingest**: Modified `ingestYouTubeSource` to invoke chunking after transcript storage ✅
- **Authentication**: Google OAuth integration for YouTube captions API ✅

**Testing Results** ✅
- Successfully ingests YouTube videos with transcript chunking
- Creates searchable chunk rows in database
- Integrates with existing RAG pipeline for content generation

---

## 3.2 Plan / Outline (Content Plan) ✅ INTEGRATED

**Implementation Status**

- **Integrated into staged pipeline** (`server/services/content/generation.ts` lines 300-406) ✅
- Planning occurs as **AI-Planned Brief Stage** within `generateContentDraft` ✅

**Implemented Behaviour** ✅

- LLM reads:
  - Chunked transcript data with RAG context ✅
  - Content generation instructions and target schema ✅
  - Org-scoped content preferences ✅
- Produces structured outline + frontmatter before section generation ✅
- Creates stable foundation for per-section writing ✅

**Integration Details**

- **Not exposed as separate endpoint** - integrated into content generation pipeline
- **Frontmatter derivation**: Title, description, SEO metadata generated from AI brief ✅
- **Section planning**: Structured outline feeds into per-section generation ✅
- **JSON parsing safeguards**: Reliable structured output handling ✅

**Testing Results** ✅
- Successfully generates structured content plans from YouTube transcripts
- Produces consistent frontmatter and section outlines
- Feeds into downstream section generation with proper context

---

## 3.3 Frontmatter Generation ✅ INTEGRATED

**Implementation Status**

- **Integrated into AI-Planned Brief Stage** (`server/services/content/generation.ts`) ✅
- Frontmatter generated as part of structured planning phase ✅

**Implemented Behaviour** ✅

- Takes outline + SEO hints from AI planning stage ✅
- Applies content-type specific metadata (blog_post, how_to, etc.) ✅
- Emits stable `frontmatter` object persisted on `content_version` ✅
- Includes: title, description, slug, content_type, schema hints ✅

**Integration Details**

- **Not separate endpoint** - part of unified generation pipeline
- **Stable before section writing**: Frontmatter locked in during planning phase ✅
- **Org-scoped**: Respects organization context and branding ✅
- **SEO-aware**: Incorporates keyword targeting and schema markup ✅

**Testing Results** ✅
- Generates consistent frontmatter metadata from transcript content
- Properly structures SEO-friendly titles and descriptions
- Maintains stability across section generation phases
- Displays correctly in content detail UI with metadata cards

---

## 3.4 Section Generation (Per‑Section, RAG‑Aware) ✅ COMPLETED

**Implementation Status**

- **RAG-Contextualized Section Generation** (`server/services/content/generation.ts` lines 409-640) ✅
- Per-section writing with transcript chunk context ✅

**Implemented Behaviour** ✅

For each planned section:

- Build retrieval query based on section title/type/notes ✅
- Query chunk embeddings for most relevant transcript `chunk` previews (RAG) ✅
- LLM call for **only that section** with:
  - System: "You are writing ONE section of a blog post…" ✅
  - User: section description + RAG snippets + global instructions ✅
- Produce `body_mdx` for that section ✅
- JSON parsing safeguards for reliable structured output ✅

**Implementation Details**

- **RAG Integration**: Uses existing chunk embeddings and retrieval system ✅
- **Section-Specific Prompts**: Tailored prompts for each section type and context ✅
- **Error Handling**: JSON parsing safeguards prevent generation failures ✅
- **Context Assembly**: Similar to existing `_gather_transcript_context` patterns ✅

**Testing Results** ✅
- Successfully generates individual sections with relevant transcript context
- Produces structured sections with proper MDX formatting
- Integrates seamlessly with chunk-based RAG system
- Displays sections with summaries and expandable full text in UI

---

## 3.5 Assemble Full Version From Sections ✅ COMPLETED

**Implementation Status**

- **MDX Assembly Stage** integrated into `generateContentDraft` pipeline ✅
- Stitches sections into complete MDX document ✅

**Implemented Behaviour** ✅

- Build `body_mdx` from structured sections:
  - `# {frontmatter.title}` ✅
  - For each section in order: `## {s.title}\n\n{s.body_mdx}\n` ✅
  - Proper heading hierarchy (H2, H3, etc.) ✅
- Capture section offsets, metadata, and assets ✅
- Persist new `content_version` row and update `content.current_version_id` ✅
- Generate assets metadata with generator info ✅

**Implementation Details**

- **Section Offset Tracking**: Captures `startOffset` and `endOffset` for each section ✅
- **Metadata Preservation**: Maintains section-level metadata and word counts ✅
- **Asset Management**: Records generator source, model, and creation metadata ✅
- **Version Management**: Creates new `content_version` with complete structured data ✅

**Testing Results** ✅
- Successfully assembles complete MDX documents from individual sections
- Maintains proper section structure and metadata
- Creates versioned content with full traceability
- Displays assembled content correctly in content detail UI with full MDX body

---

## 3.6 SEO Analysis ⚠️ PARTIAL

**Implementation Status**

- **Basic SEO metadata generation** integrated into content pipeline ✅
- **Full SEO analysis endpoint** not yet implemented ❌

**Current Implementation** ✅

- Frontmatter includes SEO-friendly metadata (title, description, schema hints) ✅
- Word count and section structure tracking ✅
- Content type and schema awareness ✅
- Basic metadata quality from AI planning stage ✅

**Missing Implementation** ❌

- Dedicated SEO analysis endpoint
- Comprehensive readability scoring
- Keyword focus analysis
- Schema validation
- SEO suggestions and recommendations
- `seo_snapshot` storage on content versions

**Next Steps**

- Port existing SEO analyzer logic to Nuxt
- Create dedicated `/api/content/{contentId}/versions/{versionId}/seo` endpoint
- Integrate SEO analysis into content generation pipeline
- Store SEO snapshots on `content_version` records

---

## 3.7 Section Patching (Chat‑Driven Edits) ⚠️ FOUNDATION READY

**Implementation Status**

- **Foundation components implemented** ✅
- **Dedicated section patching endpoint** not yet implemented ❌

**Available Building Blocks** ✅

- RAG system with chunk embeddings and retrieval ✅
- Section-aware content structure in `content_version.sections` ✅
- AI Gateway integration for section-specific prompts ✅
- Content versioning and assembly pipeline ✅
- Organization-scoped access controls ✅

**UI Foundation** ✅

- Content detail page displays individual sections with summaries ✅
- Section expansion interface ("Show full section") ✅
- Editing chat module present in content detail view ✅
- Section-level metadata and structure preserved ✅

**Missing Implementation** ❌

- Dedicated `/api/content/{contentId}/sections/{sectionId}/patch` endpoint
- Section-specific editing prompts and context assembly
- RAG-aware section rewriting logic
- Automatic reassembly and new version creation after section edits

**Next Steps**

- Implement section patching endpoint using existing RAG and versioning infrastructure
- Create section-specific editing prompts similar to existing patterns
- Wire section editing to chat interface for in-context editing experience

---

## 4. Sections JSON Shape (On `content_version.sections`)

Sections are the structured index over `body_mdx` used for:

- Rendering a TOC.
- Section‑level generation and patching.
- SEO and schema‑aware enrichment.

**Canonical shape** (conceptual):

- Each section object:
  - `section_id: string` — stable id (UUID or deterministic).
  - `index: number` — 0‑based order.
  - `type: string` — e.g. `"intro" | "body" | "faq" | "cta" | "recipe_step"`.
  - `level?: number` — heading level (2 for H2, 3 for H3), if applicable.
  - `title?: string` — heading text.
  - `anchor?: string` — slug/anchor for deep links.
  - `startOffset?: number` — optional char index into `body_mdx`.
  - `endOffset?: number` — optional char index into `body_mdx`.
  - `wordCount: number` — per‑section word count.
  - `summary?: string` — optional summary.
  - `body_mdx?: string` — body for this section (used heavily in patch flow).
  - `meta?: Record<string, any>` — arbitrary hints (importance, SEO flags, todos, etc.).

**Notes**

- Existing section extraction utilities already work with a very similar shape; Nuxt should align field names where practical (e.g. `section_id`, `index`, `title`, `body_mdx`, `summary`).

---

## 5. Chat‑First UX and Pipeline Triggers ✅ COMPLETED

**Implementation Status**

- **Chat-driven content generation** fully implemented ✅
- **Pipeline integration** with natural conversation flow ✅

**Implemented Behaviour** ✅

- **`POST /api/chat`** with URL detection and content generation ✅
  - Detect YouTube URLs in chat messages ✅
  - Upsert `source_content` for YouTube videos ✅
  - Trigger complete pipeline stages:
    1. Ingest + chunks (via YouTube ingest API) ✅
    2. Plan (AI-planned brief stage) ✅
    3. Frontmatter (integrated into planning) ✅
    4. Generate sections (RAG-aware per-section writing) ✅
    5. Assemble version (MDX assembly with metadata) ✅
    6. ~~Run SEO analysis~~ (basic SEO metadata only) ⚠️
  - Return final `contentId`/`versionId` ✅

**UI Implementation** ✅

- **Chat Landing Page** (`app/pages/[slug]/chat.vue`):
  - Real draft data displayed in cards ✅
  - Status, content type, section/word counts ✅
  - Quick navigation and actions per draft ✅
  - "New Draft vs existing drafts" dropdown ✅

- **Content Detail Route** (`app/pages/[slug]/content/[id].vue`):
  - Current version, sections, SEO plan display ✅
  - Source info with ingest status ✅
  - MDX body rendering ✅
  - Editing chat module for in-context editing ✅

**Testing Results** ✅
- Natural conversation flow from chat to content generation
- Seamless integration between chat interface and staged pipeline
- Proper routing and navigation between chat and content detail views

---

## 6. Implementation Status Summary

### ✅ COMPLETED COMPONENTS

- **Database Schema**
  - `server/database/schema/chunk.ts` - Chunk table for transcript segments ✅
  - `server/database/schema/index.ts` - Schema exports ✅
  - Database migrations and schema synchronization ✅

- **YouTube Ingest Pipeline**
  - `server/api/source-content/youtube.post.ts` - YouTube ingest endpoint ✅
  - `server/services/sourceContent/chunkSourceContent.ts` - Chunking helper ✅
  - `server/services/sourceContent/youtubeIngest.ts` - Modified for chunking ✅
  - Google OAuth integration for YouTube captions ✅

- **Content Generation Pipeline**
  - `server/services/content/generation.ts` - Rebuilt staged pipeline ✅
    - Chunking/fetching stage (lines 62-215) ✅
    - AI-planned brief stage (lines 300-406) ✅
    - RAG-contextualized section generation (lines 409-640) ✅
    - MDX assembly with metadata capture ✅

- **UI Integration**
  - `app/pages/[slug]/chat.vue` - Real draft data in cards ✅
  - `app/pages/[slug]/content/[id].vue` - Staged data display ✅
  - Section-level UI with summaries and metadata ✅
  - Navigation between chat and content detail views ✅

- **API Endpoints**
  - `POST /api/source-content/youtube` ✅
  - `POST /api/content/generate` (rebuilt with staged pipeline) ✅
  - `POST /api/chat` (integrated with pipeline) ✅

### ⚠️ PARTIAL/MISSING COMPONENTS

- **SEO Analysis** - Basic metadata only, full analysis endpoint missing
- **Section Patching** - Foundation ready, dedicated endpoint not implemented
- **Dedicated Planning Endpoint** - Integrated into generation, not separate

### 🎯 ACHIEVEMENT

**Successfully transformed monolithic content generation into a reusable, staged pipeline** that provides:
- End-to-end YouTube ingest with searchable chunks
- Deterministic plan → sections → assemble behavior  
- RAG-aware section generation with transcript context
- Section-first architecture with editing capabilities
- Chat-driven UX with natural conversation flow
- Real-time UI reflecting staged pipeline data

The implementation maintains backward compatibility while enabling the section-level editing and reusable pipeline architecture described in this plan.
