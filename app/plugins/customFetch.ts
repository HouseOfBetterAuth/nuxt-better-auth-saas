export default defineNuxtPlugin(() => {
  const $customFetch = $fetch.create({
    onRequest({ request, options }) {
      console.log(request, options)
    }
    // onResponse({ response }) {
    // },
    // onResponseError({ response }) {
    // }
  })
  // Expose to useNuxtApp().$customFetch
  return {
    provide: {
      customFetch: $customFetch
    }
  }
})
