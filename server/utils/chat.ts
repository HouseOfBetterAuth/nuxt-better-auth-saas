export const extractYouTubeId = (url: URL): string | null => {
  if (url.hostname === 'youtu.be') {
    return url.pathname.replace('/', '')
  }

  if (url.searchParams.has('v')) {
    return url.searchParams.get('v')
  }

  const pathSegments = url.pathname.split('/')
  const embedIndex = pathSegments.indexOf('embed')
  if (embedIndex !== -1 && pathSegments[embedIndex + 1]) {
    return pathSegments[embedIndex + 1]
  }

  return null
}
