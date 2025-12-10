/**
 * SSE Streaming Utility for Cloudflare Workers
 *
 * Provides a clean Web Streams API-based implementation for Server-Sent Events.
 * This is designed specifically for Cloudflare Workers runtime.
 */

export interface SSEWriter {
  write: (eventType: string, data: any) => void
  close: () => void
  error: (err: Error) => void
}

export interface SSEStreamResult {
  stream: ReadableStream<Uint8Array>
  writer: SSEWriter
}

/**
 * Creates an SSE stream using Web Streams API
 *
 * @returns Object containing the ReadableStream and a writer interface
 *
 * @example
 * const { stream, writer } = createSSEStream()
 *
 * // Return stream immediately to start response
 * return new Response(stream, {
 *   headers: {
 *     'Content-Type': 'text/event-stream',
 *     'Cache-Control': 'no-cache',
 *     'Connection': 'keep-alive'
 *   }
 * })
 *
 * // Write events asynchronously
 * writer.write('message', { text: 'Hello' })
 * writer.close()
 */
export function createSSEStream(): SSEStreamResult {
  const encoder = new TextEncoder()
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null

  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      controller = ctrl
    },
    cancel() {
      // Client disconnected
      controller = null
    }
  })

  const writer: SSEWriter = {
    write(eventType: string, data: any) {
      if (!controller) {
        console.warn('[SSE] Attempted to write to closed stream')
        return
      }

      try {
        const eventData = JSON.stringify(data)
        const sseMessage = `event: ${eventType}\ndata: ${eventData}\n\n`
        const bytes = encoder.encode(sseMessage)
        controller.enqueue(bytes)
      } catch (error) {
        console.error('[SSE] Failed to write event:', error)
        // Try to send error event
        try {
          const errorMessage = `event: error\ndata: ${JSON.stringify({ message: 'Serialization failed' })}\n\n`
          controller.enqueue(encoder.encode(errorMessage))
        } catch {
          // Silent fail if we can't even send error
        }
      }
    },

    close() {
      if (controller) {
        try {
          controller.close()
        } catch (error) {
          console.error('[SSE] Failed to close stream:', error)
        }
        controller = null
      }
    },

    error(err: Error) {
      if (controller) {
        try {
          // Send error event before closing
          const errorMessage = `event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`
          controller.enqueue(encoder.encode(errorMessage))
          controller.close()
        } catch (error) {
          console.error('[SSE] Failed to send error:', error)
          try {
            controller.error(err)
          } catch {
            // Silent fail
          }
        }
        controller = null
      }
    }
  }

  return { stream, writer }
}

/**
 * Format SSE event string (for compatibility with existing code)
 *
 * @deprecated Use createSSEStream() instead for proper streaming
 */
export function formatSSEEvent(eventType: string, data: any): string {
  try {
    const eventData = JSON.stringify(data)
    return `event: ${eventType}\ndata: ${eventData}\n\n`
  } catch (error) {
    console.error('Failed to serialize SSE data:', error)
    return `event: ${eventType}\ndata: ${JSON.stringify({ error: 'Serialization failed' })}\n\n`
  }
}
